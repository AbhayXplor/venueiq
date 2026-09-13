"use client";

/**
 * Shared header for every marketing page — logo, liquid-glass nav pills, one
 * solid CTA, and the phone burger menu. Keeps the chrome identical across
 * /, /how and /live so the whole site reads as one product.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

export const NAV = [
  { label: "How It Works", href: "/how" },
  { label: "Live Screen", href: "/live" },
  { label: "Operator Room", href: "/operator" },
  { label: "Guest View", href: "/visitor" },
];

/** VenueIQ mark — three graduated bars, tilted. A crowd-density ramp. */
export function Mark({ className = "vq-land-logo-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <g transform="rotate(-30 12 12)">
        <rect x="4.2" y="11.6" width="3.5" height="8.4" rx="1.75" />
        <rect x="10.25" y="7.6" width="3.5" height="12.4" rx="1.75" />
        <rect x="16.3" y="3.6" width="3.5" height="16.4" rx="1.75" />
      </g>
    </svg>
  );
}

export function SiteHeader({ active }: { active?: string }) {
  const [open, setOpen] = useState(false);

  // Close the menu as soon as we are back on a desktop-width viewport.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 901px)");
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("vq-land-menu-open", open);
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => document.documentElement.classList.remove("vq-land-menu-open"), []);

  return (
    <>
      <div className="vq-land-backdrop" aria-hidden="true" />

      <header className="vq-land-header">
        <Link href="/" className="vq-land-logo vq-appear vq-appear-scale" style={{ "--d": "0.08s" } as React.CSSProperties} aria-label="VenueIQ — home">
          <Mark />
          <span>
            VenueIQ
            <span className="vq-land-logo-suffix">.ai</span>
          </span>
        </Link>

        <nav id="site-nav" className="vq-land-nav" aria-label="Primary">
          {NAV.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active === item.href ? "page" : undefined}
              onClick={() => setOpen(false)}
              className={`vq-appear ${i % 2 === 0 ? "vq-appear-scale" : "vq-appear-soft"}`}
              style={{ "--d": `${0.16 + i * 0.12}s` } as React.CSSProperties}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/live"
          onClick={() => setOpen(false)}
          className="vq-land-btn vq-land-btn-solid vq-land-header-cta vq-appear vq-appear-scale"
          style={{ "--d": "0.34s" } as React.CSSProperties}
        >
          See it live
        </Link>

        <button
          type="button"
          className="vq-land-burger vq-appear vq-appear-scale"
          style={{ "--d": "0.34s" } as React.CSSProperties}
          aria-controls="site-nav"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>
    </>
  );
}
