// Persistent cache of bars, in Mongo. Holds both cTrader and Binance series.
//
// The pacer means a cold fetch costs roughly a second per few symbols, which
// the user sees as a slow page every time the process restarts or a bar TTL
// expires. Storing the bars makes a cold read a single indexed document fetch,
// so the page renders immediately from what was already collected and refreshes
// happen in the background.
//
// Bars are stored as flat number arrays rather than subdocuments: 480 bars as
// [time, o, h, l, c, v] tuples is a fraction of the size of 480 nested objects,
// and the whole document stays well inside Mongo's 16MB ceiling.
//
// Documents are keyed per source:
//
//   cTrader: "<ctid>:<symbolId>:<timeframe>". The broker's symbolId is stable for
//   a given account, and including the account means pointing the page at a
//   different account cannot read another account's series.
//   Binance: "binance:<pair>:<timeframe>". The pair name is already unique, and
//   the "binance:" prefix cannot collide with the numeric cTrader form.
//
// The cTrader key is unchanged, so series stored before Binance was added stay
// readable and are not refetched.

import mongoose from "mongoose";

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

const marketCandlesSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    /** Absent for Binance series. */
    ctid: { type: Number },
    /** Absent for Binance series. */
    symbolId: { type: Number },
    /** Which source wrote this series. Defaults to cTrader for older documents. */
    provider: { type: String, required: false },
    timeframe: { type: String, required: true },
    bars: { type: [BarSchema], default: [] },
    fetchedAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false }
);

marketCandlesSchema.index({ fetchedAt: 1 });

type CandleDoc = { t: number; o: number; h: number; l: number; c: number; v: number };
type MarketCandleDoc = {
  _id: string;
  ctid?: number;
  symbolId?: number;
  provider?: string;
  timeframe: string;
  bars: CandleDoc[];
  fetchedAt: Date;
};

export const MarketCandles =
  (mongoose.models.MarketCandles as mongoose.Model<MarketCandleDoc> | undefined) ||
  mongoose.model<MarketCandleDoc>("MarketCandles", marketCandlesSchema);

export interface StoredBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function seriesKey(ctid: number, symbolId: number, timeframe: string): string {
  return `${ctid}:${symbolId}:${timeframe}`;
}

export function binanceSeriesKey(pair: string, timeframe: string): string {
  return `binance:${pair}:${timeframe}`;
}

export function mt5SeriesKey(symbol: string, timeframe: string): string {
  return `mt5:${symbol}:${timeframe}`;
}

/** Read a stored series, or null when it has never been fetched. */
export async function readSeries(
  ctid: number,
  symbolId: number,
  timeframe: string
): Promise<{ bars: StoredBar[]; fetchedAt: number } | null> {
  return readByKey(seriesKey(ctid, symbolId, timeframe));
}

export async function readBinanceSeries(
  pair: string,
  timeframe: string
): Promise<{ bars: StoredBar[]; fetchedAt: number } | null> {
  return readByKey(binanceSeriesKey(pair, timeframe));
}

export async function readMt5Series(
  symbol: string,
  timeframe: string
): Promise<{ bars: StoredBar[]; fetchedAt: number } | null> {
  return readByKey(mt5SeriesKey(symbol, timeframe));
}

async function readByKey(key: string): Promise<{ bars: StoredBar[]; fetchedAt: number } | null> {
  const doc = await MarketCandles.findById(key)
    .select("bars fetchedAt")
    .lean()
    .exec();
  if (!doc || !Array.isArray(doc.bars) || doc.bars.length === 0) return null;
  return {
    bars: doc.bars.map((b: any) => ({
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
export async function writeSeries(
  ctid: number,
  symbolId: number,
  timeframe: string,
  bars: StoredBar[]
): Promise<void> {
  await writeByKey(seriesKey(ctid, symbolId, timeframe), { ctid, symbolId, timeframe, bars });
}

export async function writeBinanceSeries(
  pair: string,
  timeframe: string,
  bars: StoredBar[]
): Promise<void> {
  await writeByKey(binanceSeriesKey(pair, timeframe), { provider: "binance", timeframe, bars });
}

export async function writeMt5Series(
  symbol: string,
  timeframe: string,
  bars: StoredBar[]
): Promise<void> {
  await writeByKey(mt5SeriesKey(symbol, timeframe), { provider: "mt5", timeframe, bars });
}

async function writeByKey(
  key: string,
  fields: {
    ctid?: number;
    symbolId?: number;
    provider?: string;
    timeframe: string;
    bars: StoredBar[];
  }
): Promise<void> {
  await MarketCandles.updateOne(
    { _id: key },
    {
      $set: {
        ...fields,
        bars: fields.bars.map((b) => ({
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

// Guard against unbounded growth if someone watches a very large universe. At
// 480 bars a series is roughly 30KB, so this is about 40MB of bars at the cap.
const MAX_SERIES = 1200;

/** Drop the least recently fetched series when over the cap. */
export async function pruneSeries(): Promise<number> {
  const total = await MarketCandles.estimatedDocumentCount().exec();
  if (total <= MAX_SERIES) return 0;
  const excess = total - MAX_SERIES;
  const victims = await MarketCandles.find({}, { _id: 1 })
    .sort({ fetchedAt: 1 })
    .limit(excess)
    .lean()
    .exec();
  if (!victims.length) return 0;
  const res = await MarketCandles.deleteMany({ _id: { $in: victims.map((v) => v._id) } }).exec();
  return res.deletedCount ?? 0;
}

/** Remove every stored series, e.g. when the account changes. */
export async function clearSeries(): Promise<void> {
  await MarketCandles.deleteMany({}).exec();
}