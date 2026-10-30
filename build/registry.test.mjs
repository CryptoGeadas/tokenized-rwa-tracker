// Tests for the registry check and its build warnings. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRegistry, registryWarnings, registryLog } from "./registry.mjs";
import { runPipeline } from "./pipeline.mjs";

const entry = (over = {}) => ({
  name: "Fund", issuer: "Issuer", backing_type: "government-debt", trust_tier: 1, lane: "main",
  one_liner: "Holds T-bills.", chains: ["ethereum"], mislabel: false, wrapper: "regulated-fund", ...over,
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

// ── insurance type and wrapper rule (#14) ───────────────────────────────────
const wrapper = (holds, trust_tier = 2) => entry({ wrapper: "token-wrapper", holds, trust_tier, one_liner: "Vault holding other RWA tokens." });

test("insurance is an allowed backing type; an unknown type still fails", () => {
  assert.doesNotThrow(() => checkRegistry({ onre: entry({ backing_type: "insurance", trust_tier: 3 }) }));
  assert.throws(() => checkRegistry({ x: entry({ backing_type: "reinsurance" }) }), /backing_type "reinsurance"/);
});

test("a wrapper needs a holds list, and holds is only for wrappers", () => {
  assert.throws(() => checkRegistry({ vault: entry({ wrapper: "token-wrapper" }) }), /vault.*holds/);
  assert.throws(() => checkRegistry({ vault: wrapper([]) }), /vault.*holds/);
  assert.throws(() => checkRegistry({ fund: entry({ holds: ["blackrock-buidl"] }) }), /fund.*holds.*token-wrapper/);
});

test("a holds item written as a slug must exist in the registry; a plain name is allowed", () => {
  assert.throws(() => checkRegistry({ vault: wrapper(["no-such-fund"]) }), /vault.*holds "no-such-fund"/);
  assert.doesNotThrow(() => checkRegistry({ buidl: entry(), vault: wrapper(["buidl", "Janus Henderson JAAA"]) }));
});

test("a wrapper's tier can't be better than the worst registry fund it holds", () => {
  const reg = (tier) => ({ buidl: entry({ trust_tier: 1 }), maple: entry({ trust_tier: 2 }), vault: wrapper(["buidl", "maple"], tier) });
  assert.throws(() => checkRegistry(reg(1)), /vault.*trust_tier 1.*better than.*maple.*2/);
  assert.doesNotThrow(() => checkRegistry(reg(2)));
  assert.doesNotThrow(() => checkRegistry(reg(3)));
});

test("a wrapper holding only outside funds passes on the registry side", () => {
  assert.doesNotThrow(() => checkRegistry({ vault: wrapper(["Some Offchain Fund"], 1) }));
});

test("the page gets a wrapper's holdings with registry names resolved", () => {
  const reg = checkRegistry({ buidl: entry({ name: "BlackRock BUIDL" }), vault: wrapper(["buidl", "Janus Henderson JAAA"]) });
  const out = runPipeline(reg, [], [{ slug: "buidl", category: "RWA", tvl: 9e8 }, { slug: "vault", category: "RWA", tvl: 9e7 }]);
  assert.deepEqual(out.mainStage.find((f) => f.slug === "vault").holds, [{ slug: "buidl", name: "BlackRock BUIDL" }, { name: "Janus Henderson JAAA" }]);
  assert.equal(out.mainStage.find((f) => f.slug === "buidl").holds, undefined);
});

test("an unrated wrapper in a secondary lane is not flagged by the tier rule", () => {
  assert.doesNotThrow(() => checkRegistry({ buidl: entry({ lane: "real-estate", backing_type: "real-estate", trust_tier: 2 }), vault: entry({ lane: "real-estate", backing_type: "real-estate", trust_tier: null, wrapper: "token-wrapper", holds: ["buidl"] }) }));
});

test("a registry fund spelled as a name or in other case can't dodge the tier rule", () => {
  const reg = (h) => ({ buidl: entry({ name: "BlackRock BUIDL", trust_tier: 2 }), vault: wrapper([h], 1) });
  for (const h of ["BUIDL", "BlackRock BUIDL", "blackrock buidl"]) assert.throws(() => checkRegistry(reg(h)), /vault.*registry fund "buidl".*slug/, h);
});

test("a rated wrapper can't hold an unrated registry fund", () => {
  const reg = { realt: entry({ lane: "real-estate", backing_type: "real-estate", trust_tier: null }), vault: entry({ backing_type: "real-estate", wrapper: "token-wrapper", holds: ["realt"], trust_tier: 1 }) };
  assert.throws(() => checkRegistry(reg), /vault.*not rated/);
});

test("the wrapper field must be a known value; bad holds items fail", () => {
  assert.throws(() => checkRegistry({ x: entry({ wrapper: "token-wraper" }) }), /x.*wrapper "token-wraper"/);
  for (const holds of [[""], ["  "], [1], [" buidl"], ["buidl", "buidl"], ["vault"]])
    assert.throws(() => checkRegistry({ buidl: entry(), vault: wrapper(holds) }), /vault/, JSON.stringify(holds));
});

test("a wrapper is typed by what it holds: one shared type, or mixed/other for a mix", () => {
  const base = { buidl: entry({ trust_tier: 1 }), maple: entry({ backing_type: "private-credit", trust_tier: 2 }) };
  assert.throws(() => checkRegistry({ ...base, vault: { ...wrapper(["buidl"], 2), backing_type: "private-credit" } }), /vault.*expected "government-debt"/);
  assert.throws(() => checkRegistry({ ...base, vault: wrapper(["buidl", "maple"], 2) }), /vault.*expected "mixed\/other"/);
  assert.doesNotThrow(() => checkRegistry({ ...base, vault: { ...wrapper(["buidl", "maple"], 2), backing_type: "mixed/other" } }));
});

test("entry order doesn't matter: a wrapper may come before the fund it holds", () => {
  assert.doesNotThrow(() => checkRegistry({ vault: wrapper(["buidl"], 2), buidl: entry({ trust_tier: 2 }) }));
  assert.throws(() => checkRegistry({ vault: wrapper(["buidl"], 1), buidl: entry({ trust_tier: 2 }) }), /better than/);
});

test("tvl_source must name a CoinGecko category", () => {
  assert.doesNotThrow(() => checkRegistry({ x: entry({ tvl_source: { coingecko_category: "ondo-tokenized-assets" } }) }));
  for (const bad of ["ondo", {}, { coingecko_category: "" }, { coingecko: "x" }, { coingecko_category: "x", extra: 1 }])
    assert.throws(() => checkRegistry({ x: entry({ tvl_source: bad }) }), /x.*tvl_source/, JSON.stringify(bad));
});

test("tokens: a list of { chain, address, decimals, symbol } loads (#21)", () => {
  const tokens = [{ chain: "ethereum", address: "0x7712c34205737192402172409a8F7ccef8aA2AEc", decimals: 6, symbol: "BUIDL" }];
  assert.deepEqual(checkRegistry({ x: entry({ tokens }) }).x.tokens, tokens);
  for (const bad of [{}, [], "0xabc", [{ chain: "ethereum", address: "0x12", decimals: 6, symbol: "A" }], [{ chain: "ethereum", address: tokens[0].address, symbol: "A" }], [{ ...tokens[0], extra: 1 }]])
    assert.throws(() => checkRegistry({ x: entry({ tokens: bad }) }), /x.*tokens/, JSON.stringify(bad));
});
