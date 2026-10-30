// ─────────────────────────────────────────────────────────────────────────────
// DRAFT HELPER — pure core. For each fund in review it turns DefiLlama facts into a draft
// registry entry and a section of a Markdown review sheet. The opinion fields (backing
// type, tier, wrapper, mislabel, one-liner…) stay blank: a suggested backing type is kept
// apart, with the word it came from, so a guess never reaches the registry as a decision.
// Only entries the owner approves in the sheet are copied into rwa-registry.json.
// A fact DefiLlama doesn't have reads "unknown" with a link to check, never "none" or 0.
//
//   draftEntry({ fund, protocol, pools }) → { slug, entry, suggestion: { backing_type, lane, why } }
//   sheetSection(facts, draft) → Markdown for one fund
//   reviewSheet([facts], now) → the whole sheet
// ─────────────────────────────────────────────────────────────────────────────
import { REVIEW_LINE } from "./pipeline.mjs";

// First match wins; insurance comes before credit ("reinsurance" deals are not loans).
const CLUES = [
  ["insurance", /reinsurance|insurance/i],
  ["basis-trade/synthetic", /basis trade|delta[- ]neutral|funding rates?/i],
  ["government-debt", /treasur|t-bills?|tbills?|government (bond|debt)|money market/i],
  ["private-credit", /\bcredit|\bloans?\b|\blending|receivable|invoice|financing|\bgpus?\b/i],
  ["real-estate", /real estate|propert|mortgage|rental/i],
  ["commodity", /\bgold\b|\bsilver\b|commodit|uranium|\boil\b/i],
  ["equity", /\bstocks?\b|\bequit/i],
];
const SECONDARY = new Set(["real-estate", "commodity", "equity"]);

// The whole word around a match, so the reason reads "Treasury", not "Treasur".
const wordAt = (text, m) => {
  let a = m.index, b = m.index + m[0].length;
  while (a > 0 && /[\w-]/.test(text[a - 1])) a--;
  while (b < text.length && /[\w-]/.test(text[b])) b++;
  return text.slice(a, b);
};

function suggest(protocol, name) {
  const fields = [["name", name], ["description", protocol?.description]];
  for (const [type, re] of CLUES)
    for (const [where, text] of fields) {
      const m = text && re.exec(text);
      if (m) return { backing_type: type, lane: SECONDARY.has(type) ? type : "main", why: `${where} mentions "${wordAt(text, m)}"` };
    }
  return { backing_type: null, lane: null, why: "no clue in the name or description; research needed" };
}

export function draftEntry({ fund, protocol }) {
  const entry = {
    name: fund.name,
    issuer: "",
    backing_type: "",
    trust_tier: null,
    tier_overrides: null,
    wrapper: "",
    jurisdiction: "",
    redemption: "",
    chains: protocol?.chains?.length ? protocol.chains.map((c) => c.toLowerCase()) : null, // null = unknown
    one_liner: "",
    mislabel: null, // an opinion: decided in the review
    lane: "",
  };
  return { slug: fund.slug, entry, suggestion: suggest(protocol, fund.name) };
}

