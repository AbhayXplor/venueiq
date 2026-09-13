"use client";

/**
 * The landing page: one viewport, bottom-anchored hero, three sourced numbers.
 *
 * Every entrance animation resolves to a resting state of opacity 1, so if
 * animations never run the page still renders complete — see the rAF fallback.
 */
import Link from "next/link";
import { Suspense, useEffect, useRef } from "react";
import { SiteHeader } from "./SiteHeader";
import { STATS } from "./stats";
import { ConsoleWakeNote } from "@/components/ConsoleWakeNote";
import { LandingStory } from "./LandingStory";
import { LandingTour } from "./LandingTour";

const delay = (d: string) => ({ "--d": d }) as React.CSSProperties;

/* --------------------------------------------------------------------------
   Stat icons — same gradient language as the rest of the chrome.
   -------------------------------------------------------------------------- */

function RampIcon() {
  return (
    <svg className="vq-land-stat-icon" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="vqRampA" x1="3" y1="2" x2="14" y2="22">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.38" />
          <stop offset="1" stopColor="#3a3a3a" stopOpacity="0.62" />
        </linearGradient>
        <linearGradient id="vqRampB" x1="10" y1="2" x2="21" y2="22">
          <stop offset="0" stopColor="#3a3a3a" stopOpacity="0.38" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.62" />
        </linearGradient>
      </defs>
      <rect x="2.9" y="12.4" width="5" height="9" rx="2.5" fill="url(#vqRampA)" />
      <rect x="9.5" y="7.6" width="5" height="13.8" rx="2.5" fill="#4a4a4a" />
      <rect x="16.1" y="2.6" width="5" height="18.8" rx="2.5" fill="url(#vqRampB)" />
    </svg>
  );
}

function CrowdIcon() {
  return (
    <svg className="vq-land-stat-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8.4" cy="7.2" r="2.6" fill="#e8e8e8" />
      <circle cx="16.1" cy="6.5" r="2.1" fill="#9a9a9a" />
      <circle cx="12.1" cy="12.5" r="2.6" fill="#e8e8e8" />
      <circle cx="5.3" cy="14.6" r="2.1" fill="#6a6a6a" />
      <circle cx="18.4" cy="13.6" r="2.1" fill="#9a9a9a" />
      <circle cx="11.2" cy="19.2" r="2.1" fill="#6a6a6a" />
      <circle cx="17.4" cy="19.4" r="1.6" fill="#4a4a4a" />
    </svg>
  );
}

function SirenIcon() {
  return (
    <svg className="vq-land-stat-icon" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="vqSirenA" x1="5" y1="2" x2="19" y2="17">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.62" />
          <stop offset="1" stopColor="#3a3a3a" stopOpacity="0.86" />
        </linearGradient>
      </defs>
      <path d="M12 2.4a6.5 6.5 0 0 0-6.5 6.5v3.4L3.9 15.6h16.2l-1.6-3.3V8.9A6.5 6.5 0 0 0 12 2.4Z" fill="url(#vqSirenA)" />
      <rect x="9.5" y="17.1" width="5" height="4.6" rx="2.2" fill="#e8e8e8" />
    </svg>
  );
}

/* --------------------------------------------------------------------------
   The three numbers. The figures and their sources live in ./stats so both
   hero layouts cite identical values — a cited figure that can drift between
   two copies is worse than no figure at all. The icons stay here because they
   are specific to this layout.
   -------------------------------------------------------------------------- */

const STAT_ICONS = [<RampIcon key="ramp" />, <CrowdIcon key="crowd" />, <SirenIcon key="siren" />];

