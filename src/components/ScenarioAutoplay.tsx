"use client";

/**
 * Scenario autoplay — honour `?play=1`.
 *
 * The landing story and the tour deep-link into the console with ?play=1 so
 * the scenario starts itself: a judge lands on the controls and the venue is
 * already moving. The engine ignores `play` when the scenario has finished for
 * the day (its own guard), so this can never restart a completed run — press
 * reset for that, which is what the console's own button is for.
 *
 * One-shot per mount, no retry loop: if the socket is not up yet, the shared
 * client's own reconnection delivers the snapshot and this simply does nothing.
 */
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { sendControl } from "@/lib/engine-client";

export function ScenarioAutoplay({ connected }: { connected: boolean }) {
  const params = useSearchParams();
  const wantsPlay = params?.get("play") === "1";

  useEffect(() => {
    if (!wantsPlay || !connected) return;
    sendControl({ action: "play" });
    // Fire once per mount — a control message is idempotent for an already
    // running scenario, so the important property is just "no loop".
  }, [wantsPlay, connected]);

  return null;
}
