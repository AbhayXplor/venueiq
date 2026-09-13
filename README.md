# VenueIQ — Crowd Intelligence for Mega-Venues

**MENA Ignite Hackathon 2026 · Prototype Phase · Theme 3 — Tourism, Pilgrimage & Cultural Experience Innovation**

Real-time crowd intelligence read straight from the mobile network. Every phone in a venue is
already a sensor, so VenueIQ needs no new hardware and no app install: it turns Nokia Network as
Code (CAMARA) signals into a live crowd picture, forecasts it **30 minutes ahead** with a
multi-agent AI brain, and steers visitors before zones jam.

## What's inside

| Route | What it is |
|---|---|
| `/` | Landing page — the problem, the approach, and three cited figures |
| `/operator` | The ops control room: venue map, KPIs, carrier signal board, Guardian actions, Oracle forecast, live agent trace |
| `/visitor` | The guest experience in a phone frame: live map, wait times, smart reroutes, alerts |
| `/live` | The big-screen view for a venue wall, with a live engine preview |
| `/how` | The long-form explanation: how each CAMARA signal is used and what it can't tell you |

## The three processes

| Process | Port | Runtime | Its job |
|---|---|---|---|
| App | 3000 | Next.js 16 | Everything a human looks at |
| Engine | 3003 | Bun + socket.io | The clock, the venue model, the Nokia client, broadcasts snapshots |
| Agent brain | 3004 | Python + FastAPI + LangGraph | The reasoning: decide, then hand back actions and a trace |

Start order matters — the engine health-checks the brain at boot.

## Repository layout

```
.
├── src/                          # Next.js app
│   ├── app/                      # routes: /, /operator, /visitor, /live, /how
│   │   ├── landing.css           # marketing surfaces
│   │   ├── hero-film.css         # optional video hero variant (see Configuration)
│   │   └── globals.css           # console surfaces: token layer + shared chrome
│   ├── components/landing/       # hero, header, live preview
│   ├── components/operator/      # venue map, signal board, Guardian, Oracle, trace
│   ├── components/EngineWarmer.tsx  # one /health ping on page load, to wake a sleeping host
│   └── lib/                      # shared socket client + wire types
├── public/
│   └── hero.mp4                  # hero film — a local asset, so it wins over the CDN fallback
├── mini-services/
│   ├── venue-engine/             # Bun service
│   │   ├── src/agents/           # LangGraph client + the TypeScript agent chain
│   │   ├── src/nac/              # CAMARA client, per-endpoint state, circuit breaker
│   │   ├── src/llm/              # provider chain
│   │   ├── src/scenario/         # the scripted evening
│   │   ├── src/state/            # the six-zone venue model
│   │   └── scripts/              # e2e, mode check, chaos test
│   └── agent-brain/              # Python service
│       ├── app/                  # graph, router policy, forecaster, NaC client
│       └── tests/                # router policy tests, offline backtest + fixture
├── render.yaml                   # the two live services as free Render instances
└── scripts/                      # repo-level diagnostics and verification
```

Two directories exist on disk but are deliberately not committed: `screenshots/`
(regenerated on demand by `scripts/shots.mjs`) and `scripts/research/` (vendored Nokia and
Ollama documentation kept for reference — useful, but third-party text rather than ours).

## Architecture

```
Next.js 16 app (port 3000)  ──socket.io──▶  VenueIQ engine (port 3003, Bun)
        five routes                              │
                                                ├─ Scenario player (deterministic
                                                │   "evening at Global Village",
                                                │   18:00 → 23:00, replayable)
                                                ├─ NaC signal layer (7 CAMARA APIs;
                                                │   live calls when NAC_API_KEY is set,
                                                │   deterministic simulator otherwise,
                                                │   per-endpoint live/sandbox state)
                                                └─ Agent layer, two implementations:
     ┌─────────────────────────────┐               AGENT_MODE=langgraph (default)
     │  agent-brain (port 3004,    │ ⇠ HTTP ────▶   POSTs the cycle's signals to
     │  Python + FastAPI +         │                the graph and applies what
     │  LangGraph)                 │                comes back
     │                             │               AGENT_MODE=ts (fallback)
     │  perceive → features →      │                in-process SENTINEL / ORACLE /
     │  recall → forecast →        │                NAVIGATOR / GUARDIAN chain
     │  ROUTE(ACT | PROBE | HOLD)  │
     │    ├─ PROBE → spend one     │               Either way the console gets
     │    │   API call, re-decide  │               identical `snapshot` + `trace`
     │    └─ ACT → GUARDIAN actions│               events, so the frontend does
     │       + NAVIGATOR reroute   │               not know or care which ran.
     └─────────────────────────────┘
```

