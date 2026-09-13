"""
Nokia Network as Code client — the brain's own perception layer.

The brain owns this on purpose. If the engine pre-fetched every signal, then
"which signal should I look at next?" would not be a decision the agent could
make — it would be a decision someone made for it in advance, which is exactly
the "chain, not an agent" critique this service exists to answer. So the agent
holds the API client and spends calls itself.

Gateway detail, verified live: the URL host and the header host are different.
  URL:    https://network-as-code.p-eu.rapidapi.com
  Header: x-rapidapi-host: network-as-code.nokia.rapidapi.com
The legacy `network-as-code.p.rapidapi.com` listing returns 403 "You are not
subscribed" even with a valid key.

Honest framing, enforced in the comments and in every label we ship: CAMARA
Congestion Insights reports how congested the radio network is at a place, as
experienced by a device. It is an *early indicator of crowd pressure*. It is
not a per-zone headcount, and we never present it as one.

Every call is counted in the ledger, because the ledger is what makes the
"when to spend an API call" story checkable.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from .config import DEMO_VISITOR, ZONE_PROBES, settings
from .trace import Ledger

# Circuit breaker: a failing gateway must not be hammered for a whole demo.
BREAKER_THRESHOLD = 12
BREAKER_RETRY_S = 300.0

# Test switch. A full evening is 60 cycles x 6 zone probes = 360 gateway calls;
# nobody should have to spend that to check the graph still works. With this on
# the client answers from the deterministic sandbox and says so. Driven by
# NAC_FORCE_SANDBOX so the engine and the brain agree on one flag.
FORCE_SANDBOX = settings.nac_force_sandbox


def congestion_band(pct: float) -> str:
    if pct >= 85:
        return "very-high"
    if pct >= 65:
        return "high"
    if pct >= 40:
        return "medium"
    return "low"


def congestion_pct(level: str) -> Optional[float]:
    """Map a CAMARA congestion class onto a comparable percentage.

    The field is `congestionLevel` — verified live against the gateway. This
    previously read `congestion`, which never exists, so every live reading
    scored None and the endpoint silently degraded to the venue model while
    still reporting mode "live". Parsing is exact and case-insensitive so a
    renamed class degrades loudly rather than quietly.
    """
    key = "".join(ch for ch in str(level).lower() if ch.isalnum())
    if key in ("veryhigh", "severe", "critical"):
        return 95.0
    if key == "high":
        return 90.0
    if key in ("medium", "moderate"):
        return 55.0
    if key == "low":
        return 25.0
    return None


def latest_interval(report: list[Any]) -> dict[str, Any]:
    """The API returns an interval history in unspecified order — pick the
    one with the latest timeIntervalStop rather than trusting the index."""
    best: dict[str, Any] = {}
    best_stop = ""
    for entry in report:
        if not isinstance(entry, dict):
            continue
        stop = str(entry.get("timeIntervalStop") or "")
        if stop >= best_stop:
            best_stop = stop
            best = entry
    return best


# How far the carrier's class has to sit from the venue's own reading before we
# call it a disagreement rather than rounding. The class is coarse (it reports a
# band, not a number), so a tight tolerance would manufacture disagreements.
CORROBORATION_TOLERANCE_PCT = 20.0


def corroborate(observed_pct: float, network_pct: Optional[float]) -> str:
    """Does the carrier class agree with the venue's own picture?

    This is deliberately a *yes/no cross-check* rather than a blended average.
    Averaging was the earlier behaviour and it was wrong for two reasons:

    1. The class is coarse. Its levels are far apart, so averaging it 50/50 with
       a continuous occupancy reading moves that reading by up to ~25 points
       whenever the class changes — a step that no crowd produced.
    2. In this sandbox each probe device returns a *fixed* class, so the average
       added a constant per-zone offset (-25 to +65 points depending on the
       device). That is a measurement artefact with a plausible-looking number,
       which is the worst kind: it can raise a false alarm on a calm zone and
       hide a real one.

    So the occupancy stays the primary measurement and the carrier class is
    reported as corroboration — and disagreement, which is genuinely useful, is
    what earns a second look rather than being smoothed away.
    """
    if network_pct is None:
        return "unknown"
    return "agrees" if abs(observed_pct - network_pct) <= CORROBORATION_TOLERANCE_PCT else "disagrees"


@dataclass
class CongestionReading:
    zone_id: str
    congestion: str  # carrier class: low | medium | high | very-high
    network_pct: Optional[float]  # that class as a level, for comparison only
    observed_pct: float  # venue occupancy — the primary measurement
    corroboration: str  # "agrees" | "disagrees" | "unknown"
    source: str  # "live" | "sandbox"


class NacClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(settings.nac_timeout_ms / 1000.0))
        self._failures = 0
        self._opened_at = 0.0
        self.mode: str = "live" if settings.nac_api_key else "sandbox"
        self.last_status: str = ""
        self.last_error: str = ""
        # Per-signal truth. One endpoint degrading while the rest stay live is
        # the normal case, so a single global flag would hide it.
        self.signal_modes: dict[str, str] = {}

    def _ret(self, signal: str, payload: dict) -> dict:
        """Record the mode the caller actually got, then hand the payload back."""
        self.signal_modes[signal] = "live" if payload.get("mode") == "live" else "sandbox"
        return payload

    async def aclose(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------
    def _breaker_open(self) -> bool:
        import time

        if self._failures < BREAKER_THRESHOLD:
            return False
        if (time.monotonic() - self._opened_at) > BREAKER_RETRY_S:
            return False  # half-open: let one probe through
        return True

    def _record(self, ok: bool) -> None:
        import time

        if ok:
            if self._failures >= BREAKER_THRESHOLD:
                self.mode = "live"
            self._failures = 0
        else:
            self._failures += 1
            if self._failures >= BREAKER_THRESHOLD and self.mode == "live":
                self._opened_at = time.monotonic()
                self.mode = "sandbox"

    async def _live(self, path: str, body: dict[str, Any]) -> Optional[Any]:
        """One live call. Returns None when the call is unavailable or failed —
        callers then simulate, and the trace says so."""
        if FORCE_SANDBOX or not settings.nac_api_key or self._breaker_open():
            return None
        try:
            res = await self._client.post(
                f"{settings.nac_base_url.rstrip('/')}{path}",
                headers={
                    "Content-Type": "application/json",
                    "x-rapidapi-key": settings.nac_api_key,
                    "x-rapidapi-host": settings.nac_rapidapi_host,
                    "x-correlator": str(uuid.uuid4()),
                },
                json=body,
            )
            self.last_status = f"HTTP {res.status_code}"
            if res.status_code >= 400:
                raise RuntimeError(f"HTTP {res.status_code} {res.text[:120]}")
            data = res.json()
            self.last_error = ""  # cleared on success, so the reported error is always current
            self._record(True)
            return data
        except Exception as exc:  # noqa: BLE001
            self.last_status = "failed"
            self.last_error = str(exc)[:160]
            self._record(False)
            return None

    # ------------------------------------------------------------------
    # CAMARA Congestion Insights — the core signal.
    # ------------------------------------------------------------------
    async def congestion(
        self,
        zones: list[dict[str, Any]],
        ledger: Ledger,
    ) -> list[CongestionReading]:
        """Poll the venue's own probe device in each zone.

        Each zone has a venue-owned SIM reporting from a fixed position, so no
        visitor consent is involved and the reading is comparable zone to zone
        instead of being a random sample of whoever happens to be standing
        there. Heads-on counts stay sourced from the venue model: this API
        reports a congestion class, not a headcount.
        """
        import asyncio

        results: list[Optional[tuple[str, float]]] = []
        for i, _z in enumerate(zones):
            ledger.charge_api("congestion")
            data = await self._live(
                "/congestion-insights/v0/query",
                {"device": {"phoneNumber": ZONE_PROBES[i % len(ZONE_PROBES)]}},
            )
            if not isinstance(data, list) or not data:
                results.append(None)
                continue
            entry = latest_interval(data)
            level = str(entry.get("congestionLevel") or entry.get("congestion") or "").lower()
            pct = congestion_pct(level)
            if pct is None and level:
                self.last_error = f"unrecognised congestionLevel: {level[:40]}"
            results.append((level, pct) if pct is not None else None)

        any_live = any(r is not None for r in results)
        readings: list[CongestionReading] = []
        for i, z in enumerate(zones):
            observed = (z["load"] / z["capacity"]) * 100.0 if z.get("capacity") else 0.0
            live = results[i]
            if any_live and live is not None:
                # The class cross-checks the occupancy; it never replaces it.
                _, net_pct = live
                readings.append(
                    CongestionReading(
                        z["id"],
                        congestion_band(observed),
                        net_pct,
                        round(observed),
                        corroborate(observed, net_pct),
                        "live",
                    )
                )
            else:
                readings.append(
                    CongestionReading(z["id"], congestion_band(observed), None, round(observed), "unknown", "sandbox")
                )
        self.signal_modes["congestion"] = "live" if any_live else "sandbox"
        if any_live:
            self.mode = "live"
        return readings

    # ------------------------------------------------------------------
    # The signals the router may choose to spend on.
    # ------------------------------------------------------------------
    async def geofence(self, zone_id: str, device_index: int, ledger: Ledger) -> dict:
        """Area-entered subscription around a zone. Live mode needs a publicly
        reachable sink, so the sandbox outcome is reported honestly as such."""
        ledger.charge_api("geofence")
        data = await self._live(
            "/geofencing-subscriptions/v0.3/subscriptions",
            {
                "protocol": "HTTP",
                "sink": "https://example.com/webhook",
                "types": ["org.camaraproject.geofencing-subscriptions.v0.area-entered"],
                "config": {
                    "subscriptionDetail": {
                        "device": {"phoneNumber": ZONE_PROBES[device_index % len(ZONE_PROBES)]},
                        "area": {
                            "areaType": "CIRCLE",
                            "center": {"latitude": 25.0705, "longitude": 55.3095},
                            "radius": 500,
                        },
                    },
                    "initialEvent": True,
                    "subscriptionMaxEvents": 10,
                },
            },
        )
        if data is None:
            return self._ret("geofence", {"signal": "geofence", "zoneId": zone_id, "mode": "sandbox", "subscriptionId": None})
        sub_id = data.get("subscriptionId") or data.get("id")
        return self._ret(
            "geofence",
            {"signal": "geofence", "zoneId": zone_id, "mode": "live", "subscriptionId": sub_id},
        )

    async def location(self, zone_name: str, ledger: Ledger, phone: str = "") -> dict:
        """Carrier-verified fix — used to confirm that a hot zone has devices in
        it rather than trusting the congestion class alone."""
        ledger.charge_api("location")
        data = await self._live(
            "/location-retrieval/v0/retrieve",
            {"device": {"phoneNumber": phone or DEMO_VISITOR}, "maxAge": 60},
        )
        radius = ((data or {}).get("area") or {}).get("radius")
        if isinstance(radius, (int, float)) and radius > 0:
            return self._ret(
                "location",
                {"signal": "location", "zone": zone_name, "accuracyM": int(radius), "mode": "live"},
            )
        return self._ret(
            "location",
            {"signal": "location", "zone": zone_name, "accuracyM": 25, "mode": "sandbox"},
        )

    async def roaming(self, ledger: Ledger, phone: str = "") -> dict:
        ledger.charge_api("roaming")
        data = await self._live(
            "/device-status/device-roaming-status/v1/retrieve",
            {"device": {"phoneNumber": phone or DEMO_VISITOR}},
        )
        if isinstance(data, dict) and isinstance(data.get("roaming"), bool):
            # The gateway returns countryName as a list; the UI expects a label.
            raw_country = data.get("countryName")
            if isinstance(raw_country, list):
                country = ", ".join(str(c) for c in raw_country) or "unknown"
            else:
                country = str(raw_country or "unknown")
            return self._ret(
                "roaming",
                {"signal": "roaming", "roaming": data["roaming"], "country": country, "mode": "live"},
            )
        return self._ret(
            "roaming", {"signal": "roaming", "roaming": True, "country": "India", "mode": "sandbox"}
        )

    async def reachability(self, ledger: Ledger, phone: str = "") -> dict:
        """Checked before any visitor push is claimed as delivered."""
        ledger.charge_api("reachability")
        data = await self._live(
            "/device-status/device-reachability-status/v1/retrieve",
            {"device": {"phoneNumber": phone or DEMO_VISITOR}},
        )
        if isinstance(data, dict):
            return self._ret(
                "reachability",
                {"signal": "reachability", "reachable": data.get("reachable") is not False, "mode": "live"},
            )
        return self._ret("reachability", {"signal": "reachability", "reachable": True, "mode": "sandbox"})

    async def qod(self, session_id: str, ledger: Ledger) -> dict:
        ledger.charge_api("qod")
        data = await self._live(
            "/qod/v0/sessions",
            {
                "device": {"phoneNumber": ZONE_PROBES[0]},
                "applicationServer": {"ipv4Address": "1.1.1.1"},
                "qosProfile": "DOWNLINK_M_UPLINK_L",
                "duration": 30 * 60,
            },
        )
        if isinstance(data, dict):
            return self._ret(
                "qod",
                {
                    "signal": "qod",
                    "sessionId": data.get("sessionId") or data.get("id") or session_id,
                    "qosProfile": data.get("qosProfile") or "DOWNLINK_M_UPLINK_L",
                    "mode": "live",
                },
            )
        return self._ret(
            "qod", {"signal": "qod", "sessionId": session_id, "qosProfile": "QOS_L", "mode": "sandbox"}
        )

    # ------------------------------------------------------------------
    @property
    def effective_mode(self) -> str:
        """What the signal actually is right now, not what it could be."""
        return "sandbox" if FORCE_SANDBOX else self.mode

    def stats(self) -> dict:
        return {
            "mode": self.effective_mode,
            "lastStatus": self.last_status,
            "lastError": self.last_error,
            "forcedSandbox": FORCE_SANDBOX,
            "signalModes": dict(self.signal_modes),
        }


nac = NacClient()
