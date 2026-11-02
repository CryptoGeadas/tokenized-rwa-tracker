// Tests for the fund flows ledger (flows.mjs). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLedger, addFlows, fundFlows, withFlows, shiftDay } from "./flows.mjs";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const tokA = { address: A, decimals: 6, symbol: "AAA" };
const ev = (day, kind, units, tx = null, token = A) => ({ token, day, kind, units, tx });
const T = "2026-10-29";
// a backfill run: 30 days read, last complete day T
const backfilled = (events, price = { [A]: 1 }, over = {}) =>
  addFlows(emptyLedger(), { chain: "ethereum", events, lastBlock: 500, today: T, tracked: [tokA], prices: price, backfill: true, updatedAt: "2026-10-30T04:00:00Z", ...over });
const fundA = [{ chain: "ethereum", address: A, decimals: 6, symbol: "AAA" }];

test("a backfill stores each token's days in units with that day's price, and the chain's last block and day", () => {
  const l = backfilled([ev(T, "in", 5), ev(T, "out", 2, "0xb")], { [A]: 1.05 });
  const t = l.tokens[`ethereum:${A}`];
  assert.equal(t.firstDay, shiftDay(T, -29), "a backfill covers the full 30 days");
  assert.deepEqual(t.days[T], { in: 5, out: 2, maxOut: 2, maxOutTx: "0xb", price: 1.05 });
  assert.deepEqual(l.chains.ethereum, { lastBlock: 500, asOf: T, updatedAt: "2026-10-30T04:00:00Z" });
});

test("the biggest burn of a day keeps its transaction hash", () => {
  const l = backfilled([ev(T, "out", 3, "0x1"), ev(T, "out", 9, "0x2"), ev(T, "out", 4, "0x3")]);
  const d = l.tokens[`ethereum:${A}`].days[T];
  assert.equal(d.maxOut, 9);
  assert.equal(d.maxOutTx, "0x2");
  assert.equal(d.out, 16);
});

test("a day's dollars are fixed at the price it was stored with; a later run at a new price adds at the old price", () => {
  let l = backfilled([ev(T, "in", 10)], { [A]: 1 });
  // the next run finishes the same day (late events) at a different price
  l = addFlows(l, { chain: "ethereum", events: [ev(T, "in", 10)], lastBlock: 600, today: T, tracked: [tokA], prices: { [A]: 2 } });
  assert.equal(l.tokens[`ethereum:${A}`].days[T].price, 1);
  assert.equal(fundFlows(fundA, l).in30, 20);
});

test("days older than 30 are dropped as the window moves on", () => {
  let l = backfilled([ev(shiftDay(T, -29), "in", 1), ev(T, "in", 1)]);
  const next = shiftDay(T, 1);
  l = addFlows(l, { chain: "ethereum", events: [], lastBlock: 700, today: next, tracked: [tokA], prices: { [A]: 1 } });
  assert.deepEqual(Object.keys(l.tokens[`ethereum:${A}`].days), [T]);
  assert.equal(l.chains.ethereum.asOf, next);
});

test("the summary: net over 7 and 30 days, minted, redeemed and the biggest redemption with its day and transaction, in dollars", () => {
  const l = backfilled([
    ev(shiftDay(T, -20), "in", 100), ev(shiftDay(T, -20), "out", 30, "0xold"),
    ev(shiftDay(T, -3), "in", 10), ev(shiftDay(T, -3), "out", 50, "0xbig"), ev(T, "out", 5, "0xsmall"),
  ], { [A]: 2 });
  assert.deepEqual(fundFlows(fundA, l), {
    status: "full", since: null, asOf: T,
    in30: 220, out30: 170, net7: -90, net30: 50,
    maxOut30: 100, maxOutDay: shiftDay(T, -3), maxOutTx: "0xbig",
  });
});

test("days after the last complete day are kept but not counted", () => {
  const l = backfilled([ev(T, "in", 1), ev(shiftDay(T, 1), "in", 99)]);
  assert.equal(fundFlows(fundA, l).in30, 1);
  assert.ok(l.tokens[`ethereum:${A}`].days[shiftDay(T, 1)], "kept for the next run");
});

test("missing days are never zero: a fund read for under 30 days says since when", () => {
  const since = shiftDay(T, -9);
  const l = backfilled([ev(T, "in", 4)], { [A]: 1 }, { backfill: since });
  const s = fundFlows(fundA, l);
  assert.equal(s.status, "partial");
  assert.equal(s.since, since);
  assert.equal(s.in30, 4);
});

