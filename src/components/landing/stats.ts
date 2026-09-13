/**
 * The three figures on the marketing page.
 *
 * They live in one file because two hero layouts render them. These are cited
 * numbers, so a source changing has to change in exactly one place — two copies
 * would be a quiet way to end up publishing a stale figure beside a fresh one.
 * Each `source` is shown to screen readers and in a native tooltip, so the
 * claim is always traceable from the page itself.
 */
export type Stat = {
  value: string;
  label: string;
  source: string;
};

export const STATS: Stat[] = [
  {
    value: "10.5M",
    label: "visits in one Global Village season",
    source: "Source: Global Village, Season 29 close — 10.5 million visitors (May 2025).",
  },
  {
    value: "7 per m²",
    label: "where crowd crush forces begin",
    source:
      "Source: Fruin, cited in Risk Frontiers, “Behaviour and Mechanics of Crowd Crush Disasters” — crush mechanics begin around seven people per square metre.",
  },
  {
    value: "1,300+",
    label: "lives lost at the 2024 Hajj",
    source: "Source: reported death toll of the 2024 Hajj pilgrimage (June 2024).",
  },
];
