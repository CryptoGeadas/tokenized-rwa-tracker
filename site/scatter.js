import { esc, fmtPct, fmtTvl, BACKING_COLORS } from "./fmt.js";

export function renderScatter(container, tooltip, funds, isDark) {
  container.innerHTML = "";
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

  const yTicks = d3.range(0, maxYield, maxYield / 4).concat(maxYield);
  svg.selectAll(".grid-line")
    .data(yTicks)
    .join("line")
    .attr("x1", PAD.left).attr("x2", W - PAD.right)
    .attr("y1", (d) => yScale(d)).attr("y2", (d) => yScale(d))
    .attr("stroke", gridColor).attr("stroke-width", 1);

  for (let t = 1; t < 4; t++) {
    svg.append("line")
      .attr("x1", PAD.left + zoneW * t).attr("x2", PAD.left + zoneW * t)
      .attr("y1", PAD.top).attr("y2", PAD.top + plotH)
      .attr("stroke", gridColor).attr("stroke-dasharray", "4,4");
  }

  svg.selectAll(".y-label")
    .data(yTicks)
    .join("text")
    .attr("x", PAD.left - 8).attr("y", (d) => yScale(d) + 4)
    .attr("text-anchor", "end")
    .attr("fill", textColor).attr("font-size", 11).attr("font-family", "Inter, sans-serif")
    .text((d) => d.toFixed(1) + "%");

  svg.append("text")
    .attr("transform", `translate(14, ${PAD.top + plotH / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .attr("fill", axisColor).attr("font-size", 10)
    .attr("font-family", "Sora, sans-serif").attr("font-weight", 600)
    .text("YIELD (apyBase)");

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

  // Knuth multiplicative hash for deterministic jitter
  const jitterSeed = {};
  funds.forEach((f, i) => { jitterSeed[f.slug] = ((i * 2654435761) % 1000) / 1000 - 0.5; });

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

  dots.filter((f) => f.mislabel)
    .append("text")
    .attr("y", (f) => -rScale(f.tvl) - 5)
    .attr("text-anchor", "middle")
    .attr("fill", "#EF4444").attr("font-size", 10)
    .attr("font-family", "Sora, sans-serif").attr("font-weight", 700)
    .text("NOT RWA");

  dots.on("mouseenter", function (event, f) {
    const mislabelLine = f.mislabel ? `<div class="tt-mislabel">⚠ NOT AN RWA</div>` : "";
    tooltip.innerHTML =
      `<div class="tt-name">${esc(f.name)}</div>${mislabelLine}` +
      `<div class="tt-row">${esc(f.issuer)} · Tier ${f.trust_tier}</div>` +
      `<div class="tt-row">${fmtPct(f.apyBase)} · ${fmtTvl(f.tvl)}</div>`;
    tooltip.classList.add("visible");
  })
  .on("mousemove", function (event) {
    const wrap = container.closest(".scatter-wrap").getBoundingClientRect();
    let left = event.clientX - wrap.left + 14;
    let top = event.clientY - wrap.top - 20;
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
