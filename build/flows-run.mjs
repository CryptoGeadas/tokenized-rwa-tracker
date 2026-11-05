// ─────────────────────────────────────────────────────────────────────────────
// FLOWS JOB CLI (#21) — runs once a day in its own GitHub Action (flows.yml), never inside
// the refresh, so a slow or busy SQD Portal can't hold up the main snapshot.
// Reads the registry's tokens and the ledger (build/state/flows-ledger.json), runs the job
// (flows-job.mjs) and saves the ledger only when it changed. The next refresh puts the
// ledger's numbers on the page.
//
// A Portal failure (busy, down, bad answer) is a WARNING, not a failed run (#26): the ledger
// file is left exactly as it was, the page shows its "As of" date, and the next daily run
// reads on from the same block. It fails the run (so GitHub emails) only once flows have not
// updated for over 72 h, or on a first run that has nothing to keep. Any other error is ours
// (a broken ledger, a bug) and fails the run so it is seen.
//
//   runFlowsFile({ registryPath, ledgerPath, portal, prices, supplies?, now?, log? }) → exit code 0
// ─────────────────────────────────────────────────────────────────────────────
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { checkRegistry } from "./registry.mjs";
import { fetchMintsBurns, finalizedHead, blockAt } from "./portal.mjs";
import { emptyLedger } from "./flows.mjs";
import { runFlows, fetchPrices, fetchSupplies, registryTokens } from "./flows-job.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const LATE_MS = 72 * 3_600_000;
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);

async function loadLedger(path) {
  let text;
  try { text = await readFile(path, "utf8"); }
  catch (e) { if (e.code === "ENOENT") return emptyLedger(); throw e; }
  // a broken or wrong-shaped ledger fails the run rather than being overwritten
  const j = JSON.parse(text);
  if (!isObj(j) || !isObj(j.tokens) || !isObj(j.chains))
    throw new Error("flows-ledger.json is not a flows ledger — refusing to overwrite it");
  return j;
}

export async function runFlowsFile({ registryPath, ledgerPath, portal, prices, supplies, now = Date.now(), log = console }) {
  const registry = checkRegistry(JSON.parse(await readFile(registryPath, "utf8")));
  const before = await loadLedger(ledgerPath);
  let r;
  try {
    r = await runFlows({ ledger: before, tokens: registryTokens(registry, "ethereum"), portal, prices, supplies, now, log });
  } catch (e) {
    if (!e.fromPortal) throw e;
    const mb = ((e.partial?.bytes ?? 0) / 1e6).toFixed(2);
    // …but a failure that has lasted over 72 h (or a first run with nothing to keep) is an
    // outage, not a bad day: fail the run so GitHub emails. The ledger stays unchanged either way.
    const at = Date.parse(before.chains?.ethereum?.updatedAt ?? "");
    if (!Number.isFinite(at) || now - at > LATE_MS)
      throw new Error(`flows have not updated ${Number.isFinite(at) ? "for over 72 h" : "since the first run"}: ${e.message} (${mb} MB read this run, discarded) — check the SQD Portal`);
    // GitHub reads "::warning::" from standard output and shows it on the run page; the run stays green
    log.log(`::warning::flows not updated: ${e.message} — ${mb} MB read this run, discarded; the ledger is unchanged and the next run reads on from block ${before.chains.ethereum.lastBlock}`);
    return 0;
  }
  log.log(`flows: ${(r.bytes / 1e6).toFixed(2)} MB from SQD Portal this run · ledger as of ${r.ledger.asOf}`);
  const text = JSON.stringify(r.ledger);
  if (text === JSON.stringify(before)) { log.log("flows: ledger unchanged"); return 0; }
  await mkdir(dirname(ledgerPath), { recursive: true });
  // a temp file, then rename: a job killed mid-write never leaves half a ledger
  await writeFile(ledgerPath + ".tmp", text + "\n");
  await rename(ledgerPath + ".tmp", ledgerPath);
  return 0;
}

// run as a script (not when imported by tests)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFlowsFile({
    registryPath: join(HERE, "rwa-registry.json"),
    ledgerPath: join(HERE, "state", "flows-ledger.json"),
    portal: { fetchMintsBurns, finalizedHead, blockAt },
    prices: (addresses) => fetchPrices(addresses),
    supplies: (tokens) => fetchSupplies(tokens),
  }).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
