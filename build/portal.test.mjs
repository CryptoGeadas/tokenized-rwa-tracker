// Tests for the SQD Portal client (portal.mjs), against a fake Portal. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchMintsBurns, finalizedHead, blockAt, PortalError, TRANSFER, ZERO_TOPIC } from "./portal.mjs";

const TOKEN = "0x00000000000000000000000000000000000000aa";
const TOKEN18 = "0x00000000000000000000000000000000000000cc";
const HOLDER = "0x000000000000000000000000" + "11".repeat(20);
const word = (n) => BigInt(n).toString(16).padStart(64, "0");
// A Transfer log as the Portal returns it: from / to in topics 1 and 2, the amount in data.
const transfer = (from, to, units, address = TOKEN, tx = "0xt1") => ({ address, topics: [TRANSFER, from, to], data: "0x" + word(units), transactionHash: tx });
const mint = (units, address, tx) => transfer(ZERO_TOPIC, HOLDER, units, address, tx);
const burn = (units, address, tx) => transfer(HOLDER, ZERO_TOPIC, units, address, tx);
const block = (number, timestamp, logs = []) => ({ header: { number, timestamp }, logs });
const DAY1 = Date.parse("2026-10-20T10:00:00Z") / 1000;
const DAY2 = Date.parse("2026-10-21T10:00:00Z") / 1000;

