// The escape and the money, percent and date formatters are the shared copy in format.js (#48).
import { esc, fmtTvl } from "./format.js";
// A TVL taken from CoinGecko (DefiLlama has none, #20) is marked so the reader knows the source.
export const tvlCell = (f) => fmtTvl(f.tvl) + (f.tvlSource === "coingecko" ? ` <span class="tvl-src" title="Market cap from CoinGecko: DefiLlama reports no TVL for this fund">CG</span>` : "");

// Colours are the site's tokens (/site.css), so one change there reaches the tracker (#45): mint
// for the safest backing, a light neutral for credit, amber for synthetic (caution), and quiet
// data colours for the rest. Each differs in lightness as well as hue. Sand has no site token;
// it is the tracker's own data colour (styles.css). Use these as CSS (style, not SVG attributes).
const MINT = "var(--accent)", NEUTRAL = "var(--fg-2)", AMBER = "var(--warn)";
const CYAN = "var(--cyan)", VIOLET = "var(--violet)", SAND = "var(--sand)", MUTED = "var(--muted)", FAINT = "var(--faint)";
const fill = (c) => `color-mix(in srgb, ${c} 70%, transparent)`;
export const BACKING_COLORS = {
  "government-debt":       { fill: fill(MINT),    stroke: MINT,    label: "Gov debt",    badge: "bt-gov" },
  "private-credit":        { fill: fill(NEUTRAL), stroke: NEUTRAL, label: "Credit",      badge: "bt-credit" },
  "basis-trade/synthetic": { fill: fill(AMBER),   stroke: AMBER,   label: "Synthetic",   badge: "bt-synth" },
  "real-estate":           { fill: fill(VIOLET),  stroke: VIOLET,  label: "Real estate", badge: "bt-realestate" },
  "commodity":             { fill: fill(SAND),    stroke: SAND,    label: "Commodity",   badge: "bt-commodity" },
  "equity":                { fill: fill(MUTED),   stroke: MUTED,   label: "Equity",      badge: "bt-equity" },
  "insurance":             { fill: fill(CYAN),    stroke: CYAN,    label: "Insurance",   badge: "bt-insurance" },
  "mixed/other":           { fill: fill(FAINT),   stroke: FAINT,   label: "Mixed/other", badge: "bt-other" },
};

export function backingBadge(type) {
  const c = BACKING_COLORS[type];
  if (!c) return esc(type);
  return `<span class="bt ${c.badge}">${esc(c.label)}</span>`;
}

export function tierBadge(tier) {
  if (tier == null) return "—";
  return `<span class="tier tier-${tier}">${tier}</span>`;
}
