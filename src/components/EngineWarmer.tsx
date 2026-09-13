"use client";

/**
 * Warms the engine on any page load. Renders nothing.
 *
 * It exists because a free-tier host spins an idle service down, and the first
 * visitor would otherwise wait up to a minute before the console came alive.
 * Mounted once in the root layout, so every route — the landing page included —
 * starts the wake-up as early as possible rather than only when a visitor
 * reaches `/operator`.
 */
import { useEffect } from "react";
import { warmEngine } from "@/lib/engine-client";

export function EngineWarmer() {
  useEffect(() => {
    warmEngine();
  }, []);
  return null;
}
