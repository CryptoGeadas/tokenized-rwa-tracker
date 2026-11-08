// Tests for the "Large money flows" strip (site/strip.js, #29). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripHtml } from "../site/strip.js";

const NOW = Date.parse("2026-11-05T06:00:00Z");
const rules = { outflow: 0.1, bigRedemption: 0.05, inflow: 0.2 };
const base = { status: "full", flagsChecked: true, since: null, asOf: "2026-11-04", updatedAt: "2026-11-05T04:40:00Z", in30: 0, out30: 0, net7: 0, net30: 0, maxOut30: 0 };
const fund = (slug, name, flows) => ({ slug, name, flows: { ...base, ...flows } });
const buidl = fund("buidl", "BlackRock BUIDL", { net30: -30.8e6, maxOut30: 21.5e6, maxOutDay: "2026-10-21", flags: [{ kind: "outflow", share: 0.18 }, { kind: "big-redemption", share: 0.12 }] });
const usyc = fund("usyc", "Hashnote USYC", { net30: -3e6, maxOut30: 19.4e6, maxOutDay: "2026-10-09", flags: [{ kind: "big-redemption", share: 0.49 }] });
const ondo = fund("ondo", "Ondo", { status: "partial", since: "2026-10-20", net30: 83.9e6, flags: [{ kind: "inflow", share: 0.25 }] });
const quiet = fund("quiet", "Quiet Fund", { net30: 1e6 });
const untracked = { slug: "huma", name: "Huma", flows: { status: "untracked", reason: "chain" } };
const data = (main, lanes = {}, flowsCard = true) => ({ config: { flowsCard, flagRules: rules }, mainStage: main, secondaryLanes: lanes });

test("off while the switch is off", () => {
  assert.equal(stripHtml(data([buidl], {}, false), NOW), "");
});

test("one line per flagged fund with all its flags, largest net outflow first, inflow last", () => {
  const html = stripHtml(data([ondo, usyc, quiet, buidl], { equity: [untracked] }), NOW);
  const order = [...html.matchAll(/<li[^>]*><b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(order, ["BlackRock BUIDL", "Hashnote USYC", "Ondo"]);
  const buidlLine = html.slice(html.indexOf("BlackRock BUIDL"), html.indexOf("Hashnote USYC"));
  assert.match(buidlLine, /fl-flag-outflow">Outflow<.*fl-flag-big-redemption">Big redemption</s);
  assert.ok(buidlLine.includes("$30.8M more redeemed than minted in 30 days, 18% of its tokens on Ethereum."));
  assert.ok(buidlLine.includes("One redemption of $21.5M on 21 Oct, 12% of its tokens on Ethereum."));
  assert.ok(html.includes("$83.9M more minted than redeemed since 20 Oct, 25% of its tokens on Ethereum."));
  assert.equal((html.match(/<b>BlackRock BUIDL<\/b>/g) || []).length, 1, "a fund with two flags appears once");
});

test("the header names the period and end date; the rule text and counts sit under the lines", () => {
  const html = stripHtml(data([buidl, quiet], { equity: [untracked] }), NOW);
  assert.match(html, /<h3>Large money flows<\/h3>/);
  assert.match(html, /last 30 days to 4 Nov/);
  assert.match(html, /net redemptions reach 10% of its tokens on Ethereum, one redemption reaches 5%, or net mints reach 20%/);
  assert.match(html, /2 funds checked, 1 not tracked./);
  assert.match(html, /<a href="methodology\.html#flows">How money flows work<\/a>/);
  assert.doesNotMatch(html, /unusual|exit/i);
});

test("no flags: one quiet line, without the orange border", () => {
  const html = stripHtml(data([quiet]), NOW);
  assert.match(html, /No large money flows in the last 30 days\./);
  assert.doesNotMatch(html, /fl-strip-loud|<li/);
});

test("stale: As of <date> in the header and the lines dimmed (by the build's mark or the viewer's clock)", () => {
  const marked = stripHtml(data([{ ...buidl, flows: { ...buidl.flows, stale: true } }]), NOW);
  assert.match(marked, /class="fl-strip fl-strip-loud is-stale"/);
  assert.match(marked, /<li class="is-stale"><b>BlackRock BUIDL/);
  assert.match(marked, /<span class="fl-asof">As of 4 Nov<\/span>/);
  assert.match(stripHtml(data([buidl]), Date.parse("2026-11-09T06:00:00Z")), /is-stale/);
  assert.doesNotMatch(stripHtml(data([buidl]), NOW), /is-stale|As of/);
});

test("unreadable data: says so and shows no flags", () => {
  const down = { slug: "buidl", name: "BlackRock BUIDL", flows: { status: "unavailable" } };
  const html = stripHtml(data([down, untracked]), NOW);
  assert.match(html, /Money flows unavailable right now\./);
  assert.doesNotMatch(html, /<li|fl-flag/);
});

test("nothing tracked at all: no strip", () => {
  assert.equal(stripHtml(data([untracked]), NOW), "");
});

test("fund names are escaped", () => {
  const evil = fund("x", "<img src=x>", { net30: -5e6, flags: [{ kind: "outflow", share: 0.5 }] });
  assert.doesNotMatch(stripHtml(data([evil]), NOW), /<img src=x>/);
});

// ── only what was checked (#29 review) ──
test("nothing checkable yet (all collecting, no price, or no fresh supply): never 'no large money flows'", () => {
  const collecting = { slug: "a", name: "A", flows: { status: "collecting", since: "2026-11-01", asOf: "2026-11-04" } };
  const noSupply = fund("b", "B", { flagsChecked: undefined });
  const noPrice = fund("c", "C", { noPrice: true, flagsChecked: undefined });
  const html = stripHtml(data([collecting, noSupply, noPrice]), NOW);
  assert.match(html, /No fund has enough data to check yet\./);
  assert.doesNotMatch(html, /No large money flows/);
  assert.match(html, /0 funds checked, 3 tracked but not checkable yet/);
  const unread = { slug: "d", name: "D", flows: { status: "collecting", since: null } };
  assert.doesNotMatch(stripHtml(data([unread]), NOW), /No large money flows|last 30 days to/);
});

test("mixed: one fund unavailable among checked ones is counted, not hidden", () => {
  const down = { slug: "x", name: "X", flows: { status: "unavailable" } };
  const html = stripHtml(data([quiet, down]), NOW);
  assert.match(html, /No large money flows in the last 30 days\./);
  assert.match(html, /1 fund checked, 1 tracked but not checkable yet/);
});

test("the header date is the oldest among checked funds; each line dims on its own date", () => {
  const older = fund("o", "Old Fund", { asOf: "2026-11-01", updatedAt: "2026-11-02T04:40:00Z", net30: -9e6, flags: [{ kind: "outflow", share: 0.2 }] });
  const html = stripHtml(data([buidl, older]), NOW);
  assert.match(html, /last 30 days to 1 Nov/);
  assert.match(html, /<li class="is-stale"><b>Old Fund/);
  assert.match(html, /<li><b>BlackRock BUIDL/);
});

test("a partial window says since when; a stale quiet strip is dimmed", () => {
  const partial = fund("p", "P", { status: "partial", since: "2026-10-28" });
  assert.match(stripHtml(data([partial, quiet]), NOW), /No large money flows since 28 Oct\./);
  assert.match(stripHtml(data([quiet]), Date.parse("2026-11-09T06:00:00Z")), /class="fl-strip is-stale"/);
});
