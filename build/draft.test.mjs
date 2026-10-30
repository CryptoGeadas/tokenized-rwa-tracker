// Tests for the draft helper core: DefiLlama facts in, draft registry entry + review-sheet section out.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftEntry, sheetSection, reviewSheet, proposeTokens, tokenSheet } from "./draft.mjs";
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

// ── token proposer (#24) ──
const BUIDL = "0x7712c34205737192402172409a8f7ccef8aa2aec";
const USDE = "0x4c9edd5852cd905f086c759e8383e09bff1e68b3", OTHER_USDE = "0x1d00e86748573c322f4cc41518aa0e77bd912eb4";
const tokenList = [
  { chainId: 1, address: BUIDL, name: "BlackRock USD Institutional Digital Liquidity Fund", symbol: "BUIDL", decimals: 6 },
  { chainId: 1, address: USDE, name: "Ethena USDe", symbol: "USDe", decimals: 18 },
  { chainId: 1, address: OTHER_USDE, name: "Ethereum Reserve Dollar USDE", symbol: "USDE", decimals: 18 },
  { chainId: 1, address: "0xbad", name: "Broken", symbol: "BROKEN", decimals: 6 },
];
const buidl = { fund: { slug: "blackrock-buidl", name: "BlackRock BUIDL", tvl: 3e9, url: "https://defillama.com/protocol/blackrock-buidl" },
  protocol: null, pools: [{ symbol: "BUIDL", chain: "Ethereum" }, { symbol: "buidl", chain: "Avalanche" }], tokenList };

test("the proposer gives address and decimals by pool symbol, with the source of each", () => {
  const p = proposeTokens(buidl.pools, tokenList);
  assert.equal(p.status, "matched");
  assert.deepEqual(p.proposals, [{ chain: "ethereum", address: BUIDL, decimals: 6, symbol: "BUIDL",
    source: 'CoinGecko token list ("BlackRock USD Institutional Digital Liquidity Fund"), matched on pool symbol BUIDL' }]);
  const md = sheetSection(buidl, draftEntry(buidl));
  assert.match(md, /^- Ethereum tokens \(proposed, not a decision\):$/m);
  assert.ok(md.includes(`\n  - BUIDL: [${BUIDL}](https://etherscan.io/token/${BUIDL}), decimals 6. Source: CoinGecko token list ("BlackRock USD Institutional Digital Liquidity Fund"), matched on pool symbol BUIDL.\n`));
  const block = JSON.parse(/````json tokens\n([\s\S]*?)\n````/.exec(md)[1]);
  assert.deepEqual(block, { tokens: [{ chain: "ethereum", address: BUIDL, decimals: 6, symbol: "BUIDL" }] });
  assert.equal(jsonBlock(md)["blackrock-buidl"].tokens, undefined, "proposals stay apart from the draft entry");
});

