// Carries out the review alarm (alarm.mjs) on GitHub. Runs in the refresh workflow after
// the build; needs GITHUB_TOKEN (issues: write) and GITHUB_REPOSITORY. Without a token it
// only prints what it would do, which is allowed locally but fails in CI.
import { readFile } from "node:fs/promises";
import { decideAlarm, ALARM_LABEL } from "./alarm.mjs";

const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_ACTIONS: ci } = process.env;

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
const issuesWith = async (state, sort) =>
  (await gh("GET", `/issues?state=${state}&labels=${ALARM_LABEL}&sort=${sort}&direction=desc&per_page=100`)).filter((i) => !i.pull_request);

async function main() {
  if (!token && ci === "true") throw new Error("GITHUB_TOKEN missing in CI: the review alarm was not synced");
  if (token && !repo) throw new Error("GITHUB_REPOSITORY is not set");

  const data = JSON.parse(await readFile(new URL("../site/data/latest.json", import.meta.url), "utf8"));
  if (!Array.isArray(data.unclassified)) throw new Error("latest.json has no unclassified list; not touching the alarm issue");
  for (const f of data.unclassified)
    if (!f?.slug || !f.name || !f.url || !Number.isFinite(f.tvl)) throw new Error(`latest.json: in-review fund without slug/name/url/tvl: ${JSON.stringify(f).slice(0, 120)}`);

  let open = null;
  if (token) {
    const issues = (await issuesWith("open", "created")).sort((a, b) => a.number - b.number);
    open = issues[0] ?? null;
    for (const extra of issues.slice(1)) {
      await gh("PATCH", `/issues/${extra.number}`, { state: "closed", state_reason: "not_planned" });
      await gh("POST", `/issues/${extra.number}/comments`, { body: `Duplicate of #${open.number}, which the refresh keeps up to date.` });
      console.log(`  closed duplicate #${extra.number}`);
    }
  }

  const a = decideAlarm(data.unclassified, open, { fundsOverLine: data.stats?.coverage?.overLine });
  console.log(`review alarm: ${a.action}${open ? ` (#${open.number})` : ""} · ${data.unclassified.length} fund(s) in review${a.why ? ` · ${a.why}` : ""}`);
  if (a.why) console.log(`::warning title=rwa-review::Review alarm skipped: ${a.why}`);
  if (!token) { if (a.action !== "none") console.log("  (no GITHUB_TOKEN: dry run)\n" + (a.title || a.comment)); return; }

  if (a.action === "open") {
    // Reopen the last alarm issue rather than open a new one each time a fund drifts around $50M.
    const last = (await issuesWith("closed", "updated"))[0];
    if (last) {
      await gh("PATCH", `/issues/${last.number}`, { state: "open", title: a.title, body: a.body });
      console.log(`  reopened #${last.number}`);
    } else {
      const issue = await gh("POST", "/issues", { title: a.title, body: a.body, labels: [ALARM_LABEL] });
      console.log(`  opened #${issue.number}`);
    }
  } else if (a.action === "update") {
    await gh("PATCH", `/issues/${open.number}`, { title: a.title, body: a.body });
    console.log(`  updated #${open.number}`);
  } else if (a.action === "close") {
    // Close first: if the comment then fails, the next run doesn't post it twice.
    await gh("PATCH", `/issues/${open.number}`, { state: "closed", state_reason: "completed" });
    await gh("POST", `/issues/${open.number}/comments`, { body: a.comment });
    console.log(`  closed #${open.number}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
