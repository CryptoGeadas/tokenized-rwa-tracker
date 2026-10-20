import { esc, fmtTvl, tvlCell, backingBadge, BACKING_COLORS } from "./fmt.js";
import { renderScatter } from "./scatter.js";
import { renderTable } from "./table.js";

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
  rerender();
  renderUnclassified();
  renderSecondary();
  renderSmaller();
  renderFooter();
}

function rerender() {
  const isDark = true; // site is dark only
  renderScatter($("#scatter-chart"), $(".scatter-tooltip"), state.data.mainStage.filter((f) => f.apyBase != null), isDark);
  renderTable($("#table-container"), state.data.mainStage, state.sortKey, state.sortDir, state.expandedSlug);
}

// ─── Unclassified section ──────────────────────────────────────────────────

const UNCL_VISIBLE = 15;

const unclRows = (list) => list.map((u) =>
  `<div class="uncl-row"><a class="uncl-name" href="${esc(u.url || `https://defillama.com/protocol/${u.slug}`)}" rel="noopener" target="_blank">${esc(u.name)} ↗</a><span class="uncl-chains">${esc((u.chains || []).join(", "))}</span><span class="uncl-tvl">${fmtTvl(u.tvl)}</span></div>`
).join("");

// In review: unclassified funds over $50M. When there are none, the coverage line shows instead.
function renderUnclassified() {
  // The filter only matters for a snapshot built before the $50M line existed.
  const items = (state.data.unclassified || []).filter((u) => u.tvl >= 50e6);
  const section = $("#unclassified-section");
  renderCoverage();
  if (!items.length) { section.style.display = "none"; return; }
  section.style.display = "block";

  state.unclExpanded = false;


  const listEl = $("#unclassified-list");
  const toggleBtn = $("#uncl-toggle");

  const update = () => {
    const visible = state.unclExpanded ? items : items.slice(0, UNCL_VISIBLE);
    listEl.innerHTML = unclRows(visible);
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

// Shown only when the build's own numbers say every fund over $50M is classified.
function renderCoverage() {
  const el = $("#coverage-line");
  const c = state.data.stats?.coverage;
  const allReviewed = c && Array.isArray(state.data.unclassified) && state.data.unclassified.length === 0 && c.overLine === c.classifiedOverLine;
  if (!allReviewed) { el.style.display = "none"; return; }
  const share = c.classifiedTvlShare == null ? "share of RWA TVL unknown" : `${Math.round(c.classifiedTvlShare * 100)}% of TVL in RWA funds over $5M`;
  const day = new Date(state.data.generatedAt).toISOString().slice(0, 10);
  el.textContent = `All funds over $50M reviewed · ${c.classifiedOverLine} funds, ${share} · checked ${day}`;
  el.style.display = "block";
}

function renderSmaller() {
  const items = state.data.smaller || [];
  const section = $("#smaller-section");
  if (!items.length) { section.style.display = "none"; return; }
  section.style.display = "block";
  $("#smaller-summary").textContent = `Smaller funds, not reviewed (${items.length})`;
  $("#smaller-list").innerHTML = unclRows(items);
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
        <td class="name-cell">${esc(f.name)}${f.holds?.length ? `<span class="wrapper-tag" title="Holds other RWA tokens">wrapper</span>` : ""}</td>
        <td>${esc(f.issuer)}</td>
        <td>${backingBadge(f.backing_type)}</td>
        <td class="num">${tvlCell(f)}</td>
        <td class="chains-cell">${(f.chains || []).join(", ")}</td>
        <td class="oneliner">${esc(f.one_liner)}${f.holds?.length ? `<br>Holds: ${esc(f.holds.map((h) => h.name).join(", "))}` : ""}</td>
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
    ${s.mainStageCount} main-stage · ${s.secondaryCount} secondary · ${s.unclassifiedCount} in review ·${Array.isArray(d.smaller) ? ` ${d.smaller.length} smaller, not reviewed ·` : ""}
    data ${ageH}h old (${when.toISOString().slice(0, 16).replace("T", " ")} UTC) ·
    source <a href="https://defillama.com">DefiLlama</a> ·
    <a href="./data/latest.json">raw JSON</a> ·
    <a href="methodology.html">methodology</a>
    <div style="margin-top:6px">Classification is editorial opinion, not financial advice.</div>`;

  // shared site footer: the tool fills its own data-health line
  const line = $("[data-tool-dataline]");
  if (line) line.textContent = `Data as of ${when.toISOString().slice(11, 16)} UTC, ${when.toISOString().slice(0, 10)} · Source: DefiLlama · Funds tracked: ${s.mainStageCount + s.secondaryCount + s.unclassifiedCount + (Array.isArray(d.smaller) ? d.smaller.length : 0)} · Not financial advice`;
  $("[data-tool-dot]")?.classList.toggle("stale", ageH > 36);
}

// ─── Event handlers ───────────────────────────────────────────────────────

document.addEventListener("click", (e) => {
  const th = e.target.closest(".tbl th[data-sort]");
  if (th) {
    const key = th.dataset.sort;
    if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    else { state.sortKey = key; state.sortDir = "asc"; }
    renderTable($("#table-container"), state.data.mainStage, state.sortKey, state.sortDir, state.expandedSlug);
    return;
  }
  const tr = e.target.closest(".tbl tbody tr[data-slug]");
  if (tr) {
    const slug = tr.dataset.slug;
    state.expandedSlug = state.expandedSlug === slug ? null : slug;
    renderTable($("#table-container"), state.data.mainStage, state.sortKey, state.sortDir, state.expandedSlug);
  }
});

window.addEventListener("resize", () => {
  if (state.data) {
    const isDark = true; // site is dark only
    renderScatter($("#scatter-chart"), $(".scatter-tooltip"), state.data.mainStage.filter((f) => f.apyBase != null), isDark);
  }
});

load();
