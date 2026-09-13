"use client";

/**
 * A warning about the wait, shown only while the wait is real.
 *
 * The engine runs on free hosting, which spins an idle instance down and takes
 * about a minute to bring it back — so the first person to open the console can
 * be left staring at nothing. This says so in advance.
 *
 * It asks the engine's `/health` before claiming anything and renders nothing at
 * all once the console is live, because a permanent notice about a problem that
 * is not happening is just noise on every future visit.
 */
import { useEngineAwake } from "@/lib/engine-client";

export function ConsoleWakeNote({ className = "" }: { className?: string }) {
  const awake = useEngineAwake();
  if (awake !== false) return null;

  return (
    <p className={className}>
      <span className="vq-wake-dot" aria-hidden />
      Live console · sleeps when idle, the first visit takes about a minute to wake it
    </p>
  );
}