// fake Portal: answers each call with the next scripted response and records the requests.
function fakePortal(responses) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    const r = responses.shift();
    if (!r) throw new Error("no more scripted responses");
    const text = r.raw ?? (r.lines ? r.lines.map((l) => JSON.stringify(l)).join("\n") + "\n" : JSON.stringify(r.body ?? ""));
    return new Response(r.status === 204 ? null : text, { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  return { fetchImpl, calls };
}
const noSleep = async () => {};
const tokens = [{ address: TOKEN, decimals: 6 }];
const read = (fetchImpl, more = {}) => fetchMintsBurns({ dataset: "ethereum-mainnet", tokens, fromBlock: 100, toBlock: 200, fetchImpl, sleep: noSleep, ...more });
// bytes of a batch exactly as the fake Portal sends it
const size = (lines) => Buffer.byteLength(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
const busy = (status = 529, code = "overloaded", headers = {}) => ({ status, headers, body: { error: { type: "rate_limit_error", code, message: "busy" } } });

test("the Transfer topic is the ERC-20 Transfer(address,address,uint256) signature", () => {
  assert.equal(TRANSFER, "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
  assert.equal(ZERO_TOPIC, "0x" + "0".repeat(64));
});

test("a mint is in and a burn is out, in token units, on the block's UTC day, with the transaction; reads on to the end of the range", async () => {
  const { fetchImpl, calls } = fakePortal([
    { lines: [block(100, DAY1, [mint(5_000_000n, TOKEN, "0xa")]), block(150, DAY1)] },
    { lines: [block(160, DAY2, [burn(2_500_000n, TOKEN, "0xb")]), block(200, DAY2)] },
  ]);
  const r = await read(fetchImpl);
  assert.deepEqual(r.events, [
    { token: TOKEN, day: "2026-10-20", kind: "in", units: 5, tx: "0xa" },
    { token: TOKEN, day: "2026-10-21", kind: "out", units: 2.5, tx: "0xb" },
  ]);
  assert.equal(r.lastBlock, 200);
  assert.equal(r.lastTimestamp, DAY2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.fromBlock, 151, "the next request starts after the last block received");
  assert.match(calls[0].url, /\/datasets\/ethereum-mainnet\/finalized-stream$/, "finalized blocks only");
  assert.ok(r.bytes > 0);
});

test("asks only for Transfers from or to the zero address, one query for all tokens", async () => {
  const { fetchImpl, calls } = fakePortal([{ lines: [block(200, DAY1)] }]);
  await fetchMintsBurns({ dataset: "ethereum-mainnet", tokens: [...tokens, { address: TOKEN18, decimals: 18 }], fromBlock: 100, toBlock: 200, fetchImpl, sleep: noSleep });
  assert.deepEqual(calls[0].body.logs, [
    { address: [TOKEN, TOKEN18], topic0: [TRANSFER], topic1: [ZERO_TOPIC] },
    { address: [TOKEN, TOKEN18], topic0: [TRANSFER], topic2: [ZERO_TOPIC] },
  ]);
  assert.equal(calls[0].body.fields.log.transactionHash, true);
});

test("ordinary transfers between holders are not flows, even if the Portal sends them", async () => {
  const { fetchImpl } = fakePortal([{ lines: [block(200, DAY1, [transfer(HOLDER, HOLDER, 9n), transfer(ZERO_TOPIC, ZERO_TOPIC, 9n), mint(1_000_000n)])] }]);
  const r = await read(fetchImpl);
  assert.deepEqual(r.events.map((e) => [e.kind, e.units]), [["in", 1]]);
});

test("each token's own decimals; addresses matched whatever their case; the day is UTC around midnight", async () => {
  const before = Date.parse("2026-10-20T23:59:59Z") / 1000, after = Date.parse("2026-10-21T00:00:00Z") / 1000;
  const { fetchImpl } = fakePortal([{ lines: [
    block(150, before, [mint(3_000_000n, TOKEN.toUpperCase().replace("0X", "0x"), "0xa")]),
    block(200, after, [burn(1_234_567n * 10n ** 18n, TOKEN18, "0xb")]),
  ] }]);
  const r = await fetchMintsBurns({ dataset: "ethereum-mainnet", tokens: [...tokens, { address: TOKEN18.toUpperCase().replace("0X", "0x"), decimals: 18 }], fromBlock: 100, toBlock: 200, fetchImpl, sleep: noSleep });
  assert.deepEqual(r.events, [
    { token: TOKEN, day: "2026-10-20", kind: "in", units: 3, tx: "0xa" },
    { token: TOKEN18, day: "2026-10-21", kind: "out", units: 1234567, tx: "0xb" },
  ]);
});

test("reports progress after each batch", async () => {
  const seen = [];
  const { fetchImpl } = fakePortal([{ lines: [block(150, DAY1, [mint(1n)])] }, { lines: [block(200, DAY2)] }]);
  await read(fetchImpl, { onBatch: (p) => seen.push([p.lastBlock, p.events]) });
  assert.deepEqual(seen, [[150, 1], [200, 1]]);
});

test("stops when the Portal says there is no more data", async () => {
  const { fetchImpl, calls } = fakePortal([{ lines: [block(120, DAY1)] }, { status: 204 }]);
  const r = await read(fetchImpl);
  assert.equal(r.lastBlock, 120);
  assert.equal(calls.length, 2);
});

test("overloaded or rate-limited: waits Retry-After (at most a minute), then asks again for the same blocks", async () => {
  const waits = [];
  const { fetchImpl, calls } = fakePortal([busy(529, "overloaded", { "retry-after": "7" }), busy(429, "rate_limited", { "retry-after": "999" }), { lines: [block(200, DAY1)] }]);
  const r = await read(fetchImpl, { sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(waits, [7_000, 60_000]);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].body.fromBlock, 100);
  assert.equal(r.lastBlock, 200);
});

test("gives up after the retry limit (one try plus maxRetries), keeping what was read before", async () => {
  const first = [block(150, DAY1, [mint(1_000_000n)])];
  const firstBytes = size(first);
  const { fetchImpl, calls } = fakePortal([{ lines: first }, busy(), busy(), busy(), { lines: [block(200, DAY2)] }]);
  await assert.rejects(read(fetchImpl, { maxRetries: 2 }), (e) => {
    assert.ok(e instanceof PortalError);
    assert.equal(e.code, "overloaded");
    assert.equal(e.partial.lastBlock, 150);
    assert.equal(e.partial.events.length, 1);
    assert.equal(e.partial.bytes, firstBytes);
    return true;
  });
  assert.equal(calls.length, 4, "1 good batch, then 1 try and 2 retries");
  const zero = fakePortal([busy(), { lines: [block(200, DAY2)] }]);
  await assert.rejects(read(zero.fetchImpl, { maxRetries: 0 }), /overloaded/);
  assert.equal(zero.calls.length, 1);
});

test("counts the bytes of every batch, as bytes not characters", async () => {
  const b1 = [block(150, DAY1, [mint(1n, TOKEN, "0xé")])], b2 = [block(200, DAY2)];
  const r = await read(fakePortal([{ lines: b1 }, { lines: b2 }]).fetchImpl);
  assert.equal(r.bytes, size(b1) + size(b2));
});

test("a log from an untracked address, or not a Transfer, is not a flow", async () => {
  const other = "0x00000000000000000000000000000000000000ff";
  const { fetchImpl } = fakePortal([{ lines: [block(200, DAY1, [mint(5n, other), { ...mint(5n), topics: ["0x" + "ab".repeat(32), ZERO_TOPIC, HOLDER] }, mint(1_000_000n)])] }]);
  const r = await read(fetchImpl);
  assert.deepEqual(r.events.map((e) => [e.token, e.units]), [[TOKEN, 1]]);
});

test("any other error stops at once, matched by its code", async () => {
  const { fetchImpl, calls } = fakePortal([{ status: 400, body: { error: { code: "invalid_query", message: "bad" } } }]);
  await assert.rejects(read(fetchImpl), (e) => e.code === "invalid_query" && e.status === 400);
  assert.equal(calls.length, 1);
});

test("an empty 200, an out-of-order block or malformed log data is an error, not the end of the data", async () => {
  await assert.rejects(read(fakePortal([{ raw: "" }]).fetchImpl), /empty_batch/);
  await assert.rejects(read(fakePortal([{ lines: [block(150, DAY1), block(140, DAY1)] }]).fetchImpl), /bad_block/);
  await assert.rejects(read(fakePortal([{ lines: [block(150, DAY1, [{ ...mint(1n), data: "0x12" }])] }]).fetchImpl), /bad_log/);
});

test("stops before the next batch once past the deadline and returns what was read", async () => {
  const { fetchImpl, calls } = fakePortal([{ lines: [block(150, DAY1, [mint(1_000_000n)])] }, { lines: [block(200, DAY2)] }]);
  const r = await read(fetchImpl, { deadline: Date.now() - 1, onBatch: () => {} });
  // the deadline is checked before every request, so a past deadline reads nothing
  assert.equal(calls.length, 0);
  assert.equal(r.lastBlock, 99);
});

test("finalized head and block at a time", async () => {
  const head = fakePortal([{ body: { number: 26_300_000 } }]);
  assert.equal(await finalizedHead("ethereum-mainnet", { fetchImpl: head.fetchImpl }), 26_300_000);
  assert.match(head.calls[0].url, /ethereum-mainnet\/finalized-head$/);
  const at = fakePortal([{ body: { block_number: 26_100_000 } }]);
  assert.equal(await blockAt("ethereum-mainnet", 1_760_000_000, { fetchImpl: at.fetchImpl }), 26_100_000);
  assert.match(at.calls[0].url, /timestamps\/1760000000\/block$/);
});
