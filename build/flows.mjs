// ─────────────────────────────────────────────────────────────────────────────
// FUND FLOWS LEDGER — pure (#21). The rolling 30-day record behind the "Money flows" card:
// per fund token, per UTC day, units minted (in), units burned (out), the biggest single
// burn and its transaction, and that day's dollar price. The flows job (flows-run.mjs)
// adds each run's events from the SQD Portal (portal.mjs); the build turns the ledger into
// a `flows` object on every fund with registry tokens. Flows are shown only: they never
// touch trust tier, backing type or any other opinion field.
//
//   emptyLedger() → ledger
//   addFlows(ledger, { chain, events, lastBlock, today, tracked, prices, backfill?, updatedAt? }) → new ledger
//     `today` is the last COMPLETE UTC day the run read on that chain: it becomes the chain's
//     `asOf`. Later days are kept but not counted until a run completes them; days before
//     today − 29 are dropped. `tracked` = [{ address, decimals, symbol }]. `prices` =
//     { address: dollars | null }: a day takes the price of the run that first stores it and
//     keeps it, so later price moves never change old days. A token first seen in a backfill
//     has data from the backfill's first day (`backfill` = "YYYY-MM-DD", or true = 30 days).
//   fundFlows(tokens, ledger) → { status: "full" | "partial", since, asOf, in30, out30, net7,
//     net30, maxOut30, maxOutDay, maxOutTx } in dollars; { status: "collecting", since, asOf }
//     under 7 full days; or null when there are no honest numbers (no ledger, a token it does
//     not know, a day without a price). Several tokens are summed into one fund.
//   withFlows(result, registry, ledger) → result with `flows` on registry funds that have tokens
//
// Ledger: { asOf, chains: { ethereum: { lastBlock, asOf, updatedAt } },
//           tokens: { "ethereum:0x…": { symbol, decimals, firstDay, days: { "YYYY-MM-DD": { in, out, maxOut, maxOutTx, price } } } } }
// ─────────────────────────────────────────────────────────────────────────────

export const KEEP_DAYS = 30;
export const MIN_DAYS = 7; // under this many full days: "collecting", no numbers
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
export const shiftDay = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysFrom = (first, last) => Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS) + 1;
const cents = (n) => Math.round(n * 100) / 100;
const keyOf = (chain, address) => `${chain}:${String(address).toLowerCase()}`;

export const emptyLedger = () => ({ asOf: null, chains: {}, tokens: {} });

export function addFlows(ledger, { chain, events, lastBlock, today, tracked = [], prices = {}, backfill = false, newFrom = null, updatedAt = null }) {
  const next = structuredClone(ledger);
  // a token new to the ledger outside a backfill was read from part-way through a day: its first
  // full day is tomorrow, or `newFrom` (from the job) when that is later — never earlier
  const later = (a, b) => (a && a > b ? a : b);
  const firstDay = typeof backfill === "string" ? backfill : backfill ? shiftDay(today, -(KEEP_DAYS - 1)) : later(newFrom, shiftDay(today, 1));
  const priceOf = new Map(Object.entries(prices).map(([a, p]) => [a.toLowerCase(), p]));
  const tokenOf = (address) => (next.tokens[keyOf(chain, address)] ??= { firstDay, days: {} });
  // a token no longer tracked is dropped: if it comes back it starts fresh, so the days it was
  // not read can never count as $0
  if (tracked.length) {
    const keep = new Set(tracked.map((t) => keyOf(chain, t.address)));
    for (const k of Object.keys(next.tokens)) if (k.startsWith(`${chain}:`) && !keep.has(k)) delete next.tokens[k];
  }
  for (const t of tracked) Object.assign(tokenOf(t.address), { symbol: t.symbol, decimals: t.decimals });
  for (const e of events) {
    const p = priceOf.get(e.token.toLowerCase());
    const d = (tokenOf(e.token).days[e.day] ??= { in: 0, out: 0, maxOut: 0, maxOutTx: null, price: Number.isFinite(p) ? p : null });
    if (e.kind === "in") d.in += e.units;
    else {
      d.out += e.units;
      if (e.units > d.maxOut) { d.maxOut = e.units; d.maxOutTx = e.tx ?? null; }
    }
  }
  const oldest = shiftDay(today, -(KEEP_DAYS - 1));
  for (const [k, t] of Object.entries(next.tokens))
    if (k.startsWith(`${chain}:`)) for (const day of Object.keys(t.days)) if (day < oldest) delete t.days[day];
  next.chains[chain] = { ...next.chains[chain], lastBlock, asOf: today, ...(updatedAt ? { updatedAt } : {}) };
  next.asOf = today;
  return next;
}

// Freshness (#26), the DeFi Yield Scanner's rule. Numbers are STALE (shown dimmed, with their
// "As of" day) when the chain's last complete read (updatedAt) is over 36 h old, or the data's
// own last day ended over 48 h ago (also covers a ledger without updatedAt), or updatedAt is
// damaged (it can't prove the numbers are current). The page runs the same rule again with the
// viewer's clock, so a snapshot that stops publishing never looks current.
export const STALE_MS = 36 * 3_600_000;
export const DATA_STALE_MS = 48 * 3_600_000;
export function freshness(chainInfo, now) {
  const raw = chainInfo?.updatedAt, asOf = chainInfo?.asOf;
  const at = typeof raw === "string" ? Date.parse(raw) : NaN;
  const dataEnd = typeof asOf === "string" && DAY.test(asOf) ? Date.parse(`${asOf}T00:00:00Z`) + DAY_MS : NaN;
  const stale = (raw != null && !Number.isFinite(at)) || (Number.isFinite(at) && now - at > STALE_MS) || (Number.isFinite(dataEnd) && now - dataEnd > DATA_STALE_MS);
  return { ...(stale ? { stale: true } : {}), ...(Number.isFinite(at) ? { updatedAt: raw } : {}) };
}