test("no ledger is unavailable; a token the job has not read yet is collecting from the next update (#26)", () => {
  assert.deepEqual(fundFlows(fundA, null), { status: "unavailable" });
  assert.deepEqual(fundFlows([{ chain: "ethereum", address: B, symbol: "BBB" }], backfilled([])), { status: "collecting", since: null, asOf: T });
  // the job keeps failing: "collecting from the next update" turns stale with the chain's date
  const late = fundFlows([{ chain: "ethereum", address: B, symbol: "BBB" }], backfilled([]), Date.parse("2026-11-05T00:00:00Z"));
  assert.equal(late.stale, true);
  assert.equal(late.asOf, T);
  assert.deepEqual(fundFlows(fundA, emptyLedger()), { status: "collecting", since: null }, "the chain was never read");
  assert.equal(fundFlows([], backfilled([])), null, "no tokens: no flows object");
});

test("a damaged day or date in the ledger is unavailable, never a $0 or a guessed state (#26)", () => {
  const bad = backfilled([ev(T, "in", 1)]);
  bad.tokens[`ethereum:${A}`].days[T].in = "1";
  assert.deepEqual(fundFlows(fundA, bad), { status: "unavailable" });
  const badDay = backfilled([ev(T, "in", 1)]);
  badDay.chains.ethereum.asOf = "yesterday";
  assert.deepEqual(fundFlows(fundA, badDay), { status: "unavailable" });
});

// ── no price, stale (#26) ──
test("a day without a price: a single-token fund gives its numbers in token units, never dollars", () => {
  const l = backfilled([ev(shiftDay(T, -2), "in", 10), ev(T, "out", 4, "0xa")], { [A]: null });
  const s = fundFlows(fundA, l);
  assert.equal(s.status, "full");
  assert.equal(s.noPrice, true);
  assert.deepEqual(s.symbols, ["AAA"]);
  assert.deepEqual(s.units, { in30: 10, out30: 4, net7: 6, net30: 6, maxOut30: 4, maxOutDay: T, maxOutTx: "0xa" });
  for (const k of ["in30", "out30", "net7", "net30", "maxOut30"]) assert.equal(s[k], undefined, `no dollar ${k}`);
});

test("if any token of a fund has a day without a price in the window, the fund's summary is no price (no numbers for several tokens)", () => {
  const tokB2 = { address: B, decimals: 18, symbol: "BBB" };
  const l = addFlows(emptyLedger(), { chain: "ethereum", events: [ev(T, "in", 10), ev(T, "in", 3, null, B)], lastBlock: 500, today: T,
    tracked: [tokA, tokB2], prices: { [A]: 1, [B]: null }, backfill: true });
  const s = fundFlows([...fundA, { chain: "ethereum", address: B, symbol: "BBB" }], l);
  assert.equal(s.noPrice, true);
  assert.deepEqual(s.symbols, ["BBB"], "only the token without a price is named");
  assert.equal(s.units, undefined);
  assert.equal(s.in30, undefined);
  // a priced day outside the window, or a no-price day before the token's first day, doesn't count
  const ok = backfilled([ev(T, "in", 1)], { [A]: 1 });
  ok.tokens[`ethereum:${A}`].days[shiftDay(T, -40)] = { in: 1, out: 0, maxOut: 0, maxOutTx: null, price: null };
  assert.equal(fundFlows(fundA, ok).noPrice, undefined);
});

test("stale: the last update over 36 h ago, or the data's last day ended over 48 h ago, is marked with its date", () => {
  const l = backfilled([ev(T, "in", 1)]); // updatedAt 2026-10-30T04:00Z, data to 29 Oct
  const at = (iso) => fundFlows(fundA, l, Date.parse(iso));
  assert.equal(at("2026-10-31T15:00:00Z").stale, undefined, "35 h after the update, 39 h after the data day ended");
  assert.equal(at("2026-10-31T17:00:00Z").stale, true, "37 h after the update");
  assert.equal(at("2026-10-31T17:00:00Z").updatedAt, "2026-10-30T04:00:00Z");
  const noStamp = backfilled([ev(T, "in", 1)], { [A]: 1 }, { updatedAt: null });
  assert.equal(fundFlows(fundA, noStamp, Date.parse("2026-10-31T23:00:00Z")).stale, undefined, "47 h after the data day ended");
  assert.equal(fundFlows(fundA, noStamp, Date.parse("2026-11-01T01:00:00Z")).stale, true, "49 h after the data day ended");
  const damaged = backfilled([ev(T, "in", 1)], { [A]: 1 }, { updatedAt: "not a date" });
  assert.equal(fundFlows(fundA, damaged, Date.parse("2026-10-30T05:00:00Z")).stale, true, "a damaged stamp can't prove the numbers are current");
  assert.equal(fundFlows([{ chain: "ethereum", address: A }], backfilled([], { [A]: 1 }, { backfill: shiftDay(T, -2) }), Date.parse("2026-11-05T00:00:00Z")).stale, true, "collecting is marked too");
});

