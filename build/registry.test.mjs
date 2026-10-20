// Tests for the registry check and its build warnings. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRegistry, registryWarnings, registryLog } from "./registry.mjs";
import { runPipeline } from "./pipeline.mjs";

const entry = (over = {}) => ({
  name: "Fund", issuer: "Issuer", backing_type: "government-debt", trust_tier: 1, lane: "main",
  one_liner: "Holds T-bills.", chains: ["ethereum"], mislabel: false, ...over,
});

test("a valid registry loads, without its _comment", () => {
  const reg = checkRegistry({ _comment: "x", a: entry(), b: entry({ lane: "real-estate", backing_type: "real-estate", trust_tier: null }) });
  assert.deepEqual(Object.keys(reg), ["a", "b"]);
});

test("an unknown backing type fails the build, naming the entry", () => {
  assert.throws(() => checkRegistry({ fund_x: entry({ backing_type: "treasuries" }) }), /fund_x.*backing_type "treasuries"/);
});

test("a missing required field fails the build", () => {
  for (const f of ["name", "issuer", "backing_type", "lane", "one_liner", "chains", "mislabel"]) {
    const e = entry(); delete e[f];
    assert.throws(() => checkRegistry({ fund_x: e }), new RegExp(`fund_x.*${f}`), f);
  }
});

test("a bad lane fails the build", () => {
  assert.throws(() => checkRegistry({ fund_x: entry({ lane: "mian" }) }), /fund_x.*lane "mian"/);
});

test("a main-stage fund needs a trust tier 1-4; secondary lanes may leave it empty", () => {
  for (const t of [null, 0, 5, 2.5, "1"]) assert.throws(() => checkRegistry({ fund_x: entry({ trust_tier: t }) }), /fund_x.*trust_tier/, String(t));
  assert.throws(() => checkRegistry({ fund_x: entry({ lane: "equity", backing_type: "equity", trust_tier: 7 }) }), /fund_x.*trust_tier/);
  assert.doesNotThrow(() => checkRegistry({ fund_x: entry({ lane: "equity", backing_type: "equity", trust_tier: null }) }));
});

test("registry funds DefiLlama doesn't list, or lists with no TVL, become warnings; a healthy registry gives none", () => {
  const reg = { gone: entry({ name: "Gone" }), blank: entry({ name: "Blank" }), ok: entry({ name: "Ok" }) };
  const out = runPipeline(reg, [], [{ slug: "blank", category: "RWA", tvl: null }, { slug: "ok", category: "RWA", tvl: 9e6 }]);
  const w = registryWarnings(out.dropped);
  assert.equal(w.length, 2);
  assert.match(w.find((x) => /Gone/.test(x.text)).text, /not found on DefiLlama.*check its slug/);
  assert.match(w.find((x) => /Blank/.test(x.text)).text, /no TVL/);
  assert.deepEqual(registryWarnings(runPipeline({ ok: entry() }, [], [{ slug: "ok", category: "RWA", tvl: 9e6 }]).dropped), []);
});

test("a fund that only shrank under $5M is logged, not warned about", () => {
  const out = runPipeline({ small: entry() }, [], [{ slug: "small", category: "RWA", tvl: 1e6 }]);
  assert.deepEqual(registryWarnings(out.dropped), []);
});

test("registryLog: a log line per warning; the ::warning line only in CI", () => {
  const w = [{ id: "registry-slug", text: "Registry fund Gone [gone] not found on DefiLlama — check its slug" }];
  assert.deepEqual(registryLog(w, {}), ["  ⚠ Registry fund Gone [gone] not found on DefiLlama — check its slug"]);
  assert.deepEqual(registryLog(w, { GITHUB_ACTIONS: "true" }), [
    "  ⚠ Registry fund Gone [gone] not found on DefiLlama — check its slug",
    "::warning title=registry-slug::Registry fund Gone [gone] not found on DefiLlama — check its slug",
  ]);
  assert.equal(registryLog(w, { GITHUB_ACTIONS: "false" }).length, 1);
});

test("pool_projects must be a list of slugs, not a single string", () => {
  assert.throws(() => checkRegistry({ fund_x: entry({ pool_projects: "fund-x-pool" }) }), /fund_x.*pool_projects/);
  assert.throws(() => checkRegistry({ fund_x: entry({ pool_projects: [""] }) }), /pool_projects/);
  assert.doesNotThrow(() => checkRegistry({ fund_x: entry({ pool_projects: ["fund-x-pool"] }) }));
});

test("the real rwa-registry.json passes the check and has no duplicate slugs", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(new URL("./rwa-registry.json", import.meta.url), "utf8");
  const reg = checkRegistry(JSON.parse(text));
  const keys = [...text.matchAll(/^ {2}"([^"]+)":\s*\{/gm)].map((m) => m[1]);
  assert.equal(keys.length, Object.keys(reg).length, "a slug appears twice — JSON.parse would keep only the last");
});

test("an explicit $0 protocol TVL, or pools that all show $0, count as 'no TVL on DefiLlama'", () => {
  const out = runPipeline({ zero: entry(), pools0: entry() },
    [{ project: "pools0", chain: "Ethereum", symbol: "X", tvlUsd: 0, apyBase: 4 }],
    [{ slug: "zero", category: "RWA", tvl: 0 }]);
  assert.deepEqual(Object.fromEntries(out.dropped.map((f) => [f.slug, f.reason])), { zero: "no TVL on DefiLlama", pools0: "no TVL on DefiLlama" });
  assert.deepEqual(registryWarnings(out.dropped).map((w) => w.id), ["registry-tvl", "registry-tvl"]);
});

test("reserved slugs and unknown fields fail the build (a typo like trust_teir must not pass)", () => {
  assert.throws(() => checkRegistry(JSON.parse('{"__proto__": {"name": "x"}}')), /__proto__.*reserved/);
  assert.throws(() => checkRegistry({ constructor: entry() }), /reserved/);
  assert.throws(() => checkRegistry({ fund_x: entry({ lane: "equity", backing_type: "equity", trust_tier: undefined, trust_teir: 2 }) }), /fund_x.*unknown field.*trust_teir/);
  assert.equal(checkRegistry({ a: entry() }).toString, undefined, "no Object.prototype keys");
});

test("a dropped fund with an unknown reason still gives a warning", () => {
  assert.deepEqual(registryWarnings([{ slug: "x", name: "X", tvl: 0, reason: "something new" }]).map((w) => w.id), ["registry-dropped"]);
});
