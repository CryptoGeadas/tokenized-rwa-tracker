// ─────────────────────────────────────────────────────────────────────────────
// SQD PORTAL CLIENT — the I/O half of fund flows (#21). Reads fund tokens' mints (Transfer
// from the zero address) and burns (Transfer to the zero address) from the free public
// Portal (portal.sqd.dev, no key) and returns them as in/out token units per UTC day.
// Same design as the DeFi Yield Scanner's client; this repo keeps its own copy.
//   • finalized blocks only (/finalized-stream), so a chain reorg never reaches the ledger;
//   • one query for all tokens of a chain, asking only for Transfers from or to the zero
//     address, so busy tokens (stablecoins) stay cheap;
//   • a response is one batch, not the whole range: ask again from the last block + 1
//     until the range ends or the Portal answers 204 (no more data);
//   • rate-limit / overloaded answers and dropped connections: wait (Retry-After, at most
//     a minute) and repeat the same request, up to maxRetries in a row; any other error
//     stops at once. Errors are matched on error.code, never on the message.
//   • a failure part-way through throws with error.partial = what was read before it.
//
//   fetchMintsBurns({ dataset, tokens: [{ address, decimals }], fromBlock, toBlock, fetchImpl?, sleep?, maxRetries? = 30, onBatch?({ lastBlock, events, bytes }), deadline? })
//     deadline (ms): stop before the next batch once past it and return what was read.
//     → { events: [{ token, day: "YYYY-MM-DD", kind: "in" | "out", units, tx }], lastBlock, lastTimestamp, bytes }
//     An empty 200, a block number out of order, or malformed log data is an error, not
//     the end of the data.
//   finalizedHead(dataset) → block number;  blockAt(dataset, unixSeconds) → block number
// ─────────────────────────────────────────────────────────────────────────────

const PORTAL = "https://portal.sqd.dev/datasets";
export const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // Transfer(address,address,uint256)
export const ZERO_TOPIC = "0x" + "0".repeat(64); // the zero address as a log topic
const RETRY = new Set([429, 503, 529]);
const DEFAULT_WAIT_S = 5;
const MAX_WAIT_S = 60; // a huge Retry-After must not stall the daily job for hours
const REQUEST_TIMEOUT_MS = 120_000;
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class PortalError extends Error {
  constructor(status, code, message) {
    super(`SQD Portal ${status} ${code}: ${message}`);
    this.status = status;
    this.code = code;
  }
}

// One HTTP call with the retry rule. Returns the Response (2xx or 204). A dropped or hung
// connection (fetch throws, or no answer in REQUEST_TIMEOUT_MS) counts as a retryable try.
async function call(url, init, { fetchImpl, sleep, maxRetries }) {
  for (let tries = 0; ; tries++) {
    let res;
    try { res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }); }
    catch (e) {
      if (tries >= maxRetries) throw new PortalError(0, "network_error", e.message);
      await sleep(1000 * DEFAULT_WAIT_S);
      continue;
    }
    if (res.ok || res.status === 204) return res;
    let code = `http_${res.status}`, message = "";
    try { const j = await res.json(); code = j?.error?.code ?? code; message = j?.error?.message ?? ""; } catch { /* not the error envelope */ }
    if (!RETRY.has(res.status) || tries >= maxRetries) throw new PortalError(res.status, code, message || res.statusText || "no message");
    const wait = Number(res.headers.get("retry-after"));
    await sleep(1000 * Math.min(MAX_WAIT_S, Number.isFinite(wait) && wait > 0 ? wait : DEFAULT_WAIT_S));
  }
}
const opts = (o) => ({ fetchImpl: o.fetchImpl ?? fetch, sleep: o.sleep ?? realSleep, maxRetries: o.maxRetries ?? 30, onBatch: o.onBatch, deadline: o.deadline });