test("withFlows: an unreadable ledger gives every tracked fund unavailable, not an error", () => {
  const out = withFlows({ mainStage: [{ slug: "tracked" }, { slug: "other" }], secondaryLanes: {} }, { tracked: { tokens: fundA }, other: {} }, null, Date.now());
  assert.deepEqual(out.mainStage[0].flows, { status: "unavailable" });
  assert.equal(out.mainStage[1].flows.status, "untracked", "a fund without tokens is not tracked, ledger or not");
});

test("withFlows adds a flows object to registry funds with tokens, in the main stage and secondary lanes", () => {
  const l = backfilled([ev(T, "out", 3, "0xa")]);
  const registry = { tracked: { tokens: fundA }, other: {} };
  const out = withFlows({ mainStage: [{ slug: "tracked" }, { slug: "other" }], secondaryLanes: { equity: [{ slug: "tracked" }] }, stats: {} }, registry, l);
  assert.equal(out.mainStage[0].flows.out30, 3);
  assert.equal(out.secondaryLanes.equity[0].flows.maxOutTx, "0xa");
  assert.deepEqual(out.stats, {});
});

test("each day keeps its own price; the biggest redemption is picked in dollars, not units", () => {
  const Y = shiftDay(T, -1);
  let l = addFlows(emptyLedger(), { chain: "ethereum", events: [ev(Y, "in", 10), ev(Y, "out", 6, "0xunits")], lastBlock: 500, today: Y, tracked: [tokA], prices: { [A]: 1 }, backfill: true });
  l = addFlows(l, { chain: "ethereum", events: [ev(T, "in", 10), ev(T, "out", 4, "0xdollars")], lastBlock: 600, today: T, tracked: [tokA], prices: { [A]: 2 } });
  assert.equal(l.tokens[`ethereum:${A}`].days[Y].price, 1);
  const s = fundFlows(fundA, l);
  assert.equal(s.in30, 30);
  assert.equal(s.maxOut30, 8);
  assert.equal(s.maxOutDay, T);
  assert.equal(s.maxOutTx, "0xdollars");
});

test("the 30-day edge: day T−29 is kept and counted, then dropped when the window moves", () => {
  const edge = shiftDay(T, -29);
  let l = backfilled([ev(edge, "in", 1), ev(shiftDay(T, -28), "in", 2)]);
  assert.ok(l.tokens[`ethereum:${A}`].days[edge]);
  assert.equal(fundFlows(fundA, l).in30, 3);
  l = addFlows(l, { chain: "ethereum", events: [], lastBlock: 700, today: shiftDay(T, 1), tracked: [tokA], prices: { [A]: 1 } });
  assert.deepEqual(Object.keys(l.tokens[`ethereum:${A}`].days), [shiftDay(T, -28)]);
});

test("days before a token's first day are never counted", () => {
  const l = backfilled([ev(shiftDay(T, -15), "in", 50), ev(T, "in", 4)], { [A]: 1 }, { backfill: shiftDay(T, -9) });
  assert.equal(fundFlows(fundA, l).in30, 4);
});

// ── coverage and funds with several tokens (#25) ──
const tokB = { address: B, decimals: 18, symbol: "BBB" };
const fundAB = [...fundA, { chain: "ethereum", address: B, decimals: 18, symbol: "BBB" }];

test("coverage: under 7 days is collecting (no numbers); 7–29 is partial since the first day; 30 is full", () => {
  const at = (days) => fundFlows(fundA, backfilled([ev(T, "in", 1)], { [A]: 1 }, { backfill: shiftDay(T, -(days - 1)) }));
  assert.deepEqual(at(6), { status: "collecting", since: shiftDay(T, -5), asOf: T });
  assert.equal(at(7).status, "partial");
  assert.equal(at(7).since, shiftDay(T, -6));
  assert.equal(at(7).in30, 1);
  assert.equal(at(29).status, "partial");
  assert.equal(at(29).since, shiftDay(T, -28));
  assert.equal(at(30).status, "full");
  assert.equal(at(30).since, null);
});

