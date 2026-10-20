// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK TVL (#20). For registry funds DefiLlama has no TVL for, an entry can name a
// CoinGecko category (tvl_source.coingecko_category); its market cap is used instead.
// One free call per refresh: /coins/categories. A failure gives no numbers, so those
// funds stay hidden with the usual "no TVL" warning, never a made-up figure.
//
//   fallbackTvl(registry, categories) → { slug: marketCapUsd } (pure)
//   fetchFallbackTvl(registry) → same, fetched; {} on any failure (logged)
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORIES = "https://api.coingecko.com/api/v3/coins/categories";

export function fallbackTvl(registry, categories) {
  const cap = new Map((Array.isArray(categories) ? categories : []).map((c) => [c?.id, c?.market_cap]));
  const out = {};
  for (const [slug, e] of Object.entries(registry)) {
    const id = e.tvl_source?.coingecko_category;
    if (id && Number.isFinite(cap.get(id)) && cap.get(id) > 0) out[slug] = cap.get(id);
  }
  return out;
}

export async function fetchFallbackTvl(registry) {
  if (!Object.values(registry).some((e) => e.tvl_source)) return {};
  try {
    const res = await fetch(CATEGORIES, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out = fallbackTvl(registry, await res.json());
    console.log(`  coingecko fallback TVL: ${Object.entries(out).map(([s, v]) => `${s} $${(v / 1e6).toFixed(0)}M`).join(", ") || "none found"}`);
    return out;
  } catch (e) {
    console.warn(`  ⚠ CoinGecko categories failed (${e.message}): funds that rely on it stay hidden this refresh`);
    return {};
  }
}
