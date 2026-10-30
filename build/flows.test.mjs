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

test("no ledger, a token the ledger does not know, or a day with no price: no numbers rather than wrong ones", () => {
  assert.equal(fundFlows(fundA, null), null);
  assert.equal(fundFlows([{ chain: "ethereum", address: B }], backfilled([])), null);
  assert.equal(fundFlows(fundA, backfilled([ev(T, "in", 1)], { [A]: null })), null);
});

test("withFlows adds a flows object to registry funds with tokens, in the main stage and secondary lanes, and leaves the rest alone", () => {
  const l = backfilled([ev(T, "out", 3, "0xa")]);
  const registry = { tracked: { tokens: fundA }, other: {} };
  const out = withFlows({ mainStage: [{ slug: "tracked" }, { slug: "other" }], secondaryLanes: { equity: [{ slug: "tracked" }] }, stats: {} }, registry, l);
  assert.equal(out.mainStage[0].flows.out30, 3);
  assert.equal("flows" in out.mainStage[1], false);
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
