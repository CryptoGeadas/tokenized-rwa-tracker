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

export function fundFlows(tokens, ledger) {
  if (!ledger || !Array.isArray(tokens) || !tokens.length) return null;
  const s = { in30: 0, out30: 0, net7: 0, net30: 0, maxOut30: 0, maxOutDay: null, maxOutTx: null };
  let asOf = null, firstDay = null;
  for (const tok of tokens) {
    const t = ledger.tokens?.[keyOf(tok.chain, tok.address)];
    const tokAsOf = ledger.chains?.[tok.chain]?.asOf;
    if (!t || !tokAsOf || !DAY.test(String(t.firstDay)) || !DAY.test(String(tokAsOf))) return null; // a damaged record: no numbers
    asOf = !asOf || tokAsOf < asOf ? tokAsOf : asOf;
    firstDay = !firstDay || t.firstDay < firstDay ? t.firstDay : firstDay;
  }
  // Coverage, from the earliest first day of the fund's tokens: under MIN_DAYS full days is
  // "collecting" (no numbers); then "partial" since that day; 30 days is "full".
  // Days not read are never shown as $0.
  if (daysFrom(firstDay, asOf) < MIN_DAYS) return { status: "collecting", since: firstDay, asOf };
  const window30 = shiftDay(asOf, -(KEEP_DAYS - 1)), from7 = shiftDay(asOf, -6);
  const from30 = firstDay > window30 ? firstDay : window30;
  for (const tok of tokens) {
    const t = ledger.tokens[keyOf(tok.chain, tok.address)];
    for (const [day, d] of Object.entries(t.days)) {
      // each token counts from its own first full day: a part-day read before it is skipped
      if (day < from30 || day < t.firstDay || day > asOf) continue;
      // no price that day: no dollar numbers at all, never a guessed $1 (#26 shows units instead)
      if (!Number.isFinite(d.price)) return null;
      const inUsd = d.in * d.price, outUsd = d.out * d.price, bigUsd = d.maxOut * d.price;
      s.in30 += inUsd;
      s.out30 += outUsd;
      if (day >= from7) s.net7 += inUsd - outUsd;
      if (bigUsd > s.maxOut30) Object.assign(s, { maxOut30: bigUsd, maxOutDay: day, maxOutTx: d.maxOutTx });
    }
  }
  s.net30 = s.in30 - s.out30;
  for (const k of ["in30", "out30", "net7", "net30", "maxOut30"]) s[k] = cents(s[k]);
  const full = daysFrom(from30, asOf) >= KEEP_DAYS;
  // A token added after the fund's first day counts only from its own first day; say so, so a
  // fund total never hides that one token's earlier days were not read.
  const later = tokens.map((tok) => ({ symbol: tok.symbol, since: ledger.tokens[keyOf(tok.chain, tok.address)].firstDay })).filter((x) => x.since > from30);
  return { status: full ? "full" : "partial", since: full ? null : from30, asOf, ...s, ...(later.length ? { tokensSince: later } : {}) };
}

export function withFlows(result, registry, ledger) {
  const add = (f) => {
    const tokens = registry[f.slug]?.tokens;
    return tokens ? { ...f, flows: fundFlows(tokens, ledger) } : f;
  };
  const lanes = Object.fromEntries(Object.entries(result.secondaryLanes ?? {}).map(([k, v]) => [k, v.map(add)]));
  return { ...result, mainStage: result.mainStage.map(add), secondaryLanes: lanes };
}
