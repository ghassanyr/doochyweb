import { quoteUsdFactor, resolveTradableSymbol } from "../ctrader/reads";
import { resolveMarketAccount } from "../market/account";
import { cachedCatalogFull, resolveMeta } from "../market/catalog";
import { normalizeSymbol } from "../market/symbols";
import type { PaperLotSpecSnapshot } from "./types";

export interface PaperSymbolSpec {
  requestedSymbol: string;
  brokerSymbol: string;
  symbolId: number;
  spec: PaperLotSpecSnapshot;
  minLots: number | null;
  maxLots: number | null;
  lotStep: number | null;
}

export function paperLotBounds(spec: Pick<PaperLotSpecSnapshot, "lotSize" | "minVolume" | "stepVolume" | "maxVolume">): {
  minLots: number | null;
  maxLots: number | null;
  lotStep: number | null;
} {
  if (!(spec.lotSize > 0)) return { minLots: null, maxLots: null, lotStep: null };
  return {
    minLots: spec.minVolume > 0 ? spec.minVolume / spec.lotSize : null,
    maxLots: spec.maxVolume > 0 ? spec.maxVolume / spec.lotSize : null,
    lotStep: spec.stepVolume > 0 ? spec.stepVolume / spec.lotSize : null,
  };
}

export function paperVolumeForLots(
  lots: number,
  spec: Pick<PaperLotSpecSnapshot, "lotSize" | "minVolume" | "stepVolume" | "maxVolume">
): number | null {
  if (!(spec.lotSize > 0) || !Number.isFinite(lots) || lots <= 0) return null;
  let volume = Math.round(lots * spec.lotSize);
  if (spec.stepVolume > 0) volume = Math.round(volume / spec.stepVolume) * spec.stepVolume;
  if (spec.minVolume > 0 && volume < spec.minVolume) volume = spec.minVolume;
  if (spec.maxVolume > 0 && volume > spec.maxVolume) volume = spec.maxVolume;
  return volume > 0 ? Math.round(volume) : null;
}

export function snapPaperLots(
  lots: number,
  spec: Pick<PaperLotSpecSnapshot, "lotSize" | "minVolume" | "stepVolume" | "maxVolume">
): number | null {
  const volume = paperVolumeForLots(lots, spec);
  if (volume == null || !(spec.lotSize > 0)) return null;
  return Math.round((volume / spec.lotSize) * 10_000) / 10_000;
}

export async function resolvePaperSpec(symbol: string): Promise<PaperSymbolSpec | null> {
  const account = await resolveMarketAccount().catch(() => null);
  if (!account) return null;

  const catalog = (await cachedCatalogFull()).items;
  const meta = resolveMeta(symbol, catalog);
  const candidates = [
    meta?.providers.ctrader,
    normalizeSymbol(symbol),
    String(symbol ?? "").trim().toUpperCase(),
  ].filter((value): value is string => Boolean(value));
  const unique = [...new Set(candidates)];
  const env = account.isLive ? "live" : "demo";

  for (const candidate of unique) {
    let resolved: Awaited<ReturnType<typeof resolveTradableSymbol>> = null;
    try {
      resolved = await resolveTradableSymbol(account.userId, env, account.ctid, candidate);
    } catch {
      continue;
    }
    if (!resolved || !(resolved.spec.lotSize > 0)) continue;
    const factor = await quoteUsdFactor(
      account.userId,
      account.ctid,
      account.isLive,
      resolved.symbolId
    ).catch(() => null);
    const snapshot: PaperLotSpecSnapshot = {
      symbolId: resolved.symbolId,
      brokerSymbol: resolved.spec.name,
      lotSize: resolved.spec.lotSize,
      minVolume: resolved.spec.minVolume,
      stepVolume: resolved.spec.stepVolume,
      maxVolume: resolved.spec.maxVolume,
      quoteAsset: resolved.spec.quoteAsset,
      digits: resolved.spec.digits,
      quoteUsdFactor: factor,
      ctid: account.ctid,
      isLive: account.isLive,
    };
    return {
      requestedSymbol: normalizeSymbol(symbol),
      brokerSymbol: resolved.spec.name,
      symbolId: resolved.symbolId,
      spec: snapshot,
      ...paperLotBounds(snapshot),
    };
  }
  return null;
}
