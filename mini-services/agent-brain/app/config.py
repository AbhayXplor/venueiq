"""
Brain configuration.

Secrets are never duplicated: the engine's `.env` is read first and this
service's own `.env` overrides it, so a key only ever lives in one file.
Real process environment variables always win over both.

Everything that costs money or time is a named knob here, because the whole
point of this service is that it spends deliberately.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRAIN_DIR = HERE.parent
ENGINE_DIR = BRAIN_DIR.parent / "venue-engine"


def _read_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    out: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            out[key] = value
    return out


def load_env() -> None:
    """engine/.env -> brain/.env -> real environment (each later one wins)."""
    merged: dict[str, str] = {}
    merged.update(_read_env_file(ENGINE_DIR / ".env"))
    merged.update(_read_env_file(BRAIN_DIR / ".env"))
    merged.update({k: v for k, v in os.environ.items() if v})
    os.environ.update(merged)


def _str(name: str, default: str) -> str:
    v = os.environ.get(name, "")
    return v.strip() if v and v.strip() else default


def _list(name: str, default: list[str]) -> list[str]:
    """Comma-separated env value, falling back to the documented default."""
    raw = os.environ.get(name, "").strip()
    if not raw:
        return list(default)
    items = [p.strip() for p in raw.split(",") if p.strip()]
    return items or list(default)


def _num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "").strip())
    except (TypeError, ValueError):
        return default


def _int(name: str, default: int) -> int:
    return int(_num(name, float(default)))


load_env()


@dataclass(frozen=True)
class Settings:
    # --- service -------------------------------------------------------
    # A platform injects PORT and health-checks that port, so it wins over BRAIN_PORT.
    port: int = field(default_factory=lambda: _int("PORT", _int("BRAIN_PORT", 3004)))
    # Bind every interface. The default used to be 127.0.0.1, which is correct for a
    # laptop but unreachable from outside a container — a deploy would come up healthy
    # and be impossible to call. Override with BRAIN_HOST to pin it back down.
    host: str = field(default_factory=lambda: _str("BRAIN_HOST", "0.0.0.0"))

    # --- LLM chain -----------------------------------------------------
    ollama_base_url: str = field(default_factory=lambda: _str("OLLAMA_BASE_URL", "https://ollama.com/v1"))
    ollama_api_key: str = field(default_factory=lambda: _str("OLLAMA_API_KEY", ""))
    ollama_model: str = field(default_factory=lambda: _str("OLLAMA_MODEL", "gpt-oss:20b"))
    gemini_base_url: str = field(
        default_factory=lambda: _str("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")
    )
    gemini_api_key: str = field(default_factory=lambda: _str("GEMINI_API_KEY", ""))
    gemini_model: str = field(default_factory=lambda: _str("GEMINI_MODEL", "gemini-3.1-flash-lite"))
    llm_timeout_ms: int = field(default_factory=lambda: _int("LLM_TIMEOUT_MS", 20000))

    # --- network as code ----------------------------------------------
    nac_api_key: str = field(default_factory=lambda: _str("NAC_API_KEY", ""))
    nac_base_url: str = field(default_factory=lambda: _str("NAC_BASE_URL", "https://network-as-code.p-eu.rapidapi.com"))
    nac_rapidapi_host: str = field(
        default_factory=lambda: _str("NAC_RAPIDAPI_HOST", "network-as-code.nokia.rapidapi.com")
    )
    nac_timeout_ms: int = field(default_factory=lambda: _int("NAC_TIMEOUT_MS", 6000))
    # Run with zero gateway calls. Shares the engine's switch so one env var
    # covers both services — used for offline tuning and demo rehearsal.
    nac_force_sandbox: bool = field(
        default_factory=lambda: _str("NAC_FORCE_SANDBOX", "").strip().lower() in ("1", "true", "yes", "on")
    )

    # --- the budget ----------------------------------------------------
    # Hard ceiling on hosted-LLM calls per scenario run. When it is reached the
    # graph degrades to its deterministic policy and says so on screen.
    llm_calls_per_run: int = field(default_factory=lambda: _int("BRAIN_LLM_CALLS_PER_RUN", 120))
    # Never fire two hosted calls closer together than this. Bursts are what
    # trip provider rate limits, and a 429 costs us a 90 second cool-down.
    llm_min_gap_ms: int = field(default_factory=lambda: _int("BRAIN_LLM_MIN_GAP_MS", 450))
    # Extra network-API calls a single cycle may spend beyond the core read.
    api_calls_per_cycle: int = field(default_factory=lambda: _int("BRAIN_API_CALLS_PER_CYCLE", 3))
    # How many times the probe edge may loop back for more evidence.
    max_probes_per_cycle: int = field(default_factory=lambda: _int("BRAIN_MAX_PROBES_PER_CYCLE", 1))

    # --- the cheap model ----------------------------------------------
    # Salience below this and the cycle is skipped with zero hosted calls.
    hold_salience: float = field(default_factory=lambda: _num("BRAIN_HOLD_SALIENCE", 0.34))
    # Absolute level at which a zone is worth an operator alert regardless of
    # its learned baseline.
    alarm_pct: float = field(default_factory=lambda: _num("BRAIN_ALARM_PCT", 72.0))
    critical_pct: float = field(default_factory=lambda: _num("BRAIN_CRITICAL_PCT", 80.0))
    # EWMA smoothing for the learned per-zone baseline.
    baseline_alpha: float = field(default_factory=lambda: _num("BRAIN_BASELINE_ALPHA", 0.25))
    # Simulated minutes between agent cycles (must match the engine).
    cycle_sim_minutes: int = field(default_factory=lambda: _int("AGENT_EVERY_MINUTES", 5))
    # Forecast horizon in simulated minutes.
    horizon_minutes: int = field(default_factory=lambda: _int("BRAIN_HORIZON_MINUTES", 30))


settings = Settings()

# The venue's probe fleet: one SIM-equipped device per zone, and in the
# simulator that means Nokia's documented test range. Override with
# NAC_ZONE_PROBES (comma-separated) when pointing at real venue SIMs.
ZONE_PROBES = _list(
    "NAC_ZONE_PROBES",
    [
        "+99999991000",
        "+99999991001",
        "+99999991002",
        "+99999991003",
        "+99999991004",
        "+99999991005",
    ],
)

# The consented visitor sample, used as calibration ground truth.
#
# Must resolve on the gateway. This previously held a plausible-looking but
# fictional number (+971500000042), and the gateway answered 404 "Target not
# found" for location, roaming and reachability — the three device-scoped
# endpoints silently degraded to sandbox while congestion and geofencing
# (zone-scoped) stayed live. Verified live: simulator devices only resolve
# inside the documented range, so the sample defaults to the first probe.
DEMO_VISITOR = _str("NAC_DEMO_VISITOR", ZONE_PROBES[0])
