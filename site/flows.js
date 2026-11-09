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

// a missing number reads unknown, never $NaN (#32)
const fmtUsd = (n) => (!Number.isFinite(n) ? "unknown" : Math.abs(n) < 1e3 ? `$${Math.round(Math.abs(n))}` : fmtTvl(Math.abs(n)));
const sign = (n) => (n > 0 ? "+" : n < 0 ? "−" : "");
const fmtNet = (n) => `${sign(n)}${fmtUsd(n)}`;
const netCls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
export const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
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

// Flags (#28): words with colour, never colour only. The build decides them (build/flag-rules.mjs).
const FLAG_TAGS = { outflow: "Outflow", "big-redemption": "Big redemption", inflow: "Inflow" };
const knownFlags = (s) => (s?.flags ?? []).filter((g) => FLAG_TAGS[g.kind]);
const flagTag = (g) => `<span class="fl-flag fl-flag-${g.kind}">${FLAG_TAGS[g.kind]}</span>`;
export const flagTagsHtml = (f) => {
  const flags = knownFlags(f.flows);
  return flags.length ? `<span class="fl-tags">${flags.map(flagTag).join("")}</span>` : "";
};
// One plain sentence per flag, used by the card and the strip, so both read the same.
export function flagSentence(g, s) {
  const during = s.status === "partial" ? `since ${esc(fmtDay(s.since))}` : "in 30 days";
  // today's supply can be smaller than what left: never "500% of its tokens"
  const share = g.share == null || g.share >= 1 ? "more than its whole supply on Ethereum today." : `${Math.round(g.share * 100)}% of its tokens on Ethereum.`;
  if (g.kind === "outflow") return `${fmtUsd(s.net30)} more redeemed than minted ${during}, ${share}`;
  if (g.kind === "inflow") return `${fmtUsd(s.net30)} more minted than redeemed ${during}, ${share}`;
  // the reader can check it: the transaction on Etherscan (#30); a missing or malformed hash, no link
  const what = `${fmtUsd(s.maxOut30)} on ${esc(fmtDay(s.maxOutDay))}`;
  const linked = TX.test(s.maxOutTx ?? "") ? `<a href="${EXPLORER}/tx/${s.maxOutTx}" target="_blank" rel="noopener">${what} ↗</a>` : what;
  return `One redemption of ${linked}, ${share}`;
}

// Where readers check the numbers (#30): the token contracts and each big redemption on Etherscan,
// the methodology section, and the data credit (SQD's own light logo, unaltered, per its brand page;
// the same file the owner approved for the Scanner).
const EXPLORER = "https://etherscan.io";
const TX = /^0x[0-9a-fA-F]{64}$/, ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const SQD_CREDIT = `<a class="fl-credit" href="https://sqd.dev" target="_blank" rel="noopener">Data from <img src="./assets/logos/sqd-light.svg" alt="SQD" width="38" height="16"></a>`;
export const METHOD_LINK = `<a href="methodology.html#flows">How money flows work</a>`;
function footHtml(s, credit) {
  const contracts = (s.tokenLinks ?? []).filter((t) => ADDRESS.test(t.address ?? ""))
    .map((t) => `<a href="${EXPLORER}/token/${t.address}" target="_blank" rel="noopener">Check the ${esc(t.symbol)} contract ↗</a>`).join("");
  return `<div class="flows-foot"><span class="fl-links">${contracts}${METHOD_LINK}</span>${credit ? SQD_CREDIT : ""}</div>`;
}

const HOUR = 3_600_000;
export function isStale(s, now) {
  if (s.stale === true) return true;
  const at = typeof s.updatedAt === "string" ? Date.parse(s.updatedAt) : NaN;
  const dataEnd = typeof s.asOf === "string" ? Date.parse(`${s.asOf}T00:00:00Z`) + 24 * HOUR : NaN;
  // the build's rule (flows.mjs freshness): a damaged stamp is stale too
  const damaged = s.updatedAt != null && !Number.isFinite(at);
  return damaged || (Number.isFinite(at) && now - at > 36 * HOUR) || (Number.isFinite(dataEnd) && now - dataEnd > 48 * HOUR);
}

export function flowsCardHtml(f, now = Date.now()) {
  const s = f.flows;
  if (!s) return "";
  const stale = !!s.asOf && isStale(s, now);
  const head = `<div class="dk">Money flows${stale ? ` <span class="fl-asof">As of ${esc(fmtDay(s.asOf))}</span>` : ""}</div>`;
  // credit: the card shows SQD data (numbers, units, or collecting since a date); not when it is
  // not tracked, unavailable, or not read yet
  const card = (body, credit = true) => `<div class="detail-item full flows-card${stale ? " is-stale" : ""}">${head}${body}${footHtml(s, credit)}</div>`;
  const line = (text, credit = false) => card(`<div class="flows-line flows-wait">${text}</div>`, credit);

  // not tracked (#27): the plain reason, no numbers, never $0; an unknown code shows nothing
  if (s.status === "untracked") {
    const why = s.reason === "owner" ? (typeof s.note === "string" && s.note.trim() ? s.note.trim().replace(/([^.!?])$/, "$1.") : null) : NOT_TRACKED[s.reason];
    return why ? line(`Not tracked: ${esc(why)}`) : "";
  }
  if (s.status === "unavailable") return line(`Money flows unavailable right now.${ethOnly(s)}`);
  // under 7 full days: no numbers yet
  if (s.status === "collecting")
    return line(`${s.since ? `Collecting since ${esc(fmtDay(s.since))}. Numbers show after 7 days.` : "Collecting from the next daily update."}${ethOnly(s)}`, !!s.since);
  if (!["full", "partial"].includes(s.status)) return "";
  if (s.noPrice && !s.units)
    return line(`No price for ${esc((s.symbols ?? []).join(", "))} on CoinGecko, so no dollar amounts.${ethOnly(s)}`, true);

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
  const flagLines = knownFlags(s).map((g) => `<div class="flows-flag">${flagTag(g)} ${flagSentence(g, s)}</div>`).join("");
  const tokens = s.tokenSymbols?.length ? esc(s.tokenSymbols.join(", ")) : "the fund's tokens";
  const supply = Number.isFinite(s.supplyUsd) ? fmtUsd(s.supplyUsd) : "unknown";
  // the read failed lately: name its day instead of saying "now"
  const supplyWhen = s.supplyDay && s.supplyDay < s.asOf ? `on ${esc(fmtDay(s.supplyDay))}` : "now";
  return card(`${flagLines ? `<div class="flows-flags">${flagLines}</div>` : ""}
    <div class="flows-net">${num("Net, 7 days", net(u.net7), netCls(u.net7))}${num(`Net, ${period}`, net(u.net30), netCls(u.net30))}</div>
    <div class="flows-sub">${num(`Minted, ${period}`, amount(u.in30))}${num(`Redeemed, ${period}`, amount(u.out30))}${num(`Biggest redemption, ${period}`, big)}</div>
    <div class="flows-line">${s.status === "partial" ? `Since ${esc(fmtDay(s.since))}` : "Last 30 days"}, to ${esc(fmtDay(s.asOf))}. Mints and burns of ${tokens} on Ethereum. On Ethereum ${supplyWhen}: ${supply}.${(s.tokensSince ?? []).map((t) => ` ${esc(t.symbol)} counted since ${esc(fmtDay(t.since))}.`).join("")}${note}${ethOnly(s)}</div>`);
}
