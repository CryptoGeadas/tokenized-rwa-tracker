// Tests added by the pre-go-live review of money flows (#32). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyLedger, addFlows, fundFlows, shiftDay } from "./flows.mjs";
import { fetchPrices } from "./flows-job.mjs";
import { runFlowsFile } from "./flows-run.mjs";
import { isStale, flowsCardHtml } from "../site/flows.js";
import { renderTable } from "../site/table.js";
import { tokenSheet } from "./draft.mjs";

const A = "0x00000000000000000000000000000000000000aa";
const tokA = { address: A, decimals: 6, symbol: "AAA" };
const fundA = [{ chain: "ethereum", ...tokA }];
const T = "2026-10-29";
const HOUR = 3_600_000;
const quiet = { log() {}, warn() {}, error() {} };

// ── the ledger ──────────────────────────────────────────────────────────────
test("a day stored without a price (a failed price call) takes the next good price, so one outage doesn't hide a fund's dollars for 30 days", () => {
  let l = addFlows(emptyLedger(), { chain: "ethereum", events: [{ token: A, day: shiftDay(T, -3), kind: "in", units: 10 }, { token: A, day: T, kind: "out", units: 4 }],
    lastBlock: 500, today: T, tracked: [tokA], prices: {}, backfill: true, updatedAt: "2026-10-30T04:00:00Z" });
  assert.equal(l.tokens[`ethereum:${A}`].days[T].price, null);
  assert.equal(fundFlows(fundA, l).noPrice, true);
  l = addFlows(l, { chain: "ethereum", events: [], lastBlock: 600, today: shiftDay(T, 1), tracked: [tokA], prices: { [A]: 1.1 } });
  const days = l.tokens[`ethereum:${A}`].days;
  assert.equal(days[T].price, 1.1);
  assert.equal(days[shiftDay(T, -3)].price, 1.1);
  const s = fundFlows(fundA, l);
  assert.notEqual(s.noPrice, true);
  assert.equal(s.in30, 11);
});

test("a day that has a price keeps it: a later price only fills days without one", () => {
  let l = addFlows(emptyLedger(), { chain: "ethereum", events: [{ token: A, day: T, kind: "in", units: 10 }], lastBlock: 500, today: T, tracked: [tokA], prices: { [A]: 1 }, backfill: true });
  l = addFlows(l, { chain: "ethereum", events: [], lastBlock: 600, today: shiftDay(T, 1), tracked: [tokA], prices: { [A]: 2 } });
  assert.equal(l.tokens[`ethereum:${A}`].days[T].price, 1);
});

// ── the daily job's warnings reach the run page ─────────────────────────────
test("prices: a failed or missing price is a ::warning:: on the run page, and says which of the two it was", async () => {
  const B = "0x00000000000000000000000000000000000000bb";
  const lines = [];
  const fetchImpl = async (url) => { if (url.includes(B)) throw new Error("boom"); return new Response("{}", { status: 200 }); };
  await fetchPrices([A, B], { fetchImpl, sleep: async () => {}, log: { ...quiet, log: (l) => lines.push(l) } });
  assert.ok(lines.some((l) => /^::warning::.*no USD price.*0x0+aa/.test(l)), lines.join("\n"));
  assert.ok(lines.some((l) => /^::warning::.*price for 0x0+bb failed/.test(l)), lines.join("\n"));
});

const registry = { f: { name: "F", issuer: "I", backing_type: "government-debt", trust_tier: 1, lane: "main", one_liner: "x", chains: ["ethereum"],
  mislabel: false, wrapper: "regulated-fund", tokens: [{ chain: "ethereum", address: A, decimals: 6, symbol: "AAA" }] } };
