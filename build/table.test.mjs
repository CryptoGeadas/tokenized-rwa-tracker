// Tests for keyboard access to the Trust Filter rows (site/table.js, #22). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderTable } from "../site/table.js";

const fund = (slug, name) => ({ slug, name, issuer: "I", backing_type: "government-debt", apyBase: 4, tvl: 1e8, chains: ["ethereum"], trust_tier: 1, one_liner: "x" });
const render = (expanded) => { const el = { innerHTML: "" }; renderTable(el, [fund("a", "Fund A"), fund("b", "Fund <B>")], "trust_tier", "asc", expanded); return el.innerHTML; };

test("each row's fund name is a button that says whether its card is open, and which card it controls", () => {
  const closed = render(null);
  assert.match(closed, /<button type="button" class="row-toggle" aria-expanded="false" aria-controls="detail-a">Fund A<\/button>/);
  assert.match(closed, /aria-controls="detail-b">Fund &lt;B&gt;<\/button>/, "names stay escaped");
  const open = render("a");
  assert.match(open, /aria-expanded="true" aria-controls="detail-a">Fund A/);
  assert.match(open, /<tr class="detail-row" id="detail-a">/);
  assert.match(open, /aria-expanded="false" aria-controls="detail-b"/);
});

test("the page keeps focus on the row's button after the table redraws, and rows stay clickable", async () => {
  const app = await readFile(new URL("../site/app.js", import.meta.url), "utf8");
  assert.match(app, /\.row-toggle\[aria-controls="detail-\$\{CSS\.escape\(slug\)\}"\]/);
  assert.match(app, /e\.target\.closest\("\.tbl tbody tr\[data-slug\]"\)/, "a click anywhere on the row still opens it");
  const css = await readFile(new URL("../site/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.row-toggle:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
});
