// Tests for the daily flows job (flows-job.mjs) and its price lookup, with a fake Portal
// and a fake CoinGecko. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { runFlows, fetchPrices, registryTokens } from "./flows-job.mjs";
import { emptyLedger, fundFlows } from "./flows.mjs";

const A = "0x00000000000000000000000000000000000000aa";
const tokens = [{ chain: "ethereum", address: A, decimals: 6, symbol: "AAA" }];
const NOW = Date.parse("2026-10-30T04:40:00Z");
const quiet = { log() {}, warn() {}, error() {} };

// fake Portal: finalized head 1000; block 100 starts the 30-day window; events come back as given
function fakePortal(events, lastTimestamp = Date.parse("2026-10-30T03:00:00Z") / 1000) {
  const calls = [];
  return {
    calls,
    finalizedHead: async () => 1000,
    blockAt: async (ds, ts) => { calls.push(["blockAt", ts]); return 100; },
    fetchMintsBurns: async (q) => { calls.push(["read", q.fromBlock, q.toBlock, q.tokens]); return { events, lastBlock: q.toBlock, lastTimestamp, bytes: 2_000_000 }; },
  };
}

test("the first run backfills 30 whole days; the next run reads on from the last block", async () => {
  const portal = fakePortal([{ token: A, day: "2026-10-29", kind: "out", units: 7, tx: "0xa" }]);
  const r = await runFlows({ ledger: emptyLedger(), tokens, portal, prices: async () => ({ [A]: 1 }), now: NOW, log: quiet });
  assert.deepEqual(portal.calls[0], ["blockAt", Date.parse("2026-09-30T00:00:00Z") / 1000], "from the start of the oldest of 30 whole days");
  assert.deepEqual(portal.calls[1].slice(1, 3), [100, 1000]);
  assert.deepEqual(portal.calls[1][3], [{ address: A, decimals: 6 }]);
  assert.equal(r.ledger.chains.ethereum.lastBlock, 1000);
  assert.equal(r.ledger.chains.ethereum.asOf, "2026-10-29", "the last complete day before the last block read");
  assert.equal(r.ledger.tokens[`ethereum:${A}`].firstDay, "2026-09-30");
  assert.equal(fundFlows(tokens, r.ledger).status, "full");
  assert.equal(r.bytes, 2_000_000);

  const again = fakePortal([]);
  again.finalizedHead = async () => 1500;
  const r2 = await runFlows({ ledger: r.ledger, tokens, portal: again, prices: async () => ({ [A]: 1 }), now: NOW + 86_400_000, log: quiet });
  assert.deepEqual(again.calls.map((c) => c[0]), ["read"], "no backfill the second time");
  assert.deepEqual(again.calls[0].slice(1, 3), [1001, 1500]);
  assert.equal(r2.ledger.chains.ethereum.lastBlock, 1500);
});

test("logs the MB read from the Portal", async () => {
  const lines = [];
  await runFlows({ ledger: emptyLedger(), tokens, portal: fakePortal([]), prices: async () => ({ [A]: 1 }), now: NOW, log: { ...quiet, log: (l) => lines.push(l) } });
  assert.ok(lines.some((l) => /2\.00 MB/.test(l)), lines.join("\n"));
});

test("no new finalized blocks: the ledger is left as it was", async () => {
  const first = await runFlows({ ledger: emptyLedger(), tokens, portal: fakePortal([]), prices: async () => ({ [A]: 1 }), now: NOW, log: quiet });
  const r = await runFlows({ ledger: first.ledger, tokens, portal: fakePortal([]), prices: async () => ({ [A]: 1 }), now: NOW, log: quiet });
  assert.deepEqual(r.ledger, first.ledger);
});

test("registryTokens: every Ethereum token of every registry fund, once", () => {
  const reg = { f: { tokens: [...tokens, { chain: "base", address: A, decimals: 6, symbol: "AAA" }] }, g: {}, h: { tokens } };
  assert.deepEqual(registryTokens(reg, "ethereum"), [{ address: A, decimals: 6, symbol: "AAA" }]);
});

test("prices: one call per token, a missing or failed price is null (never a guessed $1)", async () => {
  const B = "0x00000000000000000000000000000000000000bb", C = "0x00000000000000000000000000000000000000cc";
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes(C)) throw new Error("timeout");
    return new Response(JSON.stringify(url.includes(A) ? { [A]: { usd: 1.05 } } : {}), { status: 200 });
  };
  const p = await fetchPrices([A, B, C], { fetchImpl, sleep: async () => {}, log: quiet });
  assert.deepEqual(p, { [A]: 1.05, [B]: null, [C]: null });
  assert.equal(urls.length, 3);
  assert.match(urls[0], /simple\/token_price\/ethereum\?contract_addresses=0x0+aa&vs_currencies=usd$/);
});

test("prices: a busy answer is tried again; a listed-but-empty answer is logged as no price", async () => {
  let n = 0;
  const waits = [], warns = [];
  const fetchImpl = async () => (++n === 1 ? new Response("", { status: 429 }) : new Response(JSON.stringify({ [A]: { usd: 1 } }), { status: 200 }));
  assert.deepEqual(await fetchPrices([A], { fetchImpl, sleep: async (ms) => waits.push(ms), log: quiet }), { [A]: 1 });
  assert.deepEqual(waits, [30_000]);
  const empty = async () => new Response("{}", { status: 200 });
  assert.deepEqual(await fetchPrices([A], { fetchImpl: empty, sleep: async () => {}, log: { ...quiet, warn: (l) => warns.push(l) } }), { [A]: null });
  assert.match(warns[0], /no USD price/);
});
