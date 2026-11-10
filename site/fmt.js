const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
export const fmtPct = (n) => (n == null ? "—" : `${n.toFixed(2)}%`);
// A TVL taken from CoinGecko (DefiLlama has none, #20) is marked so the reader knows the source.
export const tvlCell = (f) => fmtTvl(f.tvl) + (f.tvlSource === "coingecko" ? ` <span class="tvl-src" title="Market cap from CoinGecko: DefiLlama reports no TVL for this fund">CG</span>` : "");
export const fmtTvl = (n) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;

// Colours follow the site v2 palette (tokens in /site.css): mint for the
// safest backing, a light neutral for credit, amber for synthetic (caution), and quiet
// data colours for the rest. Each differs in lightness as well as hue.
const MINT = "#7ee0a8", NEUTRAL = "#c9d1cb", AMBER = "#e5b45a";
const CYAN = "#8fb3c9", VIOLET = "#b7a6d9", SAND = "#d4c08a", MUTED = "#a3ada6", FAINT = "#7f8c84";
const fill = (c) => `${c}b3`; // 70% alpha on a #rrggbb colour
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
