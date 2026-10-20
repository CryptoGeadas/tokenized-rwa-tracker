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
