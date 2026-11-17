import "dotenv/config";
import mongoose from "mongoose";

import { PriceAlert } from "../alerts/store";
import { briefingDateKey } from "../briefing/build";
import { clearBriefing } from "../briefing/store";
import { connectDb } from "../db";
import { cachedCatalogFull, clearCatalogCache } from "./catalog";
import { MarketSettings } from "./store";
import { Signal } from "../signals/store";
import { PaperPosition } from "../simulation/store";
import { normalizeSymbol, noisyCatalogSymbols } from "./symbols";
import { UserWatchlist } from "./userWatchlist";

export interface NoisyCleanupCounts {
  hiddenSymbols: number;
  globalWatchlist: number;
  globalOrder: number;
  personalLists: number;
  personalWatchlist: number;
  personalOrder: number;
  signals: number;
  alerts: number;
  paperPositions: number;
  briefingsCleared: number;
}

export async function cleanupNoisySymbols(apply: boolean): Promise<NoisyCleanupCounts> {
  const { full } = await cachedCatalogFull();
  const brokerNames = full.filter((entry) => entry.provider !== "binance").map((entry) => entry.name);
  const hidden = [...noisyCatalogSymbols(full, brokerNames)];
  const hiddenSet = new Set(hidden);
  const counts: NoisyCleanupCounts = {
    hiddenSymbols: hidden.length,
    globalWatchlist: 0,
    globalOrder: 0,
    personalLists: 0,
    personalWatchlist: 0,
    personalOrder: 0,
    signals: 0,
    alerts: 0,
    paperPositions: 0,
    briefingsCleared: 0,
  };
  if (!hidden.length) return counts;

  const global = await MarketSettings.findById("global").exec();
  if (global) {
    counts.globalWatchlist = (global.watchlist as string[]).filter((s) => hiddenSet.has(normalizeSymbol(s))).length;
    counts.globalOrder = (global.cardOrder as string[]).filter((s) => hiddenSet.has(normalizeSymbol(s))).length;
    if (apply && (counts.globalWatchlist || counts.globalOrder)) {
      global.watchlist = (global.watchlist as string[]).filter((s) => !hiddenSet.has(normalizeSymbol(s)));
      global.cardOrder = (global.cardOrder as string[]).filter((s) => !hiddenSet.has(normalizeSymbol(s)));
      await global.save();
    }
  }

  const personal = await UserWatchlist.find({}).lean().exec();
  const affectedUsers: string[] = [];
  for (const doc of personal) {
    const watchlist = (doc.symbols as string[]) ?? [];
    const order = (doc.order as string[]) ?? [];
    const removedWatchlist = watchlist.filter((s) => hiddenSet.has(normalizeSymbol(s))).length;
    const removedOrder = order.filter((s) => hiddenSet.has(normalizeSymbol(s))).length;
    if (!removedWatchlist && !removedOrder) continue;
    counts.personalLists += 1;
    counts.personalWatchlist += removedWatchlist;
    counts.personalOrder += removedOrder;
    affectedUsers.push(String(doc.userId));
    if (apply) {
      await UserWatchlist.updateOne(
        { _id: doc._id },
        { $pull: { symbols: { $in: hidden }, order: { $in: hidden } } }
      ).exec();
    }
  }

  counts.signals = await Signal.countDocuments({ symbol: { $in: hidden } }).exec();
  counts.alerts = await PriceAlert.countDocuments({ symbol: { $in: hidden } }).exec();
  counts.paperPositions = await PaperPosition.countDocuments({ symbol: { $in: hidden } }).exec();

  if (apply) {
    await Promise.all([
      Signal.deleteMany({ symbol: { $in: hidden } }).exec(),
      PriceAlert.deleteMany({ symbol: { $in: hidden } }).exec(),
      PaperPosition.deleteMany({ symbol: { $in: hidden } }).exec(),
    ]);
    const dateKey = briefingDateKey(new Date());
    for (const userId of affectedUsers) {
      await clearBriefing(userId, dateKey);
      counts.briefingsCleared += 1;
    }
    clearCatalogCache();
  }

  return counts;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  if (!apply && !process.argv.includes("--dry-run")) {
    process.stdout.write("Dry run by default. Pass --apply to make changes.\n");
  }
  await connectDb();
  const counts = await cleanupNoisySymbols(apply);
  process.stdout.write(`${apply ? "Applied" : "Dry run"} noisy symbol cleanup:\n`);
  for (const [key, value] of Object.entries(counts)) {
    process.stdout.write(`  ${key}: ${value}\n`);
  }
  await mongoose.disconnect();
}

void main().catch(async (err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  await mongoose.disconnect();
  process.exitCode = 1;
});
