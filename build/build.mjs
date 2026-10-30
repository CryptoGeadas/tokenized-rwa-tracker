import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runPipeline, DROP } from "./pipeline.mjs";
import { checkRegistry, registryWarnings, registryLog } from "./registry.mjs";
import { fetchFallbackTvl } from "./coingecko.mjs";
import { withFlows } from "./flows.mjs";

// SWITCH: show the "Money flows" card in open rows (#21). Off until go-live (#33);
// FLOWS_CARD=1 turns it on for a local build only.
const FLOWS_CARD = false;

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "..", "site");
const OUT = join(SITE, "data", "latest.json");
const LEDGER = join(HERE, "state", "flows-ledger.json");

// The ledger is written once a day by flows-run.mjs. A missing or unreadable one never
// fails the build: funds then carry no flows numbers.
async function loadLedger() {
  try {
    const j = JSON.parse(await readFile(LEDGER, "utf8"));
    if (!j || typeof j !== "object" || Array.isArray(j) || !j.tokens || typeof j.tokens !== "object" || Array.isArray(j.tokens)) throw new Error("not a flows ledger");
    return j;
  } catch (e) {
    console.warn(`  ⚠ flows-ledger.json ${e.code === "ENOENT" ? "missing" : `unreadable (${e.message})`} — no flows numbers this build`);
    return null;
  }
}

const POOLS_FEED = "https://yields.llama.fi/pools";
const PROTOCOLS_FEED = "https://api.llama.fi/protocols";

async function fetchJSON(url) {
  console.log("fetching", url, "…");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function main() {
  // Check the registry before fetching, so a registry typo is the error you see.
  const registry = checkRegistry(JSON.parse(await readFile(join(HERE, "rwa-registry.json"), "utf8")));
  const [protocols, { data: pools }, fallback] = await Promise.all([fetchJSON(PROTOCOLS_FEED), fetchJSON(POOLS_FEED), fetchFallbackTvl(registry)]);

  console.log(`  ${protocols.length} protocols · ${pools.length} pools`);

  const result = withFlows(runPipeline(registry, pools, protocols, fallback), registry, await loadLedger());
  const flowsCard = process.env.FLOWS_CARD ? process.env.FLOWS_CARD === "1" : FLOWS_CARD;
  if (process.env.FLOWS_CARD === "1" && !FLOWS_CARD) console.warn("  ⚠ FLOWS_CARD=1: Money flows card on — local check only, do NOT commit site/data/latest.json from this build");

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "https://defillama.com",
    config: { flowsCard },
    ...result,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");

  console.log(
    `\nwrote ${OUT}` +
    `\n  main-stage: ${result.stats.mainStageCount}` +
    `\n  secondary:  ${result.stats.secondaryCount}` +
    `\n  in review (over $50M, unclassified): ${result.stats.unclassifiedCount}` +
    `\n  smaller funds, not reviewed: ${result.smaller.length}`
  );
  for (const f of result.dropped.filter((d) => d.reason === DROP.small)) console.log(`  dropped (under $5M): ${f.name} [${f.slug}] $${(f.tvl / 1e6).toFixed(1)}M`);
  for (const line of registryLog(registryWarnings(result.dropped), process.env)) console.log(line);

  for (const f of result.mainStage) {
    const yld = f.apyBase != null ? f.apyBase.toFixed(2) + "%" : "n/a";
    const flag = f.mislabel ? " ⚠ NOT AN RWA" : "";
    console.log(`  T${f.trust_tier} | ${f.name.padEnd(25)} | ${yld.padStart(7)} | $${(f.tvl / 1e6).toFixed(0)}M${flag}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
