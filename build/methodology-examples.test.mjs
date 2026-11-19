// The tier cards on the methodology page name example funds; each must be a main-stage
// fund the tracker rates at that same tier (#52). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../site/methodology.html", import.meta.url), "utf8");
const registry = JSON.parse(await readFile(new URL("./rwa-registry.json", import.meta.url), "utf8"));

// "Ondo USDY/OUSG" = "Ondo USDY / OUSG"; "Frax USD" = "Frax USD (frxUSD)"
const norm = (s) => s.replace(/\([^)]*\)/g, "").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim().toLowerCase();
const byName = new Map(Object.entries(registry).filter(([k, e]) => !k.startsWith("_") && e.lane === "main").map(([, e]) => [norm(e.name), e]));

function tierExamples() {
  const out = [];
  for (const card of html.split('<div class="tier-card">').slice(1)) {
    const tier = Number(card.match(/tier-badge-(\d)/)?.[1]);
    const list = card.match(/<ul>\s*<li>([^<]+)<\/li>/)?.[1];
    if (!tier || !list) continue;
    for (const name of list.split(",")) out.push({ tier, name: name.trim() });
  }
  return out;
}

test("the page has examples for all four tiers", () => {
  assert.deepEqual([...new Set(tierExamples().map((x) => x.tier))].sort(), [1, 2, 3, 4]);
});

test("every tier example is a main-stage fund rated at that tier", () => {
  for (const { tier, name } of tierExamples()) {
    const e = byName.get(norm(name));
    assert.ok(e, `"${name}" (Tier ${tier} example) is not a main-stage fund in rwa-registry.json`);
    assert.equal(e.trust_tier, tier, `"${name}" is a Tier ${tier} example but is rated Tier ${e.trust_tier}`);
  }
});
