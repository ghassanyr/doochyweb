// Long-range bar history for research (analogue search). The Analysis page only
// needs ~480 bars, so it cannot serve two years. This pages cTrader trendbars in
// fixed windows and caches the result to a JSON file per symbol. It is read-only:
// it never trades and never refreshes tokens.
//
// Cache: <HISTORY_DIR or ~/doochyweb/data/history>/<SYMBOL>_<tf>.json
// Incremental: a later call only fetches bars newer than the newest cached bar.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { userSockets, type CtraderEnv } from "../ctrader/connection";
import { resolveTradableSymbol } from "../ctrader/reads";
import { resolveMarketAccount } from "./account";
import * as rateLimit from "./providers/rateLimit";
import { getTimeframe } from "./timeframes";
import type { Candle, SymbolMeta } from "./types";

const PRICE_SCALE = 100_000;
/** Window per request. H4 caps at one year per request; half a year keeps each reply small. */
const WINDOW_MS = 182 * 24 * 3_600_000;

export function historyDir(): string {
  return process.env.HISTORY_DIR || path.join(os.homedir(), "doochyweb", "data", "history");
}

export function historyFile(symbol: string, tf: string): string {
  return path.join(historyDir(), `${symbol}_${tf}.json`);
}

interface RawTrendbar {
  low?: number | string;
  deltaOpen?: number | string;
  deltaClose?: number | string;
  deltaHigh?: number | string;
  utcTimestampInMinutes?: number | string;
  volume?: number | string;
}

export function mapBar(b: RawTrendbar): Candle {
  const low = Number(b.low ?? 0);
  return {
    time: Number(b.utcTimestampInMinutes ?? 0) * 60_000,
    open: (low + Number(b.deltaOpen ?? 0)) / PRICE_SCALE,
    high: (low + Number(b.deltaHigh ?? 0)) / PRICE_SCALE,
    low: low / PRICE_SCALE,
    close: (low + Number(b.deltaClose ?? 0)) / PRICE_SCALE,
    volume: Number(b.volume ?? 0),
  };
}

/** Split [from, to) into windows of at most WINDOW_MS. Pure, so it is testable. */
export function windows(from: number, to: number, size = WINDOW_MS): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (let t = from; t < to; t += size) out.push({ from: t, to: Math.min(to, t + size) });
  return out;
}

export function readHistory(symbol: string, tf: string): Candle[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyFile(symbol, tf), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(symbol: string, tf: string, bars: Candle[]): void {
  fs.mkdirSync(historyDir(), { recursive: true });
  const tmp = historyFile(symbol, tf) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(bars));
  fs.renameSync(tmp, historyFile(symbol, tf));
}

/**
 * Bars for a broker symbol over `days`, incremental against the cache. Only closed
 * bars are kept: a bar still forming is dropped, so the cache never holds a partial bar.
 */
export async function loadHistory(meta: SymbolMeta, tfId: string, days: number, now = Date.now()): Promise<Candle[]> {
  const tf = getTimeframe(tfId);
  if (!meta.providers?.ctrader) throw new Error(`${meta.symbol}: no cTrader symbol, history unavailable`);
  if (tf.ctrader == null) throw new Error(`${tfId}: no cTrader bar size`);

  const cached = readHistory(meta.symbol, tfId);
  const newest = cached.length ? cached[cached.length - 1].time : null;
  const want = now - days * 86_400_000;
  const from = newest != null && newest > want ? newest + tf.ms : want;
  const to = Math.floor(now / tf.ms) * tf.ms; // only bars that have fully closed

  if (from >= to) return cached.filter((b) => b.time >= want);

  const account = await resolveMarketAccount();
  const env: CtraderEnv = account.isLive ? "live" : "demo";
  const resolved = await resolveTradableSymbol(account.userId, env, account.ctid, meta.providers.ctrader);
  if (!resolved) throw new Error(`${meta.providers.ctrader} is not tradable on this cTrader account`);

  const fetched: Candle[] = [];
  for (const w of windows(from, to)) {
    const release = await rateLimit.acquire("ctrader");
    try {
      const res: any = await userSockets(account.userId).send(
        env,
        "ProtoOAGetTrendbarsReq",
        {
          ctidTraderAccountId: account.ctid,
          symbolId: resolved.symbolId,
          period: tf.ctrader,
          fromTimestamp: w.from,
          toTimestamp: w.to,
          count: 1000,
        },
        { ctid: account.ctid, rotateOnTokenError: false }
      );
      for (const b of (res?.trendbar ?? []) as RawTrendbar[]) fetched.push(mapBar(b));
    } finally {
      release();
    }
  }

  const byTime = new Map<number, Candle>();
  for (const b of [...cached, ...fetched]) byTime.set(b.time, b);
  const merged = [...byTime.values()]
    .filter((b) => b.time + tf.ms <= now)
    .sort((a, b) => a.time - b.time);
  writeHistory(meta.symbol, tfId, merged);
  return merged.filter((b) => b.time >= want);
}
