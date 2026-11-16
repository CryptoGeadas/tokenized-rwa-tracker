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
import { addFlows } from "./flows.mjs";
import { runChains, utcDay } from "./flows-core.mjs";
import { netFetch } from "./net.mjs";

export const DATASETS = { ethereum: "ethereum-mainnet" };
const PRICE_URL = "https://api.coingecko.com/api/v3/simple/token_price/ethereum";
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RPC_URL = "https://ethereum-rpc.publicnode.com";
const TOTAL_SUPPLY = "0x18160ddd"; // totalSupply()
const PRICE_TRIES = 3; // a rate-limited, failing or hung price call is tried again…
const PRICE_WAIT_MS = 30_000; // …after 30 s, then 60 s: CoinGecko's free tier stays busy for a while (#50)

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
      const res = await netFetch(`${PRICE_URL}?contract_addresses=${a}&vs_currencies=usd`, { headers: { accept: "application/json" } }, { timeoutMs: 30_000, tries: PRICE_TRIES, retryWaitMs: PRICE_WAIT_MS, fetchImpl, sleep, log: { warn: (l) => log.log(l) } });
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

// The tracker's adapter for the shared flows core (#47): which tokens to read, the price taken
// once per run (only when there are new blocks), and how mints and burns go into the ledger
// (netted per transaction, with price and supply, in addFlows).
export function tokenAdapter({ tokens, prices, supplies, now }) {
  let price = null;
  return {
    noun: "tokens",
    prepare: ({ ledger, chain }) => ({ ledger, items: tokens, known: Object.keys(ledger.tokens ?? {}).filter((k) => k.startsWith(`${chain}:`)).length }),
    read: ({ portal, items, ...rest }) => portal.fetchMintsBurns({ tokens: items.map(({ address, decimals }) => ({ address, decimals })), ...rest }),
    // prices are asked for here, outside the Portal read, so a price bug is never blamed on the Portal
    add: async (ledger, { items, ...rest }) => {
      price ??= await prices(items.map((t) => t.address));
      return addFlows(ledger, { ...rest, tracked: items, prices: price, supplies: await supplies(items), supplyDay: utcDay(now) });
    },
  };
}

// readLimitMs: stop reading cleanly before the workflow's timeout kills the job, so what was
// read is saved and the next run continues from there.
// A Portal error is thrown again for flows-run.mjs, carrying e.ledger when blocks read before
// it were kept (#46); any other error is thrown as it is.
export async function runFlows({ ledger, tokens, portal, prices, supplies = async () => ({}), now = Date.now(), log = console, readLimitMs = 300 * 60_000 }) {
  if (!tokens.length) { log.warn("  ⚠ flows: no tracked tokens in the registry"); return { ledger, bytes: 0 }; }
  const before = ledger.chains?.ethereum?.lastBlock;
  const r = await runChains({ ledger, datasets: DATASETS, adapter: tokenAdapter({ tokens, prices, supplies, now }), portal, now, log: { log: log.log, error: log.log, warn: (l) => log.log(l.replace(/^\s*⚠ /, "::warning::")) }, readLimitMs });
  const e = r.errors.ethereum;
  if (e) {
    if (e.fromPortal && r.ledger.chains?.ethereum?.lastBlock !== before) e.ledger = r.ledger;
    throw e;
  }
  return { ledger: r.ledger, bytes: r.bytes };
}
