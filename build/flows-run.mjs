// ─────────────────────────────────────────────────────────────────────────────
// FLOWS JOB CLI (#21) — runs once a day in its own GitHub Action (flows.yml), never inside
// the refresh, so a slow or busy SQD Portal can't hold up the main snapshot.
// Reads the registry's tokens and the ledger (build/state/flows-ledger.json), runs the job
// (flows-job.mjs) and saves the ledger only when it changed. The next refresh puts the
// ledger's numbers on the page.
//
// A Portal failure (busy, down, bad answer) is a WARNING, not a failed run (#26): what was read
// before the failure is saved (#46; the file is untouched when nothing was read), the page shows
// its "As of" date, and the next daily run reads on from there. It fails the run (so GitHub
// emails) only once flows have not updated for over 72 h (before the first complete read:
// 72 h since the chain was first tried). Any other error is ours
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
  let saved = JSON.stringify(before);
  const save = async (ledger) => {
    const text = JSON.stringify(ledger);
    if (text === saved) return false; // nothing read: the file is left exactly as it was
    await mkdir(dirname(ledgerPath), { recursive: true });
    // a temp file, then rename: a job killed mid-write never leaves half a ledger
    await writeFile(ledgerPath + ".tmp", text + "\n");
    await rename(ledgerPath + ".tmp", ledgerPath);
    saved = text;
    return true;
  };
  // A chain with no complete read yet has no update stamp to age from: record when it was first
  // tried, so the 72 h rule can still turn the run red (#46).
  const stamped = (ledger) => {
    const info = ledger.chains?.[CHAIN];
    if (info?.updatedAt != null || info?.firstTriedAt != null) return ledger;
    return { ...ledger, chains: { ...ledger.chains, [CHAIN]: { ...info, firstTriedAt: new Date(now).toISOString() } } };
  };
  let r;
  try {
    r = await runFlows({ ledger: before, tokens: registryTokens(registry, CHAIN), portal, prices, supplies, now, log });
  } catch (e) {
    if (!e.fromPortal) throw e;
    // What the job read before the failure is kept (e.ledger), so the next run reads on from there.
    const kept = stamped(e.ledger ?? before);
    await save(kept);
    const mb = ((e.partial?.bytes ?? 0) / 1e6).toFixed(2);
    const what = e.ledger ? `kept up to block ${kept.chains[CHAIN].lastBlock}` : "nothing new kept";
    // …but a failure that has lasted over 72 h is an outage, not a bad day: fail the run so GitHub emails.
    if (ageMs(kept, now) > LATE_MS)
      throw new Error(`flows have not updated for over 72 h: ${e.message} (${mb} MB read this run, ${what}) — check the SQD Portal`);
    // GitHub reads "::warning::" from standard output and shows it on the run page; the run stays green
    log.log(`::warning::flows not updated: ${e.message} — ${mb} MB read this run, ${what}; the next run reads on from ${Number.isInteger(kept.chains[CHAIN].lastBlock) ? `block ${kept.chains[CHAIN].lastBlock + 1}` : "the start"}`);
    return 0;
  }
  log.log(`flows: ${(r.bytes / 1e6).toFixed(2)} MB from SQD Portal this run · ledger as of ${r.ledger.asOf}`);
  const after = r.ledger === before ? before : stamped(r.ledger);
  if (!(await save(after))) log.log("flows: ledger unchanged");
  // A read that keeps stopping before the head, or a finalized head that stops moving, throws
  // nothing: what was read is saved above, but over 72 h without a full update fails the run so
  // GitHub emails (#32).
  if (ageMs(after, now) > LATE_MS)
    throw new Error("flows have not updated for over 72 h: the read did not reach the Portal's finalized head — check the SQD Portal");
  return 0;
}

// Time since the chain's last complete read; before the first one, since it was first tried.
// A ledger with neither has no age (an untouched empty ledger never fails the run by itself).
const CHAIN = "ethereum";
function ageMs(ledger, now) {
  const info = ledger.chains?.[CHAIN];
  const at = Date.parse(info?.updatedAt ?? info?.firstTriedAt ?? "");
  return Number.isFinite(at) ? now - at : NaN;
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
