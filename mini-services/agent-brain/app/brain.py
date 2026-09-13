r"""
The agent graph.

    START
      |
    sense      -> read the network: the core congestion signal per zone probe
                  device. The brain holds the API client itself, because if the
                  engine pre-fetched everything then "which signal should I look
                  at next" would not be the agent's decision at all.
      |
    features   -> the cheap layer. Learn what is normal for this zone at this
                  hour, how far above its own normal it is, how fast it is
                  moving. No hosted calls, no API cost.
      |
    recall     -> score last cycle's forecast against what actually happened,
                  and nudge the model by its own error. This is the loop.
      |
    forecast   -> a 30-minute call per zone plus a salience score for the cycle.
                  Still free.
      |
    route      -> THE DECISION. ACT now, PROBE for one more signal, or HOLD and
                  spend nothing. A real choice with a real cost, taken on the
                  evidence rather than by a threshold someone hardcoded.
      | \
      |  \-- PROBE --> probe -> reassess --> back to route (at most once; a
      |                                        probe that settles nothing is
      |                                        itself a decision, and the
      |                                        graph resolves it for free)
      |
      \---- ACT --> brief -> emit
      \---- HOLD -----------> emit
                                |
                               END

What changed from the version this replaces: nothing here runs in a fixed
sequence. Quiet cycles cost zero hosted calls. Busy cycles get an operator
brief. Ambiguous cycles spend one network call to become un-ambiguous. Each of
those three is a different path through the same graph, on the same input.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from .config import DEMO_VISITOR, settings
from .llm import chain as llm_chain
from .model import CheapModel, ForecastRow, Salience, ZoneFeatures
from .nac import nac
from .trace import Ledger, Trace

ACTIONS = ["deploy-marshals", "throttle-gates", "reroute-flow", "boost-comms", "safety-slice"]
SIGNALS = ["geofence", "location", "reachability", "roaming"]


class BrainState(TypedDict, total=False):
    """Everything that flows between nodes. Plain data only — the API client,
    the ledger and the trace live on the Brain and are reached through `self`."""

    # request context (underscore-prefixed keys are internal, never shipped)
    _req: dict
    _wanted_signals: list[str]

    cycle: int
    run_id: str
    minute_of_day: int
    clock_label: str
    phase: str

    readings: list[dict]
    perceived: dict[str, float]
    carrier: dict[str, dict]
    features: list[ZoneFeatures]
    forecast: list[ForecastRow]
    salience: Optional[Salience]

    pass_no: int
    probes: int
    api_spent: int
    extra_spent: int
    signals_used: list[str]
    evidence: list[dict]

    decision: str
    route_decision: str
    confidence: float
    reasoning: str
    if_wrong: str
    focus_zone_id: str
    focus_zone_name: str
    llm_calls: int
    provider: str

    brief: dict
    guardian: Optional[dict]
    guardian_clear: bool
    reroute: Optional[dict]
    forecast_error: Optional[float]
    budget_exhausted: bool

    response: dict


# ======================================================================
# Prompts
# ======================================================================

ROUTE_SYSTEM = """You are the routing node of a crowd-safety agent graph watching a large venue through telecom network APIs (Nokia Network as Code / CAMARA).

Each cycle you decide whether this moment deserves action. Rules you must respect:
- The signal is RADIO NETWORK CONGESTION: an EARLY INDICATOR OF CROWD PRESSURE, not a headcount. Never state or imply a count of people from it.
- "Normal" for a zone is that zone's OWN learned baseline for this time of night, not a global threshold. A zone merely busy at its usual peak matters less than a zone far above its own normal.
- Coverage is partial. Roaming guests are largely invisible, so "not visible" must never be read as "not present".

You receive: level, learned normal, deviation in standard deviations, rate of change per minute, the 30-minute forecast with its margin to the alarm band, and any evidence already gathered.

Choose exactly one:
  ACT   - evidence is already sufficient to raise an operator alert and/or reroute guests.
  PROBE - you cannot yet tell whether this matters and ONE more network signal would settle it. Ask only for signals that would genuinely change your mind.
  HOLD  - nothing here needs attention. Ask for nothing; spend nothing.

Reply with ONLY compact JSON:
{"decision":"ACT|PROBE|HOLD","confidence":0.0-1.0,"zone":"<zone name or empty string>","why":"<=200 chars: what you saw and what you chose","signals":["geofence"|"location"|"reachability"|"roaming"],"ifWrong":"<=120 chars: the evidence that would change your mind"}"""

BRIEF_SYSTEM = """You are the operator-facing node of the same crowd-safety agent graph. The routing node has decided to ACT. Write the operator brief and the concrete actions.

