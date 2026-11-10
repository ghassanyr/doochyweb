// Shared types for the Analysis (market) engine, ported from the standalone
// `gauge` project. The engine itself is pure: indicators and the rating rules
// take candles and return numbers, with no I/O anywhere in this directory.

/** One OHLC bar. `time` is epoch milliseconds. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Asset class, used to pick the provider priority order. */
export type SymbolType = "forex" | "commodity" | "crypto" | "index" | "stock" | "unknown";

/** Provider-specific ticker mappings. Each is best-effort; the orchestrator
 *  walks providers in priority order and uses the first that returns candles. */
export interface ProviderMap {
  /** Broker symbol name. Set by the symbol resolver, not by the catalog. */
  ctrader?: string | null;
  /** Binance spot pair, e.g. "SOLUSDT". Set only for crypto markets. */
  binance?: string | null;
}

/** Canonical description of a tradable market. */
export interface SymbolMeta {
  symbol: string;
  name: string;
  type: SymbolType;
  providers: ProviderMap;
  note?: string;
  proxy?: string;
}

/** A chart timeframe, in cTrader's own vocabulary. */
export interface Timeframe {
  id: string;
  label: string;
  ms: number;
  ttl: number;
  /** ProtoOATrendbarPeriod enum value for this bar size. */
  ctrader: number | null;
  /** Largest (toTimestamp - fromTimestamp) cTrader accepts for this period. */
  ctraderMaxRange: number;
  /** Binance klines interval, e.g. "1h". Null where Binance cannot serve it. */
  binance?: string | null;
  /** The longer timeframe this period is aggregated from, when the source does
   *  not offer it directly. Binance publishes no weekly or monthly klines, so
   *  1w and 1M are built from daily bars. */
  aggregate?: string;
  /** Calendar bucket for an aggregated period. Weeks start Monday, months start
   *  on the 1st, both UTC. A fixed day count would misplace both: epoch-aligned
   *  weeks begin on Thursday, and a "month" is not 30 days. */
  bucket?: "week" | "month";
}

/** The five-level verdict, ordered from most bearish to most bullish. */
export type Rating = "strong_sell" | "sell" | "neutral" | "buy" | "strong_buy";

/** Per-indicator verdict - one notch coarser than a Rating. */
export type Signal = "buy" | "sell" | "neutral";

/** One indicator's latest reading and its verdict. */
export interface IndicatorRow {
  name: string;
  value: number | null;
  signal: Signal;
}

/** Vote tally plus the aggregate verdict for a group of indicators. */
export interface Section {
  buy: number;
  sell: number;
  neutral: number;
  rating: Rating;
  rows: IndicatorRow[];
}

/** The full analysis for one symbol on one timeframe. */
export interface Analysis {
  symbol: string;
  name: string;
  type: SymbolType;
  timeframe: string;
  price: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  atr: number | null;
  candles: number;
  summary: { buy: number; sell: number; neutral: number; score: number; rating: Rating };
  oscillators: Section;
  movingAverages: Section;
  sparkline: number[];
  series: { t: number; c: number }[];
  /** Body engulfing on the last closed bar, from M15 up. Null otherwise. */
  engulfing: "bullish" | "bearish" | null;
  updatedAt: number;
}

/** An analysis as returned over HTTP, including data-source provenance. */
export interface AnalysisResponse extends Analysis {
  ok: true;
  provider: ProviderId;
  cached: boolean;
  warnings: ProviderWarning[];
  meta: { note?: string };
  timeframeRatings?: Record<string, TimeframeRating>;
  /** 4H sweep of the prior 5 closed bars. Independent of the selected timeframe. */
  sweep4h: "high" | "low" | "both" | null;
}

/** The failure shape, so the UI can render a per-card error. */
export interface AnalysisError {
  ok: false;
  symbol: string;
  name?: string;
  type?: SymbolType;
  timeframe?: string;
  error: string;
}

/** Compact all-timeframe verdict used by the card's MTF confluence ribbon. */
export interface ConfluenceResponse {
  symbol: string;
  updatedAt: number;
  timeframes: Record<string, TimeframeRating>;
}

/** Compact per-timeframe verdict used by the detail view's rating strip. */
export interface TimeframeRating {
  rating?: Rating;
  score?: number;
  buy?: number;
  sell?: number;
  neutral?: number;
  price?: number;
  provider?: ProviderId;
  error?: string;
}

export type ProviderId = "ctrader" | "binance";

export interface ProviderWarning {
  provider: ProviderId;
  message: string;
}

/** Everything a provider needs to fetch one series. */
export interface FetchContext {
  settings: AnalysisSettings;
}

export interface CandleResult {
  candles: Candle[];
  provider: ProviderId;
}

/** Provider contract. `supports` is a pre-filter; `fetchCandles` throws to hand
 *  off to the next provider in the priority order. */
export interface MarketProvider {
  readonly id: ProviderId;
  supports(meta: SymbolMeta, settings: AnalysisSettings, tf: Timeframe): boolean;
  fetchCandles(meta: SymbolMeta, tf: Timeframe, ctx: FetchContext): Promise<Candle[]>;
}

/** The cTrader account whose symbols and prices back the Analysis page. */
export interface MarketAccount {
  userId: string;
  ctid: number;
  isLive: boolean;
}

/** Settings the UI may read and write. cTrader credentials live in the
 *  credentials collection, never here, and are never returned over the API. */
export interface AnalysisSettings {
  refreshSeconds: number;
  defaultTimeframe: string;
  strongRatio: number;
  /** Which cTrader account is supplying the prices, for display only. */
  account: { ctid: number; login: number; broker: string; isLive: boolean; symbolCount: number } | null;
  /** Set when cTrader is unreachable, so the UI can explain an empty page. */
  accountError: string | null;
}

/** A catalog entry for the add-symbol autocomplete. */
export interface CatalogEntry {
  symbol: string;
  name: string;
  type: SymbolType;
  /** Present when this entry is served by a non-broker source. */
  provider?: ProviderId;
}