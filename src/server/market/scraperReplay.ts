// Deterministic replay of the scraper runner over historical bars.
//
// It steps the exact rules the live runner uses across every hourly boundary of a
// window, so session labels, capture types, change detection, needle dedup and the
// weekend filter are all exercised without waiting a real week.
//
//   tsx src/server/market/scraperReplay.ts [--days=7] [--end=ISO] [--symbols=A,B]
//                                          [--write=/tmp/replay.jsonl] [--compare=FILE]
//
// Reads bars through the production provider; writes nothing unless --write is set.
// Compare mode matches captures by UTC hour and reports summary/change/needle diffs.

import "dotenv/config";
import fs from "node:fs";
import mongoose from "mongoose";

import { connectDb } from "../db";
import { analyze } from "./analysis";
import { getCandles } from "./providers/index";
import { loadCatalog, resolveMeta } from "./catalog";
import { buildObs } from "./scraperCollect";
import {
  buildCapture, diffObservations, isStale, isWeekendClosed, newNeedles, sessionLabel,
  type CapturePayload, type Change, type Needle, type Obs,
} from "./scraperRules";
import { getWatchlist, publicSettings } from "./store";
import { getTimeframe } from "./timeframes";
import type { Candle, SymbolMeta } from "./types";

console.log = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
const out = (s: string) => process.stdout.write(s + "\n");

const H1 = 3_600_000;
const H4 = 4 * H1;

export interface ReplaySymbol {
  symbol: string;
  meta: SymbolMeta;
  bars4h: Candle[];
  bars1h: Candle[];
}

export interface ReplayResult {
  captures: CapturePayload[];
  changes: Change[];
  needles: Needle[];
  perSession: Record<string, number>;
  full: number;
  empty: number;
  avgMarkets: number;
  weekend: { boundaries: number; withNonCrypto: number; nonCryptoAlignments: number };
  alignments: { engulf: number; triple: number };
}

const closedUpTo = (bars: Candle[], ms: number, at: number): Candle[] =>
  bars.filter((b) => b.time + ms <= at).sort((a, b) => a.time - b.time);

const categoryOf = (meta: SymbolMeta): Obs["category"] =>
  (meta.type === "crypto" ? "crypto" : meta.type) as Obs["category"];

/**
 * Replay `boundaries` (hour starts, ms) across `symbols`. Pure apart from the
 * optional rating function; `analyze` is the default.
 */
export function replay(
  symbols: ReplaySymbol[],
  boundaries: number[],
  opts: { rating?: (meta: SymbolMeta, closed4h: Candle[]) => string | null } = {}
): ReplayResult {
  const prev = new Map<string, Obs>();
  let firedDate = "";
  let fired = new Set<string>();
  const captures: CapturePayload[] = [];
  const changes: Change[] = [];
  const needles: Needle[] = [];
  const perSession: Record<string, number> = {};
  let full = 0, empty = 0, markets = 0;
  const weekend = { boundaries: 0, withNonCrypto: 0, nonCryptoAlignments: 0 };
  const alignments = { engulf: 0, triple: 0 };

  for (const B of boundaries) {
    const ts = new Date(B).toISOString();
    const session = sessionLabel(ts);
    const date = ts.slice(0, 10);
    if (date !== firedDate) { firedDate = date; fired = new Set(); }

    const cur: Obs[] = [];
    for (const s of symbols) {
      const c4 = closedUpTo(s.bars4h, H4, B);
      const c1 = closedUpTo(s.bars1h, H1, B);
      if (isStale(c4, H4, B) || isStale(c1, H1, B)) continue;
      if (!c4.length || !c1.length) continue;
      const rating = opts.rating
        ? opts.rating(s.meta, c4)
        : c4.length >= 30 ? (analyze(c4, s.meta, "4h").summary.rating as string) : null;
      cur.push(buildObs({
        symbol: s.symbol,
        category: categoryOf(s.meta),
        price: c4[c4.length - 1].close,
        rating,
        closed4h: c4,
        closed1h: c1,
      }));
    }

    const prior = [...prev.values()];
    const ch = diffObservations(prior, cur);
    const nd = newNeedles(prior, cur, `${session}:${date}`, fired);
    const capture = buildCapture({ timestamp_utc: ts, obs: cur, changes: ch, needles: nd });

    captures.push(capture);
    changes.push(...ch);
    needles.push(...nd);
    perSession[session] = (perSession[session] ?? 0) + 1;
    if (capture.capture_type === "full") full++;
    if (!cur.length) empty++;
    markets += cur.length;
    alignments.engulf += capture.summary.engulf_alignments;
    alignments.triple += capture.summary.triple_alignments;
    for (const n of nd) fired.add(n.key);
    for (const o of cur) prev.set(o.symbol, o);

    if (isWeekendClosed(ts)) {
      weekend.boundaries++;
      const nonCrypto = cur.filter((o) => o.category !== "crypto");
      if (nonCrypto.length) weekend.withNonCrypto++;
      for (const row of capture.true_alignments.engulf_1h_4h) {
        const o = cur.find((x) => x.symbol === row.symbol);
        if (o && o.category !== "crypto") weekend.nonCryptoAlignments++;
      }
      for (const row of capture.true_alignments.triple) {
        const o = cur.find((x) => x.symbol === row.symbol);
        if (o && o.category !== "crypto") weekend.nonCryptoAlignments++;
      }
    }
  }

  return {
    captures, changes, needles, perSession, full, empty,
    avgMarkets: captures.length ? markets / captures.length : 0,
    weekend, alignments,
  };
}