Constraints:
- Plain operational language. Two sentences maximum for detail.
- actions must come only from: deploy-marshals, throttle-gates, reroute-flow, boost-comms, safety-slice. At most three, strongest first.
- Only propose a reroute when a zone is genuinely over its alarm band.
- Congestion is a proxy for crowd pressure, not a headcount. Do not invent visitor numbers.

Reply with ONLY compact JSON:
{"headline":"<=70 chars","detail":"<=240 chars","severity":"warn|critical","actions":["..."],"reroute":{"targetZoneId":"<zone id>","reason":"<=140 chars"},"visitorMessage":"<=160 chars for the guest app"}"""


# ======================================================================
# Brain
# ======================================================================


class Brain:
    """Owns the graph, the learned model and the spend ledger."""

    def __init__(self) -> None:
        self.model = CheapModel(
            horizon_minutes=settings.horizon_minutes, cycle_minutes=settings.cycle_sim_minutes
        )
        self.ledger = Ledger(settings.llm_calls_per_run)
        self.run_id = "run-1"
        self.alert_zone_id: Optional[str] = None
        self._trace = Trace()
        self._lock = asyncio.Lock()
        # The carrier's cross-check for this cycle, so the routing policy can
        # treat disagreement as a reason to spend a call.
        self._carrier: dict[str, dict] = {}
        self._graph = self._build()
        self.last_decision = "HOLD"
        self.last_reasoning = ""

    # ------------------------------------------------------------------
    def reset(self, run_id: str = "run-1") -> None:
        self.model.reset()
        self.ledger = Ledger(settings.llm_calls_per_run)
        self.run_id = run_id
        self.alert_zone_id = None
        self._carrier = {}
        self.last_decision = "HOLD"
        self.last_reasoning = ""

    # ------------------------------------------------------------------
    # graph wiring
    # ------------------------------------------------------------------
    def _build(self):
        g = StateGraph(BrainState)
        g.add_node("sense", self.sense)
        g.add_node("features", self.features)
        g.add_node("recall", self.recall)
        g.add_node("forecast", self.forecast)
        g.add_node("route", self.route)
        g.add_node("probe", self.probe)
        g.add_node("reassess", self.reassess)
        g.add_node("brief", self.brief)
        g.add_node("emit", self.emit)

        g.add_edge(START, "sense")
        g.add_edge("sense", "features")
        g.add_edge("features", "recall")
        g.add_edge("recall", "forecast")
        g.add_edge("forecast", "route")
        g.add_conditional_edges(
            "route", self._branch, {"act": "brief", "probe": "probe", "hold": "emit"}
        )
        g.add_edge("probe", "reassess")
        g.add_edge("reassess", "route")
        g.add_edge("brief", "emit")
        g.add_edge("emit", END)
        return g.compile()

    def _branch(self, state: BrainState) -> str:
        d = state.get("decision", "HOLD")
        if d == "ACT":
            return "act"
        if d == "PROBE" and state.get("probes", 0) < settings.max_probes_per_cycle:
            return "probe"
        return "hold"

    # ------------------------------------------------------------------
    # nodes
    # ------------------------------------------------------------------
    async def sense(self, state: BrainState) -> dict:
        """Perception. The agent spends the network calls and decides what the
        reading means, rather than being handed a pre-built picture."""
        req = state["_req"]
        readings = await nac.congestion(req["zones"], self.ledger)

        self._trace.emit(
            "NAC",
            "signal",
            f"Congestion Insights polled · {len(readings)} zone probe devices",
            source="api",
            detail=" · ".join(f"{r.zone_id} {r.congestion}" for r in readings),
        )

        live = any(r.source == "live" for r in readings)
        if not live:
            self._trace.emit(
                "NAC",
                "signal",
                "Network gateway unavailable — running the deterministic sandbox signal",
                source="api",
                level="warn",
                detail=f"last: {nac.last_error or nac.last_status or 'no key'}",
            )

        # Occupancy (the venue's own probe devices and model) is the primary
        # measurement. The carrier class is an independent cross-check on it.
        perceived = {r.zone_id: r.observed_pct for r in readings}
        carrier = {
            r.zone_id: {
                "class": r.congestion,
                "levelPct": r.network_pct,
                "corroboration": r.corroboration,
            }
            for r in readings
        }
        self._carrier = carrier

        if live:
            agree = [r for r in readings if r.corroboration == "agrees"]
            disagree = [r for r in readings if r.corroboration == "disagrees"]
            self._trace.emit(
                "NAC",
                "signal",
                f"Carrier class cross-check: {len(agree)}/{len(readings)} probe devices agree with the venue picture",
                source="api",
                level="warn" if disagree else "info",
                detail=(
                    "the class is coarse and sandbox classes are fixed per device, so it corroborates at "
                    "most — it is never averaged into the occupancy number, because congestion is an early "
                    "indicator of crowd pressure and not a headcount"
                ),
            )

        return {
            "readings": [r.__dict__ for r in readings],
            "carrier": carrier,
            "perceived": perceived,
            "api_spent": len(readings),
            "extra_spent": 0,
            "signals_used": ["congestion"],
            "probes": 0,
            "pass_no": 0,
            "evidence": [],
        }

    async def features(self, state: BrainState) -> dict:
        """Cheap layer: learn this zone's normal, describe the movement."""
        req = state["_req"]
        perceived = state.get("perceived") or {}
        zones = []
        for z in req["zones"]:
            zz = dict(z)
            if z["id"] in perceived:
                # The network-refined value is what the agent reasons about.
                zz["densityPct"] = perceived[z["id"]]
            zones.append(zz)
        return {"features": self.model.features(zones, int(req["minuteOfDay"]))}

    async def recall(self, state: BrainState) -> dict:
        """Score the previous forecast against reality and correct the model."""
        err = self.model.verify(state.get("features", []), state.get("minute_of_day", 0))
        if err is None:
            return {"forecast_error": None}
        if err < 0.5:
            # Calling out a 0.1-point miss on every cycle would be noise, and
            # noise is how a reasoning trace becomes wallpaper.
            self.ledger.forecast_errors.append(err)
            return {"forecast_error": err}
        high = self.model.bias < 0
        self._trace.emit(
            "BRAIN",
            "reason",
            f"Last cycle's 30-minute call missed by {err:.1f} points on average — model corrected "
            f"({'+' if high else '-'}{abs(self.model.bias):.1f}pt, it had been running {'high' if high else 'low'})",
            source="template",
            detail="this score is the feedback loop: every forecast is checked against the next one",
        )
        self.ledger.forecast_errors.append(err)
        return {"forecast_error": err}

    async def forecast(self, state: BrainState) -> dict:
        feats: list[ZoneFeatures] = state.get("features", [])
        rows = self.model.forecast(feats, settings.alarm_pct, settings.critical_pct)
        sal = self.model.salience(feats, rows, settings.alarm_pct)

        if feats:
            top = max(feats, key=lambda f: f.pct)
            known = sum(1 for f in feats if f.baseline_source != "none")
            self._trace.emit(
                "ORACLE",
                "reason",
                f"{top.short} is busiest at {top.pct:.0f}%; {rows[0].label} is forecast to reach "
                f"{rows[0].plus_pct:.0f}% within {settings.horizon_minutes} minutes",
                source="template",
                level="warn" if rows[0].risk == "high" else "info",
                detail=f"statistical model, no hosted call · {known}/{len(feats)} zones have a learned baseline",
            )
            self._trace.emit(
                "BRAIN",
                "reason",
                f"Salience {sal.score:.2f} — {sal.explain()}",
                source="template",
                detail=f"skip threshold {settings.hold_salience:.2f} · {top.summary()}",
            )
        return {"forecast": rows, "salience": sal}

    # ------------------------------------------------------------------
    async def route(self, state: BrainState) -> dict:
        """The decision node. A hosted call only when the cycle earned one."""
        feats: list[ZoneFeatures] = state.get("features", [])
        rows: list[ForecastRow] = state.get("forecast", [])
        sal: Salience = state["salience"]
        pass_no = state.get("pass_no", 0)

        # --- path 1: nothing is happening. Skip, for free. ---------------
        if pass_no == 0 and sal.score < settings.hold_salience:
            self._trace.emit(
                "BRAIN",
                "decision",
                f"HOLD — nothing actionable (salience {sal.score:.2f} below {settings.hold_salience:.2f}). No hosted call spent.",
                source="template",
            )
            return {
                "decision": "HOLD",
                "route_decision": "HOLD",
                "confidence": 0.9,
                "reasoning": "quiet cycle",
                "provider": "templates",
            }

        # --- path 2: the budget is gone. Keep deciding, stop paying. -----
        if self.ledger.budget_exhausted:
            self._trace.emit(
                "BRAIN",
                "decision",
                f"Hosted call budget exhausted ({self.ledger.llm_calls}/{self.ledger.llm_budget}) — resolving by policy from here on",
                source="template",
                level="warn",
            )
            return {
                **self._tag(self._finalise(self._policy(feats, rows, sal), feats, rows, pass_no), pass_no),
                "budget_exhausted": True,
                "provider": "templates",
            }

        # --- path 3: second pass. Only pay again if still ambiguous. -----
        if pass_no > 0 and not self._still_ambiguous(feats, state.get("evidence", [])):
            d = self._tag(self._finalise(self._policy(feats, rows, sal), feats, rows, pass_no), pass_no)
            top = max(feats, key=lambda f: f.pct) if feats else None
            self._trace.emit(
                "BRAIN",
                "decision",
                f"Evidence sufficient after the probe — resolving as {d['decision']} without another hosted call",
                source="template",
                detail=f"salience {sal.score:.2f} · {top.summary() if top else 'no data'}",
            )
            return d

        # --- path 4: the paid decision -----------------------------------
        parsed, provider = await llm_chain.complete_json(ROUTE_SYSTEM, self._digest(state), max_tokens=600)
        self.ledger.charge_llm(provider, ok=parsed is not None)

        if parsed is None:
            d = self._tag(self._finalise(self._policy(feats, rows, sal), feats, rows, pass_no), pass_no)
            self._trace.emit(
                "BRAIN",
                "decision",
                f"No hosted provider answered — routing by policy as {d['decision']}",
                source="template",
                level="warn",
                detail="ollama and gemini both unavailable; the graph still decides, it just decides by rule",
            )
            return d

        decision = str(parsed.get("decision", "HOLD")).upper()
        if decision not in ("ACT", "PROBE", "HOLD"):
            decision = "HOLD"
        signals = [s for s in (parsed.get("signals") or []) if s in SIGNALS][:2] if decision == "PROBE" else []
        top = max(feats, key=lambda f: f.pct) if feats else None
        zone_name = str(parsed.get("zone") or (top.name if top else ""))
        confidence = float(parsed.get("confidence") or 0.5)
        why = str(parsed.get("why") or "").strip()[:240]
        if_wrong = str(parsed.get("ifWrong") or "").strip()[:160]

        self._trace.emit(
            "BRAIN",
            "decision",
            f"{decision} — {why}",
            source="llm",
            level="warn" if decision == "ACT" else "info",
            detail=" · ".join(
                x
                for x in [
                    f"confidence {confidence:.0%}",
                    f"focus {zone_name}" if zone_name else "",
                    f"spending on {', '.join(signals)}" if signals else "",
                    f"would change my mind: {if_wrong}" if if_wrong else "",
                ]
                if x
            ),
        )

        d: dict[str, Any] = {
            "decision": decision,
            "confidence": confidence,
            "reasoning": why,
            "if_wrong": if_wrong,
            "focus_zone_id": next((f.zone_id for f in feats if f.name == zone_name), top.zone_id if top else ""),
            "focus_zone_name": zone_name,
            "provider": provider,
            "llm_calls": state.get("llm_calls", 0) + 1,
            "_wanted_signals": signals,
        }
        d = self._tag(d, pass_no)
        d = self._finalise(d, feats, rows, pass_no)
        return d

    # ------------------------------------------------------------------
    async def probe(self, state: BrainState) -> dict:
        """Spend network API calls — but only on what the router asked for."""
        wanted: list[str] = list(state.get("_wanted_signals") or [])
        extra_spent = state.get("extra_spent", 0)
        api_spent = state.get("api_spent", 0)
        feats: list[ZoneFeatures] = state.get("features", [])
        focus = next((f for f in feats if f.zone_id == state.get("focus_zone_id")), None)
        focus = focus or (feats[0] if feats else None)
        zone_idx = next((i for i, f in enumerate(feats) if focus and f.zone_id == focus.zone_id), 0)

        evidence: list[dict] = list(state.get("evidence", []))
        used: list[str] = []
        for sig in wanted:
            if extra_spent >= settings.api_calls_per_cycle:
                self._trace.emit(
                    "BRAIN",
                    "decision",
                    f"Refusing to spend on {sig} — this cycle's API budget is already used up",
                    source="template",
                    level="warn",
                    detail=f"{extra_spent} extra calls spent, cap {settings.api_calls_per_cycle}",
                )
                break
            if sig == "geofence":
                res = await nac.geofence(focus.zone_id if focus else "stage", zone_idx, self.ledger)
            elif sig == "location":
                res = await nac.location(focus.name if focus else "zone", self.ledger)
            elif sig == "reachability":
                res = await nac.reachability(self.ledger, DEMO_VISITOR)
            elif sig == "roaming":
                res = await nac.roaming(self.ledger, DEMO_VISITOR)
            else:
                continue
            evidence.append(res)
            used.append(sig)
            extra_spent += 1
            api_spent += 1
            self._trace.emit(
                "NAC",
                "signal",
                f"Spent one network call on {sig} — {self._describe(res)}",
                source="api",
                detail=f"requested by the routing decision · {res.get('mode', 'sandbox')} mode",
            )

        self._trace.emit(
            "BRAIN",
            "reason",
            f"Probe complete — re-weighing with {len(used)} extra signal(s) before deciding",
            source="template",
        )
        return {
            "evidence": evidence,
            "signals_used": list(dict.fromkeys(list(state.get("signals_used", [])) + used)),
            "probes": state.get("probes", 0) + 1,
            "api_spent": api_spent,
            "extra_spent": extra_spent,
            "pass_no": state.get("pass_no", 0) + 1,
        }

    async def reassess(self, state: BrainState) -> dict:
        """Fold the new evidence in. Evidence that settles the question raises
        salience; evidence that settles nothing is recorded as such."""
        evidence = state.get("evidence", [])
        sal: Salience = state["salience"]
        boost = 0.0
        notes: list[str] = []
        for e in evidence:
            if e.get("signal") == "geofence":
                boost += 0.10
                notes.append("a geofenced device was seen entering the zone")
            elif e.get("signal") == "location" and e.get("mode") == "live":
                boost += 0.08
                notes.append(f"carrier fix confirms devices in the zone (±{e.get('accuracyM')}m)")
            elif e.get("signal") == "reachability" and not e.get("reachable"):
                notes.append("the demo visitor is UNREACHABLE — a push would have been a lie")
            elif e.get("signal") == "roaming":
                notes.append(
                    f"roaming={e.get('roaming')} ({e.get('country')}) — a roaming guest is not evidence of absence"
                )

        new_score = round(min(1.0, sal.score + boost), 3)
        adjusted = Salience(
            score=new_score,
            pressure=sal.pressure,
            deviation=sal.deviation,
            velocity=sal.velocity,
            breach=sal.breach,
            components=sal.components,
        )
        self._trace.emit(
            "BRAIN",
            "reason",
            f"Re-weighed: salience {sal.score:.2f} → {new_score:.2f}",
            source="template",
            detail="; ".join(notes) if notes else "the extra signal neither confirmed nor cleared the concern",
        )
        return {"salience": adjusted}

    # ------------------------------------------------------------------
    async def brief(self, state: BrainState) -> dict:
        """ACT path: one hosted call producing both the narrative and the
        actions, so acting costs one call instead of three."""
        parsed, provider = await llm_chain.complete_json(BRIEF_SYSTEM, self._digest(state), max_tokens=700)
        self.ledger.charge_llm(provider, ok=parsed is not None)

        if parsed is None:
            brief = self._brief_policy(state)
            self._trace.emit(
                "GUARDIAN",
                "decision",
                brief["headline"],
                source="template",
                level=brief["severity"],
                detail=brief["detail"],
            )
            return {"brief": brief}

        actions = [a for a in (parsed.get("actions") or []) if a in ACTIONS][:3]
        severity = "critical" if parsed.get("severity") == "critical" else "warn"
        brief = {
            "headline": str(parsed.get("headline") or "").strip()[:90],
            "detail": str(parsed.get("detail") or "").strip()[:320],
            "severity": severity,
            "actions": actions,
            "reroute": parsed.get("reroute") or None,
            "visitorMessage": str(parsed.get("visitorMessage") or "").strip()[:200],
        }
        self._trace.emit(
            "GUARDIAN", "decision", brief["headline"], source="llm", level=severity, detail=brief["detail"]
        )
        return {"brief": brief, "llm_calls": state.get("llm_calls", 0) + 1}

    # ------------------------------------------------------------------
    async def emit(self, state: BrainState) -> dict:
        """Assemble the response, and close the loop by storing this cycle's
        forecast for the next cycle to score."""
        decision = state.get("decision", "HOLD")
        feats: list[ZoneFeatures] = state.get("features", [])
        rows: list[ForecastRow] = state.get("forecast", [])
        brief = state.get("brief") or {}
        best = max(feats, key=lambda f: f.pct) if feats else None

        guardian = None
        guardian_clear = False
        reroute = None

        if decision == "ACT" and brief and best:
            zone_id = state.get("focus_zone_id") or best.zone_id
            zone = next((f for f in feats if f.zone_id == zone_id), best)
            guardian = {
                "raise": True,
                "zoneId": zone.zone_id,
                "severity": brief.get("severity", "warn"),
                "headline": brief.get("headline") or f"Density building — {zone.name}",
                "detail": brief.get("detail") or zone.summary(),
                "actions": brief.get("actions") or ["deploy-marshals", "throttle-gates"],
            }
            self.alert_zone_id = zone.zone_id
            if brief.get("reroute"):
                reroute = {
                    "targetZoneId": brief["reroute"].get("targetZoneId") or zone.zone_id,
                    "reason": str(brief["reroute"].get("reason") or "")[:200],
                    "visitorMessage": brief.get("visitorMessage") or "",
                }
        elif self.alert_zone_id:
            zone = next((f for f in feats if f.zone_id == self.alert_zone_id), None)
            if zone is None or zone.pct < settings.alarm_pct - 8:
                guardian_clear = True
                self._trace.emit(
                    "GUARDIAN",
                    "observe",
                    f"{(zone.name if zone else 'Alert zone')} back inside the alarm band — alert cleared",
                    source="template",
                )
                self.alert_zone_id = None

        self.model.store_predictions(rows, state.get("minute_of_day", 0))
        # Count what the graph CHOSE, not just how it ended. A cycle that bought
        # evidence and then held is a PROBE, and the console should show it.
        route_decision = state.get("route_decision") or decision
        self.ledger.cycles += 1
        self.ledger.decisions[route_decision] += 1
        for s in state.get("signals_used", []):
            self.ledger.signals[s] += 1
        self.ledger.probes += state.get("probes", 0)

        self.last_decision = decision
        self.last_reasoning = state.get("reasoning", "")

        sal: Salience = state["salience"]
        response = {
            "mode": "langgraph",
            "decision": decision,
            "reasoning": state.get("reasoning", ""),
            "confidence": state.get("confidence", 0.0),
            "forecast": [r.to_wire() for r in rows],
            "guardian": guardian,
            "guardianClear": guardian_clear,
            "reroute": reroute,
            "trace": self._trace.as_list(),
            "stats": {
                "decision": decision,
                "routing": route_decision,
                "confidence": state.get("confidence", 0.0),
                "llmCalls": state.get("llm_calls", 0),
                "llmProvider": state.get("provider", "templates"),
                "apiCalls": state.get("api_spent", 0),
                "signals": list(dict.fromkeys(state.get("signals_used", []))),
                "probes": state.get("probes", 0),
                "salience": sal.score,
                "forecastErrorPct": state.get("forecast_error"),
                "budgetExhausted": self.ledger.budget_exhausted,
                "nacMode": nac.effective_mode,
                # Which endpoint this cycle's evidence actually came from live,
                # so the console can mark a degraded signal instead of hiding it.
                "signalModes": dict(nac.signal_modes),
            },
        }
        return {"response": response}

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _tag(d: dict, pass_no: int) -> dict:
        """Record what the router chose the FIRST time it looked. A cycle that
        bought evidence and then decided not to act is a PROBE, and pretending
        otherwise would hide the most interesting thing the graph does."""
        if pass_no == 0 and "decision" in d:
            d = {**d, "route_decision": d["decision"]}
        return d

    def _finalise(
        self, d: dict, feats: list[ZoneFeatures], rows: list[ForecastRow], pass_no: int = 0
    ) -> dict:
        """A PROBE that cannot be followed by another probe has to resolve.
        Turning it into ACT or HOLD here, with the reason attached, is the
        honest ending. On the first pass a probe is still allowed, so this is a
        no-op there — collapsing it early would delete the middle branch."""
        if pass_no == 0 or d.get("decision") != "PROBE":
            return d
        top = max(feats, key=lambda f: f.pct) if feats else None
        rising = bool(rows) and rows[0].plus_pct >= settings.alarm_pct and top is not None and top.velocity_pct_per_min > 0.2
        if top and (top.pct >= settings.alarm_pct or rising):
            return {
                **d,
                "decision": "ACT",
                "confidence": 0.6,
                "reasoning": f"probe spent; {top.short} is still rising and now over the alarm band, so act on it",
            }
        return {
            **d,
            "decision": "HOLD",
            "confidence": 0.7,
            "reasoning": "probe spent; the evidence does not support an action this cycle",
        }

    def _still_ambiguous(self, feats: list[ZoneFeatures], evidence: list[dict]) -> bool:
        """Would one more hosted call actually change anything? Only when the
        zone sits in the undecided middle and every probe came back sandboxed."""
        if not feats or not evidence:
            return False
        top = max(feats, key=lambda f: f.pct)
        if top.pct >= settings.critical_pct or top.pct < settings.alarm_pct - 15:
            return False
        inconclusive = all(e.get("mode") == "sandbox" for e in evidence)
        return inconclusive and (settings.alarm_pct - 15) <= top.pct < settings.alarm_pct

    def _carrier_disagreement(self, feats: list[ZoneFeatures]) -> Optional[ZoneFeatures]:
        """The zone where the carrier class most strongly contradicts the venue.

        Two independent measurements pointing different ways is exactly the
        situation where spending one more call is worth it — and, unlike a
        fixed threshold, it is a reason that only appears when the world is
        actually ambiguous.
        """
        worst: Optional[ZoneFeatures] = None
        worst_gap = 0.0
        for f in feats:
            entry = self._carrier.get(f.zone_id)
            if not entry or entry.get("corroboration") != "disagrees":
                continue
            gap = abs(f.pct - float(entry.get("levelPct") or 0.0))
            if gap > worst_gap:
                worst_gap, worst = gap, f
        return worst

    def _policy(self, feats: list[ZoneFeatures], rows: list[ForecastRow], sal: Salience) -> dict:
        """Deterministic stand-in for the routing decision. Same shape as the
        model's answer, so the graph behaves identically without a provider."""
        if not feats:
            return {"decision": "HOLD", "confidence": 0.5, "reasoning": "no zone data", "provider": "templates"}
        top = max(feats, key=lambda f: f.pct)
        hottest = max(f.pct for f in feats)
        hot = [f for f in feats if f.pct >= settings.critical_pct]
        near = [f for f in feats if f.pct >= settings.alarm_pct]
        pred_top = rows[0].plus_pct if rows else top.pct
        # Already there, or clearly on the way with speed behind it.
        pred_breach = (
            pred_top >= settings.alarm_pct
            and hottest >= settings.alarm_pct - 18
            and top.velocity_pct_per_min > 0.15
        )

        if hot or near or pred_breach:
            zone = (hot or near or [top])[0]
            return {
                "decision": "ACT",
                "confidence": 0.7,
                "reasoning": f"{zone.short} reads {zone.pct:.0f}% against a normal of {zone.phase_baseline:.0f}% — over the alarm band",
                "focus_zone_id": zone.zone_id,
                "focus_zone_name": zone.name,
                "provider": "templates",
            }
        # The undecided middle: it matters, but not enough to act on yet. Buy one
        # signal and choose the one whose absence is actually the obstacle.
        #
        # Disagreement with the carrier class is an extra reason to buy, but only
        # while the zone is near the band — otherwise a fixed sandbox class would
        # have us probing every quiet cycle for no gain.
        conflict = self._carrier_disagreement(feats) if top.pct >= settings.alarm_pct - 20 else None
        if sal.score >= settings.hold_salience or top.zscore >= 1.8 or bool(rows and rows[0].plus_pct >= settings.alarm_pct) or conflict:
            if conflict:
                # Confirm the crowd physically exists in the zone before acting on
                # a level the two sources disagree about.
                sig = "geofence"
                entry = self._carrier.get(conflict.zone_id) or {}
                why = (
                    f"{conflict.short} reads {conflict.pct:.0f}% while the carrier reports "
                    f"{entry.get('class', 'unknown')} — the two sources disagree, so one "
                    f"{sig} call settles whether the crowd is really there"
                )
            elif top.velocity_pct_per_min > 0.4 and top.baseline_source == "none":
                sig = "location"
                why = f"{top.short} is {top.deviation:+.0f}pt against its own baseline and rising — one {sig} call settles whether it matters"
            elif top.pct >= settings.alarm_pct - 24 and top.velocity_pct_per_min > 0:
                sig = "geofence"
                why = f"{top.short} is {top.deviation:+.0f}pt against its own baseline and rising — one {sig} call settles whether it matters"
            else:
                sig = "reachability"
                why = f"{top.short} is {top.deviation:+.0f}pt against its own baseline and rising — one {sig} call settles whether it matters"
            return {
                "decision": "PROBE",
                "confidence": 0.4,
                "reasoning": why,
                "focus_zone_id": (conflict or top).zone_id,
                "focus_zone_name": (conflict or top).name,
                "_wanted_signals": [sig],
                "provider": "templates",
            }
        return {"decision": "HOLD", "confidence": 0.8, "reasoning": "quiet cycle", "provider": "templates"}

    def _brief_policy(self, state: BrainState) -> dict:
        feats: list[ZoneFeatures] = state.get("features", [])
        top = max(feats, key=lambda f: f.pct) if feats else None
        if top is None:
            return {
                "headline": "Density building",
                "detail": "Zone readings crossed the alarm band.",
                "severity": "warn",
                "actions": ["deploy-marshals"],
                "reroute": None,
                "visitorMessage": "",
            }
        critical = top.pct >= settings.critical_pct
        return {
            "headline": f"{'Critical density' if critical else 'Density building'} — {top.name}",
            "detail": (
                f"{top.name} reads {top.pct:.0f}% against a learned normal of {top.phase_baseline:.0f}% "
                f"({top.deviation:+.0f}pt, {top.zscore:+.1f}σ), moving {top.velocity_pct_per_min:+.2f}% per minute. "
                + (
                    "Crush pressure rises sharply above roughly seven people per square metre — stage marshals and throttle inflow now."
                    if critical
                    else "Worth holding the gates on before the trend compounds."
                )
            )[:320],
            "severity": "critical" if critical else "warn",
            "actions": ["deploy-marshals", "throttle-gates", "reroute-flow"] if critical else ["deploy-marshals", "throttle-gates"],
            "reroute": {"targetZoneId": top.zone_id, "reason": f"{top.short} is over its alarm band"} if critical else None,
            "visitorMessage": f"{top.name} is filling fast — take the quieter route and save time." if critical else "",
        }

    @staticmethod
    def _describe(res: dict) -> str:
        sig = res.get("signal")
        if sig == "geofence":
            return f"subscription {res.get('subscriptionId') or 'pending'} ({res.get('mode')})"
        if sig == "location":
            return f"fix ±{res.get('accuracyM')}m ({res.get('mode')})"
        if sig == "reachability":
            return "device reachable" if res.get("reachable") else "device NOT reachable"
        if sig == "roaming":
            return f"roaming={res.get('roaming')} · {res.get('country')}"
        return str(res)

    def _digest(self, state: BrainState) -> str:
        """A compact, checkable picture of the moment for the prompt."""
        feats: list[ZoneFeatures] = state.get("features", [])
        rows: list[ForecastRow] = state.get("forecast", [])
        sal: Salience = state["salience"]
        by_id = {r.zone_id: r for r in rows}

        lines = [
            f"Venue clock {state.get('clock_label')} · phase: {state.get('phase')} · cycle {state.get('cycle')}",
            f"Salience for this cycle: {sal.score:.2f}  ({sal.explain()})",
            "",
            "Zones (level | learned normal | deviation | rate of change | 30-min forecast):",
        ]
        for f in sorted(feats, key=lambda x: x.pct, reverse=True):
            row = by_id.get(f.zone_id)
            lines.append(
                f"  {f.name} ({f.zone_id}): {f.pct:.0f}% | {f.phase_baseline:.0f}% [{f.baseline_source}] | "
                f"{f.deviation:+.0f}pt ({f.zscore:+.1f}σ) | {f.velocity_pct_per_min:+.2f}%/min | "
                f"{row.plus_pct:.0f}% by +{settings.horizon_minutes}min ({row.risk})"
                if row
                else f"  {f.name} ({f.zone_id}): {f.pct:.0f}%"
            )

        evidence = state.get("evidence") or []
        lines.append("")
        if evidence:
            lines.append("Extra network evidence already gathered this cycle:")
            for e in evidence:
                lines.append(f"  - {e}")
        else:
            lines.append("No extra network calls spent yet this cycle.")

        lines += [
            "",
            f"Alarm band is {settings.alarm_pct:.0f}% and above; critical is {settings.critical_pct:.0f}% and above.",
            f"This cycle has spent {state.get('api_spent', 0)} network API calls and "
            f"{state.get('llm_calls', 0)} hosted model calls.",
            f"Remaining hosted budget for the whole run: {self.ledger.llm_remaining} of {self.ledger.llm_budget} calls.",
        ]
        if state.get("pass_no", 0) > 0:
            lines.append("You already spent one probe this cycle; ask again only if it truly settles the question.")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    async def run_cycle(self, req: dict) -> dict:
        """One full pass of the graph, serialised against concurrent calls."""
        async with self._lock:
            if req.get("runId") and req["runId"] != self.run_id:
                self.reset(req["runId"])

            self._trace = Trace()
            initial: BrainState = {
                "_req": req,
                "cycle": int(req.get("cycle", 0)),
                "run_id": self.run_id,
                "minute_of_day": int(req.get("minuteOfDay", 0)),
                "clock_label": str(req.get("clockLabel", "")),
                "phase": str(req.get("phase", "")),
            }
            t0 = time.perf_counter()
            final = await self._graph.ainvoke(initial)
            elapsed_ms = round((time.perf_counter() - t0) * 1000)

            response = final.get("response") or {}
            stats = response.setdefault("stats", {})
            stats["graphMs"] = elapsed_ms
            stats["llmTotalCalls"] = self.ledger.llm_calls
            stats["llmBudget"] = self.ledger.llm_budget
            stats["apiByEndpoint"] = dict(self.ledger.nac_by_api)
            return response


brain = Brain()
