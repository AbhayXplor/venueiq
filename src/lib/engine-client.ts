"use client";

/**
 * Engine client — one socket.io connection feeds a zustand store; every page
 * (landing, operator, visitor) reads the same live snapshot. No polling, no
 * client-side fetching, one source of truth.
 *
 * Endpoint resolution, in order of precedence:
 *
 * 1. `NEXT_PUBLIC_ENGINE_URL` — set this when the engine lives somewhere else
 *    (Railway, Render, a tunnel). It is the only supported production path.
 * 2. Otherwise derive the engine's address from the page's own hostname, so a
 *    dev server opened as `localhost`, as `127.0.0.1`, or from another machine
 *    on the LAN all reach an engine on the host the page came from. The old
 *    hardcoded `http://localhost:3003` silently connected to nothing whenever
 *    the page was not itself served from `localhost`.
 *
 * With an explicit URL we connect straight to it. Without one we race two dev
 * paths — the gateway's XTransformPort upgrade and the derived direct address —
 * and the first one to deliver a snapshot wins; the loser is closed, so the
 * engine never ends up serving two consoles.
 */
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import type { ControlAction, Snapshot, TraceEvent } from "./types";

const ENGINE_PORT = Number(process.env.NEXT_PUBLIC_ENGINE_PORT ?? 3003)
const EXPLICIT_ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL?.replace(/\/$/, "") || null

function directEngineUrl(): string {
  if (EXPLICIT_ENGINE_URL) return EXPLICIT_ENGINE_URL
  if (typeof window === "undefined") return `http://localhost:${ENGINE_PORT}`
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:${ENGINE_PORT}`
}

interface EngineStore {
  snapshot: Snapshot | null
  traces: TraceEvent[]
  connected: boolean
  ready: boolean
  path: "gateway" | "direct" | null
}

export const useEngineStore = create<EngineStore>(() => ({
  snapshot: null,
  traces: [],
  connected: false,
  ready: false,
  path: null,
}))

let gatewaySocket: Socket | null = null
let directSocket: Socket | null = null
let winner: "gateway" | "direct" | null = null

function attach(s: Socket, path: "gateway" | "direct") {
  s.on("connect", () => {
    // An open socket is not proof of life — the engine's first snapshot is.
    // Locking the race here would let a path that connects but never streams
    // starve the one that does, which is precisely the failure that would look
    // like "the demo just stopped" on stage.
    if (winner && winner !== path) return
    useEngineStore.setState((st) => (st.snapshot ? st : { connected: true, ready: true, path }))
    console.info(`[engine] socket open via ${path}`)
  })
  s.on("disconnect", () => {
    if (!winner || winner === path) useEngineStore.setState({ connected: false })
  })
  s.on("snapshot", (snapshot: Snapshot) => {
    // First snapshot decides the race, and the loser is closed so the engine
    // only ever serves one console.
    if (winner && winner !== path) {
      s.close()
      return
    }
    const isFirst = winner === null
    winner = path
    const other = path === "gateway" ? directSocket : gatewaySocket
    if (isFirst && other) other.close()
    useEngineStore.setState({ snapshot, ready: true, connected: true, path })
  })
  s.on("trace", (event: TraceEvent) =>
    useEngineStore.setState((st) => {
      if (winner && winner !== path) return st
      const traces = st.traces.some((t) => t.id === event.id) ? st.traces : [...st.traces, event]
      return { traces: traces.slice(-160) }
    })
  )
  s.on("connect_error", () =>
    useEngineStore.setState((st) => (st.ready ? st : { ready: true }))
  )
}

/**
 * Wake the engine before anyone needs it.
 *
 * A free-tier host spins an idle service down, and the next request then waits
 * up to a minute for it to answer. Firing one harmless request as soon as any
 * page loads starts that wake-up while the reader is still on the landing page,
 * so the console usually has a live engine by the time they reach it. Waking
 * the engine also wakes the brain behind it, which is the slower of the two.
 *
 * Best-effort by design: it must never block a render or throw.
 */
let warmRequested = false

export function warmEngine(): void {
  if (warmRequested || typeof window === "undefined") return
  warmRequested = true
  // `no-cors` because the engine is a different origin: the reply is opaque and
  // unreadable, which is fine — the request reaching the engine is the point.
  void fetch(`${directEngineUrl()}/health`, { mode: "no-cors", cache: "no-store" }).catch(() => {});
}

/**
 * Is the engine answering yet? `null` until we have asked, so a caller stays
 * silent rather than warning about something it has not verified.
 *
 * Free hosting spins an idle service down, so the first visit waits — this is
 * how a caller finds out whether that is happening right now. The first look
 * also starts the wake-up. If the engine does not answer we keep asking for
 * about a minute, which is how long a spun-down instance takes to return, and
 * then stop: an idle tab left open overnight must not hold the service awake
 * and spend the month's instance hours.
 */
export function useEngineAwake(): boolean | null {
  const [awake, setAwake] = useState<boolean | null>(null)

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const ask = async () => {
      attempts++
      try {
        const res = await fetch(`${directEngineUrl()}/health`, {
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        })
        if (stopped) return
        if (res.ok) {
          setAwake(true)
          return
        }
      } catch {
        /* not answering yet — which is the case worth saying out loud */
      }
      if (stopped) return
      setAwake(false)
      if (attempts < 12) timer = setTimeout(ask, 5000)
    }

    warmEngine()
    void ask()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  return awake
}

export function connectEngine(): () => void {
  // The gateway trick is a local-preview affordance only: it routes a
  // same-origin socket upgrade through Next's dev server via a query param.
  // There is no reason to try it against a real engine URL.
  if (gatewaySocket === null && !EXPLICIT_ENGINE_URL) {
    gatewaySocket = io(`/?XTransformPort=${ENGINE_PORT}`, {
      transports: ["websocket", "polling"],
      reconnectionDelay: 1200,
      reconnectionDelayMax: 4000,
      timeout: 7000,
    })
    attach(gatewaySocket, "gateway")
  }
  if (directSocket === null) {
    directSocket = io(directEngineUrl(), {
      transports: ["websocket", "polling"],
      reconnectionDelay: 1500,
      reconnectionDelayMax: 5000,
      timeout: 5000,
    })
    attach(directSocket, "direct")
  }
  return () => {
    /* sockets persist across route changes — single shared connection */
  }
}

export function sendControl(msg: ControlAction): void {
  const s = winner === "gateway" ? gatewaySocket : directSocket
  s?.emit("control", msg)
}

export function sendGuardianAction(action: string, zoneId?: string): void {
  const s = winner === "gateway" ? gatewaySocket : directSocket
  s?.emit("guardian-action", { action, zoneId })
}

/** React hook: connect on mount (idempotent across pages). */
export function useEngine(): void {
  useEffect(() => connectEngine(), [])
}
