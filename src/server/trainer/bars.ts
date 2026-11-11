// Dedicated Mongo storage for the trainer's long-history bars.
//
// This is deliberately separate from MarketCandles: the market cache holds a
// few hundred bars per series for the Analysis page, while the trainer needs two
// years and must not prune or overwrite that cache. One document holds all bars
// for a `${symbol}:${timeframe}` pair, stored as flat [t,o,h,l,c,v] tuples so the
// 15m series stays well inside Mongo's 16MB document ceiling.

import mongoose from "mongoose";

import type { Candle } from "../market/types";
import type { TrainerSymbol, TrainerTimeframe } from "./types";

// t, o, h, l, c, v
const BarSchema = new mongoose.Schema(
  {
    t: { type: Number, required: true },
    o: { type: Number, required: true },
    h: { type: Number, required: true },
    l: { type: Number, required: true },
    c: { type: Number, required: true },
    v: { type: Number, default: 0 },
  },
  { _id: false }
);

const trainerBarsSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    symbol: { type: String, required: true },
    timeframe: { type: String, required: true },
    bars: { type: [BarSchema], default: [] },
    fetchedAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false }
);

trainerBarsSchema.index({ fetchedAt: 1 });

type TrainerBarDoc = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

type TrainerBarsDoc = {
  _id: string;
  symbol: string;
  timeframe: string;
  bars: TrainerBarDoc[];
  fetchedAt: Date;
};

export const TrainerBars =
  (mongoose.models.TrainerBars as mongoose.Model<TrainerBarsDoc> | undefined) ||
  mongoose.model<TrainerBarsDoc>("TrainerBars", trainerBarsSchema);

export function trainerBarsKey(symbol: TrainerSymbol, timeframe: TrainerTimeframe): string {
  return `${symbol}:${timeframe}`;
}

/** Read a stored series, or null when it has never been written. */
export async function readTrainerBars(
  symbol: TrainerSymbol,
  timeframe: TrainerTimeframe
): Promise<{ bars: Candle[]; fetchedAt: number } | null> {
  const doc = await TrainerBars.findById(trainerBarsKey(symbol, timeframe))
    .select("bars fetchedAt")
    .lean()
    .exec();
  if (!doc || !Array.isArray(doc.bars) || doc.bars.length === 0) return null;
  return {
    bars: doc.bars.map((b) => ({
      time: Number(b.t),
      open: Number(b.o),
      high: Number(b.h),
      low: Number(b.l),
      close: Number(b.c),
      volume: Number(b.v) || 0,
    })),
    fetchedAt: new Date(doc.fetchedAt).getTime(),
  };
}

/** Overwrite a stored series. */
export async function writeTrainerBars(
  symbol: TrainerSymbol,
  timeframe: TrainerTimeframe,
  bars: readonly Candle[]
): Promise<void> {
  await TrainerBars.updateOne(
    { _id: trainerBarsKey(symbol, timeframe) },
    {
      $set: {
        symbol,
        timeframe,
        bars: bars.map((b) => ({
          t: b.time,
          o: b.open,
          h: b.high,
          l: b.low,
          c: b.close,
          v: b.volume || 0,
        })),
        fetchedAt: new Date(),
      },
    },
    { upsert: true }
  ).exec();
}
