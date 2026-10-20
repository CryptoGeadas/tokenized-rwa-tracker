// Tests for the CoinGecko fallback TVL (#20). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackTvl } from "./coingecko.mjs";

const reg = { ogm: { tvl_source: { coingecko_category: "ondo-tokenized-assets" } }, other: {} };

test("a registry fund with a CoinGecko category gets that category's market cap", () => {
  assert.deepEqual(fallbackTvl(reg, [{ id: "ondo-tokenized-assets", market_cap: 1.04e9 }, { id: "x", market_cap: 5 }]), { ogm: 1.04e9 });
});

test("a missing category, no market cap or a broken answer gives no number", () => {
  for (const cats of [[], [{ id: "ondo-tokenized-assets", market_cap: null }], [{ id: "ondo-tokenized-assets", market_cap: 0 }], { error: "rate limited" }, null])
    assert.deepEqual(fallbackTvl(reg, cats), {}, JSON.stringify(cats));
});
