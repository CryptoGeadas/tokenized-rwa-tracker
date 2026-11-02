// Every backing type the registry allows has a page color and a styled badge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BACKING_COLORS } from "../site/fmt.js";
import { BACKING_TYPES } from "./registry.mjs";

test("every backing type has a page color, and the page has no extra ones", () => {
  assert.deepEqual(Object.keys(BACKING_COLORS).sort(), [...BACKING_TYPES].sort());
});

test("every color's badge class is styled", async () => {
  const css = await readFile(new URL("../site/styles.css", import.meta.url), "utf8");
  for (const c of Object.values(BACKING_COLORS)) assert.ok(css.includes("." + c.badge + " {"), c.badge);
});

test("the Money flows card while collecting shows when it started and no numbers (#25)", async () => {
  const { flowsCardHtml } = await import("../site/flows.js");
  const html = flowsCardHtml({ flows: { status: "collecting", since: "2026-10-31", asOf: "2026-10-30" } });
  assert.match(html, /Collecting since 31 Oct\. Numbers show after 7 days\./);
  assert.doesNotMatch(html, /\$/);
  const partial = flowsCardHtml({ flows: { status: "partial", since: "2026-10-20", asOf: "2026-10-29", in30: 1, out30: 2, net7: 0, net30: -1, maxOut30: 2, maxOutDay: "2026-10-21" } });
  for (const k of ["Net, since 20 Oct", "Minted, since 20 Oct", "Redeemed, since 20 Oct", "Biggest redemption, since 20 Oct"]) assert.ok(partial.includes(k), k);
});

test("the Money flows card names a token counted from a later day (#25)", async () => {
  const { flowsCardHtml } = await import("../site/flows.js");
  const html = flowsCardHtml({ flows: { status: "full", since: null, asOf: "2026-10-29", in30: 1, out30: 0, net7: 1, net30: 1, maxOut30: 0, maxOutDay: null, tokensSince: [{ symbol: "BBB", since: "2026-10-31" }] } });
  assert.match(html, /BBB counted since 31 Oct\./);
});

// ── card states (#26) ──
const full = { status: "full", since: null, asOf: "2026-10-29", in30: 2e6, out30: 5e6, net7: -1e6, net30: -3e6, maxOut30: 2e6, maxOutDay: "2026-10-21" };
const NOW = Date.parse("2026-10-30T06:00:00Z");

test("unavailable card says so and shows no numbers", async () => {
  const { flowsCardHtml } = await import("../site/flows.js");
  const html = flowsCardHtml({ flows: { status: "unavailable" } }, NOW);
  assert.match(html, /Money flows unavailable right now\./);
  assert.doesNotMatch(html, /\$/);
});

test("a token not read yet: collecting from the next daily update", async () => {
  const { flowsCardHtml } = await import("../site/flows.js");
  assert.match(flowsCardHtml({ flows: { status: "collecting", since: null } }, NOW), /Collecting from the next daily update\./);
});

test("stale: As of <date> in the header and the numbers dimmed — by the build's mark or by the viewer's clock", async () => {
  const { flowsCardHtml } = await import("../site/flows.js");
  const fresh = flowsCardHtml({ flows: { ...full, updatedAt: "2026-10-30T04:40:00Z" } }, NOW);
  assert.doesNotMatch(fresh, /As of|is-stale/);
  const marked = flowsCardHtml({ flows: { ...full, stale: true } }, NOW);
  assert.match(marked, /class="detail-item full flows-card is-stale"/);
  assert.match(marked, /<span class="fl-asof">As of 29 Oct<\/span>/);
  // the snapshot stopped publishing: the viewer's clock is 3 days on
  assert.match(flowsCardHtml({ flows: { ...full, updatedAt: "2026-10-30T04:40:00Z" } }, Date.parse("2026-11-02T06:00:00Z")), /is-stale/);
});

