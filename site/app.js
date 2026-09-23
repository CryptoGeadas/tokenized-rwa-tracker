const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
const fmtPct = (n) => (n == null ? "—" : `${n.toFixed(2)}%`);
const fmtTvl = (n) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;

const BACKING_COLORS = {
  "government-debt":       { fill: "rgba(59,130,246,0.7)",  stroke: "#3B82F6", label: "Gov debt",    badge: "bt-gov" },
  "private-credit":        { fill: "rgba(245,158,11,0.7)",  stroke: "#F59E0B", label: "Credit",      badge: "bt-credit" },
  "basis-trade/synthetic": { fill: "rgba(239,68,68,0.7)",   stroke: "#EF4444", label: "Synthetic",   badge: "bt-synth" },
  "real-estate":           { fill: "rgba(16,185,129,0.7)",  stroke: "#10B981", label: "Real estate", badge: "bt-realestate" },
  "commodity":             { fill: "rgba(139,92,246,0.7)",   stroke: "#8B5CF6", label: "Commodity",   badge: "bt-commodity" },
  "equity":                { fill: "rgba(59,130,246,0.7)",   stroke: "#3B82F6", label: "Equity",      badge: "bt-equity" },
};

const $ = (s) => document.querySelector(s);
const state = { data: null, sortKey: "trust_tier", sortDir: "asc", expandedSlug: null };

// ─── Data loading ──────────────────────────────────────────────────────────

async function load() {
  try {
    const res = await fetch("./data/latest.json", { cache: "no-cache" });
    state.data = await res.json();
  } catch {
    $("#scatter-section").innerHTML = `<p style="color:var(--muted);padding:20px">No data — run <code>node build/build.mjs</code> first.</p>`;
    return;
  }
  renderScatter();
  renderTable();
  renderUnclassified();
  renderSecondary();
  renderFooter();
}

// ─── D3 scatter chart ──────────────────────────────────────────────────────

