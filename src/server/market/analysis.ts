// Turns raw candles into an investing.com-style technical analysis block:
// oscillator rows, moving-average rows, per-section summaries and one overall
// rating / score used to drive the gauge. Ported from the standalone `gauge`
// project; only types were added.

import * as ti from "./indicators";
import { detectEngulfing, isLastBarForming } from "./patterns";
import { getTimeframe } from "./timeframes";
import type { Candle, IndicatorRow, Rating, Section, Signal, SymbolMeta } from "./types";

export const RATINGS: Rating[] = ["strong_sell", "sell", "neutral", "buy", "strong_buy"];

// Net-vote ratio (|buy-sell| / total) at or above this turns Buy/Sell into
// Strong Buy/Strong Sell. Configurable from settings.
let strongRatio = 0.25;

export function setStrongRatio(ratio: number): void {
  const n = Number(ratio);
  if (Number.isFinite(n) && n > 0 && n <= 1) strongRatio = n;
}

export function getStrongRatio(): number {
  return strongRatio;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined || Number.isNaN(v) ? null : Number(v);

function row(name: string, rawValue: unknown, signal: Signal): IndicatorRow {
  return { name, value: num(rawValue), signal: signal || "neutral" };
}

function rateByLevels(value: number | null, buyBelow: number, sellAbove: number): Signal {
  if (value === null) return "neutral";
  if (value < buyBelow) return "buy";
  if (value > sellAbove) return "sell";
  return "neutral";
}

function signSignal(value: number | null): Signal {
  if (value === null) return "neutral";
  if (value > 0) return "buy";
  if (value < 0) return "sell";
  return "neutral";
}

function rateSummary(buy: number, sell: number, neutral: number): Rating {
  const total = buy + sell + neutral;
  if (!total || buy === sell) return "neutral";
  const ratio = Math.abs(buy - sell) / total;
  if (buy > sell) return ratio >= strongRatio ? "strong_buy" : "buy";
  return ratio >= strongRatio ? "strong_sell" : "sell";
}

function summarize(rows: IndicatorRow[]): Section {
  let buy = 0;
  let sell = 0;
  let neutral = 0;
  for (const r of rows) {
    if (r.signal === "buy") buy++;
    else if (r.signal === "sell") sell++;
    else neutral++;
  }
  return { buy, sell, neutral, rating: rateSummary(buy, sell, neutral), rows };
}

export function analyze(candles: Candle[], meta: Partial<SymbolMeta> = {}, timeframe = "4h") {
  if (!Array.isArray(candles) || candles.length < 30) {
    throw new Error(`Not enough candles to analyze (${candles ? candles.length : 0})`);
  }

  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const prevClose = closes.length > 1 ? closes[closes.length - 2] : price;
  const change = price - prevClose;
  const changePct = prevClose === 0 ? 0 : (change / prevClose) * 100;

  const rsi14 = ti.rsi(closes, 14);
  const stoch = ti.stochastic(candles, 9, 6, 3);
  const stochRsi = ti.stochRsi(closes, 14, 14, 3, 3);
  const macd = ti.macd(closes, 12, 26, 9);
  const adxRes = ti.adx(candles, 14);
  const wr = ti.williamsR(candles, 14);
  const cci = ti.cci(candles, 20);
  const atr14 = ti.atr(candles, 14);
  const hl = ti.highsLows(candles, 14);
  const uo = ti.ultimateOscillator(candles, 7, 14, 28);
  const roc14 = ti.roc(closes, 14);
  const bbp = ti.bullBearPower(candles, 13);

  const lastRsi = ti.last(rsi14);
  const lastK = ti.last(stoch.k);
  const lastStochRsi = ti.last(stochRsi.k);
  const lastMacd = ti.last(macd.macd);
  const lastSignal = ti.last(macd.signal);
  const lastAdx = ti.last(adxRes.adx);
  const lastPlus = ti.last(adxRes.plusDI);
  const lastMinus = ti.last(adxRes.minusDI);
  const lastWr = ti.last(wr);
  const lastCci = ti.last(cci);
  const lastAtr = ti.last(atr14);
  const lastHl = ti.last(hl);
  const lastUo = ti.last(uo);
  const lastRoc = ti.last(roc14);
  const lastBbp = ti.last(bbp);

  const macdSignal: Signal =
    lastMacd === null || lastSignal === null
      ? "neutral"
      : lastMacd > lastSignal
        ? "buy"
        : "sell";

  // ADX is a trend-strength filter: only acts when the trend is meaningful.
  const adxSignal: Signal =
    lastAdx === null || lastPlus === null || lastMinus === null
      ? "neutral"
      : lastAdx < 20
        ? "neutral"
        : lastPlus > lastMinus
          ? "buy"
          : "sell";

  const oscillators: IndicatorRow[] = [
    row("RSI(14)", lastRsi, rateByLevels(lastRsi, 30, 70)),
    row("STOCH(9,6)", lastK, rateByLevels(lastK, 20, 80)),
    row("STOCHRSI(14)", lastStochRsi, rateByLevels(lastStochRsi, 20, 80)),
    row("MACD(12,26)", lastMacd, macdSignal),
    row("ADX(14)", lastAdx, adxSignal),
    row("Williams %R", lastWr, rateByLevels(lastWr, -80, -20)),
    row("CCI(20)", lastCci, rateByLevels(lastCci, -100, 100)),
    row("ATR(14)", lastAtr, "neutral"),
    row("Highs/Lows(14)", lastHl, signSignal(lastHl)),
    row("Ultimate Oscillator", lastUo, rateByLevels(lastUo, 30, 70)),
    row("ROC", lastRoc, signSignal(lastRoc)),
    row("Bull/Bear Power(13)", lastBbp, signSignal(lastBbp)),
  ];

  const periods = [5, 10, 20, 50, 100, 200];
  const movingAverages: IndicatorRow[] = [];
  for (const p of periods) {
    const v = ti.last(ti.sma(closes, p));
    movingAverages.push(row(`MA${p}`, v, v === null ? "neutral" : price > v ? "buy" : "sell"));
  }
  for (const p of periods) {
    const v = ti.last(ti.ema(closes, p));
    movingAverages.push(row(`EMA${p}`, v, v === null ? "neutral" : price > v ? "buy" : "sell"));
  }

  const oscillatorSummary = summarize(oscillators);
  const maSummary = summarize(movingAverages);
  const overall = summarize([...oscillators, ...movingAverages]);

  const total = overall.buy + overall.sell + overall.neutral;
  const score = total ? (overall.buy - overall.sell) / total : 0;

  const lastCandle = candles[candles.length - 1];

  return {
    symbol: meta.symbol!,
    name: meta.name || meta.symbol!,
    type: meta.type || ("unknown" as const),
    timeframe,
    price,
    change,
    changePct,
    high: lastCandle.high,
    low: lastCandle.low,
    open: lastCandle.open,
    previousClose: prevClose,
    atr: lastAtr,
    candles: candles.length,
    summary: { ...overall, score, rating: overall.rating },
    oscillators: oscillatorSummary,
    movingAverages: maSummary,
    sparkline: closes.slice(-120),
    series: candles.slice(-180).map((c) => ({ t: c.time, c: c.close })),
    engulfing: detectEngulfing(candles, timeframe, isLastBarForming(candles, getTimeframe(timeframe).ms)),
    updatedAt: Date.now(),
  };
}