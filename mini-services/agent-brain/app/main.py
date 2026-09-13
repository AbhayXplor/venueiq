"""
VenueIQ agent brain — HTTP service + offline self-test.

Run it:
    python -m app.main                 # serve on BRAIN_PORT (default 3004)
    python -m app.main --selftest      # full evening, no hosted calls at all
    python -m app.main --selftest --live --start 1200 --cycles 15

The engine POSTs one `/cycle` per agent cycle and applies whatever comes back.
The response is returned as a plain dict rather than a validated model, so a
schema drift can never turn a working cycle into a 500 during a demo.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from . import llm as llm_module
from . import nac as nac_module
from .brain import brain
from .config import DEMO_VISITOR, settings
from .llm import chain as llm_chain
from .nac import nac
from .schemas import CycleRequest

app = FastAPI(title="VenueIQ agent brain", version="1.0.0")


# ----------------------------------------------------------------------
# endpoints
# ----------------------------------------------------------------------
@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "mode": "langgraph",
        "llm": llm_chain.stats(),
        "nac": nac.stats(),
        "budget": {
            "llmBudget": settings.llm_calls_per_run,
            "llmCalls": brain.ledger.llm_calls,
            "llmRemaining": brain.ledger.llm_remaining,
            "apiCalls": brain.ledger.api_calls,
        },
        "lastDecision": brain.last_decision,
        "runId": brain.run_id,
    }


@app.get("/stats")
async def stats() -> dict:
    return {
        "ledger": brain.ledger.summary(),
        "llm": llm_chain.stats(),
        "nac": nac.stats(),
        "model": {
            "zonesLearned": len(brain.model.slow),
            "biasCorrectionPct": round(brain.model.bias, 2),
            "forecastErrors": [round(e, 1) for e in brain.model.error_history[-6:]],
        },
    }


@app.post("/reset")
async def reset(runId: str = "run-1") -> dict:
    brain.reset(runId)
    return {"ok": True, "runId": brain.run_id}


@app.post("/cycle")
async def cycle(req: CycleRequest) -> Any:
    result = await brain.run_cycle(req.model_dump())
    return JSONResponse(content=result)


# ----------------------------------------------------------------------
# self-test: a synthetic evening, no engine required
# ----------------------------------------------------------------------
ZONES = [
    # id, name, short, capacity, base%, peak%, peak-at, rise, hold, fall
    ("entry", "Entry Gates", "Entry", 900, 0.12, 0.78, 1160, 70, 30, 180),
    ("stage", "Main Stage", "Stage", 1200, 0.10, 0.94, 1230, 60, 50, 90),
    ("carnival", "Carnival Rides", "Carnival", 700, 0.15, 0.88, 1185, 55, 40, 140),
    ("pavilions", "Country Pavilions", "Pavilions", 1600, 0.22, 0.72, 1200, 90, 90, 120),
    ("food", "Food Street", "Food", 1000, 0.18, 0.86, 1245, 70, 50, 100),
    ("transit", "Transit Hub", "Transit", 800, 0.20, 0.80, 1290, 60, 40, 120),
]


def _smoothstep(x: float) -> float:
    x = 0.0 if x < 0 else 1.0 if x > 1 else x
    return x * x * (3 - 2 * x)


def _envelope(minute: int, base: float, peak: float, at: int, rise: int, hold: int, fall: int) -> float:
    if minute <= at - rise:
        return base
    if minute < at:
        return base + (peak - base) * _smoothstep((minute - (at - rise)) / rise)
    if minute <= at + hold:
        return peak
    if minute < at + hold + fall:
        return peak - (peak - base) * _smoothstep((minute - (at + hold)) / fall)
    return base


def _minute_clock(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def _phase_for(m: int) -> str:
    if m < 1110:
        return "Gates open"
    if m < 1170:
        return "Evening build"
    if m < 1230:
        return "Peak arrivals"
    if m < 1275:
        return "Showtime peak"
    if m < 1310:
        return "Show egress"
    if m < 1350:
        return "Late evening"
    return "Closing"


def _zone_snapshot(minute: int) -> list[dict]:
    zones = []
    for zid, name, short, capacity, base, peak, at, rise, hold, fall in ZONES:
        frac = _envelope(minute, base, peak, at, rise, hold, fall)
        load = int(capacity * frac)
        prev = int(capacity * _envelope(minute - 10, base, peak, at, rise, hold, fall))
        pct = (load / capacity) * 100
        status = "critical" if pct >= 80 else "busy" if pct >= 60 else "filling" if pct >= 35 else "calm"
        zones.append(
            {
                "id": zid,
                "name": name,
                "short": short,
                "capacity": capacity,
                "load": load,
                "loadDelta10": load - prev,
                "densityPct": round(pct),
                "waitMin": None if pct < 25 else max(3, round(pct * 0.28)),
                "status": status,
            }
        )
    return zones


def _request(minute: int, cycle_no: int) -> dict:
    zones = _zone_snapshot(minute)
    on_site = int(sum(z["load"] for z in zones) * 1.35)
    busiest = max(zones, key=lambda z: z["densityPct"])
    return {
        "cycle": cycle_no,
        "runId": "selftest",
        "minuteOfDay": minute,
        "clockLabel": _minute_clock(minute),
        "phase": _phase_for(minute),
        "speed": 1,
        "zones": zones,
        "venue": {
            "onSite": on_site,
            "capacity": 42000,
            "arrivals10": 0,
            "exits10": 0,
            "busiestZone": busiest["name"],
        },
        "visitor": {"zoneId": "pavilions", "phone": DEMO_VISITOR},
        "budget": {"llmCallsUsed": 0, "llmCallsMax": settings.llm_calls_per_run, "apiCallsUsed": 0},
    }


async def selftest(start: int, cycles: int, live: bool, verbose: bool, sandbox: bool = False) -> int:
    llm_module.OFFLINE = not live
    nac_module.FORCE_SANDBOX = sandbox
    brain.reset("selftest")
    if live:
        await llm_chain.probe()

    print(f"\n{'=' * 104}")
    print(f"  VenueIQ agent brain — self-test   ({'HOSTED CALLS ON' if live else 'OFFLINE / deterministic path'})")
    print(f"  budget {settings.llm_calls_per_run} hosted calls · hold threshold {settings.hold_salience} · "
          f"alarm {settings.alarm_pct:.0f}% · critical {settings.critical_pct:.0f}%")
    print(f"{'=' * 104}")
    print(f"  {'#':>3} {'clock':>6} {'salien':>6} {'decision':<7} {'llm':>3} {'api':>3} {'probe':>5}  top zone")
    print(f"  {'-' * 100}")

    totals = {"llm": 0, "api": 0, "probes": 0}
    decisions: dict[str, int] = {}
    for i in range(cycles):
        minute = start + i * settings.cycle_sim_minutes
        if minute > 1380:
            break
        res = await brain.run_cycle(_request(minute, i))
        st = res["stats"]
        totals["llm"] += st["llmCalls"]
        totals["api"] += st["apiCalls"]
        totals["probes"] += st["probes"]
        route = st.get("routing") or st["decision"]
        decisions[route] = decisions.get(route, 0) + 1
        forecast = res.get("forecast") or []
        top = forecast[0] if forecast else {"label": "-", "plus30Pct": 0}
        label = route if route == st["decision"] else f"{route}->{st['decision']}"
        print(
            f"  {i:>3} {_minute_clock(minute):>6} {st['salience']:>6.2f} {label:<13} "
            f"{st['llmCalls']:>3} {st['apiCalls']:>3} {st['probes']:>5}  "
            f"{top['label']} -> {top['plus30Pct']}%"
        )
        if verbose:
            for ev in res["trace"]:
                print(f"        [{ev['agent']:<8} {ev['source']:<8}] {ev['text'][:118]}")

    ledger = brain.ledger.summary()
    print(f"  {'-' * 100}")
    print(f"  decisions        : {decisions}")
    print(f"  hosted LLM calls : {totals['llm']} of {settings.llm_calls_per_run} budgeted")
    print(f"  network API calls: {totals['api']}   probes: {totals['probes']}")
    print(f"  signals spent on : {ledger['signals']}")
    print(f"  nac mode         : {nac.effective_mode}   ({nac.last_status or 'no live key'})")
    print(f"  learned zones    : {len(brain.model.slow)}   bias correction {brain.model.bias:+.2f}pt")
    print(f"  forecast errors  : {[round(e, 1) for e in brain.model.error_history]}")
    print(f"{'=' * 104}\n")

    ok = totals["api"] > 0 and len(decisions) >= 1
    if not live and len(decisions) < 2:
        print("  WARNING: expected at least two different decisions across the evening.\n")
        ok = False
    return 0 if ok else 1


def main() -> None:
    # Windows consoles default to cp1252, which cannot print the arrows and
    # separators the trace uses. Reconfigure once rather than strip the output.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    ap = argparse.ArgumentParser(description="VenueIQ agent brain")
    ap.add_argument("--selftest", action="store_true", help="replay a synthetic evening instead of serving")
    ap.add_argument("--live", action="store_true", help="allow hosted LLM calls during the self-test")
    ap.add_argument("--start", type=int, default=1080, help="first simulated minute (1080 = 18:00)")
    ap.add_argument("--cycles", type=int, default=61, help="how many agent cycles to run")
    ap.add_argument("--verbose", action="store_true", help="print every trace line")
    ap.add_argument(
        "--sandbox",
        action="store_true",
        # Default OFF (costs nothing): a forgotten selftest otherwise spends
        # ~370 gateway calls. Pass --live-gateway to exercise the real signal.
        help="skip the live gateway (default) — pass --live-gateway to spend real calls",
    )
    ap.add_argument("--live-gateway", action="store_true", help="let the selftest make live gateway calls")
    args = ap.parse_args()

    if args.selftest:
        code = asyncio.run(
            selftest(args.start, args.cycles, args.live, args.verbose, sandbox=not args.live_gateway)
        )
        raise SystemExit(code)

    import uvicorn

    print(f"VenueIQ agent brain listening on :{settings.port}")
    print(f"  llm chain  : {[p.id for p in llm_chain.providers if p.api_key] or 'none (deterministic only)'}")
    print(f"  nac gateway: {settings.nac_base_url}  host {settings.nac_rapidapi_host}")
    print(f"  budget     : {settings.llm_calls_per_run} hosted calls/run, {settings.api_calls_per_cycle} extra API calls/cycle")
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()
