import "dotenv/config";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import fs from "node:fs/promises";
import path from "node:path";

const PRICE_SCALE = 100_000;
const REQUEST_TIMEOUT_MS = 15_000;
const PORT = 5035;
/** Gap between sequential trendbar requests. Sequential use stays well under cTrader's 5-in-flight limit. */
const PACE_MS = 250;

/** ProtoOATrendbarPeriod enum values. */
const PERIODS: Record<string, number> = { "1m": 1, "5m": 5, "15m": 7, "1h": 9 };
const PERIOD_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
};
/** Chunk span per request. Kept small so each request stays far under the bar cap. */
const CHUNK_MS: Record<string, number> = {
  "1m": 1 * 24 * 60 * 60_000,
  "5m": 3 * 24 * 60 * 60_000,
  "15m": 7 * 24 * 60 * 60_000,
  "1h": 60 * 24 * 60 * 60_000,
};

export interface Candle {
  time: number; // epoch ms, bar open
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Creds {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  host: string;
  pinnedCtid?: number;
}

function getCreds(): Creds {
  const clientId = process.env.CTRADER_CLIENT_ID;
  const clientSecret = process.env.CTRADER_CLIENT_SECRET;
  const accessToken = process.env.CTRADER_ACCESS_TOKEN;
  const host = process.env.CTRADER_HOST || "demo.ctraderapi.com";
  if (!clientId || !clientSecret || !accessToken) {
    throw new Error("CTRADER_CLIENT_ID, CTRADER_CLIENT_SECRET and CTRADER_ACCESS_TOKEN are required in shitnals/.env");
  }
  const pinnedCtid = process.env.CTRADER_CTID ? Number(process.env.CTRADER_CTID) : undefined;
  return { clientId, clientSecret, accessToken, host, pinnedCtid };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/** Opens the socket, application-auths, and returns the connection. Does NOT refresh tokens:
 *  refresh rotates the grant for every other connection (Doochy, DoochyBot). */
async function openConnection(creds: Creds): Promise<any> {
  const connection: any = new CTraderConnection({ host: creds.host, port: PORT });
  await withTimeout(connection.open(), REQUEST_TIMEOUT_MS, "socket open");
  await withTimeout(
    connection.sendCommand("ProtoOAApplicationAuthReq", {
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    }),
    REQUEST_TIMEOUT_MS,
    "ProtoOAApplicationAuthReq"
  );
  return connection;
}

async function pickAccount(connection: any, creds: Creds): Promise<{ ctid: number; isLive: boolean }> {
  const res: any = await withTimeout(
    connection.sendCommand("ProtoOAGetAccountListByAccessTokenReq", { accessToken: creds.accessToken }),
    REQUEST_TIMEOUT_MS,
    "account list"
  );
  const accounts = ((res?.ctidTraderAccount ?? []) as any[]).map((a) => ({
    ctid: Number(a.ctidTraderAccountId),
    isLive: a.isLive === true || a.isLive === "true",
  }));
  if (!accounts.length) throw new Error("No cTrader accounts under this access token");
  if (creds.pinnedCtid) {
    const pinned = accounts.find((a) => a.ctid === creds.pinnedCtid);
    if (!pinned) throw new Error(`CTRADER_CTID=${creds.pinnedCtid} is not in this grant's account list`);
    return pinned;
  }
  return accounts.find((a) => !a.isLive) ?? accounts[0];
}

/** Account auth must happen on the socket before any account-scoped request. */
async function authAccount(connection: any, ctid: number, accessToken: string): Promise<void> {
  await withTimeout(
    connection.sendCommand("ProtoOAAccountAuthReq", { ctidTraderAccountId: ctid, accessToken }),
    REQUEST_TIMEOUT_MS,
    "ProtoOAAccountAuthReq"
  );
}

/** Resolves a broker symbol name to its symbolId by listing symbols, matching the Doochy approach. */
async function resolveSymbolId(connection: any, ctid: number, name: string): Promise<number> {
  const res: any = await withTimeout(
    connection.sendCommand("ProtoOASymbolsListReq", {
      ctidTraderAccountId: ctid,
      includeArchivedSymbols: false,
    }),
    REQUEST_TIMEOUT_MS,
    "ProtoOASymbolsListReq"
  );
  const match = ((res?.symbol ?? []) as any[]).find((s) => String(s.symbolName ?? "").trim() === name);
  if (!match) throw new Error(`Symbol ${name} is not tradable on this cTrader account`);
  return Number(match.symbolId);
}

interface RawTrendbar {
  low?: number | string;
  deltaOpen?: number | string;
  deltaClose?: number | string;
  deltaHigh?: number | string;
  utcTimestampInMinutes?: number | string;
  volume?: number | string;
}

function rawToCandle(b: RawTrendbar): Candle {
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

async function fetchRange(
  connection: any,
  ctid: number,
  symbolId: number,
  timeframe: string,
  fromMs: number,
  toMs: number
): Promise<Candle[]> {
  const out: Candle[] = [];
  const step = CHUNK_MS[timeframe];
  // Walk forward in chunks so each request stays small.
  for (let from = fromMs; from < toMs; from += step) {
    const to = Math.min(toMs, from + step);
    const res: any = await withTimeout(
      connection.sendCommand("ProtoOAGetTrendbarsReq", {
        ctidTraderAccountId: ctid,
        symbolId,
        period: PERIODS[timeframe],
        fromTimestamp: from,
        toTimestamp: to,
      }),
      REQUEST_TIMEOUT_MS,
      "ProtoOAGetTrendbarsReq"
    );
    const bars = (res?.trendbar ?? []) as RawTrendbar[];
    out.push(...bars.map(rawToCandle));
    await new Promise((r) => setTimeout(r, PACE_MS));
  }
  return out;
}

function mergeSorted(a: Candle[], b: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of a) map.set(c.time, c);
  for (const c of b) map.set(c.time, c);
  return [...map.values()].sort((x, y) => x.time - y.time);
}

function cacheFile(symbol: string, timeframe: string): string {
  const dir = process.env.CACHE_DIR || path.join(process.cwd(), "data", "candles");
  return path.join(dir, `${symbol}_${timeframe}.json`);
}

async function readCache(file: string): Promise<Candle[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Returns candles for [now - days, now].
 * - No cache: full backfill over `days`.
 * - Cache present: fetch only bars newer than the newest cached bar (incremental),
 *   unless `refresh` is false and the cache is already current, in which case no broker call is made.
 */
export async function fetchCandles(
  symbol: string,
  timeframe: string,
  options: { days?: number } = {}
): Promise<Candle[]> {
  if (PERIODS[timeframe] == null) throw new Error(`Unsupported timeframe: ${timeframe}`);
  const file = cacheFile(symbol, timeframe);
  await fs.mkdir(path.dirname(file), { recursive: true });

  const days = options.days ?? 730;
  const now = Date.now();
  const tfMs = PERIOD_MS[timeframe];
  const windowStart = now - days * 86_400_000;
  const existing = await readCache(file);
  const newest = existing.length ? existing[existing.length - 1].time : null;

  // Cache is current when the newest bar is no more than two bars old AND the
  // oldest cached bar covers the requested window. The first bar of any series
  // sits a few hours after the requested start (session open), so allow two chunks of slack.
  const coversWindow = existing.length > 0 && existing[0].time <= windowStart + 2 * CHUNK_MS[timeframe];
  if (newest != null && now - newest < 2 * tfMs && coversWindow) {
    console.log(`[fetch] ${symbol} ${timeframe}: cache current (newest ${new Date(newest).toISOString()}), no broker call`);
    return existing.filter((c) => c.time >= windowStart);
  }
  console.log(
    newest == null
      ? `[fetch] ${symbol} ${timeframe}: no cache, full backfill of ${days}d`
      : `[fetch] ${symbol} ${timeframe}: incremental from ${new Date(newest + tfMs).toISOString()}`
  );

  const creds = getCreds();
  const connection = await openConnection(creds);
  try {
    const account = await pickAccount(connection, creds);
    await authAccount(connection, account.ctid, creds.accessToken);
    const symbolId = await resolveSymbolId(connection, account.ctid, symbol);

    const from = newest != null && coversWindow ? newest + tfMs : windowStart;
    // Never cache a bar that is still forming: it would never be refreshed,
    // because later incremental runs start after the newest cached bar.
    const fetched = await fetchRange(connection, account.ctid, symbolId, timeframe, from, now);
    const closed = fetched.filter((c) => c.time + tfMs <= now);
    const merged = mergeSorted(existing, closed);
    const fresh = closed;
    await fs.writeFile(file, JSON.stringify(merged));
    console.log(`[fetch] fetched ${fresh.length} new bars, cache now ${merged.length}`);
    return merged.filter((c) => c.time >= windowStart);
  } finally {
    try {
      connection.close?.();
    } catch {
      /* ignore */
    }
  }
}

// CLI entry point: `pnpm fetch -- --symbol=XAUUSD --timeframe=15m --days=730`
async function main() {
  const args = process.argv.slice(2);
  const get = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
  const symbol = get("symbol", "XAUUSD");
  const timeframe = get("timeframe", "15m");
  const days = Number(get("days", "730"));

  console.log(`[fetch] ${symbol} ${timeframe} ${days}d`);
  const candles = await fetchCandles(symbol, timeframe, { days });
  console.log(`[fetch] ${candles.length} candles`);
  if (candles.length) {
    console.log(`[fetch] ${new Date(candles[0].time).toISOString()} -> ${new Date(candles[candles.length - 1].time).toISOString()}`);
  }
}

main().catch((err) => {
  console.error("[fetch] fatal:", err);
  process.exit(1);
});
