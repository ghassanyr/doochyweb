// Latest-price reads for the Signals cards' live progress bar.
//
// This is deliberately lightweight: one hourly series per symbol, served from
// the Analysis provider cache when it is warm, with a 30s process cache so the
// page's poll never becomes a broker poll. Failures are skipped rather than
// failing the whole response; progress is a nicety, not the signal itself.

import { cachedCatalogFull, resolveMeta } from "../market/catalog";
import { cachedBars, getCandles } from "../market/providers/index";
import { normalizeSymbol } from "../market/symbols";
import { publicSettings } from "../market/store";

const PRICE_TTL_MS = 30_000;
const MAX_SYMBOLS = 16;
const CONCURRENCY = 4;

const cache = new Map<string, { price: number; at: number }>();

export interface PricePoint {
  price: number;
  at: string;
}

export async function signalPrices(symbols: string[]): Promise<Record<string, PricePoint>> {
  const now = Date.now();
  const unique = [...new Set(symbols.map((s) => normalizeSymbol(s)).filter(Boolean))].slice(0, MAX_SYMBOLS);
  const out: Record<string, PricePoint> = {};
  const missing: string[] = [];

  for (const symbol of unique) {
    const hit = cache.get(symbol);
    if (hit && now - hit.at < PRICE_TTL_MS) {
      out[symbol] = { price: hit.price, at: new Date(hit.at).toISOString() };
    } else {
      missing.push(symbol);
    }
  }
  if (!missing.length) return out;

  let catalog: Awaited<ReturnType<typeof cachedCatalogFull>>["items"] = [];
  let settings: Awaited<ReturnType<typeof publicSettings>> | null = null;
  try {
    const loaded = await cachedCatalogFull();
    catalog = loaded.items;
    settings = await publicSettings();
  } catch {
    return out;
  }

  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const chunk = missing.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (symbol) => {
        try {
          const meta = resolveMeta(symbol, catalog);
          if (!meta) return;
          let bars = cachedBars(meta, "1h");
          if (!bars?.length) {
            const result = await getCandles(meta, "1h", settings!);
            bars = result.bars;
          }
          const last = bars?.[bars.length - 1];
          if (!last || !Number.isFinite(last.close)) return;
          const at = Date.now();
          cache.set(symbol, { price: last.close, at });
          out[symbol] = { price: last.close, at: new Date(at).toISOString() };
        } catch {
          // Skip this symbol; the card simply shows no progress.
        }
      })
    );
  }
  return out;
}
