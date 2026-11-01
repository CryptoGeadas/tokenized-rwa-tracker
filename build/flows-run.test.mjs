// Tests for the flows job CLI (flows-run.mjs) and the build's ledger read (flows-file.mjs),
// on temporary files with a fake Portal. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFlowsFile } from "./flows-run.mjs";
import { loadLedgerForBuild } from "./flows-file.mjs";
import { PortalError } from "./portal.mjs";
import { emptyLedger, addFlows } from "./flows.mjs";

const A = "0x00000000000000000000000000000000000000aa";
const NOW = Date.parse("2026-10-31T04:40:00Z");
const registry = { f: { name: "F", issuer: "I", backing_type: "government-debt", trust_tier: 1, lane: "main", one_liner: "x", chains: ["ethereum"],
  mislabel: false, wrapper: "regulated-fund", tokens: [{ chain: "ethereum", address: A, decimals: 6, symbol: "AAA" }] } };
const ledger = addFlows(emptyLedger(), { chain: "ethereum", events: [], lastBlock: 1000, today: "2026-10-29", tracked: [{ address: A, decimals: 6, symbol: "AAA" }], prices: {}, backfill: true, updatedAt: "2026-10-30T04:40:00Z" });
const logs = () => { const out = []; return { out, log: (l) => out.push(l), warn: (l) => out.push(l), error: (l) => out.push(l) }; };

async function files(ledgerText) {
  const dir = await mkdtemp(join(tmpdir(), "rwa-flows-"));
  const registryPath = join(dir, "rwa-registry.json"), ledgerPath = join(dir, "flows-ledger.json");
  await writeFile(registryPath, JSON.stringify(registry));
  if (ledgerText != null) await writeFile(ledgerPath, ledgerText);
  return { dir, registryPath, ledgerPath };
}
const portalThat = (fail) => ({
  finalizedHead: async () => 2000,
  blockAt: async () => 100,
  fetchMintsBurns: async () => { throw fail; },
});

test("a Portal failure leaves the ledger file byte-for-byte unchanged and the run ends green with a warning naming the reason", async () => {
  const text = JSON.stringify(ledger) + "\n";
  const f = await files(text);
  const log = logs();
  const code = await runFlowsFile({ ...f, portal: portalThat(new PortalError(529, "overloaded", "busy")), prices: async () => ({}), now: NOW, log });
  assert.equal(code, 0);
  assert.equal(await readFile(f.ledgerPath, "utf8"), text);
  assert.ok(log.out.some((l) => /^::warning::flows not updated: SQD Portal 529 overloaded: busy/.test(l)), log.out.join("\n"));
  await rm(f.dir, { recursive: true });
});

test("a Portal failure on the finalized head is also a warning, not a red run", async () => {
  const f = await files(JSON.stringify(ledger));
  const portal = { ...portalThat(null), finalizedHead: async () => { throw new PortalError(0, "network_error", "fetch failed"); } };
  const log = logs();
  assert.equal(await runFlowsFile({ ...f, portal, prices: async () => ({}), now: NOW, log }), 0);
  assert.ok(log.out.some((l) => /::warning::flows not updated: .*network_error/.test(l)));
  await rm(f.dir, { recursive: true });
});

test("our own error is not hidden: a broken ledger fails the run and is not overwritten", async () => {
  const f = await files("{ not json");
  await assert.rejects(runFlowsFile({ ...f, portal: portalThat(null), prices: async () => ({}), now: NOW, log: logs() }));
  assert.equal(await readFile(f.ledgerPath, "utf8"), "{ not json");
  await rm(f.dir, { recursive: true });
});

test("a good run saves the ledger and logs the MB used", async () => {
  const f = await files(JSON.stringify(ledger));
  const portal = { ...portalThat(null), fetchMintsBurns: async (q) => ({ events: [], lastBlock: q.toBlock, lastTimestamp: NOW / 1000 - 3600, bytes: 1_250_000 }) };
  const log = logs();
  assert.equal(await runFlowsFile({ ...f, portal, prices: async () => ({}), now: NOW, log }), 0);
  assert.equal(JSON.parse(await readFile(f.ledgerPath, "utf8")).chains.ethereum.lastBlock, 2000);
  assert.ok(log.out.some((l) => /1\.25 MB from SQD Portal this run/.test(l)), log.out.join("\n"));
  await rm(f.dir, { recursive: true });
});