// ---- compare against an existing captures JSONL ---------------------------

interface ExternalCapture {
  timestamp_utc: string;
  summary?: Record<string, unknown>;
  changes?: unknown[];
  needles_fired?: unknown[];
}

function readJsonl(file: string): ExternalCapture[] {
  const text = fs.readFileSync(file, "utf8");
  const rows: ExternalCapture[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && typeof o === "object" && o.timestamp_utc) rows.push(o);
    } catch { /* torn line */ }
  }
  return rows;
}

const hourKey = (iso: string): number => Math.floor(Date.parse(iso) / H1) * H1;

export function compareCaptures(ours: CapturePayload[], theirs: ExternalCapture[]) {
  const mine = new Map(ours.map((c) => [hourKey(c.timestamp_utc), c]));
  const rows: { hour: string; diffs: string[] }[] = [];
  let matched = 0;
  for (const t of theirs) {
    const key = hourKey(t.timestamp_utc);
    const o = mine.get(key);
    if (!o) continue;
    matched++;
    const diffs: string[] = [];
    const s = (t.summary ?? {}) as Record<string, unknown>;
    const pairs: [string, number, unknown][] = [
      ["strong_buy", o.summary.strong_buy, s.strong_buy],
      ["strong_sell", o.summary.strong_sell, s.strong_sell],
      ["engulf_alignments", o.summary.engulf_alignments, s.engulf_alignments ?? s.engulf_1h_4h ?? s.true_1h_4h_alignments],
      ["triple_alignments", o.summary.triple_alignments, s.triple_alignments ?? s.triple],
    ];
    for (const [name, a, b] of pairs) if (Number(b) !== a) diffs.push(`${name} ${a}/${b ?? "-"}`);
    if (Array.isArray(t.changes) && t.changes.length !== o.changes.length) diffs.push(`changes ${o.changes.length}/${t.changes.length}`);
    if (Array.isArray(t.needles_fired) && t.needles_fired.length !== o.needles_fired.length) diffs.push(`needles ${o.needles_fired.length}/${t.needles_fired.length}`);
    if (diffs.length) rows.push({ hour: new Date(key).toISOString(), diffs });
  }
  return { matched, diffs: rows };
}

// ---- CLI -----------------------------------------------------------------

const arg = (name: string, fallback: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};

