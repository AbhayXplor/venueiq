"use client";

/**
 * The landing page, film variant: one viewport, full-bleed video behind a
 * liquid-glass nav, copy anchored to the bottom in two columns.
 *
 * This sits beside LandingHero rather than replacing it. page.tsx chooses
 * between them, so the classic layout is one environment variable away and
 * nothing had to be deleted to try this.
 *
 * The heading animates character by character, which is a presentation trick
 * with a real accessibility cost: a screen reader handed a hundred single-letter
 * spans will spell the sentence out. So the chars are aria-hidden and the real
 * accessible name sits on an sr-only span beside them.
 */
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { Mark, NAV } from "./SiteHeader";
import { STATS } from "./stats";

/** Stagger between characters, and how long the whole line waits before it starts. */
const CHAR_DELAY_MS = 30;
const CHAR_INITIAL_MS = 200;

const HEADLINE_LINES = ["Read crowd pressure", "before it becomes a crush."];

/**
 * The headline reveals character by character.
 *
 * Characters are grouped into words, and each word is a nowrap inline-block.
 * That grouping is not cosmetic. One span per character makes the gap between
 * any two letters a legal line break, so "crush" could split across two lines
 * as "cru" / "sh". Words are the only place a break is allowed.
 *
 * The stagger is still measured across the whole line — spaces included, via
 * `offset` — so the sweep reads as one left-to-right gesture rather than
 * restarting at every word.
 */
function AnimatedHeading({ lines }: { lines: string[] }) {
  return (
    <h1 className="vq-film-h1">
      <span className="sr-only">{lines.join(" ")}</span>
      {lines.map((line, lineIndex) => {
        // Each line waits for the one above it to finish, so the sentence
        // reads left-to-right, top-to-bottom, as one gesture.
        const lineStartMs = CHAR_INITIAL_MS + lineIndex * line.length * CHAR_DELAY_MS;
        const words = line.split(" ");
        let offset = 0;
        return (
          <span className="vq-film-line" key={line} aria-hidden="true">
            {words.map((word, wordIndex, all) => {
              const wordStart = offset;
              // +1 for the space that separates this word from the next, so the
              // delay keeps advancing across words exactly as it did before.
              offset += word.length + 1;
              return (
                <Fragment key={`${lineIndex}-${wordIndex}`}>
                  <span className="vq-film-word">
                    {Array.from(word).map((char, charIndex) => (
                      <span
                        className="vq-film-char"
                        key={charIndex}
                        style={{ animationDelay: `${lineStartMs + (wordStart + charIndex) * CHAR_DELAY_MS}ms` }}
                      >
                        {char}
                      </span>
                    ))}
                  </span>
                  {/* A real space: the one place a line break is legal. */}
                  {wordIndex < all.length - 1 ? " " : null}
                </Fragment>
              );
            })}
          </span>
        );
      })}
    </h1>
  );
}

function FadeIn({
  delay,
  duration = 1000,
  className,
  children,
}: {
  delay: number;
  duration?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`vq-film-fade${className ? ` ${className}` : ""}`}
      style={{ animationDelay: `${delay}ms`, animationDuration: `${duration}ms` }}
    >
      {children}
    </div>
  );
}

export function LandingHeroFilm({ heroVideo }: { heroVideo: string | null }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Escape closes the phone menu, and a resize back to desktop clears it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => mq.matches && setMenuOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /**
   * Safety net. The keyframes already hold their finished frame via
   * `fill-mode: both`, so a page with no JavaScript still ends up visible. This
   * covers the remaining case — an engine that ignores the keyframes entirely —
   * by putting every animated element straight into its final state. Same
   * pattern the classic hero uses; it is here so the page can never be blank.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const els = Array.from(root.querySelectorAll<HTMLElement>(".vq-film-char, .vq-film-fade"));
        const running = els.some((el) =>
          (el.getAnimations?.() ?? []).some((a) => a.playState === "running"),
        );
        if (!running) root.classList.add("vq-film-static");
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={`vq-film${menuOpen ? " vq-film-open" : ""}`} ref={rootRef}>
      {/* Raw film, no overlay: the video is never dimmed or tinted. */}
      <div className="vq-film-video" aria-hidden="true">
        {heroVideo ? (
          <video src={heroVideo} autoPlay muted loop playsInline preload="auto" />
        ) : (
          <div className="vq-film-field" />
        )}
      </div>

      <div className="vq-film-page">
        <div className="vq-film-navwrap">
          <header className="liquid-glass vq-film-nav">
            <Link href="/" className="vq-film-brand" aria-label="VenueIQ — home">
              <Mark className="vq-film-mark" />
              <span>
                VenueIQ
                <span className="vq-film-brand-suffix">.ai</span>
              </span>
            </Link>

            <nav className="vq-film-navlinks" aria-label="Primary">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>

            <Link href="/operator" className="vq-film-navcta">
              Open console
            </Link>

            <button
              type="button"
              className="vq-film-burger"
              aria-expanded={menuOpen}
              aria-controls="film-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span />
              <span />
              <span />
            </button>
          </header>

          {menuOpen && (
            <nav id="film-menu" className="liquid-glass vq-film-menu" aria-label="Menu">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
        </div>

        <main className="vq-film-hero">
          <div className="vq-film-grid">
            <div className="vq-film-copy">
              <AnimatedHeading lines={HEADLINE_LINES} />

              <FadeIn delay={800}>
                <p className="vq-film-lede">
                  Nokia network congestion is the earliest sign of crowd pressure. VenueIQ reads it
                  live, forecasts thirty minutes ahead, and reroutes guests before a zone fills.
                </p>
              </FadeIn>

              <FadeIn delay={1200}>
                <div className="vq-film-actions">
                  <Link href="/operator" className="vq-film-btn vq-film-btn-solid">
                    Open the operator console
                  </Link>
                  <Link href="/how" className="vq-film-btn vq-film-btn-ghost">
                    See how it works
                  </Link>
                </div>
              </FadeIn>
            </div>

            {/* Right column: the one-line summary, then the evidence for it. */}
            <div className="vq-film-aside">
              <FadeIn delay={1400}>
                <span className="liquid-glass vq-film-tag">Sense. Forecast. Reroute.</span>
              </FadeIn>

              <FadeIn delay={1600} className="vq-film-stats">
                {STATS.map((s) => (
                  <span key={s.value} className="liquid-glass vq-film-stat" title={s.source}>
                    <b>{s.value}</b>
                    {s.label}
                    <span className="vq-film-stat-source">{s.source}</span>
                  </span>
                ))}
              </FadeIn>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
