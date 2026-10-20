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

export function sheetSection({ fund, protocol, pools = [] }, draft) {
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
