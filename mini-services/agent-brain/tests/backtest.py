"""
Score the forecaster against a real evening — offline, in milliseconds.

Why this exists: tuning the forecast by replaying the live system would spend
hundreds of gateway calls and hundreds of hosted-model calls to measure
arithmetic. The scenario is deterministic, so one captured evening is enough to
evaluate a forecaster as often as we like. The capture itself is free too: see
scripts/capture-trajectory.mjs, which runs the engine with no agent cycle and
NAC_FORCE_SANDBOX=1.

Two input regimes are scored, because they answer different questions:

  * `observed`  — what the agent reasons about now: the venue's own occupancy.
  * `blended`   — the old behaviour, where the coarse carrier class was averaged
                  50/50 into occupancy. In this sandbox each probe device
                  returns a *fixed* class, so this adds a constant per-zone
                  offset and injects steps no crowd produced. Included so the
                  cost of that mistake is a number, not an opinion.

    python tests/backtest.py                 # both regimes
    python tests/backtest.py --sweep         # also probe blend weights
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from app.model import CheapModel  # noqa: E402

REFERENCE = HERE / "reference-evening.json"

# The classes the gateway actually returned per probe device when we checked it
# live, in zone order (entry, stage, carnival, pavilions, food, transit). One
# fixed class per device, which is precisely why averaging it in is unsafe.
CLASS_LEVELS = [25.0, 90.0, 55.0, 25.0, 55.0, 90.0]

ALARM_PCT = 72.0
CRITICAL_PCT = 80.0


def load_reference() -> dict:
    if not REFERENCE.is_file():
        raise SystemExit(
            f"missing {REFERENCE.name} — capture it first:\n"
            "  NAC_FORCE_SANDBOX=1 AGENT_EVERY_MINUTES=999 bun --hot src/index.ts   # engine\n"
            "  SPEED=16 node scripts/capture-trajectory.mjs                          # repo root"
        )
    return json.loads(REFERENCE.read_text())


def zone_payload(minute_entry: dict, prev_minute: dict | None, regime: str) -> list[dict]:
    """Shape one captured minute the way the engine sends it to the brain."""
    zones = []
    for i, z in enumerate(minute_entry["zones"]):
        capacity = z["capacity"] or 1
        load = round(z["densityPct"] / 100.0 * capacity)
        pct = z["densityPct"]
        if regime == "blended":
            pct = (pct + CLASS_LEVELS[i % len(CLASS_LEVELS)]) / 2.0
        prev = None
        if prev_minute is not None:
            prev = prev_minute["zones"][i]["densityPct"]
            if regime == "blended":
                prev = (prev + CLASS_LEVELS[i % len(CLASS_LEVELS)]) / 2.0
        delta10 = 0 if prev is None else round((pct - prev) / 2.0 * capacity / 100.0)
        zones.append(
            {
                "id": z["id"],
                "name": z["name"],
                "short": z["short"],
                "capacity": capacity,
                "load": load,
                "loadDelta10": delta10,
                "densityPct": pct,
                "waitMin": None,
                "status": "calm",
            }
        )
    return zones


def run(regime: str, cycle_minutes: int = 5, weights: tuple[float, float, float] | None = None) -> dict:
    ref = load_reference()
    minutes = ref["minutes"]
    by_minute = {m["minuteOfDay"]: m for m in minutes}
    ordered = sorted(by_minute)

    model = CheapModel(horizon_minutes=30, cycle_minutes=cycle_minutes)
    if weights is not None:
        model.W_GROWTH, model.W_LINEAR, model.W_BASELINE = weights

    errors: list[float] = []
    false_alarms = 0
    missed = 0

    for minute in ordered:
        if (minute - ordered[0]) % cycle_minutes != 0:
            continue
        prev = by_minute.get(minute - cycle_minutes)
        zones = zone_payload(by_minute[minute], prev, regime)
        feats = model.features(zones, minute)
        model.verify(feats, minute)
        rows = model.forecast(feats, ALARM_PCT, CRITICAL_PCT)
        model.store_predictions(rows, minute)

        # Did a rising carrier level push a calm zone over the band?
        for i, f in enumerate(sorted(feats, key=lambda x: x.zone_id)):
            pass
        if regime == "blended":
            for i, f in enumerate(feats):
                raw = by_minute[minute]["zones"][i]["densityPct"]
                if f.pct >= ALARM_PCT and raw < ALARM_PCT - 8:
                    false_alarms += 1
                elif f.pct < ALARM_PCT - 8 and raw >= ALARM_PCT:
                    missed += 1

    errors = list(model.error_history)
    return {
        "regime": regime,
        "cycles": len(ordered) // cycle_minutes,
        "scored": len(errors),
        "mean_error": round(statistics.fmean(errors), 2) if errors else None,
        "worst": round(max(errors), 1) if errors else None,
        "best": round(min(errors), 1) if errors else None,
        "false_alarms": false_alarms,
        "missed": missed,
        "bias": round(model.bias, 2),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sweep", action="store_true", help="try a range of blend weights")
    args = ap.parse_args()

    print("=" * 78)
    print("  forecast backtest — captured evening at Global Village")
    print("=" * 78)
    print(f"  {'input regime':<14} {'cycles':>7} {'scored':>7} {'mean err':>9} {'worst':>7} {'false alarms':>13}")
    rows = []
    for regime in ("observed", "blended"):
        r = run(regime)
        rows.append(r)
        print(
            f"  {r['regime']:<14} {r['cycles']:>7} {r['scored']:>7} "
            f"{str(r['mean_error']):>9} {str(r['worst']):>7} {r['false_alarms']:>13}"
        )
    print("-" * 78)
    obs, bl = rows
    if obs["mean_error"] and bl["mean_error"]:
        delta = bl["mean_error"] - obs["mean_error"]
        if delta < 0:
            print(
                f"  averaging the carrier class in looks {abs(delta):.1f}pt MORE accurate — but that is the "
                "constant offset predicting itself: easy to hit a shifted number, wrong about the level"
            )
        else:
            print(f"  averaging the carrier class in costs {delta:+.1f}pt of forecast error")
        print(
            f"  decisive line: it invents {bl['false_alarms']} alarm-band crossings on zones that were calm "
            f"({bl['missed']} real crossings hidden) — a false alarm at a venue is the expensive error"
        )

    if args.sweep:
        print("-" * 78)
        print("  blend-weight sweep (growth, linear, baseline) against observed occupancy")
        best = None
        for g in (0.4, 0.5, 0.6, 0.7):
            for lin in (0.2, 0.3, 0.4):
                base = round(1.0 - g - lin, 2)
                if base < 0.0:
                    continue
                r = run("observed", weights=(g, lin, base))
                tag = f"({g:.1f}, {lin:.1f}, {base:.2f})"
                print(f"    {tag:<20} mean error {r['mean_error']:>6}")
                if best is None or (r["mean_error"] or 999) < best[1]:
                    best = (tag, r["mean_error"] or 999)
        if best:
            print(f"  best: {best[0]} at {best[1]}")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
