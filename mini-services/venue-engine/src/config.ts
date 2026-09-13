/** Engine configuration — all values from environment with sane defaults. */

function num(name: string, def: number): number {
  const v = process.env[name]
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) ? n : def
}

function str(name: string, def: string): string {
  const v = process.env[name]
  return v && v.trim().length > 0 ? v.trim() : def
}

function bool(name: string, def: boolean): boolean {
  const v = process.env[name]
  if (!v) return def
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())
}

function list(name: string, def: string[]): string[] {
  const v = process.env[name]
  if (!v || !v.trim()) return def
  const items = v.split(',').map((s) => s.trim()).filter(Boolean)
  return items.length > 0 ? items : def
}

/**
 * Nokia's documented simulator test range — one probe device per zone.
 *
 * These are Nokia's published test identities rather than credentials, but the
 * real architecture is "the venue's own SIMs on a shelf", so the list is
 * overridable: in production it is the venue's probe fleet.
 */
const DEFAULT_ZONE_PROBES = ['+99999991000', '+99999991001', '+99999991002', '+99999991003', '+99999991004', '+99999991005']

export const config = {
  /**
   * Hosting platforms (Railway, Render, Fly) inject the port to bind as `PORT`
   * and point their health check at it, so it has to outrank ENGINE_PORT.
   * Ignoring it means the service listens somewhere nothing is looking, and a
   * perfectly healthy deploy reports as dead.
   */
  port: num('PORT', num('ENGINE_PORT', 3003)),
  /** Real milliseconds per simulated minute. */
  tickRealMs: num('TICK_REAL_MS', 2000),
  /** Simulation starts here (18:00). */
  startMinute: num('START_MINUTE', 1080),
  /** Simulation ends here (23:00). */
  endMinute: num('END_MINUTE', 1380),
  /** Agent cycle: run the multi-agent graph every N simulated minutes. */
  agentEveryMinutes: num('AGENT_EVERY_MINUTES', 5),
  /** LLM provider chain. */
  llm: {
    ollama: {
      baseUrl: str('OLLAMA_BASE_URL', 'https://ollama.com/v1'),
      apiKey: str('OLLAMA_API_KEY', ''),
      model: str('OLLAMA_MODEL', 'gpt-oss:20b'),
    },
    gemini: {
      apiKey: str('GEMINI_API_KEY', ''),
      baseUrl: str('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai'),
      model: str('GEMINI_MODEL', 'gemini-3.1-flash-lite'),
    },
    /** Hard timeout for any single LLM call (ms). */
    timeoutMs: num('LLM_TIMEOUT_MS', 20000),
  },
  /**
   * Agent layer. `langgraph` hands reasoning to the Python brain service;
   * `ts` keeps everything in this process. When the brain is unreachable the
   * engine degrades to `ts` on its own rather than stalling the demo.
   */
  agent: {
    mode: (str('AGENT_MODE', 'langgraph') === 'ts' ? 'ts' : 'langgraph') as 'langgraph' | 'ts',
    brainUrl: str('BRAIN_URL', 'http://127.0.0.1:3004'),
    /** Generous, because a slow cycle only stretches the cadence — the agent
     *  loop already refuses to run two cycles at once. */
    brainTimeoutMs: num('BRAIN_TIMEOUT_MS', 30000),
    /** Simulated minute stamped on each cycle, so the brain can score its own
     *  forecasts when their horizon arrives. */
    runId: str('RUN_ID', `run-${Date.now().toString(36)}`),
  },

  /** Nokia Network as Code — real calls only when a key is configured. */
  nac: {
    apiKey: str('NAC_API_KEY', ''),
    // Verified live: the URL host and the header host differ, and the legacy
    // `network-as-code.p.rapidapi.com` listing answers 403 "not subscribed"
    // even with a valid key. These defaults used to point at the legacy host,
    // so a missing .env silently cost every live call.
    baseUrl: str('NAC_BASE_URL', 'https://network-as-code.p-eu.rapidapi.com'),
    rapidApiHost: str('NAC_RAPIDAPI_HOST', 'network-as-code.nokia.rapidapi.com'),
    timeoutMs: num('NAC_TIMEOUT_MS', 6000),
    /**
     * The consented visitor sample — one device used as calibration ground
     * truth for the device-scoped endpoints. Must resolve on the gateway; the
     * sandbox only knows the documented simulator range, so override this with
     * a real number when running against a live venue.
     */
    sampleDevice: str('NAC_SAMPLE_DEVICE', DEFAULT_ZONE_PROBES[0]),
    /** The venue's probe fleet, one device per zone. */
    zoneProbes: list('NAC_ZONE_PROBES', DEFAULT_ZONE_PROBES),
    /**
     * Publicly reachable webhook the geofencing subscription delivers to. The
     * API validates DNS on the sink host, so it must resolve — a tunnel URL
     * when demonstrating a real boundary crossing.
     */
    geofenceSink: str('NAC_GEOFENCE_SINK', 'https://example.com/webhook'),
    /**
     * Run with zero gateway calls. Used for offline work (tuning the forecast,
     * rehearsing the demo, capturing a reference trajectory) without spending
     * quota. The console still labels every endpoint `sandbox`, so a forced run
     * can never be mistaken for a live one.
     */
    forceSandbox: bool('NAC_FORCE_SANDBOX', false),
  },
}
