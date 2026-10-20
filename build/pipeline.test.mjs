// Tests for the classification step. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "./pipeline.mjs";

const proto = (slug, tvl) => ({ slug, name: slug.toUpperCase(), category: "RWA", tvl });
const fund = (over = {}) => ({ name: "F", issuer: "I", backing_type: "government-debt", trust_tier: 1, lane: "main", one_liner: "x", ...over });

test("an unreviewed fund at exactly $50M is in review; just under $50M it is a smaller fund", () => {
  const out = runPipeline({}, [], [proto("at-line", 50_000_000), proto("under-line", 49_999_999)]);
  assert.deepEqual(out.unclassified.map((f) => f.slug), ["at-line"]);
  assert.deepEqual(out.smaller.map((f) => f.slug), ["under-line"]);
});

test("a registry fund under $5M is dropped (build logs it); at exactly $5M it is classified", () => {
  const reg = { "at-floor": fund({ name: "At floor" }), "under-floor": fund({ name: "Under floor" }), "dead": fund({ name: "Dead" }) };
  const out = runPipeline(reg, [], [proto("at-floor", 5_000_000), proto("under-floor", 4_999_999), proto("dead", 0)]);
  assert.deepEqual(out.mainStage.map((f) => f.slug), ["at-floor"]);
  assert.deepEqual(out.dropped.map((f) => f.slug).sort(), ["dead", "under-floor"]);
});

test("coverage: funds over $50M, how many are classified, and the classified share of RWA TVL", () => {
  const reg = { big: fund(), mid: fund({ lane: "real-estate", backing_type: "real-estate" }), small: fund() };
  const protocols = [proto("big", 300e6), proto("mid", 60e6), proto("small", 10e6), proto("new-big", 100e6), proto("new-small", 30e6)];
  const { stats } = runPipeline(reg, [], protocols);
  assert.equal(stats.coverage.overLine, 3, "big, mid, new-big");
  assert.equal(stats.coverage.classifiedOverLine, 2);
  assert.equal(stats.coverage.classifiedTvlShare, 370 / 500);
  assert.equal(stats.unclassifiedCount, 1, "kept for the website ticker: the in-review count");
});

test("the website ticker count ignores smaller unreviewed funds", () => {
  const { stats, smaller } = runPipeline({}, [], [proto("a", 20e6), proto("b", 8e6)]);
  assert.equal(smaller.length, 2);
  assert.equal(stats.unclassifiedCount, 0);
  assert.equal(stats.coverage.overLine, 0);
});

const pool = (project, tvlUsd) => ({ project, chain: "Ethereum", symbol: "X", tvlUsd, apyBase: 4 });

test("the $5M and $50M rules use pool TVL when DefiLlama has pools, protocol TVL only as a fallback", () => {
  const out = runPipeline({ "reg-fund": fund() }, [pool("new-fund", 30e6), pool("new-fund", 30e6), pool("reg-fund", 4e6)],
    [proto("new-fund", 40e6), proto("reg-fund", 100e6)]);
  assert.deepEqual(out.unclassified.map((f) => f.slug), ["new-fund"], "pools sum to $60M although the protocol says $40M");
  assert.deepEqual(out.dropped.map((f) => f.slug), ["reg-fund"], "pools sum to $4M although the protocol says $100M");
});

test("a registry fund's pool slug that DefiLlama also lists as an RWA protocol is not put in review", () => {
  const reg = { "fund-a": fund({ pool_projects: ["fund-a-pool"] }) };
  const out = runPipeline(reg, [pool("fund-a-pool", 100e6)], [proto("fund-a-pool", 100e6)]);
  assert.deepEqual(out.unclassified, []);
  assert.equal(out.stats.coverage.overLine, 1);
  assert.equal(out.stats.coverage.classifiedTvlShare, 1);
});

test("dropped funds, unreviewed funds under $5M and non-RWA protocols stay out of every list and of coverage", () => {
  const reg = { big: fund(), dead: fund() };
  const protocols = [proto("big", 100e6), proto("dead", 1e6), proto("tiny", 4_999_999), { ...proto("lender", 900e6), category: "Lending" }];
  const out = runPipeline(reg, [], protocols);
  assert.deepEqual([out.unclassified.length, out.smaller.length], [0, 0]);
  assert.deepEqual(out.stats.coverage, { overLine: 1, classifiedOverLine: 1, classifiedTvlShare: 1 });
});

test("a classified fund at exactly $50M counts as over the line; with 2 in review the ticker count is 2", () => {
  const out = runPipeline({ edge: fund() }, [], [proto("edge", 50e6), proto("n1", 80e6), proto("n2", 60e6)]);
  assert.equal(out.stats.coverage.classifiedOverLine, 1);
  assert.equal(out.stats.unclassifiedCount, out.unclassified.length);
  assert.equal(out.stats.unclassifiedCount, 2);
});

test("no TVL at all → the TVL share is unknown (null), not 0%", () => {
  assert.equal(runPipeline({}, [], []).stats.coverage.classifiedTvlShare, null);
});

test("a registry fund DefiLlama no longer lists is dropped with its own reason, not as 'under $5M'", () => {
  const out = runPipeline({ gone: fund(), shrank: fund() }, [], [proto("shrank", 1e6)]);
  const why = Object.fromEntries(out.dropped.map((f) => [f.slug, f.reason]));
  assert.deepEqual(why, { gone: "not found on DefiLlama", shrank: "under $5M" });
});

// ── fallback TVL (#20) ──────────────────────────────────────────────────────
test("a fund with no DefiLlama TVL takes its fallback TVL, marked with the source", () => {
  const reg = { ogm: fund({ lane: "equity", backing_type: "equity", trust_tier: null, tvl_source: { coingecko_category: "ondo-tokenized-assets" } }) };
  const out = runPipeline(reg, [], [{ slug: "ogm", category: "RWA", tvl: null }], { ogm: 1.04e9 });
  const f = out.secondaryLanes.equity[0];
  assert.equal(f.tvl, 1.04e9);
  assert.equal(f.tvlSource, "coingecko");
  assert.deepEqual(out.dropped, []);
});

test("DefiLlama TVL always wins over the fallback", () => {
  const reg = { a: fund({ tvl_source: { coingecko_category: "x" } }) };
  const fromPools = runPipeline(reg, [pool("a", 70e6)], [proto("a", null)], { a: 9e9 }).mainStage[0];
  assert.deepEqual([fromPools.tvl, fromPools.tvlSource], [70e6, "defillama"]);
  assert.equal(runPipeline(reg, [], [proto("a", 80e6)], { a: 9e9 }).mainStage[0].tvl, 80e6);
});

test("no fallback number (CoinGecko failed or lacks the category) → dropped as 'no TVL on DefiLlama'", () => {
  const reg = { a: fund({ tvl_source: { coingecko_category: "x" } }) };
  for (const fallback of [{}, undefined, { a: 0 }, { a: null }]) {
    const out = runPipeline(reg, [], [proto("a", null)], fallback);
    assert.deepEqual(out.dropped.map((d) => d.reason), ["no TVL on DefiLlama"], JSON.stringify(fallback));
  }
});
