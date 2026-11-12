// ─────────────────────────────────────────────────────────────────────────────
// FLOWS JOB — one daily run (#21). flows-run.mjs is the CLI around it (files + exit code);
// the Portal and the price lookup are passed in, so this is tested with fakes.
//
//   runFlows({ ledger, tokens, portal, prices, supplies?, now, log }) → { ledger, bytes }
//     tokens = [{ address, decimals, symbol }] on Ethereum (registryTokens).
//     First run (no last block): read the 30 whole days before today. Later runs: from the
//     last block + 1 to the finalized head. `today` for the ledger = the last COMPLETE UTC
//     day read, so "30 days" is 30 whole days.
//   registryTokens(registry, chain) → the registry's tokens on that chain, each once
//   fetchPrices(addresses, { fetchImpl?, sleep?, log? }) → { address: dollars | null }
//     The free CoinGecko API (no key) answers one contract address per call (asked for
//     several at once, it returns none), so each token is its own call, 2.5 s apart.
//     A failed or empty answer is null: "no price", never a guessed $1.
//     The free API has no past prices by contract address, so the first run's 30 backfilled
//     days all carry that run's price. Every later day carries its own run's price.
//   fetchSupplies(tokens, { fetchImpl?, log? }) → { address: units | null }
//     totalSupply once per token at the finalized block, from a free public RPC (no key).
//     A failed read is null: the ledger keeps the last value and its date.
//
// Ethereum only for now (#21); the dataset map is the place to add a chain later.
// ─────────────────────────────────────────────────────────────────────────────
import { addFlows, shiftDay, KEEP_DAYS } from "./flows.mjs";
import { netFetch } from "./net.mjs";

export const DATASETS = { ethereum: "ethereum-mainnet" };
const DAY_MS = 86_400_000;
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const PRICE_URL = "https://api.coingecko.com/api/v3/simple/token_price/ethereum";
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RPC_URL = "https://ethereum-rpc.publicnode.com";
const TOTAL_SUPPLY = "0x18160ddd"; // totalSupply()
const PRICE_TRIES = 3; // a rate-limited, failing or hung price call is tried again (waits: net.mjs)

export function registryTokens(registry, chain) {
  const seen = new Map();
  for (const e of Object.values(registry))
    for (const t of e.tokens ?? []) if (t.chain === chain) seen.set(t.address.toLowerCase(), { address: t.address.toLowerCase(), decimals: t.decimals, symbol: t.symbol });
  return [...seen.values()];
}

export async function fetchPrices(addresses, { fetchImpl = undefined, sleep = realSleep, log = console } = {}) {
  const out = {};
  for (const [i, raw] of addresses.entries()) {
    const a = raw.toLowerCase();
    if (i) await sleep(2_500); // stay well inside the free rate limit
    // a day stored without a price keeps no dollars for 30 days, so a busy answer is tried again
    try {
      // CoinGecko goes through the build's one fetch helper (net.mjs): a timeout, and a busy,
      // failing or hung call is tried again after a wait
      const res = await netFetch(`${PRICE_URL}?contract_addresses=${a}&vs_currencies=usd`, { headers: { accept: "application/json" } }, { timeoutMs: 30_000, tries: PRICE_TRIES, fetchImpl, sleep, log: { warn: (l) => log.log(l) } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const p = (await res.json())?.[a]?.usd;
      out[a] = Number.isFinite(p) && p > 0 ? p : null;
      // GitHub shows "::warning::" on the run page; the run stays green
      if (out[a] === null) log.log(`::warning::CoinGecko has no USD price for ${a}: no price today`);
    } catch (e) {
      log.log(`::warning::CoinGecko price for ${a} failed (${e.message}): no price today; the next good price fills it in`);
      out[a] = null;
    }
  }
  return out;
}

export async function fetchSupplies(tokens, { fetchImpl = undefined, sleep = realSleep, log = console } = {}) {
  const out = {};
  for (const t of tokens) {
    const a = t.address.toLowerCase();
    try {
      const res = await netFetch(RPC_URL, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: a, data: TOTAL_SUPPLY }, "finalized"] }),
      }, { timeoutMs: 30_000, tries: 2, fetchImpl, sleep, log: { warn: (l) => log.log(l) } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (!/^0x[0-9a-fA-F]+$/.test(j?.result ?? "")) throw new Error(j?.error?.message ?? "no result");
      out[a] = Number(BigInt(j.result)) / 10 ** t.decimals;
    } catch (e) {
      // GitHub shows "::warning::" on the run page; the run stays green
      log.log(`::warning::totalSupply for ${a} failed (${e.message}): keeping the last value`);
      out[a] = null;
    }
  }
  return out;
}

