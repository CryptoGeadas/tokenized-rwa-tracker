// npm run draft — writes review/rwa-review-<date>.md: a draft entry, research slots and
// proposed Ethereum tokens for every fund over $50M that is not in the registry.
// npm run draft -- --tokens — writes review/rwa-tokens-<date>.md: proposed Ethereum tokens
// for every registry fund that has none yet (the token review round, #31).
// Reads the registry; never writes it.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runPipeline } from "./pipeline.mjs";
import { checkRegistry } from "./registry.mjs";
import { reviewSheet, tokenSheet } from "./draft.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN_LIST = "https://tokens.coingecko.com/ethereum/all.json";

// CoinGecko's free Ethereum token list. Unreadable → null: the sheet then says "unknown".
async function fetchTokenList() {
  try {
    const tokens = (await fetchJSON(TOKEN_LIST))?.tokens;
    if (!Array.isArray(tokens) || !tokens.length) throw new Error("expected { tokens: [...] } with tokens in it");
    console.log(`  CoinGecko token list: ${tokens.length} Ethereum tokens`);
    return tokens;
  } catch (e) {
    console.warn(`  ⚠ CoinGecko token list failed (${e.message}): proposed tokens read "unknown"`);
    return null;
  }
}

// Write a new sheet; never overwrite one that may hold review work.
async function writeSheet(out, text) {
  await mkdir(dirname(out), { recursive: true });
  try {
    await writeFile(out, text, { flag: "wx" });
  } catch (e) {
    if (e.code === "EEXIST") throw new Error(`${out} already exists and may hold review notes: rename or delete it first`);
    throw e;
  }
}

async function fetchJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  try { return await res.json(); } catch (e) { throw new Error(`${url}: not JSON (${e.message})`); }
}

async function main() {
  const registry = checkRegistry(JSON.parse(await readFile(join(HERE, "rwa-registry.json"), "utf8")));
  const [protocols, poolsFeed] = await Promise.all([fetchJSON("https://api.llama.fi/protocols"), fetchJSON("https://yields.llama.fi/pools")]);
  const pools = poolsFeed?.data;
  if (!Array.isArray(protocols)) throw new Error("https://api.llama.fi/protocols: expected a list");
  if (!Array.isArray(pools)) throw new Error("https://yields.llama.fi/pools: expected { data: [...] }");
  const now = new Date(), date = now.toISOString().slice(0, 10);

  if (process.argv.includes("--tokens")) {
    const todo = Object.entries(registry).filter(([, e]) => !e.tokens);
    if (!todo.length) return console.log("Every registry fund has tokens. Nothing to propose.");
    const tokenList = await fetchTokenList();
    const facts = todo.map(([slug, entry]) => ({ slug, entry, tokenList, pools: pools.filter((p) => (entry.pool_projects ?? [slug]).includes(p.project)) }));
    const out = join(HERE, "..", "review", `rwa-tokens-${date}.md`);
    await writeSheet(out, tokenSheet(facts, now));
    return console.log(`wrote ${out}\n  ${facts.length} fund(s) without tokens`);
  }

  const { unclassified } = runPipeline(registry, pools, protocols);
  if (!unclassified.length) return console.log("Every fund over $50M is classified. Nothing to draft.");
  const tokenList = await fetchTokenList();
  const facts = unclassified.map((fund) => ({
    fund,
    protocol: protocols.find((p) => p.slug === fund.slug) ?? null,
    pools: pools.filter((p) => p.project === fund.slug),
    tokenList,
  }));
  const out = join(HERE, "..", "review", `rwa-review-${date}.md`);
  await writeSheet(out, reviewSheet(facts, now));
  console.log(`wrote ${out}\n  ${facts.length} fund(s): ${facts.map((f) => f.fund.name).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
