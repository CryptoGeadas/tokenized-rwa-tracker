// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY CHECK — pure. rwa-registry.json is the hand-written opinion layer; a typo
// there must fail the build, not quietly hide or mislabel a fund.
//
//   checkRegistry(raw) → registry (without _comment); throws on an unknown backing type
//     or lane, a missing required field, or a bad trust tier — and on the wrapper rule:
//     a wrapper (wrapper "token-wrapper") lists what it `holds` (registry slugs, or plain
//     names for funds outside the registry) and its tier can't be better than the worst
//     registry fund it holds.
//   registryWarnings(dropped) → [{ id, text }] for registry funds DefiLlama no longer
//     lists, or lists without TVL (a fund that only shrank under $5M is just logged).
//   registryLog(warnings, env) → lines for the build log (+ ::warning lines in CI)
// ─────────────────────────────────────────────────────────────────────────────
import { DROP } from "./pipeline.mjs";

export const BACKING_TYPES = ["government-debt", "private-credit", "basis-trade/synthetic", "real-estate", "commodity", "equity", "insurance", "mixed/other"];
export const TOKEN_WRAPPER = "token-wrapper";
export const WRAPPERS = ["regulated-fund", "on-chain-pool", "protocol", "LLC", "none", TOKEN_WRAPPER];
const SLUG = /^[a-z0-9][a-z0-9.()-]*$/; // a holds item in this form must be a registry slug
export const LANES = ["main", "real-estate", "commodity", "equity"];
const REQUIRED = ["name", "issuer", "backing_type", "lane", "one_liner"];
const KNOWN = new Set([...REQUIRED, "trust_tier", "tier_overrides", "wrapper", "jurisdiction", "redemption", "chains", "mislabel", "pool_projects", "holds", "tvl_source", "tokens"]);
// tokens (#21): the fund's token contracts whose mints and burns are its flows
const TOKEN_KEYS = ["chain", "address", "decimals", "symbol"];
const tokenOk = (t) => t && typeof t === "object" && Object.keys(t).length === TOKEN_KEYS.length && TOKEN_KEYS.every((k) => k in t)
  && typeof t.chain === "string" && t.chain.trim() && /^0x[0-9a-fA-F]{40}$/.test(t.address)
  && Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 36 && typeof t.symbol === "string" && t.symbol.trim();
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

