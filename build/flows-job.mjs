// ─────────────────────────────────────────────────────────────────────────────
// FLOWS JOB — one daily run (#21). flows-run.mjs is the CLI around it (files + exit code);
// the Portal and the price lookup are passed in, so this is tested with fakes.
//
//   runFlows({ ledger, tokens, portal, prices, now, log }) → { ledger, bytes }
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
//
// Ethereum only for now (#21); the dataset map is the place to add a chain later.
// ─────────────────────────────────────────────────────────────────────────────
import { addFlows, shiftDay, KEEP_DAYS } from "./flows.mjs";

export const DATASETS = { ethereum: "ethereum-mainnet" };
const DAY_MS = 86_400_000;
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const PRICE_URL = "https://api.coingecko.com/api/v3/simple/token_price/ethereum";
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PRICE_TRIES = 3; // a rate-limited, failing or hung price call: wait 30 s, then 60 s

export function registryTokens(registry, chain) {
  const seen = new Map();
  for (const e of Object.values(registry))
    for (const t of e.tokens ?? []) if (t.chain === chain) seen.set(t.address.toLowerCase(), { address: t.address.toLowerCase(), decimals: t.decimals, symbol: t.symbol });
  return [...seen.values()];
}

export async function fetchPrices(addresses, { fetchImpl = fetch, sleep = realSleep, log = console } = {}) {
  const out = {};
  for (const [i, raw] of addresses.entries()) {
    const a = raw.toLowerCase();
    if (i) await sleep(2_500); // stay well inside the free rate limit
    // a day stored without a price keeps no dollars for 30 days, so a busy answer is tried again
    for (let tries = 1; ; tries++) {
      try {
        const res = await fetchImpl(`${PRICE_URL}?contract_addresses=${a}&vs_currencies=usd`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { retry: res.status === 429 || res.status >= 500 });
        const p = (await res.json())?.[a]?.usd;
        out[a] = Number.isFinite(p) && p > 0 ? p : null;
        if (out[a] === null) log.warn(`  ⚠ CoinGecko has no USD price for ${a}: no price today`);
        break;
      } catch (e) {
        if ((e.retry || e.name === "TimeoutError" || e.name === "TypeError") && tries < PRICE_TRIES) { await sleep(30_000 * tries); continue; }
        log.warn(`  ⚠ CoinGecko price for ${a} failed (${e.message}): no price today`);
        out[a] = null;
        break;
      }
    }
  }
  return out;
}

// readLimitMs: stop reading cleanly before the workflow's timeout kills the job, so what was
// read is saved and the next run continues from there
export async function runFlows({ ledger, tokens, portal, prices, now = Date.now(), log = console, readLimitMs = 300 * 60_000 }) {
  const jobStart = Date.now();
  const chain = "ethereum", dataset = DATASETS[chain];
  if (!tokens.length) { log.warn("  ⚠ flows: no tracked tokens in the registry"); return { ledger, bytes: 0 }; }
  const startOfToday = Date.parse(utcDay(now) + "T00:00:00Z");
  const last = ledger.chains?.[chain]?.lastBlock;
  const backfill = !Number.isInteger(last);
  const head = await portal.finalizedHead(dataset);
  const fromBlock = backfill ? await portal.blockAt(dataset, (startOfToday - KEEP_DAYS * DAY_MS) / 1000) : last + 1;
  if (fromBlock > head) { log.warn(`  ⚠ ${chain}: no new finalized blocks since ${last}`); return { ledger, bytes: 0 }; }

  // A token new to the ledger is read only from fromBlock, which sits inside the day after the
  // chain's last complete day: its first full day is the one after that (also on a same-day rerun).
  const prevAsOf = ledger.chains?.[chain]?.asOf;
  const newFrom = !backfill && prevAsOf ? shiftDay(prevAsOf, 2) : null;
  const price = await prices(tokens.map((t) => t.address));
  const t0 = Date.now();
  let batches = 0;
  const onBatch = (p) => {
    if (++batches % 25) return;
    log.log(`    ${chain}: ${Math.round((100 * (p.lastBlock - fromBlock + 1)) / (head - fromBlock + 1))}% · block ${p.lastBlock} · ${p.events} events · ${(p.bytes / 1e6).toFixed(1)} MB`);
  };
  const r = await portal.fetchMintsBurns({ dataset, tokens: tokens.map(({ address, decimals }) => ({ address, decimals })), fromBlock, toBlock: head, onBatch, deadline: jobStart + readLimitMs });
  if (r.lastBlock >= fromBlock && r.lastTimestamp != null) {
    const today = shiftDay(utcDay(r.lastTimestamp * 1000), -1);
    ledger = addFlows(ledger, {
      chain, events: r.events, lastBlock: r.lastBlock, today, tracked: tokens, prices: price,
      backfill: backfill ? utcDay(startOfToday - KEEP_DAYS * DAY_MS) : false, newFrom,
      updatedAt: r.lastBlock >= head ? new Date(now).toISOString() : null,
    });
  }
  if (r.lastBlock < head) log.warn(`  ⚠ ${chain}: stopped at block ${r.lastBlock}, before the finalized head ${head}; the next run continues`);
  log.log(`  ${chain}: ${tokens.length} tokens · blocks ${fromBlock}–${r.lastBlock}${backfill ? " (first run: 30-day backfill)" : ""} · ${r.events.length} events · ${(r.bytes / 1e6).toFixed(2)} MB · ${Math.round((Date.now() - t0) / 1000)}s`);
  return { ledger, bytes: r.bytes };
}
