"""
Reasoning trace + the spend ledger.

Two jobs, both about trust:

1. `Trace` collects one line per thing the graph did — what it looked at, what
   it weighed, what it chose and why. These lines are shipped back to the
   engine and rendered in the operator console, so the reasoning is the product
   rather than a log file nobody reads.

2. `Ledger` counts everything that cost something — hosted LLM calls, network
   API calls, and which branch each cycle took. The budget is enforced from
   here, and the counts are on screen so a judge can see that "spend only when
   it is worth it" is implemented rather than asserted.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from typing import Optional


@dataclass
class TraceEvent:
    agent: str
    kind: str
    text: str
    source: str = "template"
    level: str = "info"
    detail: Optional[str] = None

    def to_wire(self) -> dict:
        d = asdict(self)
        return {k: v for k, v in d.items() if v is not None}


class Trace:
    """Accumulates the reasoning lines for a single cycle."""

    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(
        self,
        agent: str,
        kind: str,
        text: str,
        *,
        source: str = "template",
        level: str = "info",
        detail: Optional[str] = None,
    ) -> None:
        self.events.append(TraceEvent(agent=agent, kind=kind, text=text, source=source, level=level, detail=detail))

    def as_list(self) -> list[dict]:
        return [e.to_wire() for e in self.events]

    def __len__(self) -> int:
        return len(self.events)


class Ledger:
    """Per-run accounting. Reset whenever the scenario is reset."""

    def __init__(self, llm_budget: int) -> None:
        self.llm_budget = llm_budget
        self.llm_calls = 0
        self.llm_errors = 0
        self.llm_by_provider: Counter[str] = Counter()
        self.api_calls = 0
        self.nac_by_api: Counter[str] = Counter()
        self.decisions: Counter[str] = Counter()
        self.signals: Counter[str] = Counter()
        self.cycles = 0
        self.probes = 0
        self.forecast_errors: list[float] = []

    # --- LLM ----------------------------------------------------------
    @property
    def llm_remaining(self) -> int:
        return max(0, self.llm_budget - self.llm_calls)

    @property
    def budget_exhausted(self) -> bool:
        return self.llm_remaining <= 0

    def charge_llm(self, provider: str, *, ok: bool) -> None:
        self.llm_calls += 1
        self.llm_by_provider[provider] += 1
        if not ok:
            self.llm_errors += 1

    # --- network APIs -------------------------------------------------
    def charge_api(self, api_id: str, calls: int = 1) -> None:
        self.api_calls += calls
        self.nac_by_api[api_id] += calls

    # --- reporting ----------------------------------------------------
    def summary(self) -> dict:
        mean_err = round(sum(self.forecast_errors) / len(self.forecast_errors), 1) if self.forecast_errors else None
        return {
            "cycles": self.cycles,
            "llmCalls": self.llm_calls,
            "llmErrors": self.llm_errors,
            "llmBudget": self.llm_budget,
            "llmRemaining": self.llm_remaining,
            "llmByProvider": dict(self.llm_by_provider),
            "apiCalls": self.api_calls,
            "apiByEndpoint": dict(self.nac_by_api),
            "decisions": dict(self.decisions),
            "signals": dict(self.signals),
            "probes": self.probes,
            "meanForecastErrorPct": mean_err,
        }