const num = (x) => typeof x === "number" && Number.isFinite(x);

// now: the build's clock for the stale rule; left out (tests), no freshness fields are added.
export function fundFlows(tokens, ledger, now = null) {
  if (!Array.isArray(tokens) || !tokens.length) return null;
  if (!ledger) return { status: "unavailable" }; // the ledger could not be read
  let asOf = null, firstDay = null, chainInfo = null;
  for (const tok of tokens) {
    const t = ledger.tokens?.[keyOf(tok.chain, tok.address)];
    const info = ledger.chains?.[tok.chain];
    // approved but not read yet (or the chain never read): numbers start with the next update.
    // It carries the chain's date, so a job that keeps failing turns this stale too.
    if (!t || !info?.asOf) return { status: "collecting", since: null, ...(DAY.test(String(info?.asOf)) ? { asOf: info.asOf, ...(now == null ? {} : freshness(info, now)) } : {}) };
    // a damaged record: no numbers and no guessed state
    if (typeof t !== "object" || !DAY.test(String(t.firstDay)) || !DAY.test(String(info.asOf)) || !t.days || typeof t.days !== "object") return { status: "unavailable" };
    if (!asOf || info.asOf < asOf) { asOf = info.asOf; chainInfo = info; }
    firstDay = !firstDay || t.firstDay < firstDay ? t.firstDay : firstDay;
  }
  const fresh = now == null ? {} : freshness(chainInfo, now);
  // Coverage, from the earliest first day of the fund's tokens: under MIN_DAYS full days is
  // "collecting" (no numbers); then "partial" since that day; 30 days is "full".
  // Days not read are never shown as $0.
  if (daysFrom(firstDay, asOf) < MIN_DAYS) return { status: "collecting", since: firstDay, asOf, ...fresh };
  const window30 = shiftDay(asOf, -(KEEP_DAYS - 1)), from7 = shiftDay(asOf, -6);
  const from30 = firstDay > window30 ? firstDay : window30;
  const usd = { in30: 0, out30: 0, net7: 0, net30: 0, maxOut30: 0, maxOutDay: null, maxOutTx: null };
  const units = { in30: 0, out30: 0, net7: 0, net30: 0, maxOut30: 0, maxOutDay: null, maxOutTx: null };
  const unpriced = new Set(); // symbols of tokens with a day without a price in the window
  for (const tok of tokens) {
    const t = ledger.tokens[keyOf(tok.chain, tok.address)];
    for (const [day, d] of Object.entries(t.days)) {
      // each token counts from its own first full day: a part-day read before it is skipped
      if (day < from30 || day < t.firstDay || day > asOf) continue;
      if (!d || !num(d.in) || !num(d.out) || !num(d.maxOut)) return { status: "unavailable" }; // a damaged day is never a $0 day
      // no price that day: no dollar numbers for the fund, never a guessed $1
      if (!num(d.price)) unpriced.add(tok.symbol);
      for (const [s, k] of [[units, 1], [usd, num(d.price) ? d.price : 0]]) {
        s.in30 += d.in * k;
        s.out30 += d.out * k;
        if (day >= from7) s.net7 += (d.in - d.out) * k;
        if (d.maxOut * k > s.maxOut30) Object.assign(s, { maxOut30: d.maxOut * k, maxOutDay: day, maxOutTx: d.maxOutTx });
      }
    }
  }
  const full = daysFrom(from30, asOf) >= KEEP_DAYS;
  const head = { status: full ? "full" : "partial", since: full ? null : from30, asOf };
  // A token added after the fund's first day counts only from its own first day; say so, so a
  // fund total never hides that one token's earlier days were not read.
  const later = tokens.map((tok) => ({ symbol: tok.symbol, since: ledger.tokens[keyOf(tok.chain, tok.address)].firstDay })).filter((x) => x.since > from30);
  const tail = { ...(later.length ? { tokensSince: later } : {}), ...fresh };
  const finish = (s, round) => { s.net30 = s.in30 - s.out30; for (const k of ["in30", "out30", "net7", "net30", "maxOut30"]) s[k] = round(s[k]); return s; };
  if (unpriced.size) {
    // one token: its numbers in token units; several: units can't be added up, so no numbers.
    // `symbols` names only the tokens without a price.
    return { ...head, noPrice: true, symbols: [...unpriced], ...(tokens.length === 1 ? { units: finish(units, (n) => Math.round(n * 1e6) / 1e6) } : {}), ...tail };
  }
  return { ...head, ...finish(usd, cents), ...tail };
}

export function withFlows(result, registry, ledger, now = Date.now()) {
  const add = (f) => {
    const tokens = registry[f.slug]?.tokens;
    return tokens ? { ...f, flows: fundFlows(tokens, ledger, now) } : f;
  };
  const lanes = Object.fromEntries(Object.entries(result.secondaryLanes ?? {}).map(([k, v]) => [k, v.map(add)]));
  return { ...result, mainStage: result.mainStage.map(add), secondaryLanes: lanes };
}