export function checkRegistry(raw = {}) {
  const registry = Object.create(null); // a slug like "constructor" must never hit Object.prototype
  for (const [slug, e] of Object.entries(raw)) {
    if (slug === "_comment") continue;
    const at = `rwa-registry.json: "${slug}"`;
    if (RESERVED.has(slug)) throw new Error(`${at} is a reserved name`);
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error(`${at} is not an object`);
    const unknown = Object.keys(e).filter((k) => !KNOWN.has(k));
    if (unknown.length) throw new Error(`${at}: unknown field(s) ${unknown.join(", ")}`);
    for (const f of REQUIRED) if (typeof e[f] !== "string" || !e[f].trim()) throw new Error(`${at} needs ${f}`);
    if (!Array.isArray(e.chains)) throw new Error(`${at} needs chains (a list)`);
    if (e.pool_projects !== undefined && !(Array.isArray(e.pool_projects) && e.pool_projects.every((p) => typeof p === "string" && p.trim())))
      throw new Error(`${at}: pool_projects must be a list of slugs`);
    if (e.tvl_source !== undefined) {
      const t = e.tvl_source, keys = t && typeof t === "object" ? Object.keys(t) : [];
      if (keys.length !== 1 || keys[0] !== "coingecko_category" || typeof t.coingecko_category !== "string" || !t.coingecko_category.trim())
        throw new Error(`${at}: tvl_source must be { "coingecko_category": "<category id>" }`);
    }
    if (e.tokens !== undefined && !(Array.isArray(e.tokens) && e.tokens.length && e.tokens.every(tokenOk)))
      throw new Error(`${at}: tokens must be a list of { chain, address (0x + 40 hex), decimals (0-36), symbol }`);
    if (typeof e.mislabel !== "boolean") throw new Error(`${at} needs mislabel (true/false)`);
    if (!BACKING_TYPES.includes(e.backing_type)) throw new Error(`${at}: backing_type "${e.backing_type}" is not one of ${BACKING_TYPES.join(", ")}`);
    if (!LANES.includes(e.lane)) throw new Error(`${at}: lane "${e.lane}" is not one of ${LANES.join(", ")}`);
    const tierOk = Number.isInteger(e.trust_tier) && e.trust_tier >= 1 && e.trust_tier <= 4;
    if (e.lane === "main" ? !tierOk : !(tierOk || e.trust_tier == null))
      throw new Error(`${at}: trust_tier ${JSON.stringify(e.trust_tier)} must be 1-4${e.lane === "main" ? "" : " or null"}`);
    if (!WRAPPERS.includes(e.wrapper)) throw new Error(`${at}: wrapper ${JSON.stringify(e.wrapper)} is not one of ${WRAPPERS.join(", ")}`);
    if (e.wrapper === TOKEN_WRAPPER) {
      if (!Array.isArray(e.holds) || !e.holds.length || !e.holds.every((h) => typeof h === "string" && h.trim() && h === h.trim()))
        throw new Error(`${at} is a wrapper and needs holds (a list of what it holds, no blank items or outer spaces)`);
      if (new Set(e.holds).size !== e.holds.length) throw new Error(`${at}: holds lists the same fund twice`);
      if (e.holds.includes(slug)) throw new Error(`${at} can't hold itself`);
    } else if (e.holds !== undefined) throw new Error(`${at}: holds is only for wrappers (wrapper "${TOKEN_WRAPPER}")`);
    registry[slug] = e;
  }
  // Wrapper rule, once every entry is known (so entry order doesn't matter).
  const bySpelling = new Map();
  for (const [s, e] of Object.entries(registry)) for (const k of [s, e.name]) bySpelling.set(k.toLowerCase(), s);
  for (const [slug, e] of Object.entries(registry)) {
    if (e.wrapper !== TOKEN_WRAPPER) continue;
    const at = `rwa-registry.json: "${slug}"`;
    const heldTypes = new Set();
    for (const h of e.holds) {
      if (!SLUG.test(h)) {
        // An outside fund, unless it is a registry fund spelled another way (that would skip the tier rule).
        const s = bySpelling.get(h.toLowerCase());
        if (s) throw new Error(`${at} holds "${h}": that is the registry fund "${s}"; write its slug`);
        continue;
      }
      const held = registry[h];
      if (!held) throw new Error(`${at} holds "${h}", which is not in the registry (write a fund outside the registry by its name)`);
      heldTypes.add(held.backing_type);
      if (Number.isInteger(e.trust_tier) && !Number.isInteger(held.trust_tier))
        throw new Error(`${at} has trust_tier ${e.trust_tier} but holds "${h}", which is not rated: rate it or leave the wrapper unrated`);
      if (Number.isInteger(e.trust_tier) && e.trust_tier < held.trust_tier)
        throw new Error(`${at} trust_tier ${e.trust_tier} is better than "${h}" (tier ${held.trust_tier}), which it holds`);
    }
    // Typed by what it holds: one shared type gives that type; a mix gives mixed/other.
    const want = heldTypes.size === 1 ? [...heldTypes][0] : heldTypes.size > 1 ? "mixed/other" : null;
    if (want && e.backing_type !== want)
      throw new Error(`${at}: backing_type "${e.backing_type}" doesn't match what it holds (expected "${want}")`);
  }
  return registry;
}

export function registryWarnings(dropped = []) {
  return dropped.flatMap((f) => {
    const who = `Registry fund ${f.name} [${f.slug}]`;
    if (f.reason === DROP.notFound) return [{ id: "registry-slug", text: `${who} not found on DefiLlama — check its slug` }];
    if (f.reason === DROP.noTvl) return [{ id: "registry-tvl", text: `${who} has no TVL on DefiLlama — it is hidden until the source reports one, or remove the entry` }];
    if (f.reason === DROP.small) return [];
    return [{ id: "registry-dropped", text: `${who} was dropped for an unknown reason (${f.reason})` }];
  });
}

// Same escaping as the Scanner's notices.mjs (workflow-command rules); the repos share no package.
const escapeData = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (s) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

export function registryLog(warnings, env = {}) {
  const lines = warnings.map((w) => `  ⚠ ${w.text}`);
  if (env.GITHUB_ACTIONS !== "true") return lines;
  return [...lines, ...warnings.map((w) => `::warning title=${escapeProperty(w.id)}::${escapeData(w.text)}`)];
}
