// Tests for the review alarm: one GitHub issue while funds over $50M are unclassified.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAlarm } from "./alarm.mjs";

const fund = (slug, tvl = 100e6) => ({ slug, name: slug.toUpperCase(), tvl, chains: ["Ethereum"], url: `https://defillama.com/protocol/${slug}` });

test("funds in review and no open issue → open, with every fund listed", () => {
  const a = decideAlarm([fund("hastra", 681e6), fund("onre", 284e6)], null);
  assert.equal(a.action, "open");
  assert.match(a.title, /2 funds over \$50M/);
  for (const s of ["HASTRA", "$681.0M", "https://defillama.com/protocol/hastra", "ONRE", "npm run draft"]) assert.ok(a.body.includes(s), s);
});

test("open issue and a changed list → update; the same funds → none, even when TVL moved", () => {
  const open = { number: 7, ...decideAlarm([fund("hastra", 681e6)], null) };
  assert.equal(decideAlarm([fund("hastra", 681e6), fund("onre")], open).action, "update");
  assert.equal(decideAlarm([fund("hastra", 702e6)], open).action, "none", "TVL moves every refresh; only the fund list counts");
});

test("an empty list closes the open issue; empty with no issue does nothing", () => {
  const open = { number: 7, ...decideAlarm([fund("hastra")], null) };
  const a = decideAlarm([], open);
  assert.equal(a.action, "close");
  assert.match(a.comment, /every fund over \$50M is classified/i);
  assert.equal(decideAlarm([], null).action, "none");
});

test("an open issue whose body lost its fund list is updated, not left stale", () => {
  assert.equal(decideAlarm([fund("hastra")], { number: 7, title: "x", body: "edited by hand" }).action, "update");
});

test("one fund reads as singular", () => {
  assert.match(decideAlarm([fund("hastra")], null).title, /1 fund over \$50M needs/);
});

const openFor = (funds) => ({ number: 7, ...decideAlarm(funds, null) });

test("swapping one fund for another, or removing one, updates the issue with the new list", () => {
  const swap = decideAlarm([fund("onre")], openFor([fund("hastra")]));
  assert.equal(swap.action, "update");
  assert.ok(swap.body.includes("ONRE") && !swap.body.includes("HASTRA"));
  const removed = decideAlarm([fund("hastra")], openFor([fund("hastra"), fund("onre")]));
  assert.equal(removed.action, "update");
  assert.match(removed.title, /1 fund over/);
  assert.ok(!removed.body.includes("ONRE"), "a classified fund leaves the issue");
});

test("the same funds in another order → none", () => {
  assert.equal(decideAlarm([fund("onre"), fund("hastra")], openFor([fund("hastra"), fund("onre")])).action, "none");
  assert.equal(decideAlarm([fund("hastra"), fund("onre")], { number: 7, title: "x", body: "notes\n<!-- rwa-review: onre,hastra -->\nmore" }).action, "none");
});

test("every fund's name, TVL and link are in the body", () => {
  const { body } = decideAlarm([fund("hastra", 681e6), fund("onre", 284e6)], null);
  for (const s of ["HASTRA", "$681.0M", "/protocol/hastra", "ONRE", "$284.0M", "/protocol/onre"]) assert.ok(body.includes(s), s);
});

test("a fund name can't add Markdown links or break the table", () => {
  const { body } = decideAlarm([{ ...fund("x"), name: "Evil | [claim](https://evil.example)" }], null);
  assert.ok(!body.includes("[claim](https://evil.example)"));
  assert.ok(body.includes("Evil \\| \\[claim\\]"));
});

test("a feed with no funds over $50M at all leaves the issue alone instead of closing it", () => {
  const a = decideAlarm([], openFor([fund("hastra")]), { fundsOverLine: 0 });
  assert.equal(a.action, "none");
  assert.match(a.why, /broken/);
  assert.equal(decideAlarm([], openFor([fund("hastra")]), { fundsOverLine: 20 }).action, "close");
});
