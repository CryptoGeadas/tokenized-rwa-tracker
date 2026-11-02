// Money flows card (#21) for a fund's open row, behind the snapshot's config.flowsCard switch.
// Same layout as the DeFi Yield Scanner card: net 7 and 30 days first and large; minted,
// redeemed and the biggest redemption on a quieter line. Every number names its period.
// Honest states, never a $0 that only means "not read":
//   • collecting: under 7 full days, or a token the daily job has not read yet;
//   • unavailable: the ledger could not be read, or a record in it is damaged;
//   • stale (#26): "As of <date>" in the header, numbers dimmed — when the build marked it, or
//     when the viewer's clock says the last update is over 36 h old / the data's last day ended
//     over 48 h ago (the same rule as build/flows.mjs freshness), so numbers never look current
//     just because the snapshot stopped publishing;
//   • no price: one token shows its numbers in token units; several tokens show no numbers.
import { esc, fmtTvl } from "./fmt.js";

const fmtUsd = (n) => (Math.abs(n) < 1e3 ? `$${Math.round(Math.abs(n))}` : fmtTvl(Math.abs(n)));
const sign = (n) => (n > 0 ? "+" : n < 0 ? "−" : "");
const fmtNet = (n) => `${sign(n)}${fmtUsd(n)}`;
const netCls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const compact = (n) => {
  const a = Math.abs(n);
  return a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : `${Math.round(a * 100) / 100}`;
};

// Why a fund has no flows (build/flows.mjs withFlows), in plain words. "owner" uses the
// registry's own one-line reason.
const NOT_TRACKED = {
  chain: "not on Ethereum, the only chain flows are read on for now.",
  "no-token": "no Ethereum token approved for this fund yet.",
  "not-reviewed": "this fund is not reviewed yet.",
};
const CHAIN = (c) => String(c).charAt(0).toUpperCase() + String(c).slice(1);
// a fund also on other chains: the numbers are Ethereum's only, never the whole fund
const ethOnly = (s) => (Array.isArray(s.otherChains) && s.otherChains.length ? ` Ethereum only. This fund is also on ${esc(s.otherChains.map(CHAIN).join(", "))}.` : "");

const HOUR = 3_600_000;
function isStale(s, now) {
  if (s.stale === true) return true;
  const at = typeof s.updatedAt === "string" ? Date.parse(s.updatedAt) : NaN;
  const dataEnd = typeof s.asOf === "string" ? Date.parse(`${s.asOf}T00:00:00Z`) + 24 * HOUR : NaN;
  return (Number.isFinite(at) && now - at > 36 * HOUR) || (Number.isFinite(dataEnd) && now - dataEnd > 48 * HOUR);
}

export function flowsCardHtml(f, now = Date.now()) {
  const s = f.flows;
  if (!s) return "";
  const stale = !!s.asOf && isStale(s, now);
  const head = `<div class="dk">Money flows${stale ? ` <span class="fl-asof">As of ${esc(fmtDay(s.asOf))}</span>` : ""}</div>`;
  const card = (body) => `<div class="detail-item full flows-card${stale ? " is-stale" : ""}">${head}${body}</div>`;
  const line = (text) => card(`<div class="flows-line flows-wait">${text}</div>`);

  // not tracked (#27): the plain reason, no numbers, never $0; an unknown code shows nothing
  if (s.status === "untracked") {
    const why = s.reason === "owner" ? (typeof s.note === "string" && s.note.trim() ? s.note.trim().replace(/([^.!?])$/, "$1.") : null) : NOT_TRACKED[s.reason];
    return why ? line(`Not tracked: ${esc(why)}`) : "";
  }
  if (s.status === "unavailable") return line(`Money flows unavailable right now.${ethOnly(s)}`);
  // under 7 full days: no numbers yet
  if (s.status === "collecting")
    return line(`${s.since ? `Collecting since ${esc(fmtDay(s.since))}. Numbers show after 7 days.` : "Collecting from the next daily update."}${ethOnly(s)}`);
  if (!["full", "partial"].includes(s.status)) return "";
  if (s.noPrice && !s.units)
    return line(`No price for ${esc((s.symbols ?? []).join(", "))} on CoinGecko, so no dollar amounts.${ethOnly(s)}`);

  // dollars, or (no price, one token) the same numbers in token units
  const u = s.noPrice ? s.units : s;
  const sym = s.noPrice ? ` ${esc(s.symbols?.[0] ?? "")}` : "";
  const amount = (n) => (s.noPrice ? `${compact(n)}${sym}` : fmtUsd(n));
  const net = (n) => (s.noPrice ? `${sign(n)}${compact(n)}${sym}` : fmtNet(n));
  const period = s.status === "partial" ? `since ${esc(fmtDay(s.since))}` : "30 days";
  const num = (k, v, cls = "") => `<div><span class="fl-k">${k}</span><b class="${cls}">${v}</b></div>`;
  // a real $0 (days read, no burns), like the Scanner card; the date only when there is one
  const big = u.maxOut30 > 0 && u.maxOutDay ? `${amount(u.maxOut30)} <small>${esc(fmtDay(u.maxOutDay))}</small>` : amount(0);
  const note = s.noPrice ? " No price on CoinGecko, so no dollar amounts." : "";
  return card(`
    <div class="flows-net">${num("Net, 7 days", net(u.net7), netCls(u.net7))}${num(`Net, ${period}`, net(u.net30), netCls(u.net30))}</div>
    <div class="flows-sub">${num(`Minted, ${period}`, amount(u.in30))}${num(`Redeemed, ${period}`, amount(u.out30))}${num(`Biggest redemption, ${period}`, big)}</div>
    <div class="flows-line">${s.status === "partial" ? `Since ${esc(fmtDay(s.since))}` : "Last 30 days"}, to ${esc(fmtDay(s.asOf))}. Mints and burns of the fund's tokens on Ethereum.${(s.tokensSince ?? []).map((t) => ` ${esc(t.symbol)} counted since ${esc(fmtDay(t.since))}.`).join("")}${note}${ethOnly(s)}</div>`);
}