async function main() {
  await connectDb();
  const days = Number(arg("days", "7")) || 7;
  const end = Date.parse(arg("end", new Date().toISOString()));
  const endHour = Math.floor(end / H1) * H1;
  const start = endHour - days * 24 * H1;
  const only = arg("symbols", "").split(",").map((s) => s.trim()).filter(Boolean);
  const writeTo = arg("write", "");
  const compareTo = arg("compare", "");

  const [watchlist, settings, catalog] = await Promise.all([getWatchlist(), publicSettings(), loadCatalog()]);
  const wanted = only.length ? watchlist.filter((s) => only.includes(s)) : watchlist;

  const symbols: ReplaySymbol[] = [];
  const skipped: string[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const rateLimited = (msg: string) => /rate limit|BLOCKED_PAYLOAD_TYPE/i.test(msg);
  const REQUEST_GAP_MS = 1_500;
  const RATE_LIMIT_RETRY_MS = 60_000;

  const fetchOne = async (symbol: string, meta: NonNullable<ReturnType<typeof resolveMeta>>): Promise<ReplaySymbol> => {
    const r4 = await getCandles(meta, "4h", settings, { force: true });
    await sleep(REQUEST_GAP_MS);
    const r1 = await getCandles(meta, "1h", settings, { force: true });
    return { symbol, meta, bars4h: r4.bars, bars1h: r1.bars };
  };

  const retry: { symbol: string; meta: NonNullable<ReturnType<typeof resolveMeta>> }[] = [];
  for (const symbol of wanted) {
    const meta = resolveMeta(symbol, catalog.items);
    if (!meta) { skipped.push(`${symbol}: not tradable`); continue; }
    try {
      symbols.push(await fetchOne(symbol, meta));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (rateLimited(msg)) retry.push({ symbol, meta });
      else skipped.push(`${symbol}: ${msg}`);
    }
    await sleep(REQUEST_GAP_MS);
  }
  if (retry.length) {
    out(`rate limited on ${retry.length} symbols; retrying after ${RATE_LIMIT_RETRY_MS / 1000}s`);
    await sleep(RATE_LIMIT_RETRY_MS);
    for (const { symbol, meta } of retry) {
      try {
        symbols.push(await fetchOne(symbol, meta));
      } catch (err) {
        skipped.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(REQUEST_GAP_MS);
    }
  }
  symbols.sort((a, b) => wanted.indexOf(a.symbol) - wanted.indexOf(b.symbol));

  const boundaries: number[] = [];
  for (let t = start; t <= endHour; t += H1) boundaries.push(t);

  const r = replay(symbols, boundaries);

  out(`REPLAY ${new Date(start).toISOString()} .. ${new Date(endHour).toISOString()}  ${boundaries.length} hourly boundaries, ${symbols.length} symbols`);
  out(`captures ${r.captures.length} (full ${r.full}, lightweight ${r.captures.length - r.full}, empty ${r.empty}), avg markets ${r.avgMarkets.toFixed(1)}`);
  out(`sessions ${JSON.stringify(r.perSession)}`);
  out(`changes ${r.changes.length} (signal ${r.changes.filter((c) => c.field === "signal").length}, patterns ${r.changes.filter((c) => c.field === "patterns").length})`);
  out(`needles ${r.needles.length}, alignment rows engulf ${r.alignments.engulf}, triple ${r.alignments.triple}`);
  out(`weekend boundaries ${r.weekend.boundaries}, with evaluated non-crypto ${r.weekend.withNonCrypto}, non-crypto alignments ${r.weekend.nonCryptoAlignments} (expect 0)`);
  if (r.needles.length) {
    out("\nNEEDLES");
    for (const n of r.needles) out(`${n.symbol} ${n.kind} ${n.level} ${n.key}`);
  }
  if (skipped.length) { out("\nSKIPPED"); out(skipped.join("\n")); }

  if (writeTo) {
    fs.writeFileSync(writeTo, r.captures.map((c) => JSON.stringify(c)).join("\n") + "\n");
    out(`\nwrote ${r.captures.length} captures to ${writeTo}`);
  }

  if (compareTo) {
    const cmp = compareCaptures(r.captures, readJsonl(compareTo));
    out(`\nCOMPARE ${compareTo}: matched ${cmp.matched} hours, ${cmp.diffs.length} with differences`);
    for (const d of cmp.diffs.slice(0, 40)) out(`${d.hour} ${d.diffs.join("; ")}`);
  }
}

if (process.argv[1]?.endsWith("scraperReplay.ts")) {
  main()
    .catch((err) => { process.stderr.write(`replay failed: ${err instanceof Error ? err.message : String(err)}\n`); process.exitCode = 1; })
    .finally(async () => { await mongoose.disconnect().catch(() => undefined); process.exit(process.exitCode ?? 0); });
}
