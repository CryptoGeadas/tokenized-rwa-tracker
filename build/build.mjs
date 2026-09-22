import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runPipeline } from "./pipeline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "..", "site");
const OUT = join(SITE, "data", "latest.json");

const POOLS_FEED = "https://yields.llama.fi/pools";
const PROTOCOLS_FEED = "https://api.llama.fi/protocols";

async function main() {
  console.log("fetching", PROTOCOLS_FEED, "…");
  const protocols = await (await fetch(PROTOCOLS_FEED)).json();
  console.log(`  ${protocols.length} protocols`);

  console.log("fetching", POOLS_FEED, "…");
  const res = await fetch(POOLS_FEED);
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const { data: pools } = await res.json();
  console.log(`  ${pools.length} pools`);

  const result = await runPipeline(pools, protocols);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "https://defillama.com",
    ...result,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");

  console.log(
    `\nwrote ${OUT}` +
    `\n  main-stage: ${result.stats.mainStageCount}` +
    `\n  secondary:  ${result.stats.secondaryCount}` +
    `\n  unclassified: ${result.stats.unclassifiedCount}`
  );

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