test("two tokens of one fund are summed into one set of numbers, each at its own price", () => {
  const l = addFlows(emptyLedger(), { chain: "ethereum", events: [ev(T, "in", 10), ev(T, "out", 4, "0xa"), ev(T, "out", 3, "0xb", B)], lastBlock: 500, today: T,
    tracked: [tokA, tokB], prices: { [A]: 1, [B]: 2 }, backfill: true });
  const s = fundFlows(fundAB, l);
  assert.equal(s.in30, 10);
  assert.equal(s.out30, 10);
  assert.equal(s.net30, 0);
  assert.equal(s.maxOut30, 6, "B's 3 units at $2 is the biggest redemption in dollars");
  assert.equal(s.maxOutTx, "0xb");
});

test("a token added later starts from its own first day; its part-day before that is never counted, and the fund's coverage starts at the earliest token", () => {
  let l = backfilled([ev(T, "in", 1)]); // A: 30 days, as of T
  const next = shiftDay(T, 1);
  // B joins on the next run: it was read from part-way through `next`, so its first full day is the day after
  l = addFlows(l, { chain: "ethereum", events: [ev(next, "in", 100, null, B), ev(next, "in", 5)], lastBlock: 600, today: next, tracked: [tokA, tokB], prices: { [A]: 1, [B]: 1 } });
  assert.equal(l.tokens[`ethereum:${B}`].firstDay, shiftDay(next, 1));
  assert.equal(l.tokens[`ethereum:${A}`].firstDay, shiftDay(T, -29), "an existing token keeps its first day");
  const s = fundFlows(fundAB, l);
  assert.equal(s.status, "full", "the earliest token decides the coverage");
  assert.equal(s.in30, 6, "B's part-day before its first full day is not counted");
});

test("a fund whose only token is new reads collecting since the day it was added, never zero", () => {
  let l = backfilled([ev(T, "in", 1)]);
  l = addFlows(l, { chain: "ethereum", events: [], lastBlock: 600, today: shiftDay(T, 1), tracked: [tokA, tokB], prices: {} });
  assert.deepEqual(fundFlows([fundAB[1]], l), { status: "collecting", since: shiftDay(T, 2), asOf: shiftDay(T, 1) });
});

test("a new token never starts before tomorrow, even when newFrom is earlier", () => {
  const l = addFlows(backfilled([]), { chain: "ethereum", events: [], lastBlock: 600, today: shiftDay(T, 3), tracked: [tokA, tokB], prices: {}, newFrom: shiftDay(T, 2) });
  assert.equal(l.tokens[`ethereum:${B}`].firstDay, shiftDay(T, 4));
});

test("a token's own first full day is counted", () => {
  let l = backfilled([ev(T, "in", 1)]);
  const next = shiftDay(T, 1), day2 = shiftDay(T, 2);
  l = addFlows(l, { chain: "ethereum", events: [ev(next, "in", 100, null, B), ev(next, "in", 5)], lastBlock: 600, today: next, tracked: [tokA, tokB], prices: { [A]: 1, [B]: 1 } });
  l = addFlows(l, { chain: "ethereum", events: [ev(day2, "in", 7, null, B)], lastBlock: 700, today: day2, tracked: [tokA, tokB], prices: { [A]: 1, [B]: 1 } });
  assert.equal(fundFlows(fundAB, l).in30, 13, "A's 1 + 5, and B's 7 on its first full day; never B's part-day 100");
});

test("a fund total names a token added later and the day it is counted from", () => {
  let l = backfilled([ev(T, "in", 1)]);
  l = addFlows(l, { chain: "ethereum", events: [], lastBlock: 600, today: shiftDay(T, 1), tracked: [tokA, tokB], prices: {} });
  const s = fundFlows(fundAB, l);
  assert.equal(s.status, "full");
  assert.deepEqual(s.tokensSince, [{ symbol: "BBB", since: shiftDay(T, 2) }]);
  assert.equal(fundFlows(fundA, l).tokensSince, undefined, "a fund whose tokens all cover the window names none");
});

test("a token taken out of tracking is dropped, so it starts fresh if it comes back", () => {
  let l = backfilled([ev(T, "in", 1)]);
  l = addFlows(l, { chain: "ethereum", events: [], lastBlock: 600, today: shiftDay(T, 1), tracked: [tokB], prices: {} });
  assert.equal(l.tokens[`ethereum:${A}`], undefined);
  l = addFlows(l, { chain: "ethereum", events: [], lastBlock: 700, today: shiftDay(T, 2), tracked: [tokA, tokB], prices: {} });
  assert.equal(l.tokens[`ethereum:${A}`].firstDay, shiftDay(T, 3));
  assert.equal(fundFlows(fundA, l).status, "collecting");
});

test("a ledger token without a well-formed first day gives no numbers, never a full $0 window", () => {
  const l = backfilled([ev(T, "in", 1)]);
  delete l.tokens[`ethereum:${A}`].firstDay;
  assert.deepEqual(fundFlows(fundA, l), { status: "unavailable" });
});

