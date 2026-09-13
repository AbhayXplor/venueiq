/**
 * Where the hero film comes from, in priority order:
 *
 *   1. a local file you own — `public/hero.mp4` (or `.webm`)
 *   2. `NEXT_PUBLIC_HERO_VIDEO`
 *   3. FALLBACK_HERO_VIDEO, below
 *
 * Source 1 is in place (`public/hero.mp4`), so it wins and the constant below is
 * inert — it is served over our own origin, needs no network access to a third
 * party, and cannot be pulled out from under a live demo.
 *
 * FALLBACK_HERO_VIDEO is a stock clip on someone else's CDN, kept only so a
 * fresh clone without the asset still renders motion. It is deliberately the
 * lowest-priority source so that any replacement dropped into `public/` silently
 * wins. Do not let a public deployment depend on it staying online.
 */
export const FALLBACK_HERO_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260403_050628_c4e32401-fab4-4a27-b7a8-6e9291cd5959.mp4";