export function LandingHero({ heroVideo }: { heroVideo: string | null }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const targets = Array.from(root.querySelectorAll<HTMLElement>(".vq-appear"));
    const onEnd = (e: AnimationEvent) => (e.currentTarget as HTMLElement).classList.add("is-in");
    targets.forEach((el) => el.addEventListener("animationend", onEnd));

    // If nothing is actually animating (reduced motion, unsupported, or a tab
    // that never painted), reveal everything manually so nothing stays hidden.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const running = targets.some((el) =>
          (el.getAnimations?.() ?? []).some((a) => a.playState === "running"),
        );
        if (!running) targets.forEach((el) => el.classList.add("is-in"));
      }),
    );

    return () => {
      cancelAnimationFrame(raf);
      targets.forEach((el) => el.removeEventListener("animationend", onEnd));
    };
  }, []);

  return (
    <>
      <div className="vq-land" ref={rootRef}>
        <div className="vq-land-grain" aria-hidden="true" />

        <div className="vq-land-photo" aria-hidden="true">
          {heroVideo ? (
            <video src={heroVideo} autoPlay muted loop playsInline />
          ) : (
            <div className="vq-land-field" />
          )}
        </div>

      <div className="vq-land-page">
        <SiteHeader active="/" />

        <main className="vq-land-hero" id="top">
          <div className="vq-land-copy">
            <span className="vq-land-badge vq-appear vq-appear-pop" style={delay("0.22s")}>
              <svg className="vq-land-badge-star" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2.6C12.55 2.6 12.88 3.15 13.08 4.7c.62 4.7 1.52 5.6 6.22 6.22 1.55.2 2.1.53 2.1 1.08s-.55.88-2.1 1.08c-4.7.62-5.6 1.52-6.22 6.22-.2 1.55-.53 2.1-1.08 2.1s-.88-.55-1.08-2.1c-.62-4.7-1.52-5.6-6.22-6.22C3.15 12.88 2.6 12.55 2.6 12s.55-.88 2.1-1.08c4.7-.62 5.6-1.52 6.22-6.22C11.12 3.15 11.45 2.6 12 2.6Z" />
              </svg>
              Operational crowd intelligence
            </span>

            <h1 className="vq-land-h1">
              <span className="vq-land-line vq-appear vq-appear-mask" style={delay("0.42s")}>
                Sense <em>crowd pressure</em> from the network
              </span>
              <span className="vq-land-line vq-appear vq-appear-mask" style={delay("0.62s")}>
                before a crush can form.
              </span>
            </h1>

            <p
              className="vq-land-lede vq-appear vq-appear-soft"
              style={{ ...delay("0.82s"), animationDuration: "1.25s" }}
            >
              Network congestion is the earliest sign of crowd pressure. Our agents read it live, forecast
              30 minutes ahead, and reroute guests before a zone fills.
            </p>

            <div className="vq-land-actions">
              <Link href="/operator" className="vq-land-btn vq-land-btn-solid vq-appear vq-appear-btn" style={delay("0.96s")}>
                Open the operator console
              </Link>
              <Link href="/how" className="vq-land-btn vq-land-btn-ghost vq-appear vq-appear-side" style={delay("1.10s")}>
                See how it works
              </Link>
            </div>

            {/* Shown only if the engine really is asleep — see ConsoleWakeNote. */}
            <ConsoleWakeNote className="vq-land-wake" />
          </div>
        </main>

        <footer className="vq-land-stats">
          {STATS.map((s, i) => (
            <span
              key={s.value}
              className="vq-land-stat vq-appear vq-appear-stat"
              style={delay(`${1.12 + i * 0.16}s`)}
              title={s.source}
            >
              {STAT_ICONS[i]}
              <span className="vq-land-stat-text">
                <span className="vq-land-stat-value">{s.value}</span>
                <span>{s.label}</span>
              </span>
              <span className="vq-land-stat-source">{s.source}</span>
            </span>
          ))}
        </footer>
      </div>
    </div>

    <LandingStory />
    {/* Suspense: useSearchParams inside the tour needs a boundary to prerender. */}
    <Suspense fallback={null}>
      <LandingTour />
    </Suspense>
    </>
  );
}
