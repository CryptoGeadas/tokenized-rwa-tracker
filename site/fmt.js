const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
export const fmtPct = (n) => (n == null ? "—" : `${n.toFixed(2)}%`);
export const fmtTvl = (n) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;

// Colours follow the bernardogeadas.com palette (tokens in /site.css).
const ACCENT = "oklch(0.89 0.2 128)", WARN = "oklch(0.75 0.15 50)", DOWN = "oklch(0.68 0.19 25)";
const TEAL = "oklch(0.78 0.12 180)", VIOLET = "oklch(0.72 0.15 300)", INFO = "oklch(0.74 0.11 235)";
const fill = (c) => c.replace(")", " / 0.7)");
export const BACKING_COLORS = {
  "government-debt":       { fill: fill(ACCENT), stroke: ACCENT, label: "Gov debt",    badge: "bt-gov" },
  "private-credit":        { fill: fill(WARN),   stroke: WARN,   label: "Credit",      badge: "bt-credit" },
  "basis-trade/synthetic": { fill: fill(DOWN),   stroke: DOWN,   label: "Synthetic",   badge: "bt-synth" },
  "real-estate":           { fill: fill(TEAL),   stroke: TEAL,   label: "Real estate", badge: "bt-realestate" },
  "commodity":             { fill: fill(VIOLET), stroke: VIOLET, label: "Commodity",   badge: "bt-commodity" },
  "equity":                { fill: fill(INFO),   stroke: INFO,   label: "Equity",      badge: "bt-equity" },
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