- **The decision is not a script.** The graph's router is a conditional edge: it can act on the
  evidence it has, spend one more API call on a signal *it chooses* to resolve uncertainty, or
  hold the cycle and spend nothing. The branch it took, and why, is a first-class trace line.
- **The demo never dies**: if the brain is unreachable the engine falls back to the TypeScript
  chain; every LLM call falls through the provider chain to deterministic rule templates; the
  scenario is a pure function of the clock, so it is fully replayable.
- **The reasoning stays visible**: every agent decision streams to the on-screen trace with
  an `LLM` / `API` / rules badge showing its source, and per-endpoint live/sandbox state.
- **What the carrier signal is, and is not**: Congestion Insights reports how congested the
  radio network is at a place, as experienced by a device. We use it as an **early indicator of
  crowd pressure** — never as a per-zone headcount. Occupancy numbers come from the venue's own
  per-zone probe devices and scenario model. The console says this on screen, and so does `/how`.

## Run it

```bash
# 1 — the agent brain (Python 3.11+, FastAPI + LangGraph)
cd mini-services/agent-brain
pip install -r requirements.txt
python -m app.main                  # :3004

# 2 — the engine (Bun)
cd ../venue-engine
cp .env.example .env                # add your OLLAMA_API_KEY / NAC_API_KEY
bun install && bun run dev          # :3003, AGENT_MODE=langgraph by default

# 3 — the app
cd ../..
bun install
bun run dev                         # http://localhost:3000
```

Bun is the package manager for the JavaScript side (there is one lockfile, `bun.lock`). Both
services report their mode in the trace feed, so a misconfigured start is visible rather than
silent. If the brain is down, the engine logs it and runs the TypeScript chain instead — set
`AGENT_MODE=ts` to force that path deliberately.

Open `/operator`, press **Play scenario**, and watch the evening build: gates open at 18:00,
Carnival goes critical around showtime, the Guardian raises the alert, the Navigator reroutes
the visitor, and the Transit Hub absorbs the egress waves after the last show.

## Deploy

Three processes, two homes. Vercel runs the Next.js app but **not** the engine: the engine holds
a live socket and a tick loop, and Vercel has no long-lived process to put those in.

| Piece | Where | Why |
|---|---|---|
| `src/` (Next.js) | **Vercel** | static + server rendering — what Vercel is for |
| `mini-services/venue-engine` | **Render** — declared in `render.yaml` | needs a long-lived process for socket.io |
| `mini-services/agent-brain` | **Render** — declared in `render.yaml` | a long-lived HTTP service |

Nothing is hardcoded to a local address. Every service takes its port from `$PORT` when the
platform supplies one and falls back to `3003` / `3004` (the ports its `Dockerfile` exposes),
so there is no port to configure. Both bind `0.0.0.0` and both answer `GET /health`.

### 1 — the two live services on Render (free, no credit card)

`render.yaml` at the repo root provisions both. On Render: **New → Blueprint → pick this repo →
Apply**. Render prompts for the two secrets (`OLLAMA_API_KEY`, `NAC_API_KEY`) — nothing secret
is stored in the file — and wires `BRAIN_URL` to the brain's own hostname for you.

Build settings come from the Blueprint. Creating a service by hand instead? Two values matter:
the **Dockerfile path** is `mini-services/<service>/Dockerfile`, and the **build context** must
be that same service directory (`dockerContext` in `render.yaml`). The `COPY` paths are
relative to it, so a repo-root context fails with `package.json not found`.

**What the free tier actually means here, measured rather than assumed:**

| Limit | Consequence |
|---|---|
| Spins down after 15 min without traffic | the first visit waits **~1 min** for it to come back |
| ~1 min spin-up | the engine triggers a second one for the brain behind it |
| 750 instance hours per workspace per month | ~730 h is one service awake non-stop, so keep both free and let them sleep |
| Ephemeral filesystem | the recorder's `data/session-log.jsonl` is per-boot; nothing depends on it |

