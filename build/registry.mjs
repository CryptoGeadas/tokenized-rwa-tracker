// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY CHECK — pure. rwa-registry.json is the hand-written opinion layer; a typo
// there must fail the build, not quietly hide or mislabel a fund.
//
//   checkRegistry(raw) → registry (without _comment); throws on an unknown backing type
//     or lane, a missing required field, or a bad trust tier.
//   registryWarnings(dropped) → [{ id, text }] for registry funds DefiLlama no longer
//     lists, or lists without TVL (a fund that only shrank under $5M is just logged).
//   registryLog(warnings, env) → lines for the build log (+ ::warning lines in CI)
// ─────────────────────────────────────────────────────────────────────────────
import { DROP } from "./pipeline.mjs";

export const BACKING_TYPES = ["government-debt", "private-credit", "basis-trade/synthetic", "real-estate", "commodity", "equity", "mixed/other"];
export const LANES = ["main", "real-estate", "commodity", "equity"];
const REQUIRED = ["name", "issuer", "backing_type", "lane", "one_liner"];
const KNOWN = new Set([...REQUIRED, "trust_tier", "tier_overrides", "wrapper", "jurisdiction", "redemption", "chains", "mislabel", "pool_projects"]);
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
    if (typeof e.mislabel !== "boolean") throw new Error(`${at} needs mislabel (true/false)`);
    if (!BACKING_TYPES.includes(e.backing_type)) throw new Error(`${at}: backing_type "${e.backing_type}" is not one of ${BACKING_TYPES.join(", ")}`);
    if (!LANES.includes(e.lane)) throw new Error(`${at}: lane "${e.lane}" is not one of ${LANES.join(", ")}`);
    const tierOk = Number.isInteger(e.trust_tier) && e.trust_tier >= 1 && e.trust_tier <= 4;
    if (e.lane === "main" ? !tierOk : !(tierOk || e.trust_tier == null))
      throw new Error(`${at}: trust_tier ${JSON.stringify(e.trust_tier)} must be 1-4${e.lane === "main" ? "" : " or null"}`);
    registry[slug] = e;
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
