"use client";

/**
 * The one-minute tour — a spotlight overlay that walks a first-time visitor
 * through the landing page, Tollgate-style.
 *
 * Behaviour contract:
 * - Offered by a small "Take the tour" affordance; never auto-starts.
 * - Pure CSS overlay: a cut-out ring over the page, a floating card, one step
 *   at a time. No library, no dependencies.
 * - Dismissed state persists in localStorage; the affordance stays visible so
 *   anyone can replay it deliberately.
 * - Reduced motion: the pulse animation is the only motion, and it is disabled.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Mark } from "./SiteHeader";

interface Step {
  /** CSS selector for the element to spotlight. */
  sel: string;
  title: string;
  body: string;
  /** Where the card sits relative to the spotlight. */
  side: "top" | "bottom";
}

const STEPS: Step[] = [
  {
    sel: ".vq-land-h1",
    title: "This is the thesis",
    body: "Network congestion is the earliest sign of crowd pressure. The whole product is built on reading it before a crush can form.",
    side: "top",
  },
  {
    sel: ".vq-land-actions",
    title: "Two entrances",
    body: "The operator console is the control room. How it works is the full architecture — including what we refuse to claim.",
    side: "top",
  },
  {
    sel: ".vq-land-stats",
    title: "Sourced numbers",
    body: "Every figure on this page carries its source. Hover one to see where it comes from — nothing here is invented.",
    side: "bottom",
  },
  {
    sel: "#vq-pipeline .vq-story-flow",
    title: "One step is not a script",
    body: "Sense → Reason → Decide → Act → Verify. Decide is a graph edge: the agent chooses to act, probe, or hold. Watch it choose HOLD on the live trace.",
    side: "bottom",
  },
  {
    sel: "#vq-live .vq-story-live",
    title: "Numbers from the running system",
    body: "When the engine is awake, this strip streams the real simulation — decisions, API calls, actions. If it is asleep, the page says so honestly.",
    side: "bottom",
  },
  {
    sel: "#vq-doors",
    title: "Step inside",
    body: "The operator console starts the gate-surge scenario by itself. The guest view is the same engine from inside the crowd.",
    side: "bottom",
  },
];

const STORAGE_KEY = "venueiq.tour.done.v1";

function readDone(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markDone() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* private mode — the tour simply replays next visit */
  }
}

export function LandingTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const rafRef = useRef(0);
  const params = useSearchParams();

  const current = STEPS[step];

  const close = useCallback(() => {
    setOpen(false);
    markDone();
  }, []);

  const start = useCallback(() => {
    setStep(0);
    setOpen(true);
  }, []);

  // Opt-in, Tollgate-style: the floating pill starts it, or `?tour=1` deep-links
  // straight into it for a rehearsed demo. It never auto-opens — a judge who
  // wants the console should never have to dismiss an overlay first.
  useEffect(() => {
    if (params?.get("tour") === "1") {
      const t = setTimeout(() => setOpen(true), 900);
      return () => clearTimeout(t);
    }
  }, [params]);

  // Track the spotlighted element (and re-measure on scroll/resize).
  useLayoutEffect(() => {
    if (!open || !current) {
      setBox(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector<HTMLElement>(current.sel);
      if (!el) {
        setBox(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setBox({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    measure();
    const onMove = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      cancelAnimationFrame(rafRef.current);
    };
  }, [open, step, current]);

  // Scroll the spotlighted element into view when the step changes.
  useEffect(() => {
    if (!open || !current) return;
    document.querySelector(current.sel)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [open, step, current]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" || e.key === "Enter") setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      {/* the affordance — a quiet pill under the header actions once dismissed */}
      {!open && (
        <button type="button" className="vq-tour-offer" onClick={start}>
          <Mark className="vq-tour-offer-mark" />
          Take the tour
        </button>
      )}

      {open && (
        <div className="vq-tour" role="dialog" aria-modal="true" aria-label="Guided tour">
          {box && <div className="vq-tour-hole" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
          {box && <div className="vq-tour-ring" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
          {current && (
            <div
              className={`vq-tour-card${box ? ` vq-tour-card-${current.side}` : " vq-tour-card-center"}`}
              style={
                box
                  ? {
                      left: box.x + box.w / 2,
                      top: current.side === "top" ? box.y - 18 : box.y + box.h + 18,
                    }
                  : undefined
              }
            >
              <p className="vq-tour-count">
                {step + 1} / {STEPS.length}
              </p>
              <h3 className="vq-tour-title">{current.title}</h3>
              <p className="vq-tour-body">{current.body}</p>
              <div className="vq-tour-actions">
                <button type="button" className="vq-tour-skip" onClick={close}>
                  Skip
                </button>
                <div className="vq-tour-nav">
                  {step > 0 && (
                    <button type="button" className="vq-tour-back" onClick={() => setStep((s) => s - 1)}>
                      Back
                    </button>
                  )}
                  {step < STEPS.length - 1 ? (
                    <button type="button" className="vq-tour-next" onClick={() => setStep((s) => s + 1)}>
                      Next
                    </button>
                  ) : (
                    <button type="button" className="vq-tour-next" onClick={close}>
                      Done
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
