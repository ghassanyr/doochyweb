import type { BrokerMode } from "../broker/types";
import type { IntegrationTestResult } from "../integrations/types";

export interface Mt5BridgeConfig {
  bridgeUrl: string;
  apiKey: string | null;
  accountId: string;
  mode: BrokerMode;
  enabled: boolean;
  userId: string;
}

export interface Mt5SymbolRecord {
  symbol: string;
  lotSize: number;
  digits: number;
  minVolume: number;
  stepVolume: number;
  maxVolume: number;
  quoteAsset: string | null;
  quoteUsdFactor?: number | null;
}

export interface Mt5SetupIssues {
  errors: string[];
  warnings: string[];
}

const CACHE_MS = 60_000;

let cachedConfig: Mt5BridgeConfig | null = null;
let cachedAt = 0;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSymbol(value: unknown): string {
  return text(value)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function isLocalUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export function mt5ConfigFromValues(
  values: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env
): Mt5BridgeConfig {
  return {
    bridgeUrl: text(values.bridgeUrl).replace(/\/+$/, ""),
    apiKey: text(values.apiKey) || null,
    accountId: text(values.accountId),
    mode: text(values.mode) === "live" ? "live" : "demo",
    enabled: values.enabled === true || text(values.enabled).toLowerCase() === "true",
    userId: text(env.MARKET_MT5_USER_ID) || "market",
  };
}

export function mt5SetupIssues(
  values: Record<string, unknown>,
  apiKeyConfigured = false
): Mt5SetupIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const raw = text(values.bridgeUrl);
  let url: URL | null = null;
  if (raw) {
    try {
      url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors.push("Bridge URL must be an http(s) URL.");
      }
    } catch {
      errors.push("Bridge URL must be an http(s) URL.");
    }
  }
  if (url && url.protocol === "http:" && !isLocalUrl(url)) {
    warnings.push("Bridge URL is not https. Keep it on a private network or use TLS.");
  }
  if (url && !isLocalUrl(url) && !apiKeyConfigured) {
    warnings.push("Bridge API key is empty. Set one when the bridge is not loopback-only.");
  }
  if (text(values.mode) === "live") {
    warnings.push("Live MT5 mode is selected. Use demo for the public analysis page.");
  }
  return { errors, warnings };
}

export async function resolveMt5Config(force = false): Promise<Mt5BridgeConfig> {
  if (!force && cachedConfig && Date.now() - cachedAt < CACHE_MS) return cachedConfig;
  const { resolveIntegration } = await import("../integrations/store");
  const resolved = await resolveIntegration("mt5");
  const config = mt5ConfigFromValues(resolved.values);
  if (!config.enabled) {
    throw new Error("MT5 market analysis is disabled. Enable it in the MT5 integration.");
  }
  if (resolved.missing.length) {
    throw new Error(`MT5 is missing required fields: ${resolved.missing.join(", ")}`);
  }
  cachedConfig = config;
  cachedAt = Date.now();
  return config;
}

export function clearMt5ConfigCache(): void {
  cachedConfig = null;
  cachedAt = 0;
}

function requestUrl(
  config: Mt5BridgeConfig,
  path: string,
  params: Record<string, string | number | undefined> = {}
): string {
  const url = new URL(config.bridgeUrl);
  const base = url.pathname.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  url.pathname = `${base}/${suffix}`;
  url.search = "";
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  url.searchParams.set("account", config.accountId);
  return url.toString();
}

