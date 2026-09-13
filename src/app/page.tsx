import { existsSync } from "node:fs";
import { join } from "node:path";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingHeroFilm } from "@/components/landing/LandingHeroFilm";
import { FALLBACK_HERO_VIDEO } from "@/components/landing/hero-video";

/**
 * Hero film source, highest priority first: a recording of your own console
 * dropped at `public/hero.mp4`, then NEXT_PUBLIC_HERO_VIDEO, then the stock
 * fallback. See hero-video.ts for why that order matters.
 *
 * `NEXT_PUBLIC_HERO_VIDEO=none` forces the no-footage layout, which is also
 * what you get if the file is missing and the override is empty.
 */
function heroFilm(): string | null {
  for (const name of ["hero.mp4", "hero.webm"]) {
    if (existsSync(join(process.cwd(), "public", name))) return `/${name}`;
  }
  const configured = process.env.NEXT_PUBLIC_HERO_VIDEO?.trim();
  if (configured) return configured === "none" ? null : configured;
  return FALLBACK_HERO_VIDEO;
}

export default function Page() {
  /**
   * The dark hero is the default. The film variant — the full-bleed video layout
   * with a character-by-character headline — is kept behind a flag:
   *
   *   NEXT_PUBLIC_HERO=film   -> the full-bleed video layout
   *
   * Both layouts read the same film, so the switch is an env change and nothing
   * more. The film variant was set aside while the hero ran stock footage of an
   * unrelated city over a bright, undimmed frame; that objection no longer fully
   * applies now that the hero carries our own footage behind scrims, so it is
   * worth another look. Its one known defect is that the per-character spans let
   * the headline break mid-word, which the classic layout does not.
   */
  const heroVideo = heroFilm();
  const variant = process.env.NEXT_PUBLIC_HERO === "film" ? "film" : "classic";

  if (variant === "classic") return <LandingHero heroVideo={heroVideo} />;
  return <LandingHeroFilm heroVideo={heroVideo} />;
}
