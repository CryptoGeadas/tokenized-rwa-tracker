import { esc, fmtPct, fmtTvl, backingBadge, tierBadge } from "./fmt.js";

const COLS = [
  { key: "name", label: "Fund" },
  { key: "issuer", label: "Issuer", cls: "issuer-cell" },
  { key: "backing_type", label: "Backing" },
  { key: "apyBase", label: "Yield", cls: "num" },
  { key: "tvl", label: "TVL", cls: "num" },
  { key: "chains", label: "Chains", cls: "chains-cell" },
  { key: "trust_tier", label: "Tier", cls: "num" },
  { key: "one_liner", label: "What you're actually holding" },
];

const WRAPPER_LABELS = {
  "regulated-fund": "Regulated fund",
  "on-chain-pool": "On-chain pool",
  protocol: "Protocol",
  none: "None",
};

const REDEMPTION_LABELS = {
  daily: "Daily",
  instant: "Instant",
  "epoch-based": "Epoch-based",
  variable: "Variable",
  "secondary-market": "Secondary market",
  "market-hours": "Market hours",
};

function sortVal(f, key) {
  if (key === "name") return (f.name || "").toLowerCase();
  if (key === "issuer") return (f.issuer || "").toLowerCase();
  if (key === "backing_type") return f.backing_type || "";
  if (key === "chains") return (f.chains || []).length;
  if (key === "one_liner") return (f.one_liner || "").toLowerCase();
  return f[key] ?? -Infinity;
}

function renderDetailCard(f, colCount) {
  const tierHtml = f.trust_tier != null
    ? `${tierBadge(f.trust_tier)} <span style="margin-left:6px;font-size:13px;color:var(--muted)">Tier ${f.trust_tier}</span>`
    : `<span style="font-size:13px;color:var(--muted)">Not rated</span>`;
  const overrideHtml = f.tier_overrides
    ? `<div class="override-note">${esc(f.tier_overrides)}</div>`
    : "";
  const mislabelHtml = f.mislabel
    ? `<div class="detail-item"><div class="dk">Mislabel</div><div class="dv"><span class="mislabel-badge">&#9888; Not RWA</span></div></div>`
    : "";

  return `<tr class="detail-row"><td colspan="${colCount}">
    <div class="detail-card">
      <div class="detail-grid">
        <div class="detail-item">
          <div class="dk">Trust Tier</div>
          <div class="dv">${tierHtml}${overrideHtml}</div>
        </div>
        <div class="detail-item">
          <div class="dk">Wrapper</div>
          <div class="dv">${esc(WRAPPER_LABELS[f.wrapper] || f.wrapper || "—")}</div>
        </div>
        <div class="detail-item">
          <div class="dk">Jurisdiction</div>
          <div class="dv">${esc(f.jurisdiction || "—")}</div>
        </div>
        <div class="detail-item">
          <div class="dk">Redemption</div>
          <div class="dv">${esc(REDEMPTION_LABELS[f.redemption] || f.redemption || "—")}</div>
        </div>
        <div class="detail-item">
          <div class="dk">Chains</div>
          <div class="dv">${(f.chains || []).map((c) => esc(c)).join(", ") || "—"}</div>
        </div>
        ${mislabelHtml}
        <div class="detail-item full">
          <div class="dk">What you're actually holding</div>
          <div class="dv editorial">${esc(f.one_liner || "—")}</div>
        </div>
      </div>
    </div>
  </td></tr>`;
}

export function renderTable(container, funds, sortKey, sortDir, expandedSlug) {
  const sorted = funds.slice();
  const dir = sortDir === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    const va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return (b.tvl || 0) - (a.tvl || 0);
  });

  const ths = COLS.map((c) => {
    const active = sortKey === c.key;
    const caret = active ? (sortDir === "asc" ? "&#9650;" : "&#9660;") : "";
    return `<th class="${c.cls || ""} ${active ? "active" : ""}" data-sort="${c.key}">${c.label}<span class="caret">${caret}</span></th>`;
  }).join("");

  const rows = sorted.map((f) => {
    const mislabelBadge = f.mislabel ? ` <span class="mislabel-badge">⚠ Not RWA</span>` : "";
    const isOpen = expandedSlug === f.slug;
    const row = `<tr data-slug="${esc(f.slug)}" class="${isOpen ? "expanded" : ""}">
      <td class="name-cell">${esc(f.name)}${mislabelBadge}</td>
      <td class="issuer-cell">${esc(f.issuer)}</td>
      <td>${backingBadge(f.backing_type)}</td>
      <td class="num yield-cell">${fmtPct(f.apyBase)}</td>
      <td class="num tvl-cell">${fmtTvl(f.tvl)}</td>
      <td class="chains-cell">${(f.chains || []).length}</td>
      <td class="num">${tierBadge(f.trust_tier)}</td>
      <td class="oneliner">${esc(f.one_liner)}</td>
    </tr>`;
    return isOpen ? row + renderDetailCard(f, COLS.length) : row;
  }).join("");

  container.innerHTML = `<table class="tbl"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
}
