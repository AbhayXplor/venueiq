"""
Unit tests for the brain's two load-bearing pieces: the cheap model that runs
every cycle, and the router's policy for when a cycle is allowed to spend.

Everything here is offline by construction — no gateway calls, no hosted model
calls. The LLM is replaced with a stub that fails the test if it is ever
reached on a path that must not spend, which is the assertion that actually
protects the budget.

Run:  python -m unittest discover -s tests -v
"""
from __future__ import annotations

import asyncio
import os
import sys
import unittest

# Keep the import path working whether this is run as `python -m unittest` from
# the service directory or from the repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import nac as nac_module  # noqa: E402
from app import brain as brain_module  # noqa: E402
from app.config import settings  # noqa: E402
from app.main import _request  # noqa: E402
from app.model import CheapModel  # noqa: E402


class LLMGuard:
    """Replaces the hosted provider chain and records any attempt to spend."""

    def __init__(self) -> None:
        self.calls = 0
        self._original = None

    def __enter__(self) -> "LLMGuard":
        guard = self

        async def fail_if_called(*_args, **_kwargs):
            guard.calls += 1
            return None, "none"

        self._original = brain_module.llm_chain.complete_json
        brain_module.llm_chain.complete_json = fail_if_called
        return self

    def __exit__(self, *_exc) -> None:
        brain_module.llm_chain.complete_json = self._original


def zone(zid: str = "z", pct: float = 40.0, delta10: int = 0, capacity: int = 1000) -> dict:
    """A zone reading in the same shape the engine sends."""
    load = int(capacity * pct / 100)
    return {
        "id": zid,
        "name": zid.title(),
        "short": zid[:6].title(),
        "capacity": capacity,
        "load": load,
        "loadDelta10": delta10,
        "densityPct": pct,
        "waitMin": None,
        "status": "calm",
    }


def features_for(minute: int, cycle: int = 0):
    """Realistic zone features, built from the same request the self-test uses."""
    req = _request(minute, cycle)
    model = CheapModel(horizon_minutes=settings.horizon_minutes, cycle_minutes=settings.cycle_sim_minutes)
    for z in req["zones"]:
        model.observe(z["id"], z["densityPct"], minute)
    feats = model.features(req["zones"], minute)
    rows = model.forecast(feats, settings.alarm_pct, settings.critical_pct)
    sal = model.salience(feats, rows, settings.alarm_pct)
    return model, feats, rows, sal


