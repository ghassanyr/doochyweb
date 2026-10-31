const TOKEN_KEY = "doochyweb_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = opts.token ?? getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError("Network error - is the server running?", 0);
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export interface AccountView {
  ctid: number;
  login: number;
  broker: string;
  isLive: boolean;
  balance: number | null;
  currency: string | null;
  nickname: string | null;
  color: string | null;
}

// Account carried on a row when its data is shown in combined mode, so the
// table can say which account a position/order belongs to.
export interface RowAccount {
  ctid: number;
  login: number;
  isLive: boolean;
  nickname: string | null;
  color: string | null;
}

export interface PositionRow {
  positionId: number;
  symbol: string;
  side: "BUY" | "SELL";
  lots: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  netUsd: number | null;
  digits: number;
  openTimestamp: number | null;
  account?: RowAccount;
}

export interface OrderRow {
  orderId: number;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: string;
  price: number;
  lots: number;
  stopLoss: number | null;
  takeProfit: number | null;
  digits: number;
  expirationTimestamp: number | null;
  expirationType: "GTC" | "GTD";
  account?: RowAccount;
}

export interface ConnectInput {
  /** Omit to reuse the stored value. The OpenAPI app rarely changes. */
  clientId?: string;
  /** Omit to reuse the stored value. */
  clientSecret?: string;
  accessToken: string;
  refreshToken: string;
}

export type Side = "BUY" | "SELL";
export type OrderKind = "MARKET" | "LIMIT" | "STOP";

export interface TicketInput {
  symbol: string;
  side: Side;
  orderType: OrderKind;
  lots: number;
  price?: number | null;
  sl?: number | null;
  tp?: number | null;
}

export interface OrderPreview {
  symbol: string;
  snapped: boolean;
  lots: number;
  minLots: number | null;
  lotStep: number | null;
  entryRef: number | null;
  riskUSD: number | null;
  rewardUSD: number | null;
  rr: number | null;
  warnings: string[];
}

export interface WriteResult {
  ok: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Analysis (market technical analysis), see src/server/market
// ---------------------------------------------------------------------------

export const marketApi = {
  config: () =>
    request<import("./market/types").MarketConfig>("/api/market/config"),

  search: (q: string) =>
    request<{ items: import("./market/types").CatalogEntry[] }>(
      `/api/market/search?q=${encodeURIComponent(q)}`
    ),

  watchlist: () => request<{ symbols: string[]; order: string[] }>("/api/market/watchlist"),

  saveOrder: (order: string[]) =>
    request<{ order: string[] }>("/api/market/watchlist/order", {
      method: "POST",
      body: { order },
    }),

  addSymbol: (symbol: string) =>
    request<{ symbols: string[] }>("/api/market/watchlist", { method: "POST", body: { symbol } }),

  removeSymbol: (symbol: string) =>
    request<{ symbols: string[] }>(`/api/market/watchlist?symbol=${encodeURIComponent(symbol)}`, {
      method: "DELETE",
    }),

  analysis: (timeframe: string) =>
    request<{
      timeframe: string;
      results: import("./market/types").MarketResult[];
      updatedAt: number;
    }>(`/api/market/analysis?timeframe=${encodeURIComponent(timeframe)}`),

  detail: (symbol: string, timeframe: string, all: boolean) =>
    request<import("./market/types").MarketResult>(
      `/api/market/analysis/${encodeURIComponent(symbol)}` +
        `?timeframe=${encodeURIComponent(timeframe)}${all ? "&all=1" : ""}`
    ),

  // Force-refresh one market, bypassing the server's candle cache.
  refreshSymbol: (symbol: string, timeframe: string) =>
    request<import("./market/types").MarketResult>(
      `/api/market/analysis/${encodeURIComponent(symbol)}/refresh` +
        `?timeframe=${encodeURIComponent(timeframe)}`,
      { method: "POST" }
    ),

  captures: (limit = 40) =>
    request<{ captures: import("./market/types").OpenclawCapture[]; updatedAt: number }>(
      `/api/market/captures?limit=${limit}`
    ),

  breakouts: (params: { limit?: number; offset?: number; types?: string; session?: string; symbol?: string }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" ) qs.set(k, String(v));
    return request<import("./market/types").BreakoutsResponse>(`/api/market/breakouts?${qs.toString()}`);
  },

  settings: () => request<import("./market/types").MarketSettings>("/api/market/settings"),

  saveSettings: (patch: Partial<import("./market/types").MarketSettings>) =>
    request<import("./market/types").MarketSettings>("/api/market/settings", {
      method: "POST",
      body: patch,
    }),
};

export const api = {
  register: (username: string, password: string) =>
    request<{ token: string }>("/api/auth/register", { method: "POST", body: { username, password } }),

  login: (username: string, password: string) =>
    request<{ token: string }>("/api/auth/login", { method: "POST", body: { username, password } }),

  me: (token?: string) =>
    request<{ hasCredentials: boolean; clientIdMasked: string | null; accounts: AccountView[] }>(
      "/api/me",
      { token }
    ),

  connect: (creds: ConnectInput, token?: string) =>
    request<{ accounts: AccountView[] }>("/api/connect", { method: "POST", body: creds, token }),

  accounts: () => request<{ accounts: AccountView[] }>("/api/accounts"),

  positions: (ctid: number) => request<{ positions: PositionRow[] }>(`/api/accounts/${ctid}/positions`),

  orders: (ctid: number) => request<{ orders: OrderRow[] }>(`/api/accounts/${ctid}/orders`),

  setPrefs: (ctid: number, prefs: { nickname?: string; color?: string | null }, token?: string) =>
    request<{ ok: boolean }>(`/api/accounts/${ctid}/prefs`, {
      method: "PUT",
      body: prefs,
      token,
    }),

  // ---- manual order management (phase 2) ----

  previewOrder: (ctid: number, input: TicketInput) =>
    request<{ preview: OrderPreview }>(`/api/accounts/${ctid}/preview`, { method: "POST", body: input }),

  placeOrder: (ctid: number, input: TicketInput) =>
    request<WriteResult>(`/api/accounts/${ctid}/orders`, { method: "POST", body: input }),

  modifyOrder: (
    ctid: number,
    orderId: number,
    changes: { price?: number | null; sl?: number | null; tp?: number | null }
  ) =>
    request<WriteResult>(`/api/accounts/${ctid}/orders/${orderId}`, { method: "PATCH", body: changes }),

  cancelOrder: (ctid: number, orderId: number) =>
    request<WriteResult>(`/api/accounts/${ctid}/orders/${orderId}/cancel`, { method: "POST" }),

  closePosition: (ctid: number, positionId: number) =>
    request<WriteResult>(`/api/accounts/${ctid}/positions/${positionId}/close`, { method: "POST" }),

  amendPosition: (ctid: number, positionId: number, sl?: number | null, tp?: number | null) =>
    request<WriteResult>(`/api/accounts/${ctid}/positions/${positionId}`, { method: "PATCH", body: { sl, tp } }),
};