// updated 2026-10-30T04:40Z, read to block 1000
const ledger = addFlows(emptyLedger(), { chain: "ethereum", events: [], lastBlock: 1000, today: T, tracked: [tokA], prices: {}, backfill: true, updatedAt: "2026-10-30T04:40:00Z" });
async function files() {
  const dir = await mkdtemp(join(tmpdir(), "rwa-golive-"));
  const registryPath = join(dir, "rwa-registry.json"), ledgerPath = join(dir, "flows-ledger.json");
  await writeFile(registryPath, JSON.stringify(registry));
  await writeFile(ledgerPath, JSON.stringify(ledger));
  return { dir, registryPath, ledgerPath };
}
// the read stops before the head every time (the read limit)
const slowPortal = { finalizedHead: async () => 2000, blockAt: async () => 100,
  fetchMintsBurns: async (q) => ({ events: [], lastBlock: q.fromBlock + 10, lastTimestamp: Date.parse("2026-10-31T00:00:00Z") / 1000, bytes: 0 }) };
// the Portal's finalized head never moves past what was read
const stuckPortal = { finalizedHead: async () => 1000, blockAt: async () => 100, fetchMintsBurns: async () => { throw new Error("not called"); } };

test("a read that never reaches the head: a warning on the run page, and after 72 h without a full update a red run (what was read is still saved)", async () => {
  const f = await files();
  const lines = [];
  assert.equal(await runFlowsFile({ ...f, portal: slowPortal, prices: async () => ({}), now: Date.parse("2026-11-01T04:00:00Z"), log: { ...quiet, log: (l) => lines.push(l) } }), 0);
  assert.ok(lines.some((l) => /^::warning::.*stopped at block 1011/.test(l)), lines.join("\n"));
  await assert.rejects(runFlowsFile({ ...f, portal: slowPortal, prices: async () => ({}), now: Date.parse("2026-11-02T05:00:00Z"), log: quiet }), /over 72 h/);
  assert.equal(JSON.parse(await readFile(f.ledgerPath, "utf8")).chains.ethereum.lastBlock, 1022, "the progress is kept");
  await rm(f.dir, { recursive: true });
});

test("a finalized head that stops moving: a warning, and a red run after 72 h without an update", async () => {
  const f = await files();
  const lines = [];
  assert.equal(await runFlowsFile({ ...f, portal: stuckPortal, prices: async () => ({}), now: Date.parse("2026-11-01T04:00:00Z"), log: { ...quiet, log: (l) => lines.push(l) } }), 0);
  assert.ok(lines.some((l) => /^::warning::.*no new finalized blocks/.test(l)), lines.join("\n"));
  await assert.rejects(runFlowsFile({ ...f, portal: stuckPortal, prices: async () => ({}), now: Date.parse("2026-11-02T05:00:00Z"), log: quiet }), /over 72 h/);
  await rm(f.dir, { recursive: true });
});

// ── the page ────────────────────────────────────────────────────────────────
test("the page's stale rule matches the build's: over 36 h since the update, over 48 h since the data day ended, or a damaged stamp", () => {
  const at = Date.parse("2026-10-30T04:40:00Z");
  const s = { asOf: "2026-10-29", updatedAt: "2026-10-30T04:40:00Z" };
  assert.equal(isStale(s, at + 35 * HOUR), false);
  assert.equal(isStale(s, at + 37 * HOUR), true);
  const dataEnd = Date.parse("2026-10-30T00:00:00Z");
  assert.equal(isStale({ asOf: "2026-10-29" }, dataEnd + 47 * HOUR), false);
  assert.equal(isStale({ asOf: "2026-10-29" }, dataEnd + 49 * HOUR), true);
  assert.equal(isStale({ asOf: "2026-10-29", updatedAt: "not a date" }, dataEnd + HOUR), true);
});

test("a card with a missing number says unknown, never $NaN or a made-up figure", () => {
  const f = { slug: "f", name: "F", flows: { status: "full", asOf: "2026-10-29", updatedAt: "2026-10-30T04:40:00Z", tokenSymbols: ["AAA"], net30: -5e6, in30: 1e6 } };
  const html = flowsCardHtml(f, Date.parse("2026-10-30T05:00:00Z"));
  assert.doesNotMatch(html, /NaN|Invalid Date|undefined/);
  assert.match(html, /unknown/);
});

