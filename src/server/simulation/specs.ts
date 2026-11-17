import {
  ctraderAccountRef,
  getBrokerAdapter,
  mt5AccountRef,
  type BrokerAccountRef,
  type BrokerId,
} from "../broker";
import { resolveMt5Config } from "../mt5/bridge";
import { resolveMarketAccount } from "../market/account";
import { cachedCatalogFull, resolveMeta } from "../market/catalog";
import { normalizeSymbol } from "../market/symbols";
import type { PaperLotSpecSnapshot } from "./types";

export interface PaperSymbolSpec {
  requestedSymbol: string;
  broker: BrokerId;
  brokerSymbol: string;
  symbolId: string;
  spec: PaperLotSpecSnapshot;
  minLots: number | null;
  maxLots: number | null;
  lotStep: number | null;
}

interface SpecSource {
  broker: BrokerId;
  ref: BrokerAccountRef;
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

async function activeSpecSource(): Promise<SpecSource | null> {
  const mt5 = await resolveMt5Config()
    .then((config) => ({ broker: "mt5" as const, ref: mt5AccountRef(config) }))
    .catch(() => null);
  if (mt5) return mt5;
  const account = await resolveMarketAccount().catch(() => null);
  if (!account) return null;
  return {
    broker: "ctrader",
    ref: ctraderAccountRef(account.userId, account.ctid, account.isLive),
  };
}

export async function resolvePaperSpec(symbol: string): Promise<PaperSymbolSpec | null> {
  const source = await activeSpecSource();
  if (!source) return null;

  const catalog = (await cachedCatalogFull()).items;
  const meta = resolveMeta(symbol, catalog);
  const primary = meta?.providers[source.broker];
  const secondary =
    source.broker === "mt5" ? meta?.providers.ctrader : meta?.providers.mt5;
  const candidates = [
    primary,
    secondary,
    normalizeSymbol(symbol),
    String(symbol ?? "").trim().toUpperCase(),
  ].filter((value): value is string => Boolean(value));
  const unique = [...new Set(candidates)];
  const adapter = getBrokerAdapter(source.broker);

  for (const candidate of unique) {
    let resolved: Awaited<ReturnType<typeof adapter.resolveSymbol>> = null;
    try {
      resolved = await adapter.resolveSymbol(source.ref, candidate);
    } catch {
      continue;
    }
    if (!resolved || !(resolved.spec.lotSize > 0)) continue;
    const factor = await adapter
      .quoteUsdFactor(source.ref, resolved.spec.symbol)
      .catch(() => null);
    const snapshot: PaperLotSpecSnapshot = {
      broker: source.broker,
      symbolId: resolved.id,
      accountId: source.ref.accountId,
      brokerSymbol: resolved.spec.symbol,
      lotSize: resolved.spec.lotSize,
      minVolume: resolved.spec.minVolume,
      stepVolume: resolved.spec.stepVolume,
      maxVolume: resolved.spec.maxVolume,
      quoteAsset: resolved.spec.quoteAsset,
      digits: resolved.spec.digits,
      quoteUsdFactor: factor,
      ctid: source.broker === "ctrader" ? Number(source.ref.accountId) : null,
      isLive: source.ref.mode === "live",
    };
    return {
      requestedSymbol: normalizeSymbol(symbol),
      broker: source.broker,
      brokerSymbol: resolved.spec.symbol,
      symbolId: resolved.id,
      spec: snapshot,
      ...paperLotBounds(snapshot),
    };
  }
  return null;
}
