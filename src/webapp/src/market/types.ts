// API types + calls for the Analysis page. Kept separate from ./api.ts because
// the trading API and the market API have nothing in common beyond auth, and
// mixing them would bloat the module every other screen imports.

export type Rating = "strong_sell" | "sell" | "neutral" | "buy" | "strong_buy";
export type Signal = "buy" | "sell" | "neutral";
export type SymbolType = "forex" | "commodity" | "crypto" | "index" | "stock" | "unknown";

export interface IndicatorRow {
  name: string;
  value: number | null;
  signal: Signal;
}

export interface Section {
  buy: number;
  sell: number;
  neutral: number;
  rating: Rating;
  rows: IndicatorRow[];
}

export interface ProviderWarning {
  provider: string;
  message: string;
}

export interface TimeframeRating {
  rating?: Rating;
  score?: number;
  buy?: number;
  sell?: number;
  neutral?: number;
  price?: number;
  provider?: string;
  error?: string;
}

export interface MarketAnalysis {
  ok: true;
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
  engulfing: "bullish" | "bearish" | null;
  updatedAt: number;
  provider: string;
  cached: boolean;
  warnings: ProviderWarning[];
  meta: { note?: string };
  timeframeRatings?: Record<string, TimeframeRating>;
  sweep4h: "high" | "low" | "both" | null;
}

export interface MarketAnalysisError {
  ok: false;
  symbol: string;
  name?: string;
  type?: SymbolType;
  timeframe?: string;
  error: string;
}

export type MarketResult = MarketAnalysis | MarketAnalysisError;

// ---- OpenClaw capture log (written by the doochy-scraper cron) ----

export interface CaptureChange {
  symbol: string;
  field: string;
  old: string;
  new: string;
}

export interface CaptureAlignment {
  symbol: string;
  details: string;
  type: string;
  signal: string;
}

export interface CaptureNeedle {
  symbol: string;
  kind: string;
  level: string;
}

export interface OpenclawCapture {
  schema_version: number | null;
  timestamp_utc: string;
  session: string;
  capture_type: string;
  market_count: number;
  changes: CaptureChange[];
  true_alignments: { engulf_1h_4h: CaptureAlignment[]; triple: CaptureAlignment[] };
  needles_fired: CaptureNeedle[];
  summary: {
    strong_buy: number;
    strong_sell: number;
    engulf_alignments: number;
    triple_alignments: number;
  };
  next_check_utc: string | null;
}

export interface CatalogEntry {
  symbol: string;
  name: string;
  type: SymbolType;
}

export interface MarketAccount {
  ctid: number;
  login: number;
  broker: string;
  isLive: boolean;
  symbolCount: number;
}

export interface MarketSettings {
  refreshSeconds: number;
  defaultTimeframe: string;
  strongRatio: number;
  /** Which cTrader account supplies prices. Display only, never credentials. */
  account: MarketAccount | null;
  /** Set when no usable account is connected, so the page can explain itself. */
  accountError: string | null;
}

export interface MarketConfig {
  timeframes: { id: string; label: string }[];
  defaultTimeframe: string;
  settings: MarketSettings;
  catalog: CatalogEntry[];
}
// ---- Breakouts (written by doochy-breakout-storage, served by /api/market/breakouts) ----

export type BreakoutType = "resistance_break" | "support_break" | "pattern_break";

export interface Breakout {
  /** Stable per-event key shared with the research-note API and deep links. */
  event_key?: string;
  symbol: string;
  type: BreakoutType;
  level_price: number | null;
  level_type: string;
  break_price: number | null;
  break_atr_mult: number | null;
  confirmation: string;
  session: string;
  timestamp_utc: string;
  asset_class: SymbolType;
}

export interface BreakoutRunStatus {
  timestamp_utc: string;
  asOf: string;
  evaluated: number;
  skipped: number;
  skippedDetail: Record<string, string>;
  newBreakouts: number;
  error: string | null;
}

export interface NarrationBriefHistory {
  sample_size: number;
  pool_size: number;
  up_first: number;
  down_first: number;
  tie: number;
  neither: number;
  decisive_up_share: number | null;
  decisive_down_share: number | null;
  base_n: number;
  base_up_share: number | null;
  base_down_share: number | null;
  recent_n: number;
  recent_up_share: number | null;
  recent_down_share: number | null;
  recent_conflicts: boolean;
  median_mfe: number | null;
  median_mae: number | null;
  base_median_mfe: number | null;
  base_median_mae: number | null;
  match_train: number;
  match_test: number;
}

export interface NarrationBrief {
  symbol: string;
  event: string;
  direction: "above" | "below";
  session: string;
  level_price: number;
  level_type: string;
  break_price: number;
  break_atr_mult: number;
  invalidation_level: number;
  history: NarrationBriefHistory | null;
  quality: string[];
  limits: string[];
}

export interface NarrationNote {
  event_key?: string;
  symbol: string | null;
  text: string;
  model: string;
  created_at: string;
  prompt_version: number;
  brief?: NarrationBrief | null;
}

export interface BreakoutsResponse {
  enabled: boolean;
  total: number;
  breakouts: Breakout[];
  updatedAt: number;
  lastRun: BreakoutRunStatus | null;
}
