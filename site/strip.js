// "Large money flows" strip (#29), directly above the Trust Filter table, behind the snapshot's
// config.flowsCard switch. It answers "are people leaving any of these funds?" at a glance:
// one line per flagged fund (all its flags, the card's own sentences), largest net outflow
// first; the rule and the counts underneath.
// Every sentence must be true for what was actually checked: only funds whose flags were
// applied (flows.flagsChecked: numbers, a price and a fresh supply) count as checked. "No large
// money flows" shows only when at least one fund was checked; the header date is the OLDEST
// data day among them, so it never claims more than the data shows; each line dims on its own
// staleness (the card's rule, with the viewer's clock). Unreadable data: says so.
import { esc } from "./fmt.js";
import { flagTagsHtml, flagSentence, isStale, fmtDay } from "./flows.js";

const FLAG_KINDS = new Set(["outflow", "big-redemption", "inflow"]);
const pct = (n) => `${Math.round(n * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function stripHtml(data, now = Date.now()) {
  if (data?.config?.flowsCard !== true) return "";
  const funds = [...(data.mainStage ?? []), ...Object.values(data.secondaryLanes ?? {}).flat()].filter((f) => f?.flows);
  const tracked = funds.filter((f) => f.flows.status !== "untracked");
  if (!tracked.length) return "";
  const checked = tracked.filter((f) => f.flows.flagsChecked === true && ["full", "partial"].includes(f.flows.status) && f.flows.asOf);
  const head = (extra = "") => `<div class="fl-strip-head"><h3>Large money flows</h3>${extra}</div>`;
  const quiet = (text, extra = "", cls = "") => `<div class="fl-strip${cls}">${head(extra)}<p class="fl-strip-quiet">${text}</p>${foot}</div>`;

  const r = data.config.flagRules;
  const rule = r ? `A fund is flagged when net redemptions reach ${pct(r.outflow)} of its tokens on Ethereum, one redemption reaches ${pct(r.bigRedemption)}, or net mints reach ${pct(r.inflow)}. ` : "";
  const notChecked = tracked.length - checked.length, notTracked = funds.length - tracked.length;
  const counts = `${plural(checked.length, "fund")} checked${notChecked ? `, ${notChecked} tracked but not checkable yet (collecting, or waiting for a price or supply)` : ""}, ${notTracked} not tracked.`;
  const foot = `<p class="fl-strip-rule">${rule}${counts} <a href="methodology.html#flows">How money flows work</a></p>`;

  if (!checked.length) {
    // the ledger could not be read, or nothing has enough data yet: never "no large money flows"
    if (tracked.every((f) => f.flows.status === "unavailable")) return `<div class="fl-strip">${head()}<p class="fl-strip-quiet">Money flows unavailable right now.</p></div>`;
    return quiet("No fund has enough data to check yet.");
  }

  // the oldest data day among the checked funds: the strip never claims a later day than all of them have
  const oldest = checked.reduce((a, f) => (f.flows.asOf < a ? f.flows.asOf : a), checked[0].flows.asOf);
  const anyStale = checked.some((f) => isStale(f.flows, now));
  const when = `<span class="fl-strip-when">last 30 days to ${esc(fmtDay(oldest))}</span>${anyStale ? ` <span class="fl-asof">As of ${esc(fmtDay(oldest))}</span>` : ""}`;

  const flagged = checked
    .filter((f) => (f.flows.flags ?? []).some((g) => FLAG_KINDS.has(g.kind)))
    .sort((a, b) => (a.flows.net30 ?? 0) - (b.flows.net30 ?? 0)); // most money out first
  if (!flagged.length) {
    // a partial window (under 30 days read) says since when, not "the last 30 days"
    const partial = checked.filter((f) => f.flows.status === "partial");
    const since = partial.length ? partial.reduce((a, f) => (f.flows.since > a ? f.flows.since : a), partial[0].flows.since) : null;
    return quiet(`No large money flows ${since ? `since ${esc(fmtDay(since))}` : "in the last 30 days"}.`, when, anyStale ? " is-stale" : "");
  }
  const lines = flagged.map((f) => {
    const sentences = f.flows.flags.filter((g) => FLAG_KINDS.has(g.kind)).map((g) => flagSentence(g, f.flows)).join(" ");
    return `<li${isStale(f.flows, now) ? ' class="is-stale"' : ""}><b>${esc(f.name)}</b>${flagTagsHtml(f)} <span>${sentences}</span></li>`;
  }).join("");
  return `<div class="fl-strip fl-strip-loud${anyStale ? " is-stale" : ""}">${head(when)}<ul>${lines}</ul>${foot}</div>`;
}

export function renderStrip(el, data, now = Date.now()) {
  if (!el) return;
  el.innerHTML = stripHtml(data, now);
  el.hidden = !el.innerHTML;
}
