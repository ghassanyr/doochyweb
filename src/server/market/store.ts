// Persistence for the Analysis page's watchlist and settings.
//
// This is a single global document (`_id: "global"`) shared by every user: the
// market watchlist is not user-specific data, and this is a personal deployment.
//
// cTrader credentials are NOT here. They live in the credentials collection,
// one document per user, and the page is powered by whichever account
// resolveMarketAccount() selects. Nothing from that document is ever exposed.

import mongoose from "mongoose";

import { describeMarketAccount } from "./account";
import { cachedCatalog } from "./catalog";
import { DEFAULT_TIMEFRAME, isTimeframeId } from "./timeframes";
import type { AnalysisSettings } from "./types";

const GLOBAL_ID = "global";

const DEFAULT_WATCHLIST = [
  "XAUUSD",
  "XAGUSD",
  "EURUSD",
  "GBPUSD",
  "US500",
  "NAS100",
  "BTCUSD",
  "ETHUSD",
];

const DEFAULT_SETTINGS = {
  watchlist: DEFAULT_WATCHLIST,
  refreshSeconds: 60,
  defaultTimeframe: DEFAULT_TIMEFRAME,
  strongRatio: 0.25,
};

const marketSettingsSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: GLOBAL_ID },
  watchlist: { type: [String], default: () => [...DEFAULT_WATCHLIST] },
  cardOrder: { type: [String], default: () => [] },
  refreshSeconds: { type: Number, default: DEFAULT_SETTINGS.refreshSeconds },
  defaultTimeframe: { type: String, default: DEFAULT_SETTINGS.defaultTimeframe },
  strongRatio: { type: Number, default: DEFAULT_SETTINGS.strongRatio },
  updatedAt: { type: Date, default: Date.now },
});

export const MarketSettings = mongoose.model("MarketSettings", marketSettingsSchema);

export interface StoredMarketSettings {
  watchlist: string[];
  /** Saved card layout from drag-and-drop. Symbols absent from it keep their
   *  watchlist order and are appended after the ones that are listed. */
  cardOrder: string[];
  refreshSeconds: number;
  defaultTimeframe: string;
  strongRatio: number;
}

// Environment overrides win over the stored values so the app can be configured
// without touching the UI.
function withEnvOverrides(s: StoredMarketSettings): StoredMarketSettings {
  const merged = { ...s };
  if (process.env.REFRESH_SECONDS) {
    const n = Number(process.env.REFRESH_SECONDS);
    if (Number.isFinite(n) && n > 0) merged.refreshSeconds = n;
  }
  if (process.env.STRONG_RATIO) {
    const n = Number(process.env.STRONG_RATIO);
    if (Number.isFinite(n) && n > 0 && n <= 1) merged.strongRatio = n;
  }
  if (process.env.DEFAULT_TIMEFRAME && isTimeframeId(process.env.DEFAULT_TIMEFRAME)) {
    merged.defaultTimeframe = process.env.DEFAULT_TIMEFRAME;
  }
  return merged;
}

export async function getSettings(): Promise<StoredMarketSettings> {
  const doc = await MarketSettings.findById(GLOBAL_ID).lean().exec();
  const watchlist =
    Array.isArray(doc?.watchlist) && doc.watchlist.length ? doc.watchlist : [...DEFAULT_WATCHLIST];
  return withEnvOverrides({
    watchlist,
    cardOrder: Array.isArray(doc?.cardOrder) ? doc.cardOrder : [],
    refreshSeconds: doc?.refreshSeconds ?? DEFAULT_SETTINGS.refreshSeconds,
    defaultTimeframe: doc?.defaultTimeframe ?? DEFAULT_SETTINGS.defaultTimeframe,
    strongRatio: doc?.strongRatio ?? DEFAULT_SETTINGS.strongRatio,
  });
}

function normalizeList(list: string[]): string[] {
  return [...new Set(list.map((s) => String(s).toUpperCase()))].slice(0, 60);
}

export async function updateSettings(patch: Partial<StoredMarketSettings>): Promise<StoredMarketSettings> {
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (Array.isArray(patch.watchlist)) $set.watchlist = normalizeList(patch.watchlist);
  if (Array.isArray(patch.cardOrder)) $set.cardOrder = normalizeList(patch.cardOrder);
  if (patch.refreshSeconds != null) $set.refreshSeconds = Math.max(10, Number(patch.refreshSeconds) || 60);
  if (patch.defaultTimeframe != null && isTimeframeId(String(patch.defaultTimeframe))) {
    $set.defaultTimeframe = String(patch.defaultTimeframe);
  }
  if (patch.strongRatio != null) {
    const n = Number(patch.strongRatio);
    if (Number.isFinite(n) && n > 0 && n <= 1) $set.strongRatio = n;
  }
  await MarketSettings.updateOne({ _id: GLOBAL_ID }, { $set }, { upsert: true }).exec();
  return getSettings();
}

export async function getWatchlist(): Promise<string[]> {
  return (await getSettings()).watchlist;
}

export async function setWatchlist(list: string[]): Promise<string[]> {
  const clean = normalizeList(list);
  await MarketSettings.updateOne(
    { _id: GLOBAL_ID },
    { $set: { watchlist: clean, updatedAt: new Date() } },
    { upsert: true }
  ).exec();
  return clean;
}

export async function addToWatchlist(symbol: string): Promise<string[]> {
  const list = await getWatchlist();
  const upper = String(symbol).toUpperCase();
  if (!list.includes(upper)) list.push(upper);
  return setWatchlist(list);
}

export async function removeFromWatchlist(symbol: string): Promise<string[]> {
  const upper = String(symbol).toUpperCase();
  const current = await getSettings();
  await MarketSettings.updateOne(
    { _id: GLOBAL_ID },
    {
      $set: {
        watchlist: current.watchlist.filter((s) => s !== upper),
        cardOrder: current.cardOrder.filter((s) => s !== upper),
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  ).exec();
  return getWatchlist();
}

/** Persist a dragged card layout. Symbols not in the watchlist are ignored. */
export async function saveCardOrder(order: string[]): Promise<string[]> {
  const watchlist = await getWatchlist();
  const valid = new Set(watchlist);
  const clean = normalizeList(order).filter((s) => valid.has(s));
  await MarketSettings.updateOne(
    { _id: GLOBAL_ID },
    { $set: { cardOrder: clean, updatedAt: new Date() } },
    { upsert: true }
  ).exec();
  return clean;
}

/** The knobs plus which cTrader account is supplying prices. Never any
 *  credential material. */
export async function publicSettings(): Promise<AnalysisSettings> {
  const [s, info, catalog] = await Promise.all([getSettings(), describeMarketAccount(), cachedCatalog()]);
  const symbolCount = info.account ? catalog.filter((entry) => entry.provider !== "binance").length : 0;
  return {
    refreshSeconds: s.refreshSeconds,
    defaultTimeframe: s.defaultTimeframe,
    strongRatio: s.strongRatio,
    account: info.account
      ? {
          ctid: info.account.ctid,
          login: info.login ?? 0,
          broker: info.broker ?? "unknown broker",
          isLive: info.account.isLive,
          symbolCount,
        }
      : null,
    accountError: info.error,
  };
}