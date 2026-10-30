// Money flows card (#21) for a fund's open row, behind the snapshot's config.flowsCard switch.
// Same layout as the DeFi Yield Scanner card: net 7 and 30 days first and large; minted,
// redeemed and the biggest redemption on a quieter line. Every number names its period.
// "collecting" (under 7 full days) shows when it started instead of numbers. A fund without
// honest numbers (flows null) shows no card yet; those states come in #26–#27.
import { esc, fmtTvl } from "./fmt.js";

const fmtUsd = (n) => (Math.abs(n) < 1e3 ? `$${Math.round(Math.abs(n))}` : fmtTvl(Math.abs(n)));
const fmtNet = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtUsd(n)}`;
const netCls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function flowsCardHtml(f) {
  const s = f.flows;
  // under 7 full days: no numbers yet, and never a $0 that only means "not read"
  if (s?.status === "collecting" && s.since)
    return `<div class="detail-item full flows-card"><div class="dk">Money flows</div><div class="flows-line flows-wait">Collecting since ${esc(fmtDay(s.since))}. Numbers show after 7 days.</div></div>`;
  if (!s || !["full", "partial"].includes(s.status)) return "";
  const period = s.status === "partial" ? `since ${esc(fmtDay(s.since))}` : "30 days";
  const num = (k, v, cls = "") => `<div><span class="fl-k">${k}</span><b class="${cls}">${v}</b></div>`;
  // a real $0 (days read, no burns), like the Scanner card; the date only when there is one
  const big = s.maxOut30 > 0 && s.maxOutDay ? `${fmtUsd(s.maxOut30)} <small>${esc(fmtDay(s.maxOutDay))}</small>` : fmtUsd(0);
  return `<div class="detail-item full flows-card">
    <div class="dk">Money flows</div>
    <div class="flows-net">${num("Net, 7 days", fmtNet(s.net7), netCls(s.net7))}${num(`Net, ${period}`, fmtNet(s.net30), netCls(s.net30))}</div>
    <div class="flows-sub">${num(`Minted, ${period}`, fmtUsd(s.in30))}${num(`Redeemed, ${period}`, fmtUsd(s.out30))}${num(`Biggest redemption, ${period}`, big)}</div>
    <div class="flows-line">${s.status === "partial" ? `Since ${esc(fmtDay(s.since))}` : "Last 30 days"}, to ${esc(fmtDay(s.asOf))}. Mints and burns of the fund's tokens on Ethereum.${(s.tokensSince ?? []).map((t) => ` ${esc(t.symbol)} counted since ${esc(fmtDay(t.since))}.`).join("")}</div>
  </div>`;
}
