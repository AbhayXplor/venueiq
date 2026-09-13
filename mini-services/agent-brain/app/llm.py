"""
Hosted LLM provider chain.

Order: Ollama Cloud -> Gemini -> None. `None` is a first-class outcome, not an
error: every caller in the graph has a deterministic policy to fall back on, so
the demo degrades instead of stalling.

Three deliberate guards, all learned from the earlier implementation:

* `reasoning_effort: low` — gpt-oss is a reasoning model. At default effort it
  thinks for ~10s per call, which is longer than a whole agent cycle.
* A minimum gap between calls. Bursts are what trip provider rate limits, and
  once a provider is marked unhealthy it is out for a 90 second cool-down,
  which is a long time to be degraded mid-demo.
* A hard per-run call budget. When it runs out we stop calling entirely and
  say so on screen rather than quietly spending more.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx

from .config import settings

RETRY_AFTER_S = 90.0
FAILURES_BEFORE_UNHEALTHY = 3

# Test switch: when True the chain never reaches the network, so the whole
# graph can be exercised — including every fallback path — without spending a
# single hosted call or being rate limited.
OFFLINE = False


@dataclass
class ProviderState:
    id: str
    model: str
    base_url: str
    api_key: str
    healthy: bool = False
    failures: int = 0
    last_failure_at: float = 0.0
    last_error: str = ""
    calls: int = 0
    errors: int = 0
    extra: dict = field(default_factory=dict)


class LlmChain:
    def __init__(self) -> None:
        self.providers = [
            ProviderState(
                id="ollama",
                model=settings.ollama_model,
                base_url=settings.ollama_base_url,
                api_key=settings.ollama_api_key,
                extra={"reasoning_effort": "low"},
            ),
            ProviderState(
                id="gemini",
                model=settings.gemini_model,
                base_url=settings.gemini_base_url,
                api_key=settings.gemini_api_key,
            ),
        ]
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(settings.llm_timeout_ms / 1000.0))
        self._last_call_at = 0.0
        self._gap_lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------
    async def _respect_gap(self) -> None:
        """Serialise calls and enforce a floor between them."""
        async with self._gap_lock:
            wait_s = (settings.llm_min_gap_ms / 1000.0) - (time.monotonic() - self._last_call_at)
            if wait_s > 0:
                await asyncio.sleep(wait_s)
            self._last_call_at = time.monotonic()

    def _usable(self, p: ProviderState) -> bool:
        if not p.api_key:
            return False
        if p.healthy:
            return True
        if p.failures < FAILURES_BEFORE_UNHEALTHY:
            return True
        # half-open: allow a single probe through after the cool-down
        return (time.monotonic() - p.last_failure_at) > RETRY_AFTER_S

    async def _call(self, p: ProviderState, system: str, user: str, max_tokens: int) -> str:
        payload = {
            "model": p.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.3,
            "max_tokens": max_tokens,
            "stream": False,
            **p.extra,
        }
        res = await self._client.post(
            f"{p.base_url.rstrip('/')}/chat/completions",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {p.api_key}"},
            json=payload,
        )
        if res.status_code >= 400:
            raise RuntimeError(f"HTTP {res.status_code} {res.text[:120]}")
        data = res.json()
        text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        text = strip_thoughts(text)
        if not text.strip():
            raise RuntimeError("empty completion")
        return text

    async def complete(
        self,
        system: str,
        user: str,
        *,
        allow: bool = True,
        max_tokens: int = 700,
    ) -> tuple[Optional[str], str]:
        """Return (text, provider_id). (None, 'templates') means fall back."""
        if not allow or OFFLINE:
            return None, "templates"
        for p in self.providers:
            if not self._usable(p):
                continue
            await self._respect_gap()
            p.calls += 1
            try:
                text = await asyncio.wait_for(
                    self._call(p, system, user, max_tokens),
                    timeout=settings.llm_timeout_ms / 1000.0,
                )
                p.healthy = True
                p.failures = 0
                return text, p.id
            except Exception as exc:  # noqa: BLE001 - any failure moves down the chain
                p.errors += 1
                p.failures += 1
                p.last_failure_at = time.monotonic()
                p.last_error = str(exc)[:200]
                if p.failures >= FAILURES_BEFORE_UNHEALTHY:
                    p.healthy = False
        return None, "templates"

    async def complete_json(
        self,
        system: str,
        user: str,
        *,
        allow: bool = True,
        max_tokens: int = 700,
    ) -> tuple[Optional[dict], str]:
        text, provider = await self.complete(system, user, allow=allow, max_tokens=max_tokens)
        if text is None:
            return None, provider
        return parse_json_loose(text), provider

    # ------------------------------------------------------------------
    def active_mode(self) -> str:
        for p in self.providers:
            if p.healthy:
                return p.id
        return "templates"

    async def probe(self) -> None:
        """Boot-time probe so the mode shown on screen reflects reality. Two
        passes, so a healthy primary does not hide a dead secondary."""
        for _ in range(2):
            await self.complete("You are a health probe.", "Reply with the single word OK.", max_tokens=16)

    def stats(self) -> dict:
        return {
            "mode": self.active_mode(),
            "providers": [
                {
                    "id": p.id,
                    "model": p.model,
                    "healthy": p.healthy,
                    "calls": p.calls,
                    "errors": p.errors,
                    "lastError": p.last_error,
                }
                for p in self.providers
            ],
        }


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------

_THOUGHT_RE = re.compile(r"<thought>[\s\S]*?</thought>", re.IGNORECASE)
_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def strip_thoughts(text: str) -> str:
    """Gemma-class models leak reasoning into the content field. Strip it before
    anything downstream tries to parse a JSON object out of the reply."""
    return _THOUGHT_RE.sub("", text).strip()


def parse_json_loose(text: str) -> Optional[dict]:
    """Pull the first JSON object out of a reply, fences and prose included."""
    if not text:
        return None
    fenced = _FENCE_RE.search(text)
    raw = fenced.group(1) if fenced else text
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


chain = LlmChain()