class TestForecast(unittest.TestCase):
    """The forecaster is the number a technical judge will poke at."""

    def setUp(self) -> None:
        nac_module.FORCE_SANDBOX = True  # belt and braces: never touch the gateway

    def _model(self) -> CheapModel:
        return CheapModel(horizon_minutes=settings.horizon_minutes, cycle_minutes=settings.cycle_sim_minutes)

    def test_forecast_stays_inside_zero_to_one_hundred(self) -> None:
        model = self._model()
        raw = [zone("a", 0.0), zone("b", 100.0), zone("c", 55.0)]
        feats = model.features(raw, 1200)
        rows = model.forecast(feats, settings.alarm_pct, settings.critical_pct)
        self.assertEqual(len(rows), 3)
        for r in rows:
            self.assertGreaterEqual(r.plus_pct, 0)
            self.assertLessEqual(r.plus_pct, 100)

    def test_rising_zone_forecasts_upward_and_falling_zone_downward(self) -> None:
        model = self._model()
        # 30 simulated minutes of a steady climb, then 30 of a steady fall.
        for i in range(7):
            model.observe("rising", 20 + i * 6, 1200 + i * 5)
            model.observe("falling", 70 - i * 6, 1200 + i * 5)
        raw = [zone("rising", 56, delta10=60), zone("falling", 34, delta10=-60)]
        feats = model.features(raw, 1230)
        rows = {r.zone_id: r for r in model.forecast(feats, settings.alarm_pct, settings.critical_pct)}
        self.assertGreater(rows["rising"].plus_pct, 56, "a climbing zone must not forecast flat or down")
        self.assertLess(rows["falling"].plus_pct, 34, "an easing zone must not forecast flat or up")

    def test_verification_reports_error_at_its_own_horizon(self) -> None:
        """The bug this guards: predictions scored a cycle later, not a horizon later."""
        model = self._model()
        for i in range(7):
            model.observe("z", 30 + i * 4, 1200 + i * 5)
        raw = [zone("z", 54, delta10=40)]
        feats = model.features(raw, 1230)
        rows = model.forecast(feats, settings.alarm_pct, settings.critical_pct)
        model.store_predictions(rows, 1230)

        # One cycle later the horizon has not arrived: there is nothing to score.
        self.assertIsNone(
            model.verify(model.features(raw, 1230 + settings.cycle_sim_minutes), 1230 + settings.cycle_sim_minutes),
            "a prediction must not be graded before its own horizon",
        )

        # A full horizon later it can be scored, against what actually happened.
        landed = 1230 + settings.horizon_minutes
        error = model.verify(model.features([zone("z", 70)], landed), landed)
        self.assertIsNotNone(error, "the forecast must be scorable once its horizon arrives")
        self.assertGreater(error, 0.0)

    def test_verification_is_silent_with_no_history(self) -> None:
        model = self._model()
        self.assertIsNone(model.verify(model.features([zone("z", 40)], 1200), 1200))

    def test_repeated_overprediction_is_learned_away(self) -> None:
        """The model must stop making the same mistake twice."""
        model = self._model()
        model.reset()
        actual = 10.0

        def predict_then_land(minute: int) -> float:
            """Forecast at `minute`, then let the horizon arrive at `actual`."""
            rows = model.forecast(model.features([zone("z", 40, delta10=30)], minute), settings.alarm_pct, settings.critical_pct)
            predicted = rows[0].plus_pct
            model.store_predictions(rows, minute)
            landed = minute + settings.horizon_minutes
            model.verify(model.features([zone("z", actual)], landed), landed)
            return predicted

        first = predict_then_land(1200)
        minute = 1200
        for _ in range(8):
            minute += settings.cycle_sim_minutes
            later = predict_then_land(minute)

        self.assertLess(
            abs(later - actual),
            abs(first - actual),
            f"a persistent bias must be corrected: first {first:.1f} vs latest {later:.1f} against {actual}",
        )


class TestSalience(unittest.TestCase):
    def setUp(self) -> None:
        nac_module.FORCE_SANDBOX = True

    def test_a_full_venue_outranks_an_empty_one(self) -> None:
        quiet_model, quiet_feats, quiet_rows, quiet = features_for(1080)  # 18:00, gates just open
        busy_model, busy_feats, busy_rows, busy = features_for(1290)      # 21:30, peak
        self.assertLess(
            quiet.score, busy.score,
            f"an opening venue must not outrank a peak one ({quiet.score:.2f} vs {busy.score:.2f})",
        )

    def test_score_is_a_probability_like_number(self) -> None:
        _m, _f, _r, sal = features_for(1290)
        self.assertGreaterEqual(sal.score, 0.0)
        self.assertLessEqual(sal.score, 1.0)
        self.assertTrue(sal.explain(), "salience must always be able to explain itself")

    def test_baseline_learning_absorbs_a_new_normal(self) -> None:
        """A level that keeps repeating should stop reading as abnormal.

        This is the mechanism that makes a quiet Tuesday and a sold-out Saturday
        mean different things: the baseline moves to the hour's own behaviour
        instead of a fixed global threshold.
        """
        model = CheapModel(horizon_minutes=settings.horizon_minutes, cycle_minutes=settings.cycle_sim_minutes)
        for _ in range(8):
            model.observe("z", 30, 1200)
            model.features([zone("z", 30)], 1200)

        jumped = abs(model.features([zone("z", 60)], 1200)[0].deviation)
        self.assertGreater(jumped, 5, "a doubling should read as a real deviation at first")

        for _ in range(14):
            model.observe("z", 60, 1200)
            model.features([zone("z", 60)], 1200)
        settled = abs(model.features([zone("z", 60)], 1200)[0].deviation)
        self.assertLess(settled, jumped, "the learned baseline must absorb a level that keeps repeating")