The cold start is handled in code rather than by hoping. `EngineWarmer` (mounted in the root
layout) fires one `/health` request as soon as *any* page loads, so the engine starts waking
while a visitor is still reading the landing page; the engine's boot then calls the brain with
a 90 s budget and writes the recovery to the trace feed with the number of seconds it took. If
the brain is still asleep when a cycle runs, that cycle uses the TypeScript chain, says so on
screen, and switches back on its own — no restart, no redeploy.

If a judge might click your link cold and a one-minute wait is unacceptable, put the **engine**
on any always-on tier (Render Starter, Railway, Fly) and leave the brain free: the engine is the
one that has to hold the socket.

### 2 — the app on Vercel

Import the repo with the Next.js preset and set one variable:

```
NEXT_PUBLIC_ENGINE_URL=https://<your-engine-host>
```

That is the only supported production path. With it set the app connects straight to the
engine and skips the local socket race entirely. Without it, the client looks for an engine on
the *page's own* host, which on Vercel is a hostname that has no engine on it.

### 3 — check it

Open `https://<app>/operator`. The header reports the engine's mode and the LLM chain that is
actually answering. If it says disconnected, either `NEXT_PUBLIC_ENGINE_URL` is wrong or the
engine is asleep.

`https://<engine-host>/health` returns the same state as JSON — including `uptimeSeconds`,
`healthHits` and the agent mode — which is how you tell "asleep" apart from "misconfigured".

## Checks

Everything here is runnable from the repo root and costs nothing unless noted.

| Command | What it proves | Cost |
|---|---|---|
| `node scripts/doctor.mjs` | every CAMARA endpoint answers, live | 1 call per endpoint |
| `node scripts/nac-geofence-cleanup.mjs` | geofencing lifecycle end to end — create, list, delete — and clears the doctor's test subscriptions | 2 calls |
| `python scripts/brain-signals.py` | the brain's own Nokia client, separately | 1 call per signal |
| `node scripts/gemini-probe.mjs <KEY>` | a Gemini key works, and which models it can see | a few calls |
| `node mini-services/venue-engine/scripts/langgraph-e2e.mjs` | the graph, end to end | ~15 hosted calls |
| `AGENT_MODE=ts node mini-services/venue-engine/scripts/mode-check.mjs` | which agent layer is really driving | 0 |
| `node mini-services/venue-engine/scripts/fallback-recovery.mjs` | chaos: kill the brain, it degrades and heals | 0 |
| `python -m pytest mini-services/agent-brain/tests -q` | the router's decision policy | 0 |
| `python mini-services/agent-brain/tests/backtest.py` | the forecaster, scored offline | 0 |
| `node scripts/capture-trajectory.mjs` | a full evening of zone data, offline, for forecast tuning | 0 |
| `node scripts/layout-check.mjs` | geometry, palette and text contrast, 5 routes × 4 widths — and, with no engine up, the waiting states a cold-hosted deployment starts in | 0 |
| `node scripts/shots.mjs --full` | review shots → `screenshots/` (local only) | 0 |

Two of these are worth more than the rest.

`fallback-recovery.mjs` is the one that matters before a live demo: it kills the brain
mid-playback and asserts the engine keeps ticking on the TypeScript chain, says so on screen,
and returns to the graph on its own once the service is back — no engine restart.

`layout-check.mjs` drives headless Chrome and fails on overlapping panels, clipped controls,
elements past the viewport edge, colours outside the documented status ramp, and **controls whose
label falls below 4.5:1 contrast**. That last check exists because an earlier pass shipped a
white-on-white primary button that every other check passed.

## Offline tuning (zero API calls)

The forecaster is scored against a captured evening instead of live replays — tuning arithmetic
should not spend gateway or hosted-model quota:

```bash
# 1 — capture (engine with NAC_FORCE_SANDBOX=1 and AGENT_EVERY_MINUTES=999)
SPEED=16 node scripts/capture-trajectory.mjs
# 2 — score, and sweep the blend weights
python mini-services/agent-brain/tests/backtest.py --sweep
# 3 — full-evening rehearsal of the graph, no gateway calls
python mini-services/agent-brain/app/main.py --selftest
```