async function requestJson<T>(
  config: Mt5BridgeConfig,
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const res = await fetch(requestUrl(config, path, params), {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`MT5 bridge returned HTTP ${res.status}`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("MT5 bridge returned invalid JSON");
  }
}

function rows(payload: unknown, key: string): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const value = (payload as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function parseMt5Symbols(payload: unknown): Mt5SymbolRecord[] {
  const out: Mt5SymbolRecord[] = [];
  for (const row of rows(payload, "symbols")) {
    if (typeof row === "string") {
      out.push({
        symbol: row,
        lotSize: 100_000,
        digits: 2,
        minVolume: 0.01,
        stepVolume: 0.01,
        maxVolume: 100,
        quoteAsset: null,
      });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const symbol = text(item.symbol ?? item.name);
    if (!symbol) continue;
    out.push({
      symbol,
      lotSize: num(item.lotSize ?? item.lot_size, 100_000),
      digits: num(item.digits, 2),
      minVolume: num(item.minVolume ?? item.min_volume, 0.01),
      stepVolume: num(item.stepVolume ?? item.step_volume, 0.01),
      maxVolume: num(item.maxVolume ?? item.max_volume, 100),
      quoteAsset: text(item.quoteAsset ?? item.quote_asset) || null,
      quoteUsdFactor: item.quoteUsdFactor == null ? null : num(item.quoteUsdFactor, 0),
    });
  }
  return out;
}

export function parseMt5Candles(payload: unknown): {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}[] {
  const out: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[] = [];
  for (const row of rows(payload, "candles").concat(rows(payload, "bars"))) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const time = num(item.time ?? item.t, 0);
    const open = num(item.open ?? item.o, NaN);
    const high = num(item.high ?? item.h, NaN);
    const low = num(item.low ?? item.l, NaN);
    const close = num(item.close ?? item.c, NaN);
    if (!time || ![open, high, low, close].every(Number.isFinite)) continue;
    out.push({
      time: time < 1e12 ? time * 1000 : time,
      open,
      high,
      low,
      close,
      volume: num(item.volume ?? item.v, 0),
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

export async function mt5ListSymbols(config: Mt5BridgeConfig): Promise<Mt5SymbolRecord[]> {
  const payload = await requestJson<unknown>(config, "/symbols");
  return parseMt5Symbols(payload);
}

export async function mt5ResolveSymbol(
  config: Mt5BridgeConfig,
  symbol: string
): Promise<Mt5SymbolRecord | null> {
  const symbols = await mt5ListSymbols(config);
  const wanted = normalizeSymbol(symbol);
  return (
    symbols.find((row) => row.symbol === symbol) ??
    symbols.find((row) => normalizeSymbol(row.symbol) === wanted) ??
    null
  );
}

export async function mt5Quote(config: Mt5BridgeConfig, symbol: string) {
  const payload = await requestJson<Record<string, unknown>>(config, "/quote", { symbol });
  const bid = num(payload.bid, NaN);
  const ask = num(payload.ask ?? payload.bid, NaN);
  if (![bid, ask].every(Number.isFinite)) return null;
  return {
    symbol,
    bid,
    ask,
    digits: num(payload.digits, 2),
    time: num(payload.time, Date.now()),
  };
}

export async function mt5FetchCandles(
  config: Mt5BridgeConfig,
  symbol: string,
  timeframe: string,
  query: { from?: number; to?: number; count?: number } = {}
) {
  const payload = await requestJson<unknown>(config, "/candles", {
    symbol,
    timeframe,
    from: query.from,
    to: query.to,
    count: query.count,
  });
  return parseMt5Candles(payload);
}

export async function testMt5Bridge(
  values: Record<string, unknown>
): Promise<IntegrationTestResult> {
  const issues = mt5SetupIssues(values, Boolean(text(values.apiKey)));
  if (issues.errors.length) return { ok: false, message: issues.errors[0] };
  const config = mt5ConfigFromValues(values);
  if (!config.bridgeUrl || !config.accountId) {
    return { ok: false, message: "Bridge URL and account ID are required." };
  }
  try {
    const health = await requestJson<Record<string, unknown>>(config, "/health");
    const symbols = await mt5ListSymbols(config);
    const label = text(health.broker) || "MT5";
    return {
      ok: true,
      message: `${label} bridge reachable with ${symbols.length} symbol${symbols.length === 1 ? "" : "s"}.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Could not reach the MT5 bridge: ${err instanceof Error ? err.message : "network error"}`,
    };
  }
}
