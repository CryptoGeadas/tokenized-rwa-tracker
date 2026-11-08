// Tests for the money-flow links, the SQD credit and the methodology section (#30). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { flowsCardHtml, flagSentence } from "../site/flows.js";
import { stripHtml } from "../site/strip.js";

const site = (p) => new URL(`../site/${p}`, import.meta.url);
const NOW = Date.parse("2026-11-05T06:00:00Z");
const TX = "0x16771a05f1acea9ac8065bf37fe8b3f8674fa47719c88349ecc52ca4b784289f";
const BUIDL = "0x7712c34205737192402172409a8f7ccef8aa2aec";
const full = { status: "full", flagsChecked: true, since: null, asOf: "2026-11-04", updatedAt: "2026-11-05T04:40:00Z", in30: 2e6, out30: 33e6, net7: 0, net30: -30.8e6,
  maxOut30: 21.5e6, maxOutDay: "2026-10-21", maxOutTx: TX, supplyUsd: 172.6e6, tokenSymbols: ["BUIDL"], tokenLinks: [{ symbol: "BUIDL", address: BUIDL }],
  flags: [{ kind: "outflow", share: 0.18 }, { kind: "big-redemption", share: 0.12 }] };

test("a Big redemption sentence links to its transaction on Etherscan, in a new tab", () => {
  const html = flagSentence({ kind: "big-redemption", share: 0.12 }, full);
  assert.ok(html.includes(`<a href="https://etherscan.io/tx/${TX}" target="_blank" rel="noopener">$21.5M on 21 Oct ↗</a>`), html);
  const strip = stripHtml({ config: { flowsCard: true, flagRules: { outflow: 0.1, bigRedemption: 0.05, inflow: 0.2 } }, mainStage: [{ slug: "b", name: "B", flows: full }] }, NOW);
  assert.ok(strip.includes(`https://etherscan.io/tx/${TX}`));
  assert.ok(flowsCardHtml({ flows: full }, NOW).includes(`https://etherscan.io/tx/${TX}`));
  // a missing or malformed hash: the same words, no link
  for (const maxOutTx of [null, "0x12", "javascript:alert(1)"]) assert.doesNotMatch(flagSentence({ kind: "big-redemption", share: 0.12 }, { ...full, maxOutTx }), /<a /);
});

test("the card footer: one contract link per token, How money flows work, and the SQD credit when it shows SQD data", () => {
  const html = flowsCardHtml({ flows: { ...full, tokenLinks: [{ symbol: "USDY", address: BUIDL }, { symbol: "OUSG", address: "0x1b19c19393e2d034d8ff31ff34c81252fcbbee92" }] } }, NOW);
  assert.ok(html.includes(`<a href="https://etherscan.io/token/${BUIDL}" target="_blank" rel="noopener">Check the USDY contract ↗</a>`), html);
  assert.ok(html.includes("Check the OUSG contract ↗"));
  assert.match(html, /<a href="methodology\.html#flows">How money flows work<\/a>/);
  assert.match(html, /class="fl-credit" href="https:\/\/sqd\.dev"/);
  assert.match(html, /<img src="\.\/assets\/logos\/sqd-light\.svg" alt="SQD"/);
  // shows SQD data: collecting since a date, no price with units; no SQD data: no credit
  assert.match(flowsCardHtml({ flows: { status: "collecting", since: "2026-11-01", asOf: "2026-11-04", tokenLinks: full.tokenLinks } }, NOW), /fl-credit/);
  for (const flows of [{ status: "unavailable", tokenLinks: full.tokenLinks }, { status: "collecting", since: null }, { status: "untracked", reason: "chain" }]) {
    const card = flowsCardHtml({ flows }, NOW);
    assert.doesNotMatch(card, /fl-credit/, JSON.stringify(flows));
    assert.match(card, /How money flows work/, JSON.stringify(flows));
  }
  assert.match(flowsCardHtml({ flows: { status: "unavailable", tokenLinks: full.tokenLinks } }, NOW), /Check the BUIDL contract/, "the contract can be checked even when flows are down");
  assert.doesNotMatch(flowsCardHtml({ flows: { ...full, tokenLinks: [{ symbol: "X", address: "0xnope" }] } }, NOW), /Check the X contract/);
});

test("the strip shows the SQD credit when it shows SQD data", () => {
  const data = (flows) => ({ config: { flowsCard: true, flagRules: { outflow: 0.1, bigRedemption: 0.05, inflow: 0.2 } }, mainStage: [{ slug: "b", name: "B", flows }] });
  assert.match(stripHtml(data(full), NOW), /class="fl-credit" href="https:\/\/sqd\.dev"/);
  assert.match(stripHtml(data({ ...full, flags: undefined }), NOW), /fl-credit/, "the quiet line is SQD data too");
  assert.doesNotMatch(stripHtml(data({ status: "unavailable" }), NOW), /fl-credit/);
});

test("the SQD logo is exactly the file the owner approved for the Scanner (SQD's light logo, unaltered)", async () => {
  // Copied byte for byte from defi-yield-scanner/site/assets/logos/sqd-light.svg, which was
  // downloaded from https://sqd.dev/brand/Logo_light.svg on 2026-10-22 with the owner's OK.
  // SQD's brand rules forbid changing it. Line endings are normalised (git may convert them).
  const svg = (await readFile(site("assets/logos/sqd-light.svg"), "utf8")).replace(/\r\n/g, "\n");
  assert.equal(createHash("sha256").update(svg).digest("hex"), "f671beba8837675509706fed801e02ab561836c3b9ca78508097c501fb2084d3");
});

test("every methodology link from the page lands on a section that exists, and #flows explains the flows", async () => {
  const methodology = await readFile(site("methodology.html"), "utf8");
  const srcs = (await Promise.all(["flows.js", "strip.js", "app.js", "index.html"].map((f) => readFile(site(f), "utf8")))).join("\n");
  const ids = [...srcs.matchAll(/methodology\.html#([\w-]+)/g)].map((m) => m[1]);
  assert.ok(ids.includes("flows"));
  for (const id of ids) assert.ok(methodology.includes(`id="${id}"`), `#${id}`);
  const flows = methodology.slice(methodology.indexOf('id="flows"'), methodology.indexOf("</section>", methodology.indexOf('id="flows"')));
  for (const words of ["SQD", "mints", "burns", "Ethereum only", "finalized", "share of", "10%", "5%", "20%", "Collecting since", "As of", "Not tracked", "never change"])
    assert.ok(flows.includes(words), words);
  assert.doesNotMatch(flows, /\bexit\b|unusual/i);
});

test("contract links and the SQD credit open in a new tab; a collecting card links its contracts too", () => {
  const html = flowsCardHtml({ flows: { status: "collecting", since: "2026-11-01", asOf: "2026-11-04", tokenLinks: full.tokenLinks } }, NOW);
  assert.match(html, /<a href="https:\/\/etherscan\.io\/token\/0x7712c34205737192402172409a8f7ccef8aa2aec" target="_blank" rel="noopener">Check the BUIDL contract ↗<\/a>/);
  assert.match(html, /<a class="fl-credit" href="https:\/\/sqd\.dev" target="_blank" rel="noopener">/);
});
