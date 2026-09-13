"""
Live per-endpoint probe for the agent brain's CAMARA client.

The brain owns its own Nokia client (that is the point — it decides which
signal to spend on), so it has to be verified separately from the engine's
TypeScript client. This calls every signal once, live, and prints the raw
outcome so nothing is assumed from the other implementation.

    cd mini-services/agent-brain && python -W ignore ../../scripts/brain-signals.py
"""
from __future__ import annotations

import asyncio
import io
import sys
from pathlib import Path

# Run from the agent-brain directory so `app` resolves; fall back to locating it.
BRAIN = Path(__file__).resolve().parent.parent / "mini-services" / "agent-brain"
sys.path.insert(0, str(BRAIN))

from app.config import settings  # noqa: E402
from app.nac import nac  # noqa: E402
from app.trace import Ledger  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass


def settings_demo_device() -> str:
    from app.config import DEMO_VISITOR

    return DEMO_VISITOR


async def main() -> int:
    ledger = Ledger(llm_budget=0)
    zones = [
        {"id": f"zone-{i}", "load": 400 + i * 40, "capacity": 1000}
        for i in range(6)
    ]

    print("=" * 78)
    print(f"  agent-brain CAMARA probe   gateway={settings.nac_base_url}")
    print(f"  host header: {settings.nac_rapidapi_host}   visitor device: {settings_demo_device()}")
    print("=" * 78)

    readings = await nac.congestion(zones, ledger)
    live = [r for r in readings if r.source == "live"]
    print(f"  congestion-insights   {'LIVE ' if live else 'SANDBOX'}  {len(live)}/6 zone readings")
    for r in readings[:3]:
        print(f"      {r.zone_id}: net={r.network_pct} observed={r.observed_pct} blended={r.blended_pct} ({r.source})")
    if not live:
        print(f"      status={nac.last_status} error={nac.last_error}")

    checks = [
        ("geofencing-subscriptions", await nac.geofence("zone-0", 0, ledger)),
        ("location-retrieval", await nac.location("Entry", ledger)),
        ("device-roaming-status", await nac.roaming(ledger)),
        ("device-reachability", await nac.reachability(ledger)),
        ("qod-sessions", await nac.qod("probe-session", ledger)),
    ]
    for name, result in checks:
        mode = result.get("mode", "?")
        print(f"  {name:<22} {mode.upper():<8} {result}")

    print("-" * 78)
    print(f"  nac mode: {nac.effective_mode}   last: {nac.last_status}   error: {nac.last_error or 'none'}")
    print(f"  live HTTP calls this probe: {ledger.api_calls}")
    print("=" * 78)

    await nac.aclose()
    ok = bool(live) and all(r.get("mode") == "live" for _, r in checks)
    print("  result: ALL LIVE" if ok else "  result: DEGRADED — see rows above")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
