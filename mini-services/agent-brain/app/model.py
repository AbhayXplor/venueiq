"""
The cheap layer: online baselines, a trend forecaster, a salience score.

Why this file exists
--------------------
Calling a hosted LLM every cycle is not feasible: sixty cycles per playback at
two to four calls each is hundreds of calls, and it would also be the wrong
architecture. Most of what an agent needs to know each cycle is arithmetic —
how fast is this zone rising, how far above its own normal is it, how close is
it to the danger band. That is a job for a small deterministic model that runs
in under a millisecond and costs nothing.

So the division of labour is:

  * this module answers "what is happening, how fast, and how much does it
    matter" — every cycle, for free, with numbers you can audit;
  * the LLM is asked only the questions that need judgement: does this deserve
    an action, is one more API call worth spending, and how do I explain it.

Nothing here is a neural network and it does not pretend to be. It is a
statistical layer with a stated model, and every number it produces appears in
the trace so its reasoning can be checked by hand.
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from typing import Iterable, Optional

MIN_STD_PCT = 3.0  # floor so a brand-new baseline cannot divide by ~zero
HISTORY = 12  # ~1 simulated hour of cycles


def _clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


@dataclass
class ZoneFeatures:
    """Everything the cheap layer knows about one zone this cycle."""

    zone_id: str
    name: str
    short: str
    capacity: int
    pct: float
    load: int
    delta10: int
    # learned
    slow_baseline: float  # the zone's own normal, slow EWMA
    phase_baseline: float  # the normal for this half-hour slot
    baseline_source: str  # "phase" | "zone" | "none"
    deviation: float  # pct above/below its normal for this slot
    zscore: float
    # first differences
    velocity_pct_per_min: float
    acceleration: float
    hot: bool
    observations: int

    def summary(self) -> str:
        sign = "+" if self.deviation >= 0 else ""
        return f"{self.short} {self.pct:.0f}% ({sign}{self.deviation:.0f} vs normal, {sign}{self.zscore:.1f}σ, {self.velocity_pct_per_min:+.2f}%/min)"


@dataclass
class ForecastRow:
    zone_id: str
    label: str
    now_pct: float
    plus_pct: float
    risk: str

    def to_wire(self) -> dict:
        return {
            "zoneId": self.zone_id,
            "label": self.label,
            "nowPct": round(self.now_pct),
            "plus30Pct": round(self.plus_pct),
            "risk": self.risk,
        }


@dataclass
class Salience:
    """A single 0-1 number: how much does this cycle deserve attention?

    Weights are fixed and documented rather than tuned into a black box, so the
    score can be argued with. Anything below the configured threshold is
    skipped without spending a single hosted call.
    """

    score: float
    pressure: float
    deviation: float
    velocity: float
    breach: float
    components: dict = field(default_factory=dict)

    def explain(self) -> str:
        return (
            f"pressure {self.pressure:.0%} · deviation {self.deviation:.2f}σ · "
            f"velocity {self.velocity:.2f}%/min · 30-min margin {self.components.get('margin', 0):+.0f}pt"
        )


class CheapModel:
    """Per-zone online learner + forecaster. Zero API calls, zero LLM calls."""

    SLOW_ALPHA = 0.10
    PHASE_ALPHA = 0.30
    VAR_ALPHA = 0.12

    # Weights for the forecaster: newest observation dominates, but older ones
    # still set the direction. Purely a smoothing choice, nothing learned.
    WEIGHT_DECAY = 0.75
    # How much of the current rate is assumed to persist over the horizon, and
    # how far the straight-line view is allowed to run. Both are damping, not
    # learning: they exist because crowds decelerate before they stop.
    SUSTAIN = 0.6
    TREND_DAMPING = 0.6

    # Blend weights for the three forecast views. Class attributes so the
    # offline backtest can sweep them without touching any logic. Values chosen
    # by sweeping against the captured reference evening (tests/backtest.py --sweep):
    # the phase-baseline term earned no weight on this scenario's curve shape.
    W_GROWTH = 0.60
    W_LINEAR = 0.40
    W_BASELINE = 0.00

    def __init__(self, horizon_minutes: int = 30, cycle_minutes: int = 5) -> None:
        self.horizon = horizon_minutes
        self.cycle = max(1, cycle_minutes)
        self.steps = max(1, round(horizon_minutes / self.cycle))
        self.reset()

    def reset(self) -> None:
        self.slow: dict[str, float] = {}
        self.variance: dict[str, float] = {}
        self.phase: dict[tuple[str, int], tuple[float, int]] = {}  # (zone, slot) -> (mean, n)
        self.series: dict[str, deque[float]] = {}
        self.prev_velocity: dict[str, float] = {}
        self.observations = 0
        # Verification feedback: an additive correction learned from the error
        # of our own previous forecast. Started at zero, so it can only ever
        # help once there is evidence for it.
        self.bias = 0.0
        # Forecasts awaiting their moment of truth: (due_sim_minute, {zone: pct}).
        # A 30-minute call must be scored 30 minutes later, not next cycle.
        self.pending: list[tuple[int, dict[str, float]]] = []
        self.error_history: list[float] = []

    # ------------------------------------------------------------------
    # learning
    # ------------------------------------------------------------------
    @staticmethod
    def slot_of(minute_of_day: int) -> int:
        """30 simulated-minute bucket of the day."""
        return minute_of_day // 30

    def observe(self, zone_id: str, pct: float, minute_of_day: int) -> None:
        prev = self.slow.get(zone_id)
        if prev is None:
            self.slow[zone_id] = pct
            self.variance[zone_id] = 0.0
        else:
            delta = pct - prev
            self.slow[zone_id] = prev + self.SLOW_ALPHA * delta
            # EWMA of squared deviation -> a running estimate of how noisy this
            # zone normally is, so a jumpy zone is not flagged as often as a
            # rock-steady one.
            var = self.variance.get(zone_id, 0.0)
            self.variance[zone_id] = (1 - self.VAR_ALPHA) * var + self.VAR_ALPHA * delta * delta

        slot = self.slot_of(minute_of_day)
        mean, n = self.phase.get((zone_id, slot), (pct, 0))
        self.phase[(zone_id, slot)] = (mean + self.PHASE_ALPHA * (pct - mean), n + 1)

        self.series.setdefault(zone_id, deque(maxlen=HISTORY)).append(pct)

    # ------------------------------------------------------------------
    # features
    # ------------------------------------------------------------------
    def features(self, zones: Iterable[dict], minute_of_day: int) -> list[ZoneFeatures]:
        out: list[ZoneFeatures] = []
        slot = self.slot_of(minute_of_day)
        for z in zones:
            zone_id = z["id"]
            pct = float(z["densityPct"])
            load = int(z["load"])
            capacity = int(z["capacity"]) or 1
            delta10 = int(z.get("loadDelta10", 0))

            self.observe(zone_id, pct, minute_of_day)

            slow = self.slow.get(zone_id, pct)
            phase_mean, phase_n = self.phase.get((zone_id, slot), (slow, 0))
            # A phase baseline only counts once it has actually seen this slot
            # before; until then the zone's own slower average stands in.
            if phase_n >= 2:
                baseline, source = phase_mean, "phase"
            elif self.observations >= 2:
                baseline, source = slow, "zone"
            else:
                baseline, source = pct, "none"

            deviation = pct - baseline
            std = max(math.sqrt(max(self.variance.get(zone_id, 0.0), 0.0)), MIN_STD_PCT)
            zscore = deviation / std

            velocity = (delta10 / capacity) * 100.0 / 10.0  # pct per simulated minute
            prev_v = self.prev_velocity.get(zone_id)
            velocity = velocity if prev_v is None else velocity
            accel = 0.0 if prev_v is None else (velocity - prev_v)
            self.prev_velocity[zone_id] = velocity

            out.append(
                ZoneFeatures(
                    zone_id=zone_id,
                    name=z["name"],
                    short=z["short"],
                    capacity=capacity,
                    pct=pct,
                    load=load,
                    delta10=delta10,
                    slow_baseline=slow,
                    phase_baseline=baseline,
                    baseline_source=source,
                    deviation=deviation,
                    zscore=zscore,
                    velocity_pct_per_min=velocity,
                    acceleration=accel,
                    hot=deviation > 0 and velocity > 0,
                    observations=len(self.series.get(zone_id, ())),
                )
            )
        self.observations += 1
        return out

    # ------------------------------------------------------------------
    # forecasting
    # ------------------------------------------------------------------
    def _trend(self, values: list[float]) -> tuple[float, float]:
        """Weighted least-squares slope/intercept over the zone's own history."""
        n = len(values)
        if n < 2:
            v = values[0] if values else 0.0
            return 0.0, v
        weights = [self.WEIGHT_DECAY ** (n - 1 - i) for i in range(n)]
        sw = sum(weights)
        mx = sum(w * i for i, w in enumerate(weights)) / sw
        my = sum(w * v for w, v in zip(weights, values)) / sw
        num = sum(w * (i - mx) * (v - my) for i, (w, v) in enumerate(zip(weights, values)))
        den = sum(w * (i - mx) ** 2 for i, w in enumerate(weights)) or 1.0
        slope = num / den
        return slope, my - slope * mx

    def forecast(self, features: list[ZoneFeatures], alarm_pct: float, critical_pct: float) -> list[ForecastRow]:
        rows: list[ForecastRow] = []
        for f in features:
            values = list(self.series.get(f.zone_id, []))
            n = len(values)
            slope, intercept = self._trend(values)

            # Three views of the next half hour, blended. Each one is wrong in a
            # different place, which is the whole reason to keep all three:
            #
            #   growth   - carries the CURRENT rate forward, damped as the zone
            #              approaches capacity. Right at a peak, wrong on a ramp.
            #   linear   - a straight line through the recent history. Right on a
            #              sustained ramp, overshoots every peak.
            #   baseline - what this zone normally does in this half-hour slot.
            #              Anchors the other two so a runaway line cannot win.
            saturation = 1.0 - (f.pct / 100.0) ** 2
            growth = f.pct + f.velocity_pct_per_min * self.horizon * self.SUSTAIN * saturation
            linear = intercept + slope * (max(0, n - 1) + self.steps * self.TREND_DAMPING)
            linear = min(linear, 92.0)

            pred = self.W_GROWTH * growth + self.W_LINEAR * linear + self.W_BASELINE * f.phase_baseline + self.bias
            # Physical plausibility guard: nothing at this venue gains or loses
            # 30 points of occupancy in half an hour, so a number that does is a
            # model artefact, not a crowd.
            pred = _clamp(pred, f.pct - 20.0, f.pct + 30.0)
            pred = _clamp(pred, 0.0, 100.0)

            risk = "high" if (pred >= critical_pct or pred - f.pct >= 25) else "medium" if pred >= alarm_pct else "low"
            rows.append(
                ForecastRow(
                    zone_id=f.zone_id,
                    label=f.short,
                    now_pct=f.pct,
                    plus_pct=pred,
                    risk=risk,
                )
            )
        rows.sort(key=lambda r: r.plus_pct, reverse=True)
        return rows

    # ------------------------------------------------------------------
    # salience
    # ------------------------------------------------------------------
    def salience(self, features: list[ZoneFeatures], forecast: list[ForecastRow], alarm_pct: float) -> Salience:
        if not features:
            return Salience(0.0, 0.0, 0.0, 0.0, 0.0, {"margin": 0})

        pressure = max(f.pct for f in features) / 100.0
        worst_z = max(0.0, max(f.zscore for f in features))
        speed = max(0.0, max(f.velocity_pct_per_min for f in features))
        top_pred = forecast[0].plus_pct if forecast else 0.0
        margin = top_pred - alarm_pct

        deviation_term = _clamp(worst_z / 3.0, 0.0, 1.0)
        velocity_term = _clamp(speed / 1.2, 0.0, 1.0)
        breach_term = _clamp(max(0.0, margin) / 15.0, 0.0, 1.0)

        score = 0.40 * pressure + 0.25 * deviation_term + 0.15 * velocity_term + 0.20 * breach_term
        return Salience(
            score=round(_clamp(score, 0.0, 1.0), 3),
            pressure=round(pressure, 3),
            deviation=round(worst_z, 2),
            velocity=round(speed, 2),
            breach=round(breach_term, 3),
            components={"margin": round(margin, 1), "topPredicted": round(top_pred, 1)},
        )

    # ------------------------------------------------------------------
    # verification — the feedback loop
    # ------------------------------------------------------------------
    def store_predictions(self, forecast: list[ForecastRow], minute_of_day: int) -> None:
        """File this cycle's forecast away until the clock reaches the horizon
        it is claiming to predict."""
        self.pending.append(
            (minute_of_day + self.horizon, {r.zone_id: r.plus_pct for r in forecast})
        )
        self.pending = self.pending[-8:]

    def verify(self, features: list[ZoneFeatures], minute_of_day: int) -> Optional[float]:
        """Score the forecasts whose horizon has now arrived.

        This is what makes the system a loop rather than a chain: the call we
        made 30 simulated minutes ago is checked against reality, and the model
        is nudged by its own error. Scoring it any earlier would be measuring
        the wrong thing."""
        if not self.pending or not features:
            return None
        actual = {f.zone_id: f.pct for f in features}
        due = [p for p in self.pending if p[0] <= minute_of_day and any(z in actual for z in p[1])]
        if not due:
            return None
        self.pending = [p for p in self.pending if p not in due]

        errors: list[float] = []
        signed: list[float] = []
        for _, preds in due:
            for zid, pred in preds.items():
                if zid in actual:
                    errors.append(abs(actual[zid] - pred))
                    signed.append(actual[zid] - pred)
        if not errors:
            return None

        mean_err = sum(errors) / len(errors)
        self.error_history.append(mean_err)
        if len(self.error_history) > 8:
            self.error_history.pop(0)

        # Signed error for the bias term: are we consistently running high or
        # low? Decayed so a stretch of bad cycles cannot ratchet the correction
        # into a permanent offset.
        mean_signed = sum(signed) / len(signed)
        self.bias = _clamp(self.bias * 0.85 + 0.35 * mean_signed, -4.0, 4.0)
        return round(mean_err, 1)
