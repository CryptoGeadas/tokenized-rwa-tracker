// The build's read of the flows ledger (written once a day by flows-run.mjs, #21).
// It never fails the build: a missing, unreadable or wrong-shaped ledger returns null, so
// every tracked fund reads "unavailable" (flows.mjs fundFlows) — never a made-up state.
import { readFile } from "node:fs/promises";

export async function loadLedgerForBuild(path, log = console) {
  try {
    const j = JSON.parse(await readFile(path, "utf8"));
    const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
    if (!isObj(j) || !isObj(j.tokens) || !isObj(j.chains)) throw new Error("not a flows ledger");
    return j;
  } catch (e) {
    log.warn(`  ⚠ flows-ledger.json ${e.code === "ENOENT" ? "missing" : `unreadable (${e.message})`} — tracked funds show flows unavailable`);
    return null;
  }
}
