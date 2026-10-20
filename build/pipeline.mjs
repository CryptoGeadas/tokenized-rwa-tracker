// $5M floor: nothing under it is shown. $50M review line: every fund at or above it
// must be classified; an unreviewed fund there is "in review", one below it is a
// "smaller fund, not reviewed".
export const TVL_FLOOR = 5_000_000;
export const REVIEW_LINE = 50_000_000;
// Why a registry fund was dropped (registry.mjs turns the last two into warnings).
export const DROP = { small: "under $5M", noTvl: "no TVL on DefiLlama", notFound: "not found on DefiLlama" };

function bestPool(pools) {
  if (!pools.length) return null;
  const withApy = pools.filter((p) => p.apyBase != null && p.apyBase > 0);
  const source = withApy.length ? withApy : pools;
  return source.sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))[0];
}

export function runPipeline(registry, allPools, protocols) {
  const poolSlugsFor = (slug) => {
    const e = registry[slug];
    if (e?.pool_projects) return e.pool_projects;
    return [slug];
  };

  const rwaProtocols = protocols.filter((p) => p.category === "RWA");
  const rwaSlugs = new Set(rwaProtocols.map((p) => p.slug));
  for (const slug of Object.keys(registry)) {
    rwaSlugs.add(slug);
    for (const ps of poolSlugsFor(slug)) {
      if (ps !== slug) rwaSlugs.add(ps);
    }
  }

  const poolsByProject = {};
  for (const pool of allPools) {
    if (rwaSlugs.has(pool.project)) {
      (poolsByProject[pool.project] ??= []).push(pool);
    }
  }

  const mainStage = [];
  const secondaryLanes = { "real-estate": [], commodity: [], equity: [] };
  const unclassified = [];
  const smaller = [];
  const dropped = [];

  const claimedPoolSlugs = new Set();
  for (const slug of Object.keys(registry)) {
    claimedPoolSlugs.add(slug);
    for (const ps of poolSlugsFor(slug)) claimedPoolSlugs.add(ps);
  }

  for (const slug of rwaSlugs) {
    const entry = registry[slug];
    if (!entry && claimedPoolSlugs.has(slug) && !rwaProtocols.some((p) => p.slug === slug)) continue;

    const psSlugs = entry ? poolSlugsFor(slug) : [slug];
    const allFundPools = [];
    for (const ps of psSlugs) {
      allFundPools.push(...(poolsByProject[ps] || []));
    }
    if (!psSlugs.includes(slug)) {
      allFundPools.push(...(poolsByProject[slug] || []));
    }
    const pool = bestPool(allFundPools);

    const totalTvl = allFundPools.reduce((s, p) => s + (p.tvlUsd || 0), 0);
    const protoMatch = protocols.find((p) => p.slug === slug) || protocols.find((p) => psSlugs.includes(p.slug));
    const tvl = totalTvl > 0 ? totalTvl : protoMatch?.tvl || 0;

    if (!entry) {
      if (tvl >= TVL_FLOOR && !claimedPoolSlugs.has(slug)) {
        (tvl >= REVIEW_LINE ? unclassified : smaller).push({
          slug,
          name: protoMatch?.name || slug,
          tvl,
          chains: pool ? [pool.chain] : [],
          apyBase: pool?.apyBase ?? null,
          category: protoMatch?.category || "RWA",
          url: `https://defillama.com/protocol/${slug}`,
        });
      }
      continue;
    }

    if (tvl < TVL_FLOOR) {
      const found = allFundPools.length > 0 || protoMatch != null;
      const reason = !found ? DROP.notFound : tvl === 0 ? DROP.noTvl : DROP.small;
      dropped.push({ slug, name: entry.name, tvl, reason });
      continue;
    }

    const fund = {
      slug,
      name: entry.name,
      issuer: entry.issuer,
      backing_type: entry.backing_type,
      trust_tier: entry.trust_tier,
      tier_overrides: entry.tier_overrides,
      wrapper: entry.wrapper,
      jurisdiction: entry.jurisdiction,
      redemption: entry.redemption,
      chains: entry.chains,
      one_liner: entry.one_liner,
      mislabel: entry.mislabel,
      lane: entry.lane,
      tvl,
      apyBase: pool?.apyBase ?? null,
      apyReward: pool?.apyReward ?? null,
      apyBase7d: pool?.apyBase7d ?? null,
      apyMean30d: pool?.apyMean30d ?? null,
      poolCount: allFundPools.length,
      symbol: pool?.symbol ?? null,
      poolChain: pool?.chain ?? null,
    };

    if (entry.lane === "main") {
      mainStage.push(fund);
    } else if (secondaryLanes[entry.lane]) {
      secondaryLanes[entry.lane].push(fund);
    }
  }

  mainStage.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
  unclassified.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
  smaller.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
  for (const lane of Object.values(secondaryLanes)) {
    lane.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
  }

  const classified = [...mainStage, ...Object.values(secondaryLanes).flat()];
  const sum = (list) => list.reduce((t, f) => t + (f.tvl || 0), 0);
  const classifiedTvl = sum(classified), totalTvl = classifiedTvl + sum(unclassified) + sum(smaller);
  const classifiedOverLine = classified.filter((f) => f.tvl >= REVIEW_LINE).length;

  return {
    mainStage,
    secondaryLanes,
    unclassified,
    smaller,
    dropped,
    stats: {
      mainStageCount: mainStage.length,
      secondaryCount: Object.values(secondaryLanes).reduce((s, l) => s + l.length, 0),
      unclassifiedCount: unclassified.length, // in review: unclassified at or over $50M (read by the website ticker)
      coverage: {
        overLine: classifiedOverLine + unclassified.length,
        classifiedOverLine,
        classifiedTvlShare: totalTvl > 0 ? classifiedTvl / totalTvl : null,
      },
    },
  };
}
