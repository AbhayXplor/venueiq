"""
Wire formats between the VenueIQ engine and the agent brain.

The engine owns the simulation and the socket broadcast; the brain owns
perception, reasoning and the decision to spend. These models are the whole
contract between them — keep them boring and explicit.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

ZoneStatus = Literal["calm", "filling", "busy", "critical"]
SignalsWanted = Literal["geofence", "location", "reachability", "roaming", "qod"]
Decision = Literal["ACT", "PROBE", "HOLD"]
Severity = Literal["warn", "critical"]


class ZoneIn(BaseModel):
    id: str
    name: str
    short: str
    capacity: int
    load: int
    loadDelta10: int
    densityPct: int
    waitMin: Optional[int] = None
    status: ZoneStatus


class VenueIn(BaseModel):
    onSite: int
    capacity: int
    arrivals10: int
    exits10: int
    busiestZone: str


class VisitorIn(BaseModel):
    zoneId: str
    phone: str = ""


class BudgetIn(BaseModel):
    """What the engine believes has been spent. The brain keeps its own ledger
    and treats the engine's view only as a sanity check."""

    llmCallsUsed: int = 0
    llmCallsMax: int = 0
    apiCallsUsed: int = 0


class CycleRequest(BaseModel):
    cycle: int = 0
    runId: str = "run-1"
    minuteOfDay: int
    clockLabel: str
    phase: str
    speed: float = 1.0
    zones: list[ZoneIn]
    venue: VenueIn
    visitor: Optional[VisitorIn] = None
    budget: BudgetIn = Field(default_factory=BudgetIn)
    lastForecast: Optional[dict[str, float]] = None


class TraceEventOut(BaseModel):
    agent: Literal["BRAIN", "SENTINEL", "ORACLE", "NAVIGATOR", "GUARDIAN", "COORDINATOR", "NAC", "ENGINE"]
    kind: Literal["observe", "reason", "decision", "action", "signal", "system"]
    text: str
    source: Literal["llm", "template", "api"] = "template"
    level: Literal["info", "warn", "critical"] = "info"
    detail: Optional[str] = None


class ForecastOut(BaseModel):
    zoneId: str
    label: str
    nowPct: float
    plus30Pct: float
    risk: Literal["low", "medium", "high"]


class GuardianOut(BaseModel):
    raise_: bool = Field(default=False, alias="raise")
    zoneId: Optional[str] = None
    severity: Severity = "warn"
    headline: str = ""
    detail: str = ""
    actions: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class RerouteOut(BaseModel):
    targetZoneId: str
    reason: str = ""
    visitorMessage: str = ""


class CycleStatsOut(BaseModel):
    decision: Decision
    confidence: float = 0.0
    llmCalls: int = 0
    llmProvider: str = "templates"
    apiCalls: int = 0
    signals: list[str] = Field(default_factory=list)
    probes: int = 0
    salience: float = 0.0
    forecastErrorPct: Optional[float] = None
    budgetExhausted: bool = False
    nacMode: Literal["live", "sandbox"] = "sandbox"
    signalModes: dict[str, Literal["live", "sandbox"]] = Field(default_factory=dict)


class CycleResponse(BaseModel):
    mode: Literal["langgraph"] = "langgraph"
    decision: Decision
    reasoning: str = ""
    confidence: float = 0.0
    forecast: list[ForecastOut] = Field(default_factory=list)
    guardian: Optional[GuardianOut] = None
    guardianClear: bool = False
    reroute: Optional[RerouteOut] = None
    trace: list[TraceEventOut] = Field(default_factory=list)
    stats: CycleStatsOut