`NAC_FORCE_SANDBOX=1` runs either service with zero gateway calls; the console labels every
endpoint `sandbox`, so a rehearsal can never be mistaken for a live demo. The backtest also shows
why the carrier class is a cross-check and never averaged into occupancy: on the reference
evening that would have raised six alarm-band crossings on zones that were actually calm.

## Configuration

Both `.env.example` files are the authoritative reference and document every knob inline —
this table is only the shortlist that changes how a run behaves.

**`mini-services/venue-engine/.env`** (holds every credential, for both services):

| Variable | Effect |
|---|---|
| `NAC_API_KEY` | Nokia NaC key. Without it the NaC layer runs the deterministic simulator |
| `OLLAMA_API_KEY` | Ollama Cloud key. Without it the chain drops to rule templates |
| `GEMINI_API_KEY` | optional second hosted provider |
| `AGENT_MODE` | `langgraph` (default) or `ts` to force the fallback chain |
| `BRAIN_LLM_CALLS_PER_RUN` | hard ceiling on hosted calls per scenario run |
| `NAC_FORCE_SANDBOX=1` | zero gateway calls; everything labelled `sandbox` on screen |
| `NAC_ZONE_PROBES` | the venue's per-zone probe devices (comma-separated, one per zone) |
| `NAC_GEOFENCE_SINK` | publicly reachable webhook, needed for a real boundary crossing |

**`.env.local`** (frontend):

| Variable | Effect |
|---|---|
| `NEXT_PUBLIC_ENGINE_URL` | where the engine lives. Unset locally — the app derives it from the host it was served from, which is why a LAN IP, `localhost` and `127.0.0.1` all work. Required for any deployment |
| `NEXT_PUBLIC_ENGINE_PORT` | engine port used when the URL above is unset (default 3003) |
| `NEXT_PUBLIC_HERO_VIDEO` | hero film source override; `none` disables it. A local `public/hero.mp4` or `.webm` outranks this |
| `NEXT_PUBLIC_HERO=film` | switches the landing page to the full-bleed video hero. The dark hero is the default |

## CAMARA APIs used (Nokia Network as Code)

Congestion Insights · Geofencing · Location Retrieval · Device Roaming Status ·
Device Reachability · QoS on Demand · Number Verification

Six of the seven run live against the gateway; the console marks each endpoint's state
individually rather than showing one global badge, so a degraded endpoint cannot hide.

## Known limitations

Stated here rather than left for a reviewer to find:

1. **Congestion Insights is not a headcount.** It reports network congestion as experienced by a
   device: a crowd with phones in pockets reads as uncongested, and one heavy uploader reads as
   congested. Cells do not align with venue zones. Zone occupancy is therefore modelled, and the
   console says so on screen.
2. **Aggregate anonymised density APIs exist in the wider CAMARA catalogue but are not available
   on this platform.** That is a constraint, not an oversight; the migration path is to swap the
   per-device congestion probe for an aggregate density endpoint when an operator offers one.
3. **Number Verification cannot complete here** — it needs an additional OAuth2 step plus a
   registered number. It degrades visibly, marked `sandbox` on the signal board, rather than
   hiding the failure.
4. **Geofencing needs a publicly reachable sink.** The subscription lifecycle is real; the
   boundary crossing is a simulated trigger unless you point `NAC_GEOFENCE_SINK` at a tunnel or
   deployed URL, and the console labels it accordingly.
5. **The forecast is the softest component.** Mean error is ~8.6 percentage points across a full
   evening in the offline backtest, and higher on a single reading. The decision layer is
   considerably stronger than the prediction layer.
6. **Roaming visitors are largely unreachable.** A multi-operator view is a per-market commercial
   arrangement. What we show is a proxy for the crowd, not a census of it — "not visible" is a
   distinct state from "not present".
7. **The venue is a scripted demo.** Global Village's evening is a deterministic model, not a live
   venue feed. Probe devices are Nokia's documented simulator range.

## Keys

All credentials live in `mini-services/venue-engine/.env` (git-ignored), which is the single
source for both services — the brain reads its own `.env` first, then falls back to this one. The
engine degrades gracefully through its provider chain when any key is missing or rate-limited.

## Team

Abhay Jithendra — architecture, CAMARA integration, agent design.
