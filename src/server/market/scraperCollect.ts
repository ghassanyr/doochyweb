// Shared collection for the scraper: fetch closed 1H/4H bars for the watchlist,
// score the rating, and build one Obs per symbol. Pure rules live in scraperRules.ts;
// this module does the I/O. Used by the runner and the dry run.

import { analyze } from "./analysis";
import { getCandles, describeError } from "./providers/index";
import { loadCatalog, resolveMeta } from "./routes";
import { engulfClosed, isStale, signalFromRating, structureClosed, type Obs } from "./scraperRules";
import { getWatchlist, publicSettings } from "./store";
import { getTimeframe } from "./timeframes";
import type { Candle, SymbolMeta } from "./types";

export interface CollectedSymbol {
  symbol: string;
  meta: SymbolMeta;
  /** Raw series including any forming bar. */
  raw4h: Candle[];
  raw1h: Candle[];
  /** Closed bars only, sorted ascending. Last element is the bar under test. */
  closed4h: Candle[];
  closed1h: Candle[];
  rating: string | null;
  obs: Obs;
}

export interface Collection {
  asOf: number;
  watchlist: string[];
  symbols: CollectedSymbol[];
  skipped: Record<string, string>;
}

export function closedBars(bars: Candle[], tf: string, now: number): Candle[] {
  const ms = getTimeframe(tf).ms;
  return bars.filter((b) => b.time + ms <= now).sort((a, b) => a.time - b.time);
}


/**
 * Build one observation from already-closed bars. Shared by the live collector and
 * the replay so both read the same bar class. The last element of each series is the
 * bar under test.
 */
export function buildObs(args: {
  symbol: string;
  category: Obs["category"];
  price: number | null;
  rating: string | null | undefined;
  closed4h: Candle[];
  closed1h: Candle[];
}): Obs {
  const last = args.closed4h[args.closed4h.length - 1];
  return {
    symbol: args.symbol,
    category: args.category,
    price: args.price,
    signal: signalFromRating(args.rating),
    engulf1h: engulfClosed(args.closed1h),
    engulf4h: engulfClosed(args.closed4h),
    structure4h: structureClosed(args.closed4h),
    asOf: new Date(last.time + getTimeframe("4h").ms).toISOString(),
  };
}

export async function collectObservations(now: number = Date.now(), opts: { force?: boolean } = {}): Promise<Collection> {
  const [watchlist, settings, catalog] = await Promise.all([getWatchlist(), publicSettings(), loadCatalog()]);
  const out: Collection = { asOf: now, watchlist, symbols: [], skipped: {} };

  for (const symbol of watchlist) {
    const meta = resolveMeta(symbol, catalog.items);
    if (!meta) {
      out.skipped[symbol] = "not tradable on this account";
      continue;
    }
    try {
      const r4 = await getCandles(meta, "4h", settings, opts.force ? { force: true } : {});
      const r1 = await getCandles(meta, "1h", settings, opts.force ? { force: true } : {});
      const c4 = closedBars(r4.bars, "4h", now);
      const c1 = closedBars(r1.bars, "1h", now);
      if (isStale(c4, getTimeframe("4h").ms, now) || isStale(c1, getTimeframe("1h").ms, now)) {
        out.skipped[symbol] = "stale series";
        continue;
      }
      const rating = analyze(r4.bars, meta, "4h").summary.rating as string;
      const obs = buildObs({
        symbol,
        category: (meta.type === "crypto" ? "crypto" : meta.type) as Obs["category"],
        price: r4.bars.length ? r4.bars[r4.bars.length - 1].close : null,
        rating,
        closed4h: c4,
        closed1h: c1,
      });
      out.symbols.push({ symbol, meta, raw4h: r4.bars, raw1h: r1.bars, closed4h: c4, closed1h: c1, rating, obs });
    } catch (err) {
      out.skipped[symbol] = describeError(err);
    }
  }
  return out;
}
