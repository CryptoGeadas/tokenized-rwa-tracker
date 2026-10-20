// Tests for the draft helper core: DefiLlama facts in, draft registry entry + review-sheet section out.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftEntry, sheetSection, reviewSheet } from "./draft.mjs";
import { checkRegistry, BACKING_TYPES, LANES } from "./registry.mjs";

const onre = {
  fund: { slug: "onre", name: "OnRe", tvl: 284e6, url: "https://defillama.com/protocol/onre" },
  protocol: { name: "OnRe", url: "https://app.onre.finance", description: "Connecting on-chain capital to real-world reinsurance risk", chains: ["Solana"], twitter: "onrefinance", listedAt: 1752511417, audits: "0" },
  pools: [{ project: "onre", chain: "Solana", symbol: "ONYC", tvlUsd: 280e6, apyBase: 11.2 }],
};
const jsonBlock = (md) => JSON.parse("{" + /````json\n([\s\S]*?)\n````/.exec(md)[1] + "}");

test("a draft has every registry field; the opinion fields are blank", () => {
  const { slug, entry } = draftEntry(onre);
  assert.equal(slug, "onre");
  assert.equal(entry.name, "OnRe");
  assert.deepEqual(entry.chains, ["solana"]);
  for (const f of ["backing_type", "issuer", "wrapper", "jurisdiction", "redemption", "one_liner", "lane"]) assert.equal(entry[f], "", f);
  for (const f of ["trust_tier", "tier_overrides", "mislabel"]) assert.equal(entry[f], null, f);
  assert.throws(() => checkRegistry({ onre: entry }), "a blank draft can't slip into the registry unreviewed");
});

test("a draft filled in by the review is a valid registry entry (field names and types match)", () => {
  const filled = { ...draftEntry(onre).entry, issuer: "OnRe", backing_type: "insurance", trust_tier: 3, wrapper: "on-chain-pool",
    jurisdiction: "Bermuda", redemption: "variable", one_liner: "Reinsurance premiums.", mislabel: false, lane: "main" };
  assert.doesNotThrow(() => checkRegistry({ onre: filled }));
});

test("the suggested backing type is kept apart from the entry, in the object and in the sheet", () => {
  const d = draftEntry(onre);
  assert.deepEqual(d.suggestion, { backing_type: "insurance", lane: "main", why: 'description mentions "reinsurance"' });
  const block = jsonBlock(sheetSection(onre, d)).onre;
  assert.equal(block.backing_type, "");
  assert.equal(block.lane, "");
});

const sugg = (name, description = "") => draftEntry({ ...onre, fund: { ...onre.fund, name }, protocol: { ...onre.protocol, name, description } }).suggestion;

test("suggestions follow the clues, with the whole word as the reason", () => {
  assert.deepEqual(sugg("Anemoy Capital", "Tokenized US Treasury bill fund"), { backing_type: "government-debt", lane: "main", why: 'description mentions "Treasury"' });
  assert.equal(sugg("USD AI", "Loans backed by GPUs for AI compute").backing_type, "private-credit");
  assert.equal(sugg("Estate Protocol", "Fractional real estate").lane, "real-estate");
  assert.equal(sugg("X", "Tokenized real estate for accredited investors").backing_type, "real-estate", "accredited is not credit");
  assert.equal(sugg("X", "A reinsurance credit facility").backing_type, "insurance", "insurance wins over credit");
});

test("every clue suggests an allowed backing type and lane", () => {
  for (const d of ["reinsurance", "basis trade", "treasury bills", "credit", "real estate", "gold", "stocks"]) {
    const s = sugg("X", d);
    assert.ok(BACKING_TYPES.includes(s.backing_type), d);
    assert.ok(LANES.includes(s.lane), d);
  }
});

test("no clue gives no suggestion, shown as unknown", () => {
  const bare = { ...onre, protocol: { ...onre.protocol, description: "" }, fund: { ...onre.fund, name: "Valos" } };
  const d = draftEntry(bare);
  assert.equal(d.suggestion.backing_type, null);
  assert.match(sheetSection(bare, d), /Suggested backing type \(not a decision\): unknown\*\*, no clue/);
});