test("no price, one token: the numbers in token units and the no-price line; several tokens: the line naming them, no numbers", async () => {
  const { flowsCardHtml } = await import("../site/flows.js");
  const one = flowsCardHtml({ flows: { status: "full", since: null, asOf: "2026-10-29", noPrice: true, symbols: ["USD0"],
    units: { in30: 1.2e6, out30: 4.4e6, net7: -5e5, net30: -3.2e6, maxOut30: 2.5e6, maxOutDay: "2026-10-21" } } }, NOW);
  assert.match(one, /−3\.2M USD0/);
  assert.match(one, /No price on CoinGecko, so no dollar amounts\./);
  assert.doesNotMatch(one, /\$/);
  const many = flowsCardHtml({ flows: { status: "full", since: null, asOf: "2026-10-29", noPrice: true, symbols: ["AAA", "BBB"] } }, NOW);
  assert.match(many, /No price for AAA, BBB on CoinGecko, so no dollar amounts\./);
  assert.doesNotMatch(many, /\$|<b/);
});

// ── not tracked, Ethereum only (#27) ──
test("not-tracked card: the plain reason, no numbers, never $0", async () => {
  const { flowsCardHtml } = await import("../site/flows.js");
  const cases = [
    [{ reason: "owner", note: "Many property tokens, no single main token." }, "Not tracked: Many property tokens, no single main token."],
    [{ reason: "chain" }, "Not tracked: not on Ethereum, the only chain flows are read on for now."],
    [{ reason: "no-token" }, "Not tracked: no Ethereum token approved for this fund yet."],
    [{ reason: "not-reviewed" }, "Not tracked: this fund is not reviewed yet."],
  ];
  for (const [f, text] of cases) {
    const html = flowsCardHtml({ flows: { status: "untracked", ...f } });
    assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /\$|<b/);
  }
  assert.equal(flowsCardHtml({ flows: { status: "untracked", reason: "unknown-code" } }), "", "an unknown reason shows nothing rather than a wrong sentence");
});

test("a multi-chain tracked fund's card says Ethereum only and names the other chains", async () => {
  const { flowsCardHtml } = await import("../site/flows.js");
  const html = flowsCardHtml({ flows: { ...full, otherChains: ["avalanche", "optimism", "arbitrum", "polygon"] } }, NOW);
  assert.match(html, /Ethereum only\. This fund is also on Avalanche, Optimism, Arbitrum, Polygon\./);
  assert.doesNotMatch(flowsCardHtml({ flows: full }, NOW), /Ethereum only/);
  assert.match(flowsCardHtml({ flows: { status: "unavailable", otherChains: ["base"] } }, NOW), /Ethereum only\. This fund is also on Base\./);
});

test("owner reasons: a period added only when missing, text escaped, a blank note shows nothing", async () => {
  const { flowsCardHtml } = await import("../site/flows.js");
  const card = (note) => flowsCardHtml({ flows: { status: "untracked", reason: "owner", note } });
  assert.match(card("Many tokens"), /Not tracked: Many tokens\./);
  assert.match(card("Which token?"), /Not tracked: Which token\?</);
  assert.match(card("A <b> & c."), /Not tracked: A &lt;b&gt; &amp; c\./);
  for (const blank of ["", "  ", undefined]) assert.equal(card(blank), "");
});

test("Ethereum only also on the collecting and no-price cards", async () => {
  const { flowsCardHtml } = await import("../site/flows.js");
  const other = { otherChains: ["base"] };
  assert.match(flowsCardHtml({ flows: { status: "collecting", since: "2026-10-30", asOf: "2026-10-31", ...other } }, NOW), /Ethereum only\. This fund is also on Base\./);
  assert.match(flowsCardHtml({ flows: { status: "full", since: null, asOf: "2026-10-29", noPrice: true, symbols: ["A", "B"], ...other } }, NOW), /Ethereum only\. This fund is also on Base\./);
});