// readLimitMs: stop reading cleanly before the workflow's timeout kills the job, so what was
// read is saved and the next run continues from there
export async function runFlows({ ledger, tokens, portal, prices, supplies = async () => ({}), now = Date.now(), log = console, readLimitMs = 300 * 60_000 }) {
  const jobStart = Date.now();
  const chain = "ethereum", dataset = DATASETS[chain];
  if (!tokens.length) { log.warn("  ⚠ flows: no tracked tokens in the registry"); return { ledger, bytes: 0 }; }
  const startOfToday = Date.parse(utcDay(now) + "T00:00:00Z");
  const last = ledger.chains?.[chain]?.lastBlock;
  const backfill = !Number.isInteger(last);
  // a ledger with data but no block to continue from would double-count on a new backfill
  const known = Object.keys(ledger.tokens ?? {}).filter((k) => k.startsWith(`${chain}:`)).length;
  if (backfill && known) throw new Error(`flows-ledger.json: ${chain} has ${known} tokens but no lastBlock — refusing to backfill on top`);
  // an error from a Portal call is the Portal's (busy, down): flows-run.mjs keeps the ledger and
  // warns. Any other error is ours and fails the run.
  const fromPortal = async (call) => { try { return await call(); } catch (e) { e.fromPortal = true; throw e; } };
  const head = await fromPortal(() => portal.finalizedHead(dataset));
  const fromBlock = backfill ? await fromPortal(() => portal.blockAt(dataset, (startOfToday - KEEP_DAYS * DAY_MS) / 1000)) : last + 1;
  if (fromBlock > head) { log.log(`::warning::${chain}: no new finalized blocks since ${last}`); return { ledger, bytes: 0 }; }

  // A token new to the ledger is read only from fromBlock, which sits inside the day after the
  // chain's last complete day: its first full day is the one after that (also on a same-day rerun).
  const prevAsOf = ledger.chains?.[chain]?.asOf;
  const newFrom = !backfill && prevAsOf ? shiftDay(prevAsOf, 2) : null;
  const price = await prices(tokens.map((t) => t.address));
  const t0 = Date.now();
  let batches = 0;
  const onBatch = (p) => {
    if (++batches % 25) return;
    // our own progress line must never fail a read (it would be blamed on the Portal)
    try { log.log(`    ${chain}: ${Math.round((100 * (p.lastBlock - fromBlock + 1)) / (head - fromBlock + 1))}% · block ${p.lastBlock} · ${p.events} events · ${(p.bytes / 1e6).toFixed(1)} MB`); }
    catch { /* a progress line is not worth a failed run */ }
  };
  // `complete`: the read reached the head. Only then is it the chain's last successful update;
  // a part-way read keeps its blocks but leaves updatedAt, so repeated failures turn stale.
  const merge = async (r, complete) => {
    if (r.lastBlock < fromBlock || r.lastTimestamp == null) return false;
    const supply = await supplies(tokens);
    const today = shiftDay(utcDay(r.lastTimestamp * 1000), -1);
    ledger = addFlows(ledger, {
      chain, events: r.events, lastBlock: r.lastBlock, today, tracked: tokens, prices: price, supplies: supply, supplyDay: utcDay(now),
      backfill: backfill ? utcDay(startOfToday - KEEP_DAYS * DAY_MS) : false, newFrom,
      updatedAt: complete ? new Date(now).toISOString() : null,
    });
    return true;
  };
  let r;
  try { r = await fromPortal(() => portal.fetchMintsBurns({ dataset, tokens: tokens.map(({ address, decimals }) => ({ address, decimals })), fromBlock, toBlock: head, onBatch, deadline: jobStart + readLimitMs })); }
  catch (e) {
    // keep what was read before the failure (whole blocks only, portal.mjs), so the next run
    // continues from there (#46). The error carries the ledger for flows-run.mjs to save.
    if (e.partial && await merge(e.partial, false)) {
      e.ledger = ledger;
      log.log(`  ${chain}: failed at block ${e.partial.lastBlock + 1}; kept blocks ${fromBlock}–${e.partial.lastBlock} (${e.partial.events.length} events)`);
    }
    throw e;
  }
  await merge(r, r.lastBlock >= head);
  if (r.lastBlock < head) log.log(`::warning::${chain}: stopped at block ${r.lastBlock}, before the finalized head ${head}; the next run continues`);
  log.log(`  ${chain}: ${tokens.length} tokens · blocks ${fromBlock}–${r.lastBlock}${backfill ? " (first run: 30-day backfill)" : ""} · ${r.events.length} events · ${(r.bytes / 1e6).toFixed(2)} MB · ${Math.round((Date.now() - t0) / 1000)}s`);
  return { ledger, bytes: r.bytes };
}
