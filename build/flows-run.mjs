// ─────────────────────────────────────────────────────────────────────────────
// FLOWS JOB CLI (#21) — runs once a day in its own GitHub Action (flows.yml), never inside
// the refresh, so a slow or busy SQD Portal can't hold up the main snapshot.
// Reads the registry's tokens and the ledger (build/state/flows-ledger.json), runs the job
// (flows-job.mjs) and saves the ledger only when it changed. The next refresh puts the
// ledger's numbers on the page.
// ─────────────────────────────────────────────────────────────────────────────
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkRegistry } from "./registry.mjs";
import { fetchMintsBurns, finalizedHead, blockAt } from "./portal.mjs";
import { emptyLedger } from "./flows.mjs";
import { runFlows, fetchPrices, registryTokens } from "./flows-job.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = join(HERE, "state", "flows-ledger.json");

async function loadLedger(path) {
  let text;
  try { text = await readFile(path, "utf8"); }
  catch (e) { if (e.code === "ENOENT") return emptyLedger(); throw e; }
  // a broken or wrong-shaped ledger fails the run rather than being overwritten
  const j = JSON.parse(text);
  if (!j || typeof j !== "object" || Array.isArray(j) || !j.tokens || typeof j.tokens !== "object" || Array.isArray(j.tokens))
    throw new Error("flows-ledger.json is not a flows ledger — refusing to overwrite it");
  return j;
}

async function main() {
  const registry = checkRegistry(JSON.parse(await readFile(join(HERE, "rwa-registry.json"), "utf8")));
  const before = await loadLedger(LEDGER);
  const r = await runFlows({
    ledger: before,
    tokens: registryTokens(registry, "ethereum"),
    portal: { fetchMintsBurns, finalizedHead, blockAt },
    prices: (addresses) => fetchPrices(addresses),
  });
  console.log(`flows: ${(r.bytes / 1e6).toFixed(2)} MB from SQD Portal this run · ledger as of ${r.ledger.asOf}`);
  const text = JSON.stringify(r.ledger);
  if (text === JSON.stringify(before)) return console.log("flows: ledger unchanged");
  await mkdir(dirname(LEDGER), { recursive: true });
  // a temp file, then rename: a job killed mid-write never leaves half a ledger
  await writeFile(LEDGER + ".tmp", text + "\n");
  await rename(LEDGER + ".tmp", LEDGER);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
