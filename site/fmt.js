const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
export const fmtPct = (n) => (n == null ? "—" : `${n.toFixed(2)}%`);
export const fmtTvl = (n) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;

export const BACKING_COLORS = {
  "government-debt":       { fill: "rgba(59,130,246,0.7)",  stroke: "#3B82F6", label: "Gov debt",    badge: "bt-gov" },
  "private-credit":        { fill: "rgba(245,158,11,0.7)",  stroke: "#F59E0B", label: "Credit",      badge: "bt-credit" },
  "basis-trade/synthetic": { fill: "rgba(239,68,68,0.7)",   stroke: "#EF4444", label: "Synthetic",   badge: "bt-synth" },
  "real-estate":           { fill: "rgba(16,185,129,0.7)",  stroke: "#10B981", label: "Real estate", badge: "bt-realestate" },
  "commodity":             { fill: "rgba(139,92,246,0.7)",   stroke: "#8B5CF6", label: "Commodity",   badge: "bt-commodity" },
  "equity":                { fill: "rgba(59,130,246,0.7)",   stroke: "#3B82F6", label: "Equity",      badge: "bt-equity" },
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
