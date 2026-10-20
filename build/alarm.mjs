// ─────────────────────────────────────────────────────────────────────────────
// REVIEW ALARM — pure. While any fund over $50M is unclassified, one GitHub issue
// (label "rwa-review") lists them; the refresh opens it, updates it when the list of
// funds changes, and closes it when the list is empty. TVL moves every refresh, so only
// the fund slugs (kept in a hidden marker in the body) decide whether to update.
//
//   decideAlarm(inReview, openIssue, { fundsOverLine }) → { action: "open" | "update" | "close" | "none", title?, body?, comment?, why? }
//     openIssue: { number, title, body } of the open "rwa-review" issue, or null
//     fundsOverLine: stats.coverage.overLine; 0 means the feed came back broken (there are
//     always classified funds over $50M), so the alarm is left alone rather than closed.
// ─────────────────────────────────────────────────────────────────────────────
export const ALARM_LABEL = "rwa-review";
const MARKER = /<!-- rwa-review: ([^>]*) -->/;

const money = (n) => `$${(n / 1e6).toFixed(1)}M`;
// Fund names come from DefiLlama: escape Markdown so a name can't add links or break the table.
const md = (s) => String(s).replace(/[\\`*_[\]<>|#!]/g, (c) => "\\" + c);
const slugsOf = (body) => {
  const m = MARKER.exec(body || "");
  return m ? m[1].split(",").filter(Boolean).sort().join(",") : null;
};

function issueText(funds) {
  const n = funds.length;
  const title = `RWA review: ${n} fund${n === 1 ? "" : "s"} over $50M need${n === 1 ? "s" : ""} classifying`;
  const rows = funds.map((f) => `| ${md(f.name)} | ${money(f.tvl)} | ${md((f.chains || []).join(", ") || "unknown")} | [DefiLlama](${encodeURI(f.url)}) |`);
  const body = [
    "These RWA funds are over $50M on DefiLlama but are not in `build/rwa-registry.json`, so the page lists them as \"New, under review\".",
    "",
    "| Fund | TVL when listed | Chains | Link |",
    "|---|---|---|---|",
    ...rows,
    "",
    "**Next step:** run `npm run draft` to write a draft entry and a review sheet for each fund. The owner approves, changes or rejects each one; only approved entries go into the registry.",
    "",
    "This issue is kept up to date by the refresh workflow and closes itself when every fund over $50M is classified.",
    "",
    `<!-- rwa-review: ${funds.map((f) => f.slug).sort().join(",")} -->`,
  ].join("\n");
  return { title, body };
}

export function decideAlarm(inReview = [], openIssue = null, { fundsOverLine } = {}) {
  if (fundsOverLine === 0) return { action: "none", why: "no funds over $50M at all: the feed looks broken" };
  if (!inReview.length) {
    return openIssue
      ? { action: "close", comment: "Every fund over $50M is classified now. Closing; the refresh reopens this issue when another fund needs review." }
      : { action: "none" };
  }
  const text = issueText(inReview);
  if (!openIssue) return { action: "open", ...text };
  return slugsOf(openIssue.body) === slugsOf(text.body) ? { action: "none" } : { action: "update", ...text };
}