test("the build's read: a missing or broken ledger is null with a warning, never an error", async () => {
  const f = await files(null);
  const log = logs();
  assert.equal(await loadLedgerForBuild(f.ledgerPath, log), null);
  assert.match(log.out[0], /missing/);
  for (const bad of ["{ not json", "[]", '{"tokens":[]}', '{"chains":{}}']) {
    await writeFile(f.ledgerPath, bad);
    assert.equal(await loadLedgerForBuild(f.ledgerPath, logs()), null, bad);
  }
  await writeFile(f.ledgerPath, JSON.stringify(ledger));
  assert.deepEqual(await loadLedgerForBuild(f.ledgerPath, logs()), ledger);
  await rm(f.dir, { recursive: true });
});

test("an error inside the job that is not the Portal's fails the run and leaves the ledger untouched, with no warning", async () => {
  const text = JSON.stringify(ledger) + "\n";
  const f = await files(text);
  const portal = { ...portalThat(null), fetchMintsBurns: async (q) => ({ events: [], lastBlock: q.toBlock, lastTimestamp: NOW / 1000, bytes: 1 }) };
  const log = logs();
  await assert.rejects(runFlowsFile({ ...f, portal, prices: async () => { throw new TypeError("bug"); }, now: NOW, log }), /bug/);
  assert.equal(await readFile(f.ledgerPath, "utf8"), text);
  assert.ok(!log.out.some((l) => /::warning::/.test(l)));
  await rm(f.dir, { recursive: true });
});

test("a first run whose Portal call fails creates no ledger file and fails the run: there is nothing to keep", async () => {
  const f = await files(null);
  const portal = { ...portalThat(null), blockAt: async () => { throw new PortalError(503, "unavailable", "down"); } };
  await assert.rejects(runFlowsFile({ ...f, portal, prices: async () => ({}), now: NOW, log: logs() }), /since the first run.*503/);
  await assert.rejects(readFile(f.ledgerPath, "utf8"), { code: "ENOENT" });
  await rm(f.dir, { recursive: true });
});

test("a Portal failure after over 72 h without an update fails the run so GitHub emails; the ledger stays unchanged", async () => {
  const text = JSON.stringify(ledger); // updated 2026-10-30T04:40Z
  const f = await files(text);
  const fail = portalThat(new PortalError(529, "overloaded", "busy"));
  assert.equal(await runFlowsFile({ ...f, portal: fail, prices: async () => ({}), now: Date.parse("2026-11-02T04:00:00Z"), log: logs() }), 0, "71 h: still a warning");
  await assert.rejects(runFlowsFile({ ...f, portal: fail, prices: async () => ({}), now: Date.parse("2026-11-02T05:00:00Z"), log: logs() }), /over 72 h/);
  assert.equal(await readFile(f.ledgerPath, "utf8"), text);
  await rm(f.dir, { recursive: true });
});

test("the warning names the MB read before the failure", async () => {
  const f = await files(JSON.stringify(ledger));
  const e = Object.assign(new PortalError(529, "overloaded", "busy"), { partial: { bytes: 3_400_000 } });
  const log = logs();
  await runFlowsFile({ ...f, portal: portalThat(e), prices: async () => ({}), now: NOW, log });
  assert.ok(log.out.some((l) => /3\.40 MB read this run, discarded/.test(l)), log.out.join("\n"));
  await rm(f.dir, { recursive: true });
});

test("a ledger without chains is not a ledger: the job refuses it, the build reads it as unavailable", async () => {
  const f = await files('{"tokens":{}}');
  await assert.rejects(runFlowsFile({ ...f, portal: portalThat(null), prices: async () => ({}), now: NOW, log: logs() }), /not a flows ledger/);
  assert.equal(await loadLedgerForBuild(f.ledgerPath, logs()), null);
  await rm(f.dir, { recursive: true });
});

test("the build's read and the summary together: a broken ledger file gives tracked funds unavailable", async () => {
  const { withFlows } = await import("./flows.mjs");
  const f = await files("{ not json");
  const out = withFlows({ mainStage: [{ slug: "f" }], secondaryLanes: {} }, registry, await loadLedgerForBuild(f.ledgerPath, logs()), NOW);
  assert.deepEqual(out.mainStage[0].flows, { status: "unavailable" });
  await rm(f.dir, { recursive: true });
});