function renderScatter() {
  const container = $("#scatter-chart");
  container.innerHTML = "";

  const funds = state.data.mainStage.filter((f) => f.apyBase != null);
  if (!funds.length) return;

  const rect = container.getBoundingClientRect();
  const W = Math.max(rect.width, 320);
  const H = 420;
  const PAD = { top: 30, right: 30, bottom: 55, left: 60 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxYield = Math.max(...funds.map((f) => f.apyBase)) * 1.15;
  const maxTvl = Math.max(...funds.map((f) => f.tvl));
  const minR = 7, maxR = 34;

  const isDark = document.documentElement.dataset.theme === "dark";
  const textColor = isDark ? "#9CA3B0" : "#6B7482";
  const gridColor = isDark ? "rgba(42,48,64,0.6)" : "rgba(224,228,236,0.6)";
  const axisColor = isDark ? "#5A6472" : "#9CA3B0";

  const svg = d3.select(container)
    .append("svg")
    .attr("class", "scatter-svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const yScale = d3.scaleLinear().domain([0, maxYield]).range([PAD.top + plotH, PAD.top]);
  const rScale = (tvl) => minR + (Math.sqrt(tvl) / Math.sqrt(maxTvl)) * (maxR - minR);
  const zoneW = plotW / 4;
  const tierX = (tier) => PAD.left + zoneW * (tier - 1) + zoneW / 2;

  // horizontal grid
  const yTicks = d3.range(0, maxYield, maxYield / 4).concat(maxYield);
  svg.selectAll(".grid-line")
    .data(yTicks)
    .join("line")
    .attr("x1", PAD.left).attr("x2", W - PAD.right)
    .attr("y1", (d) => yScale(d)).attr("y2", (d) => yScale(d))
    .attr("stroke", gridColor).attr("stroke-width", 1);

  // vertical tier dividers
  for (let t = 1; t < 4; t++) {
    svg.append("line")
      .attr("x1", PAD.left + zoneW * t).attr("x2", PAD.left + zoneW * t)
      .attr("y1", PAD.top).attr("y2", PAD.top + plotH)
      .attr("stroke", gridColor).attr("stroke-dasharray", "4,4");
  }

  // y-axis labels
  svg.selectAll(".y-label")
    .data(yTicks)
    .join("text")
    .attr("x", PAD.left - 8).attr("y", (d) => yScale(d) + 4)
    .attr("text-anchor", "end")
    .attr("fill", textColor).attr("font-size", 11).attr("font-family", "Inter, sans-serif")
    .text((d) => d.toFixed(1) + "%");

  // y-axis title
  svg.append("text")
    .attr("transform", `translate(14, ${PAD.top + plotH / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .attr("fill", axisColor).attr("font-size", 10)
    .attr("font-family", "Sora, sans-serif").attr("font-weight", 600)
    .text("YIELD (apyBase)");

  // tier zone labels
  const tierLabels = [
    { tier: 1, line1: "Tier 1", line2: "High trust" },
    { tier: 2, line1: "Tier 2", line2: "Moderate" },
    { tier: 3, line1: "Tier 3", line2: "Low trust" },
    { tier: 4, line1: "Tier 4", line2: "Mislabeled" },
  ];
  tierLabels.forEach((t) => {
    const cx = tierX(t.tier);
    svg.append("text").attr("x", cx).attr("y", H - 24).attr("text-anchor", "middle")
      .attr("fill", axisColor).attr("font-size", 10)
      .attr("font-family", "Sora, sans-serif").attr("font-weight", 600)
      .text(t.line1);
    svg.append("text").attr("x", cx).attr("y", H - 10).attr("text-anchor", "middle")
      .attr("fill", textColor).attr("font-size", 9).attr("font-family", "Inter, sans-serif")
      .text(t.line2);
  });

  // seeded jitter so dots don't jump on re-render
  const jitterSeed = {};
  funds.forEach((f, i) => { jitterSeed[f.slug] = ((i * 2654435761) % 1000) / 1000 - 0.5; });

  // dots
  const tooltip = $(".scatter-tooltip");
  const dots = svg.selectAll(".dot")
    .data(funds)
    .join("g")
    .attr("class", "dot")
    .attr("transform", (f) => {
      const jitter = jitterSeed[f.slug] * zoneW * 0.5;
      const x = tierX(f.trust_tier ?? 4) + jitter;
      const y = yScale(f.apyBase);
      return `translate(${x},${y})`;
    });

  dots.append("circle")
    .attr("r", (f) => rScale(f.tvl))
    .attr("fill", (f) => (BACKING_COLORS[f.backing_type] || BACKING_COLORS["private-credit"]).fill)
    .attr("stroke", (f) => (BACKING_COLORS[f.backing_type] || BACKING_COLORS["private-credit"]).stroke)
    .attr("stroke-width", 1.5)
    .style("cursor", "pointer");

  // mislabel markers
  dots.filter((f) => f.mislabel)
    .append("text")
    .attr("y", (f) => -rScale(f.tvl) - 5)
    .attr("text-anchor", "middle")
    .attr("fill", "#EF4444").attr("font-size", 10)
    .attr("font-family", "Sora, sans-serif").attr("font-weight", 700)
    .text("NOT RWA");

  // tooltip events
  dots.on("mouseenter", function (event, f) {
    const mislabelLine = f.mislabel ? `<div class="tt-mislabel">⚠ NOT AN RWA</div>` : "";
    tooltip.innerHTML =
      `<div class="tt-name">${esc(f.name)}</div>${mislabelLine}` +
      `<div class="tt-row">${esc(f.issuer)} · Tier ${f.trust_tier}</div>` +
      `<div class="tt-row">${fmtPct(f.apyBase)} · ${fmtTvl(f.tvl)}</div>`;
    tooltip.classList.add("visible");
  })
  .on("mousemove", function (event) {
    const wrap = $(".scatter-wrap").getBoundingClientRect();
    let left = event.clientX - wrap.left + 14;
    let top = event.clientY - wrap.top - 20;
    // keep tooltip inside the panel
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    if (left + tw > wrap.width - 8) left = event.clientX - wrap.left - tw - 14;
    if (top + th > wrap.height - 8) top = wrap.height - th - 8;
    if (top < 4) top = 4;
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  })
  .on("mouseleave", () => { tooltip.classList.remove("visible"); });
}

// ─── Trust filter table ────────────────────────────────────────────────────

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

function sortVal(f, key) {
  if (key === "name") return (f.name || "").toLowerCase();
  if (key === "issuer") return (f.issuer || "").toLowerCase();
  if (key === "backing_type") return f.backing_type || "";
  if (key === "chains") return (f.chains || []).length;
  if (key === "one_liner") return (f.one_liner || "").toLowerCase();
  return f[key] ?? -Infinity;
}

function backingBadge(type) {
  const c = BACKING_COLORS[type];
  if (!c) return esc(type);
  return `<span class="bt ${c.badge}">${esc(c.label)}</span>`;
}

function tierBadge(tier) {
  if (tier == null) return "—";
  return `<span class="tier tier-${tier}">${tier}</span>`;
}

function renderTable() {
  const funds = state.data.mainStage.slice();
  const dir = state.sortDir === "asc" ? 1 : -1;
  funds.sort((a, b) => {
    const va = sortVal(a, state.sortKey), vb = sortVal(b, state.sortKey);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return (b.tvl || 0) - (a.tvl || 0);
  });

  const ths = COLS.map((c) => {
    const active = state.sortKey === c.key;
    const caret = active ? (state.sortDir === "asc" ? "&#9650;" : "&#9660;") : "";
    return `<th class="${c.cls || ""} ${active ? "active" : ""}" data-sort="${c.key}">${c.label}<span class="caret">${caret}</span></th>`;
  }).join("");

  const rows = funds.map((f) => {
    const mislabelBadge = f.mislabel ? ` <span class="mislabel-badge">⚠ Not RWA</span>` : "";
    const isOpen = state.expandedSlug === f.slug;
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
    return isOpen ? row + renderDetailCard(f) : row;
  }).join("");

  $("#table-container").innerHTML = `<table class="tbl"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
}

// ─── Unclassified section ──────────────────────────────────────────────────

const UNCL_VISIBLE = 15;

function renderUnclassified() {
  const items = state.data.unclassified || [];
  const section = $("#unclassified-section");
  if (!items.length) { section.style.display = "none"; return; }
  section.style.display = "block";

  state.unclExpanded = false;

  const renderRows = (list) => list.map((u) =>
    `<div class="uncl-row"><span class="uncl-name">${esc(u.name)}</span><span class="uncl-chains">${(u.chains || []).join(", ")}</span><span class="uncl-tvl">${fmtTvl(u.tvl)}</span></div>`
  ).join("");

  const listEl = $("#unclassified-list");
  const toggleBtn = $("#uncl-toggle");

  const update = () => {
    const visible = state.unclExpanded ? items : items.slice(0, UNCL_VISIBLE);
    listEl.innerHTML = renderRows(visible);
    if (items.length > UNCL_VISIBLE) {
      toggleBtn.style.display = "inline-flex";
      toggleBtn.textContent = state.unclExpanded
        ? "Show less"
        : `Show ${items.length - UNCL_VISIBLE} more`;
    } else {
      toggleBtn.style.display = "none";
    }
  };

  toggleBtn.onclick = () => { state.unclExpanded = !state.unclExpanded; update(); };
  update();
}

// ─── Detail card (drill-down) ─────────────────────────────────────────────

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

function renderDetailCard(f) {
  const tierHtml = f.trust_tier != null
    ? `${tierBadge(f.trust_tier)} <span style="margin-left:6px;font-size:13px;color:var(--muted)">Tier ${f.trust_tier}</span>`
    : `<span style="font-size:13px;color:var(--muted)">Not rated</span>`;
  const overrideHtml = f.tier_overrides
    ? `<div class="override-note">${esc(f.tier_overrides)}</div>`
    : "";
  const mislabelHtml = f.mislabel
    ? `<div class="detail-item"><div class="dk">Mislabel</div><div class="dv"><span class="mislabel-badge">&#9888; Not RWA</span></div></div>`
    : "";

  return `<tr class="detail-row"><td colspan="${COLS.length}">
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

// ─── Secondary lane tables ────────────────────────────────────────────────

const LANE_LABELS = { "real-estate": "Real Estate", commodity: "Commodity", equity: "Equity" };
const LANE_COLS = [
  { key: "name", label: "Fund" },
  { key: "issuer", label: "Issuer" },
  { key: "backing_type", label: "Backing" },
  { key: "tvl", label: "TVL", cls: "num" },
  { key: "chains", label: "Chains", cls: "chains-cell" },
  { key: "one_liner", label: "One-liner" },
];

function renderSecondary() {
  const lanes = state.data.secondaryLanes || {};
  const section = $("#secondary-section");
  const container = $("#secondary-lanes");

  const laneKeys = Object.keys(lanes).filter((k) => lanes[k].length > 0);
  if (!laneKeys.length) { section.style.display = "none"; return; }
  section.style.display = "block";

  container.innerHTML = laneKeys.map((key) => {
    const funds = lanes[key].slice().sort((a, b) => (b.tvl || 0) - (a.tvl || 0)).slice(0, 10);
    const ths = LANE_COLS.map((c) =>
      `<th class="${c.cls || ""}">${c.label}</th>`
    ).join("");
    const rows = funds.map((f) =>
      `<tr>
        <td class="name-cell">${esc(f.name)}</td>
        <td>${esc(f.issuer)}</td>
        <td>${backingBadge(f.backing_type)}</td>
        <td class="num">${fmtTvl(f.tvl)}</td>
        <td class="chains-cell">${(f.chains || []).join(", ")}</td>
        <td class="oneliner">${esc(f.one_liner)}</td>
      </tr>`
    ).join("");
    return `<div class="lane-block">
      <div class="lane-title">${LANE_LABELS[key] || key} <span class="lane-count">${funds.length} fund${funds.length !== 1 ? "s" : ""}</span></div>
      <table class="lane-tbl"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }).join("");
}

// ─── Footer ────────────────────────────────────────────────────────────────

function renderFooter() {
  const d = state.data;
  const when = new Date(d.generatedAt);
  const ageH = Math.round((Date.now() - when) / 3.6e6);
  const s = d.stats;
  $("#foot").innerHTML = `
    ${s.mainStageCount} main-stage · ${s.secondaryCount} secondary · ${s.unclassifiedCount} unclassified ·
    data ${ageH}h old (${when.toISOString().slice(0, 16).replace("T", " ")} UTC) ·
    source <a href="https://defillama.com">DefiLlama</a> ·
    <a href="./data/latest.json">raw JSON</a> ·
    <a href="methodology.html">methodology</a>
    <div style="margin-top:6px;color:var(--tertiary)">Classification is editorial opinion, not financial advice.</div>`;
}

// ─── Event handlers ───────────────────────────────────────────────────────

document.addEventListener("click", (e) => {
  const th = e.target.closest(".tbl th[data-sort]");
  if (th) {
    const key = th.dataset.sort;
    if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    else { state.sortKey = key; state.sortDir = "asc"; }
    renderTable();
    return;
  }
  const tr = e.target.closest(".tbl tbody tr[data-slug]");
  if (tr) {
    const slug = tr.dataset.slug;
    state.expandedSlug = state.expandedSlug === slug ? null : slug;
    renderTable();
  }
});

// ─── Theme toggle ──────────────────────────────────────────────────────────

$("#theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch {}
  if (state.data) renderScatter();
});

window.addEventListener("resize", () => { if (state.data) renderScatter(); });

load();
