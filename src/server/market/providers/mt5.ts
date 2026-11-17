import { getBrokerAdapter, mt5AccountRef } from "../../broker";
import { resolveMt5Config } from "../../mt5/bridge";
import type { FetchContext, MarketProvider, SymbolMeta, Timeframe } from "../types";

export const id = "mt5" as const;

const WANT_BARS = 480;

export function supports(meta: SymbolMeta): boolean {
  return Boolean(meta.providers?.mt5);
}

export async function marketSymbolRef(
  meta: SymbolMeta
): Promise<{ symbol: string } | null> {
  const name = meta.providers?.mt5;
  if (!name) return null;
  try {
    const config = await resolveMt5Config();
    const resolved = await getBrokerAdapter("mt5").resolveSymbol(mt5AccountRef(config), name);
    return resolved ? { symbol: resolved.spec.symbol } : null;
  } catch {
    return null;
  }
}

export async function fetchCandles(
  meta: SymbolMeta,
  tf: Timeframe,
  _ctx?: FetchContext
) {
  const name = meta.providers?.mt5;
  if (!name) throw new Error("No MT5 symbol is mapped for this market");
  const config = await resolveMt5Config();
  const brokerRef = mt5AccountRef(config);
  const bars = await getBrokerAdapter("mt5").fetchCandles(brokerRef, {
    symbol: name,
    timeframe: { id: tf.id, ms: tf.ms, native: { mt5: tf.id } },
    count: WANT_BARS,
  });
  return bars.map((bar) => ({
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));
}

export async function mt5Catalog(): Promise<string[]> {
  const config = await resolveMt5Config();
  return getBrokerAdapter("mt5").listSymbolNames(mt5AccountRef(config));
}

export const mt5: MarketProvider = { id, supports, fetchCandles };