export async function finalizedHead(dataset, o = {}) {
  const res = await call(`${PORTAL}/${dataset}/finalized-head`, {}, opts(o));
  const n = (await res.json())?.number;
  if (!Number.isInteger(n)) throw new PortalError(res.status, "bad_head", `no block number for ${dataset}`);
  return n;
}

export async function blockAt(dataset, unixSeconds, o = {}) {
  const res = await call(`${PORTAL}/${dataset}/timestamps/${Math.floor(unixSeconds)}/block`, {}, opts(o));
  const n = (await res.json())?.block_number;
  if (!Number.isInteger(n)) throw new PortalError(res.status, "bad_block", `no block at ${unixSeconds} on ${dataset}`);
  return n;
}

const utcDay = (unixSeconds) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

export async function fetchMintsBurns({ dataset, tokens, fromBlock, toBlock, ...rest }) {
  const o = opts(rest);
  const decimals = new Map(tokens.map((t) => [t.address.toLowerCase(), t.decimals]));
  const address = [...decimals.keys()];
  const events = [];
  let bytes = 0, lastBlock = fromBlock - 1, lastTimestamp = null, from = fromBlock;
  try {
    while (from <= toBlock) {
      if (o.deadline && Date.now() > o.deadline) break; // time limit: return what was read; the caller saves it
      const res = await call(`${PORTAL}/${dataset}/finalized-stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "evm", fromBlock: from, toBlock,
          fields: { block: { number: true, timestamp: true }, log: { address: true, topics: true, data: true, transactionHash: true } },
          logs: [
            { address, topic0: [TRANSFER], topic1: [ZERO_TOPIC] }, // mints
            { address, topic0: [TRANSFER], topic2: [ZERO_TOPIC] }, // burns
          ],
        }),
      }, o);
      if (res.status === 204) break;
      const text = await res.text();
      bytes += Buffer.byteLength(text);
      const blocks = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      // a 200 with nothing in it would end the read short of toBlock without a word
      if (!blocks.length) throw new PortalError(200, "empty_batch", `no blocks from ${from} on ${dataset}`);
      const batch = [];
      let prev = from - 1;
      for (const b of blocks) {
        const n = b.header?.number, ts = b.header?.timestamp;
        if (!Number.isInteger(n) || n <= prev || n > toBlock || !Number.isFinite(ts))
          throw new PortalError(200, "bad_block", `block header ${JSON.stringify(b.header)} after ${prev} on ${dataset}`);
        prev = n;
        for (const l of b.logs ?? []) {
          const token = String(l.address).toLowerCase(), t = l.topics ?? [];
          if (!decimals.has(token) || t[0] !== TRANSFER) continue;
          const isMint = t[1] === ZERO_TOPIC, isBurn = t[2] === ZERO_TOPIC;
          if (isMint === isBurn) continue; // a holder-to-holder transfer (or zero to zero) is not a flow
          const data = String(l.data);
          if (!/^0x[0-9a-fA-F]{64}/.test(data)) throw new PortalError(200, "bad_log", `block ${n} token ${token}: data ${data.slice(0, 20)}…`);
          const units = Number(BigInt(data.slice(0, 66))) / 10 ** decimals.get(token);
          batch.push({ token, day: utcDay(ts), kind: isMint ? "in" : "out", units, tx: l.transactionHash ?? null });
        }
      }
      // the whole batch checked out: only now does it count as read
      events.push(...batch);
      lastBlock = prev;
      lastTimestamp = blocks[blocks.length - 1].header.timestamp;
      from = lastBlock + 1;
      o.onBatch?.({ lastBlock, events: events.length, bytes });
    }
  } catch (e) {
    // batches are contiguous, so everything up to lastBlock is complete: hand it back
    // with the error so the caller can keep that progress instead of starting over.
    e.partial = { events, lastBlock, lastTimestamp, bytes };
    throw e;
  }
  return { events, lastBlock, lastTimestamp, bytes };
}