// DefiLlama text goes into Markdown: one line, control characters escaped, only http(s) links.
const md = (s) => String(s).replace(/\s+/g, " ").trim().replace(/[\\`*_[\]<>|#!]/g, (c) => "\\" + c);
const link = (u) => (/^https?:\/\/[^\s<>()]+$/i.test(u || "") ? u : null);
const money = (n) => (Number.isFinite(n) ? `$${(n / 1e6).toFixed(1)}M` : "unknown");
const pct = (n) => (Number.isFinite(n) ? `${n.toFixed(2)}%` : "unknown");
const day = (unix) => (Number.isFinite(unix) ? new Date(unix * 1000).toISOString().slice(0, 10) : null);
const POOLS_SHOWN = 5;

// ── token proposer (#24) ─────────────────────────────────────────────────────
// Proposes a fund's Ethereum token addresses and decimals by matching the symbols of its
// DefiLlama pools against CoinGecko's free Ethereum token list. Every token that shares a
// symbol is listed (the owner picks the fund's own); nothing is written to the registry.
//   proposeTokens(pools, tokenList) → { status: "matched" | "no-match" | "no-pools" | "no-list", symbols, proposals: [{ chain, address, decimals, symbol, source }] }
//     tokenList = the list's `tokens` array, or null when it could not be read.
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const SYMBOL = /^[A-Za-z0-9.+_-]{1,24}$/; // anything else could break the sheet's Markdown or JSON block
// Coins a pool holds next to the fund's token (a "USDC-SYRUPUSDC" pool). Never proposed: their
// mints and burns are the stablecoin's or the wrapper's, not the fund's.
export const BASE_ASSETS = new Set(["USDC", "USDT", "DAI", "USDS", "PYUSD", "RLUSD", "FDUSD", "USDG", "EURC", "ETH", "WETH", "STETH", "WSTETH", "BTC", "WBTC", "CBBTC"]);
const poolSymbols = (pools) => [...new Set(pools.flatMap((p) => String(p.symbol ?? "").toUpperCase().split(/[-\s/+]+/)).filter(Boolean))];

export function proposeTokens(pools = [], tokenList) {
  const all = poolSymbols(pools);
  const base = all.filter((s) => BASE_ASSETS.has(s)), symbols = all.filter((s) => !BASE_ASSETS.has(s));
  if (!symbols.length) return { status: "no-pools", symbols, base, proposals: [] };
  if (!Array.isArray(tokenList)) return { status: "no-list", symbols, base, proposals: [] };
  const proposals = [], unmatched = [], invalid = [];
  for (const sym of symbols) {
    let found = false, bad = false;
    for (const t of tokenList) {
      if (String(t?.symbol ?? "").toUpperCase() !== sym) continue;
      // the list names this symbol but its row can't be used: say so, never "no match"
      if (!SYMBOL.test(t.symbol) || !ADDRESS.test(t.address) || !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36) { bad = true; continue; }
      found = true;
      if (proposals.some((p) => p.address === t.address.toLowerCase())) continue;
      proposals.push({ chain: "ethereum", address: t.address.toLowerCase(), decimals: t.decimals, symbol: t.symbol,
        source: `CoinGecko token list ("${String(t.name ?? "").replace(/\s+/g, " ").trim()}"), matched on pool symbol ${sym}` });
    }
    if (!found) (bad ? invalid : unmatched).push(sym);
  }
  return { status: proposals.length ? "matched" : "no-match", symbols, base, unmatched, invalid, proposals };
}

// one Etherscan search per pool symbol (at most three), so the reviewer starts from each
const etherscanSearch = (syms) => syms.slice(0, 3).map((s) => `[Etherscan: ${md(s)}](https://etherscan.io/search?q=${encodeURIComponent(s)})`).join(", ");
function tokenLines(pools, tokenList, llama) {
  const p = proposeTokens(pools, tokenList);
  const check = p.symbols.length ? etherscanSearch(p.symbols) : llama ? `[DefiLlama](${llama})` : "DefiLlama";
  const baseLine = p.base.length ? [`  - Not proposed: ${md(p.base.join(", "))} (coins the pools hold next to the fund's token, not the fund's own)`] : [];
  const invalidLine = p.invalid?.length ? [`  - ${md(p.invalid.join(", "))}: unknown (CoinGecko lists the symbol but its address or decimals are invalid; check ${etherscanSearch(p.invalid)})`] : [];
  if (p.status === "no-pools") return [`- Ethereum tokens: unknown (no pools on DefiLlama to match; check ${check})`, ...baseLine];
  if (p.status === "no-list") return [`- Ethereum tokens: unknown (CoinGecko's token list could not be read; check ${check})`, ...baseLine];
  if (p.status === "no-match") {
    const nothing = p.unmatched.length ? [`- Ethereum tokens: unknown (no pool symbol matches CoinGecko's Ethereum token list; check ${etherscanSearch(p.unmatched)})`] : ["- Ethereum tokens: unknown"];
    return [...nothing, ...invalidLine, ...baseLine];
  }
  const unmatchedLine = p.unmatched.length ? [`  - ${md(p.unmatched.join(", "))}: unknown (not in CoinGecko's Ethereum token list; check ${etherscanSearch(p.unmatched)})`] : [];
  const shared = [...new Set(p.proposals.map((t) => t.symbol.toUpperCase()))].filter((s) => p.proposals.filter((t) => t.symbol.toUpperCase() === s).length > 1);
  const block = { tokens: p.proposals.map(({ chain, address, decimals, symbol }) => ({ chain, address, decimals, symbol })) };
  return [
    "- Ethereum tokens (proposed, not a decision):",
    ...p.proposals.map((t) => `  - ${md(t.symbol)}: [${t.address}](https://etherscan.io/token/${t.address}), decimals ${t.decimals}. Source: ${md(t.source)}.`),
    ...shared.map((s) => `  - Several tokens share the symbol ${md(s)}: keep only the fund's own.`),
    ...unmatchedLine,
    ...invalidLine,
    ...baseLine,
    "",
    "Proposed tokens (copied into the entry only if approved; check each address on Etherscan first):",
    "",
    "````json tokens",
    JSON.stringify(block, null, 2),
    "````",
  ];
}

// The token review (npm run draft -- --tokens): one section per registry fund, for the
// owner to approve each fund's token addresses before its flows are read.
//   tokenSheet([{ slug, entry, pools, tokenList }], now) → Markdown
export function tokenSheet(facts, now = new Date()) {
  const head = [
    `# RWA token review — ${now.toISOString().slice(0, 10)}`,
    "",
    `${facts.length} registry fund${facts.length === 1 ? "" : "s"} without approved tokens. For each one: check the proposed addresses on Etherscan, then tick one box.`,
    "Only approved (or changed) token lists are copied into `build/rwa-registry.json`. Reject with a one-line reason when the fund can't be tracked.",
    "",
  ].join("\n");
  const sections = facts.map(({ slug, entry, pools = [], tokenList }) => {
    const chains = Array.isArray(entry.chains) ? entry.chains : [];
    const llama = `https://defillama.com/protocol/${encodeURIComponent(slug)}`;
    const tokens = chains.includes("ethereum") ? tokenLines(pools, tokenList, llama) : [`- Ethereum tokens: unknown (not on Ethereum by the registry's chains; check [DefiLlama](${llama}))`];
    return [`## ${md(entry.name)}`, "", `- Registry slug: ${md(slug)}`, `- Chains: ${chains.length ? md(chains.join(", ")) : "unknown"}`, ...tokens, "",
      "Decision:", "- [ ] Approve", "- [ ] Change: ", "- [ ] Reject: ", ""].join("\n");
  });
  return head + "\n" + sections.join("\n");
}

export function sheetSection({ fund, protocol, pools = [], tokenList }, draft) {
  const p = protocol || {};
  const llama = link(fund.url);
  const unknown = `unknown (check ${llama ? `[DefiLlama](${llama})` : "DefiLlama"})`;
  const site = link(p.url);
  const audits = Number(p.audits) > 0 ? `${md(p.audits)} (check the issuer's site; DefiLlama's list is often incomplete)` : "unknown: DefiLlama lists no audits; check the issuer's site";
  const sorted = pools.slice().sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0));
  const poolLines = sorted.slice(0, POOLS_SHOWN).map((q) => `  - ${md(q.symbol)} on ${md(q.chain)}: ${money(q.tvlUsd)}, base APY ${pct(q.apyBase)}`);
  if (sorted.length > POOLS_SHOWN) poolLines.push(`  - (+${sorted.length - POOLS_SHOWN} more on DefiLlama)`);
  const s = draft.suggestion;
  return [
    `## ${md(fund.name)}`,
    "",
    `- TVL: ${money(fund.tvl)}${llama ? ` · [DefiLlama](${llama})` : ""}`,
    `- Website: ${site || unknown}`,
    `- Twitter: ${p.twitter ? `https://x.com/${encodeURIComponent(p.twitter)}` : unknown}`,
    `- Chains: ${p.chains?.length ? md(p.chains.join(", ")) : unknown}`,
    `- Listed on DefiLlama: ${day(p.listedAt) || unknown}`,
    `- Audits listed on DefiLlama: ${audits}`,
    `- DefiLlama description: ${p.description ? md(p.description) : unknown}`,
    poolLines.length ? `- Pools on DefiLlama:\n${poolLines.join("\n")}` : `- Pools on DefiLlama: ${unknown}`,
    ...tokenLines(pools, tokenList, llama),
    "",
    s.backing_type
      ? `**Suggested backing type (not a decision): ${s.backing_type}**, lane ${s.lane}, because the ${md(s.why)}.`
      : `**Suggested backing type (not a decision): unknown**, ${s.why}.`,
    "",
    "Draft entry (blank fields are for the review):",
    "",
    "````json",
    `${JSON.stringify(draft.slug)}: ${JSON.stringify(draft.entry, null, 2)}`,
    "````",
    "",
    "Research notes:",
    "",
    "Sources:",
    "",
    "Tier reason:",
    "",
    "Decision:",
    "- [ ] Approve",
    "- [ ] Change: ",
    "- [ ] Reject: ",
    "",
  ].join("\n");
}

export function reviewSheet(facts, now = new Date()) {
  const n = facts.length, line = `$${REVIEW_LINE / 1e6}M`;
  const head = [
    `# RWA review sheet — ${now.toISOString().slice(0, 10)}`,
    "",
    `${n} fund${n === 1 ? " is" : "s are"} over ${line} and not in the registry. For each one: fill in the research, then tick one box.`,
    "Only approved (or changed) entries are copied into `build/rwa-registry.json`. Rules: a new source of return gets a new type;",
    "a wrapper lists what it `holds` and can't be rated better than the weakest fund inside it.",
    "",
  ].join("\n");
  return head + "\n" + facts.map((f) => sheetSection(f, draftEntry(f))).join("\n");
}