test("pool symbols are split on separators; every token sharing a symbol is listed so the owner picks; broken list rows are skipped", () => {
  const p = proposeTokens([{ symbol: "USDE-SUSDE" }, { symbol: "BROKEN" }], tokenList);
  assert.deepEqual(p.proposals.map((x) => x.address), [USDE, OTHER_USDE]);
  const md = sheetSection({ ...buidl, pools: [{ symbol: "USDE-SUSDE", chain: "Ethereum" }] }, draftEntry(buidl));
  assert.match(md, /Several tokens share the symbol USDE: keep only the fund's own\./);
});

test("no match, no pools, or no token list reads unknown with a link to check — never none", () => {
  const noMatch = sheetSection({ ...buidl, pools: [{ symbol: "TBILL", chain: "Ethereum" }] }, draftEntry(buidl));
  assert.match(noMatch, /^- Ethereum tokens: unknown \(no pool symbol matches CoinGecko's Ethereum token list; check \[Etherscan: TBILL\]\(https:\/\/etherscan\.io\/search\?q=TBILL\)\)$/m);
  const noPools = sheetSection({ ...buidl, pools: [] }, draftEntry(buidl));
  assert.match(noPools, /^- Ethereum tokens: unknown \(no pools on DefiLlama to match; check \[DefiLlama\]\(https:\/\/defillama\.com\/protocol\/blackrock-buidl\)\)$/m);
  const noList = sheetSection({ ...buidl, tokenList: null }, draftEntry(buidl));
  assert.match(noList, /^- Ethereum tokens: unknown \(CoinGecko's token list could not be read; check \[Etherscan: BUIDL\]\(https:\/\/etherscan\.io\/search\?q=BUIDL\)\)$/m);
  for (const md of [noMatch, noPools, noList]) assert.doesNotMatch(md, /\bnone\b|````json tokens/);
});

test("token-list text can't add sections or links to the sheet", () => {
  const evil = [{ chainId: 1, address: BUIDL, name: "x\n## Fake [l](https://evil.example)", symbol: "BUIDL", decimals: 6 }];
  const md = sheetSection({ ...buidl, tokenList: evil }, draftEntry(buidl));
  assert.doesNotMatch(md, /^## Fake/m);
  assert.ok(!md.includes("[l](https://evil.example)"));
});

test("proposing never changes the registry or its entries", () => {
  const registry = Object.freeze({ "blackrock-buidl": Object.freeze({ name: "BlackRock BUIDL", chains: Object.freeze(["ethereum"]) }) });
  const before = JSON.stringify(registry);
  const facts = [{ slug: "blackrock-buidl", entry: registry["blackrock-buidl"], pools: buidl.pools, tokenList }];
  tokenSheet(facts, new Date("2026-10-31T00:00:00Z"));
  assert.equal(JSON.stringify(registry), before);
});

test("the token sheet: one section per registry fund with its proposals and the three boxes", () => {
  const facts = [
    { slug: "blackrock-buidl", entry: { name: "BlackRock BUIDL", chains: ["ethereum", "avalanche"] }, pools: buidl.pools, tokenList },
    { slug: "huma", entry: { name: "Huma", chains: ["solana"] }, pools: [{ symbol: "PST" }], tokenList },
  ];
  const sheet = tokenSheet(facts, new Date("2026-10-31T00:00:00Z"));
  assert.match(sheet, /^# RWA token review — 2026-10-31/);
  assert.equal((sheet.match(/^## /gm) || []).length, 2);
  assert.equal((sheet.match(/^- \[ \] Approve$/gm) || []).length, 2);
  assert.match(sheet, /^- Chains: ethereum, avalanche$/m);
  assert.match(sheet, /^- Ethereum tokens: unknown \(not on Ethereum by the registry's chains; check \[DefiLlama\]\(https:\/\/defillama\.com\/protocol\/huma\)\)$/m);
  assert.match(sheet, /````json tokens/);
});

test("coins a pool holds next to the fund's token are never proposed, and are named", () => {
  const list = [...tokenList, { chainId: 1, address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", name: "USDC", symbol: "USDC", decimals: 6 }];
  const p = proposeTokens([{ symbol: "USDC-BUIDL" }, { symbol: "WETH" }], list);
  assert.deepEqual(p.proposals.map((x) => x.symbol), ["BUIDL"]);
  assert.deepEqual(p.base, ["USDC", "WETH"]);
  const md = sheetSection({ ...buidl, tokenList: list, pools: [{ symbol: "USDC-BUIDL", chain: "Ethereum" }] }, draftEntry(buidl));
  assert.match(md, /^ {2}- Not proposed: USDC \(coins the pools hold next to the fund's token, not the fund's own\)$/m);
  assert.doesNotMatch(md, /0xa0b86991/);
});

test("every pool symbol is accounted for: unmatched and invalid rows read unknown with a link", () => {
  const list = [...tokenList, { chainId: 1, address: BUIDL, name: "x", symbol: "BUIDL````", decimals: 6 },
    { chainId: 1, address: USDE, name: "bad", symbol: "SYRUPX", decimals: "6" }, { chainId: 1, address: OTHER_USDE, name: "bad", symbol: "SYRUPX", decimals: 40 }];
  const p = proposeTokens([{ symbol: "BUIDL" }, { symbol: "OUSG" }, { symbol: "SYRUPX" }], list);
  assert.deepEqual(p.proposals.map((x) => x.symbol), ["BUIDL"], "a symbol that could break the sheet, or bad decimals, is never proposed");
  assert.deepEqual(p.unmatched, ["OUSG"]);
  assert.deepEqual(p.invalid, ["SYRUPX"]);
  const md = sheetSection({ ...buidl, tokenList: list, pools: [{ symbol: "BUIDL" }, { symbol: "OUSG" }, { symbol: "SYRUPX" }] }, draftEntry(buidl));
  assert.match(md, /^ {2}- OUSG: unknown \(not in CoinGecko's Ethereum token list; check \[Etherscan: OUSG\]/m);
  assert.match(md, /^ {2}- SYRUPX: unknown \(CoinGecko lists the symbol but its address or decimals are invalid; check \[Etherscan: SYRUPX\]/m);
  const onlyBad = sheetSection({ ...buidl, tokenList: list, pools: [{ symbol: "SYRUPX" }] }, draftEntry(buidl));
  assert.match(onlyBad, /^- Ethereum tokens: unknown$/m);
  assert.match(onlyBad, /SYRUPX: unknown \(CoinGecko lists the symbol but its address or decimals are invalid/);
});

test("mixed-case list addresses are proposed in lowercase; the check link searches each pool symbol", () => {
  const list = [{ chainId: 1, address: "0x7712c34205737192402172409a8F7ccef8aA2AEc", name: "B", symbol: "BUIDL", decimals: 6 }];
  assert.equal(proposeTokens([{ symbol: "BUIDL" }], list).proposals[0].address, BUIDL);
  const md = sheetSection({ ...buidl, pools: [{ symbol: "TBL" }, { symbol: "TBILL" }] }, draftEntry(buidl));
  assert.match(md, /check \[Etherscan: TBL\]\(https:\/\/etherscan\.io\/search\?q=TBL\), \[Etherscan: TBILL\]/);
});

test("the token sheet: a fund on Ethereum with no pools reads unknown with its DefiLlama link", () => {
  const sheet = tokenSheet([{ slug: "x", entry: { name: "X", chains: ["ethereum"] }, pools: [], tokenList }]);
  assert.match(sheet, /^- Ethereum tokens: unknown \(no pools on DefiLlama to match; check \[DefiLlama\]\(https:\/\/defillama\.com\/protocol\/x\)\)$/m);
  assert.doesNotMatch(sheet, /````json tokens/);
});

test("the draft command writes only review sheets, never the registry", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./draft-cli.mjs", import.meta.url), "utf8");
  assert.equal((src.match(/writeFile\(/g) || []).length, 1, "one write, in writeSheet");
  assert.doesNotMatch(src, /writeFile\([^)]*rwa-registry/);
  // every sheet is written to a path built under review/
  const targets = [...src.matchAll(/await writeSheet\((\w+)/g)].map((m) => m[1]);
  assert.deepEqual(targets, ["out", "out"]);
  const outs = [...src.matchAll(/const out = (.*);/g)].map((m) => m[1]);
  assert.equal(outs.length, 2);
  for (const o of outs) assert.ok(o.startsWith('join(HERE, "..", "review", `rwa-'), o);
});