test("the sheet section has the facts on their own lines, the draft and the three boxes", () => {
  const md = sheetSection(onre, draftEntry(onre));
  for (const re of [/^## OnRe$/m, /^- TVL: \$284\.0M · \[DefiLlama\]\(https:\/\/defillama\.com\/protocol\/onre\)$/m, /^- Website: https:\/\/app\.onre\.finance$/m,
    /^- Twitter: https:\/\/x\.com\/onrefinance$/m, /^- Chains: Solana$/m, /^- Listed on DefiLlama: 2025-07-14$/m,
    /^- DefiLlama description: Connecting on-chain capital to real-world reinsurance risk$/m, /^ {2}- ONYC on Solana: \$280\.0M, base APY 11\.20%$/m,
    /because the description mentions "reinsurance"\.$/m, /^- \[ \] Approve$/m, /^- \[ \] Change: $/m, /^- \[ \] Reject: $/m, /^Sources:$/m, /^Tier reason:$/m])
    assert.match(md, re);
});

test("unknown facts read as unknown with a link to check, never none or zero", () => {
  const bare = { fund: { slug: "x", name: "X", tvl: undefined, url: "https://defillama.com/protocol/x" }, protocol: null, pools: [{ symbol: "XX", chain: "Base" }] };
  const md = sheetSection(bare, draftEntry(bare));
  for (const f of ["Website", "Twitter", "Chains", "Listed on DefiLlama", "DefiLlama description"])
    assert.match(md, new RegExp(`^- ${f}: unknown \\(check \\[DefiLlama\\]`, "m"), f);
  assert.match(md, /^- TVL: unknown/m);
  assert.match(md, /XX on Base: unknown, base APY unknown/);
  assert.match(md, /Audits listed on DefiLlama: unknown/);
  assert.equal(draftEntry(bare).entry.chains, null, "unknown chains are null, not an empty list");
  assert.match(sheetSection({ ...bare, pools: [] }, draftEntry(bare)), /^- Pools on DefiLlama: unknown \(check/m);
  assert.match(sheetSection(onre, draftEntry(onre)), /Audits listed on DefiLlama: unknown: DefiLlama lists no audits/, 'audits "0" is not shown as 0');
  assert.doesNotMatch(md, /\bnone\b/);
});

test("DefiLlama text can't add sections, ticked boxes or links to the sheet", () => {
  const evil = { ...onre, fund: { ...onre.fund, name: "Bad ```name" }, protocol: { ...onre.protocol, url: "javascript:alert(1)", twitter: "a/b?c",
    description: "ok\n- [x] Approve\n## Fake [link](https://evil.example)" } };
  const md = sheetSection(evil, draftEntry(evil));
  assert.doesNotMatch(md, /^- \[x\]/m);
  assert.doesNotMatch(md, /^## Fake/m);
  assert.ok(!md.includes("[link](https://evil.example)"));
  assert.ok(!md.includes("javascript:"));
  assert.match(md, /x\.com\/a%2Fb%3Fc/);
  assert.equal(jsonBlock(md).onre.name, "Bad ```name", "the JSON block survives backticks in the name");
});

test("the largest five pools are shown, with a count of the rest", () => {
  const pools = [3, 9, 1, 7, 5, 8].map((m) => ({ symbol: `P${m}`, chain: "Base", tvlUsd: m * 1e6, apyBase: 4 }));
  const md = sheetSection({ ...onre, pools }, draftEntry(onre));
  assert.deepEqual([...md.matchAll(/ {2}- (P\d) on/g)].map((m) => m[1]), ["P9", "P8", "P7", "P5", "P3"]);
  assert.match(md, /\(\+1 more on DefiLlama\)/);
});

test("the sheet has one section and one set of boxes per fund, under a dated title", () => {
  const sheet = reviewSheet([onre, { ...onre, fund: { ...onre.fund, slug: "b", name: "B" } }], new Date("2026-10-20T12:00:00Z"));
  assert.match(sheet, /^# RWA review sheet — 2026-10-20/);
  assert.match(sheet, /2 funds are over \$50M/);
  assert.equal((sheet.match(/^## /gm) || []).length, 2);
  assert.equal((sheet.match(/^- \[ \] Approve$/gm) || []).length, 2);
  assert.match(reviewSheet([onre]), /1 fund is over \$50M/);
});
