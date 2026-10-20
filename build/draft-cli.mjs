// npm run draft — writes review/rwa-review-<date>.md: a draft entry and research slots for
// every fund over $50M that is not in the registry. Reads the registry; never writes it.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runPipeline } from "./pipeline.mjs";
import { checkRegistry } from "./registry.mjs";
import { reviewSheet } from "./draft.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

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
  const { unclassified } = runPipeline(registry, pools, protocols);
  if (!unclassified.length) return console.log("Every fund over $50M is classified. Nothing to draft.");

  const facts = unclassified.map((fund) => ({
    fund,
    protocol: protocols.find((p) => p.slug === fund.slug) ?? null,
    pools: pools.filter((p) => p.project === fund.slug),
  }));
  const now = new Date();
  const out = join(HERE, "..", "review", `rwa-review-${now.toISOString().slice(0, 10)}.md`);
  await mkdir(dirname(out), { recursive: true });
  try {
    await writeFile(out, reviewSheet(facts, now), { flag: "wx" }); // never overwrite a sheet that may hold review work
  } catch (e) {
    if (e.code === "EEXIST") throw new Error(`${out} already exists and may hold review notes: rename or delete it first`);
    throw e;
  }
  console.log(`wrote ${out}\n  ${facts.length} fund(s): ${facts.map((f) => f.fund.name).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