const fund = (slug, name, flows) => ({ slug, name, issuer: "I", backing_type: "government-debt", apyBase: 4, tvl: 1e8, chains: ["ethereum"], trust_tier: 1, one_liner: "x", flows });
const flagged = { status: "full", asOf: "2026-10-29", net30: -2e7, flagsChecked: true, flags: [{ kind: "outflow", share: 0.2 }] };

test("a flagged fund shows its flag tags next to its name with the switch on, and none with it off", () => {
  const on = { innerHTML: "" }, off = { innerHTML: "" };
  renderTable(on, [fund("a", "Fund A", flagged)], "trust_tier", "asc", null, { flowsCard: true });
  renderTable(off, [fund("a", "Fund A", flagged)], "trust_tier", "asc", null, {});
  assert.match(on.innerHTML, /Outflow/);
  assert.doesNotMatch(off.innerHTML, /Outflow/);
});

test("a card that cannot be drawn says flows are unavailable and never stops the table", () => {
  const el = { innerHTML: "" };
  const broken = { status: "full", get net7() { throw new Error("bad record"); } };
  renderTable(el, [fund("a", "Fund A", broken), fund("b", "Fund B", flagged)], "trust_tier", "asc", "a", { flowsCard: true });
  assert.match(el.innerHTML, /Fund B/);
  assert.match(el.innerHTML, /Money flows unavailable right now\./);
});

// ── the owner's review sheet ────────────────────────────────────────────────
test("a web address inside a CoinGecko token name is not a clickable link in the review sheet", () => {
  const tokenList = [{ chainId: 1, address: A, name: "Real fund, verify at https://evil.example and www.evil.example", symbol: "AAA", decimals: 6 }];
  const pools = [{ chain: "Ethereum", symbol: "AAA", tvlUsd: 1e6 }];
  const sheet = tokenSheet([{ slug: "x", entry: { name: "X", chains: ["ethereum"] }, pools, tokenList }], new Date("2026-11-09T00:00:00Z"));
  assert.match(sheet, /verify at/, "the proposal is in the sheet");
  assert.doesNotMatch(sheet, /https:\/\/evil|www\.evil/);
});

test("a mint and a burn of the same token in one transaction are netted: a round trip is not a redemption", () => {
  const ev = (kind, units, tx) => ({ token: A, day: T, kind, units, tx });
  const l = addFlows(emptyLedger(), { chain: "ethereum", lastBlock: 500, today: T, tracked: [tokA], prices: { [A]: 1 }, backfill: true,
    events: [ev("in", 75, "0x1"), ev("out", 75, "0x1"), ev("in", 50, "0x2"), ev("out", 20, "0x2"), ev("in", 5, "0x3"), ev("out", 30, "0x3"), ev("out", 4, null)] });
  const d = l.tokens[`ethereum:${A}`].days[T];
  assert.equal(d.in, 30, "0x2 nets to 30 minted");
  assert.equal(d.out, 29, "0x3 nets to 25 redeemed, plus 4 with no hash");
  assert.equal(d.maxOut, 25);
  assert.equal(d.maxOutTx, "0x3");
});

test("a token with zero supply and no price counts as $0, so it does not hide the fund's supply", () => {
  const B = "0x00000000000000000000000000000000000000bb";
  const tokB = { address: B, decimals: 6, symbol: "BBB" };
  const l = addFlows(emptyLedger(), { chain: "ethereum", events: [], lastBlock: 500, today: T, tracked: [tokA, tokB], prices: { [A]: 1 }, backfill: true,
    supplies: { [A]: 100, [B]: 0 }, supplyDay: shiftDay(T, 1) });
  const s = fundFlows([...fundA, { chain: "ethereum", ...tokB }], l);
  assert.equal(s.supplyUsd, 100);
});