test("one unpriced day among priced days makes the fund no price; its units still count every day", () => {
  const l = backfilled([ev(shiftDay(T, -10), "in", 5), ev(T, "in", 3)], { [A]: 1 });
  l.tokens[`ethereum:${A}`].days[shiftDay(T, -10)].price = null;
  const s = fundFlows(fundA, l);
  assert.equal(s.noPrice, true);
  assert.equal(s.units.in30, 8);
  assert.equal(s.in30, undefined);
});

test("an unpriced part-day before a later token's own first day does not make the fund no price", () => {
  const tokB2 = { address: B, decimals: 18, symbol: "BBB" };
  let l = backfilled([ev(T, "in", 1)], { [A]: 1 }, { backfill: shiftDay(T, -9), tracked: [tokA] });
  const next = shiftDay(T, 1);
  l = addFlows(l, { chain: "ethereum", events: [ev(next, "in", 9, null, B)], lastBlock: 600, today: next, tracked: [tokA, tokB2], prices: { [A]: 1, [B]: null } });
  const s = fundFlows([...fundA, { chain: "ethereum", address: B, symbol: "BBB" }], l);
  assert.equal(s.status, "partial");
  assert.equal(s.noPrice, undefined);
  assert.equal(s.in30, 1);
});

test("a null day record is unavailable", () => {
  const l = backfilled([ev(T, "in", 1)]);
  l.tokens[`ethereum:${A}`].days[T] = null;
  assert.deepEqual(fundFlows(fundA, l), { status: "unavailable" });
});

// ── not tracked, Ethereum only (#27) ──
test("not tracked, with a plain reason: owner's marker, no Ethereum chain, no approved token, not in the registry", () => {
  const l = backfilled([ev(T, "in", 1)]);
  const registry = {
    marked: { chains: ["ethereum"], flows_not_tracked: "Many property tokens, no single main token." },
    solana: { chains: ["solana"] },
    pending: { chains: ["ethereum", "base"] },
  };
  const out = withFlows({ mainStage: [{ slug: "marked" }, { slug: "solana" }, { slug: "pending" }], secondaryLanes: {},
    unclassified: [{ slug: "new-fund" }], smaller: [{ slug: "small" }] }, registry, l, Date.now());
  assert.deepEqual(out.mainStage.map((f) => f.flows), [
    { status: "untracked", reason: "owner", note: "Many property tokens, no single main token." },
    { status: "untracked", reason: "chain" },
    { status: "untracked", reason: "no-token" },
  ]);
  assert.deepEqual(out.unclassified[0].flows, { status: "untracked", reason: "not-reviewed" });
  assert.deepEqual(out.smaller[0].flows, { status: "untracked", reason: "not-reviewed" });
  for (const f of out.mainStage) for (const k of ["in30", "net30", "units"]) assert.equal(f.flows[k], undefined, "never a number");
});

test("a tracked fund on other chains too carries those chains, so the page says Ethereum only", () => {
  const l = backfilled([ev(T, "in", 1)]);
  const out = withFlows({ mainStage: [{ slug: "multi" }, { slug: "eth" }], secondaryLanes: {} },
    { multi: { tokens: fundA, chains: ["ethereum", "avalanche", "polygon"] }, eth: { tokens: fundA, chains: ["ethereum"] } }, l, Date.now());
  assert.deepEqual(out.mainStage[0].flows.otherChains, ["avalanche", "polygon"]);
  assert.equal(out.mainStage[1].flows.otherChains, undefined);
  const gone = withFlows({ mainStage: [{ slug: "multi" }], secondaryLanes: {} }, { multi: { tokens: fundA, chains: ["ethereum", "base"] } }, null, Date.now());
  assert.deepEqual(gone.mainStage[0].flows, { status: "unavailable", otherChains: ["base"] });
});

test("the owner's reason wins over the chain rule; lanes get the same flows objects", () => {
  const out = withFlows({ mainStage: [], secondaryLanes: { "real-estate": [{ slug: "realt" }, { slug: "multi" }] } },
    { realt: { chains: ["gnosis"], flows_not_tracked: "Many property tokens." }, multi: { tokens: fundA, chains: ["ethereum", "base"] } }, backfilled([ev(T, "in", 1)]), Date.now());
  assert.deepEqual(out.secondaryLanes["real-estate"][0].flows, { status: "untracked", reason: "owner", note: "Many property tokens." });
  assert.deepEqual(out.secondaryLanes["real-estate"][1].flows.otherChains, ["base"]);
});