class TestRouterPolicy(unittest.TestCase):
    """
    The three paths that decide whether a cycle is allowed to cost money.
    These are the assertions that protect the hosted-call budget.
    """

    def setUp(self) -> None:
        nac_module.FORCE_SANDBOX = True
        self.brain = brain_module.Brain()
        self.brain.reset("test-run")

    def _quiet_state(self) -> dict:
        model, feats, rows, sal = features_for(1080)
        return {"_req": _request(1080, 0), "features": feats, "forecast": rows, "salience": sal, "pass_no": 0}

    def test_quiet_cycle_holds_and_spends_nothing(self) -> None:
        state = self._quiet_state()
        state["salience"] = type(state["salience"])(**{**state["salience"].__dict__, "score": settings.hold_salience - 0.01})
        with LLMGuard() as guard:
            out = asyncio.run(self.brain.route(state))
        self.assertEqual(out["decision"], "HOLD")
        self.assertEqual(guard.calls, 0, "a cycle below the hold threshold must not call a hosted model")

    def test_exhausted_budget_keeps_deciding_without_paying(self) -> None:
        state = self._quiet_state()
        state["salience"] = type(state["salience"])(**{**state["salience"].__dict__, "score": 0.99})
        self.brain.ledger = brain_module.Ledger(0)  # nothing left to spend
        with LLMGuard() as guard:
            out = asyncio.run(self.brain.route(state))
        self.assertEqual(guard.calls, 0, "an exhausted budget must not place another hosted call")
        self.assertTrue(out.get("budget_exhausted"))
        self.assertIn(out["decision"], ("ACT", "PROBE", "HOLD"))

    def test_probe_is_bounded_by_the_per_cycle_allowance(self) -> None:
        """The graph must not be able to loop for evidence forever."""
        branch = brain_module.Brain()._branch
        self.assertEqual(branch({"decision": "ACT"}), "act")
        self.assertEqual(branch({"decision": "HOLD"}), "hold")
        self.assertEqual(branch({"decision": "PROBE", "probes": 0}), "probe")
        self.assertEqual(
            branch({"decision": "PROBE", "probes": settings.max_probes_per_cycle}),
            "hold",
            "a probe that has used its allowance must settle instead of probing again",
        )

    def test_policy_survives_an_empty_cycle(self) -> None:
        """No zones is a real state (engine restart) and must not raise."""
        out = self.brain._policy([], [], self._quiet_state()["salience"])
        self.assertIn(out.get("decision"), ("ACT", "PROBE", "HOLD", None))


class TestLedger(unittest.TestCase):
    def test_budget_is_a_hard_ceiling(self) -> None:
        ledger = brain_module.Ledger(2)
        self.assertFalse(ledger.budget_exhausted)
        ledger.charge_llm("test", ok=True)
        self.assertFalse(ledger.budget_exhausted)
        ledger.charge_llm("test", ok=True)
        self.assertTrue(ledger.budget_exhausted, "the ledger must report no room at the cap")
        # A charge past the cap is still *counted*, so an overspend would show on
        # screen as 121/120 rather than being hidden. What matters is that the
        # router never gets to make that call, which TestRouterPolicy asserts.
        ledger.charge_llm("test", ok=True)
        self.assertEqual(ledger.llm_calls, 3)
        self.assertTrue(ledger.budget_exhausted)


if __name__ == "__main__":
    unittest.main(verbosity=2)
