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
