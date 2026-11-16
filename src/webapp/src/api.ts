const TOKEN_KEY = "doochyweb_token";

export type UserRole = "user" | "admin";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
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
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status, data);
  }
  return data as T;
}

async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path, { headers });
  } catch {
    throw new ApiError("Network error - is the server running?", 0);
  }

  if (!res.ok) {
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON response */
    }
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status, data);
  }

  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const name = match?.[1]?.trim() || fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  currency?: string | null;
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

export interface OrderHistoryRow {
  dealId: number;
  orderId: number | null;
  positionId: number | null;
  symbol: string;
  side: "BUY" | "SELL";
  lots: number;
  entryPrice: number;
  exitPrice: number;
  grossProfit: number;
  swap: number;
  commission: number;
  net: number;
  digits: number;
  closeTimestamp: number;
  account?: RowAccount;
}

export interface OrderHistoryResult {
  trades: OrderHistoryRow[];
  days: number;
  truncated: boolean;
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

// Live bid/ask for one symbol on one account. `time` is the broker tick's epoch
// milliseconds, so the ticket can tell a fresh quote from the last one seen.
export interface SymbolQuote {
  symbol: string;
  bid: number;
  ask: number;
  digits: number;
  time: number;
}

export interface WriteResult {
  ok: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Analysis (market technical analysis), see src/server/market
// ---------------------------------------------------------------------------

export type WatchlistMode = "site" | "mine";

export interface MarketWatchlist {
  symbols: string[];
  order: string[];
  mode: WatchlistMode;
  limit: number;
}

export const marketApi = {
  config: () =>
    request<import("./market/types").MarketConfig>("/api/market/config"),

  search: (q: string) =>
    request<{ items: import("./market/types").CatalogEntry[] }>(
      `/api/market/search?q=${encodeURIComponent(q)}`
    ),

  // Effective list for the caller, plus the mode and personal cap.
  watchlist: () => request<MarketWatchlist>("/api/market/watchlist"),

  // The site list, used by the admin editor regardless of the admin's own mode.
  siteWatchlist: () =>
    request<{ symbols: string[]; order: string[] }>("/api/market/watchlist/public"),

  setWatchlistMode: (mode: WatchlistMode) =>
    request<MarketWatchlist>("/api/market/watchlist/mode", {
      method: "PUT",
      body: { mode },
    }),

  // Personal list writes. These fail while the caller is viewing the site list.
  saveOrder: (order: string[]) =>
    request<MarketWatchlist>("/api/market/watchlist/mine/order", {
      method: "POST",
      body: { order },
    }),

  addSymbol: (symbol: string) =>
    request<MarketWatchlist>("/api/market/watchlist/mine", {
      method: "POST",
      body: { symbol },
    }),

  removeSymbol: (symbol: string) =>
    request<MarketWatchlist>(`/api/market/watchlist/mine?symbol=${encodeURIComponent(symbol)}`, {
      method: "DELETE",
    }),

  // Site list writes, admin only.
  saveSiteOrder: (order: string[]) =>
    request<{ order: string[] }>("/api/market/watchlist/public/order", {
      method: "POST",
      body: { order },
    }),

  addSiteSymbol: (symbol: string) =>
    request<{ symbols: string[] }>("/api/market/watchlist/public", {
      method: "POST",
      body: { symbol },
    }),

  removeSiteSymbol: (symbol: string) =>
    request<{ symbols: string[] }>(
      `/api/market/watchlist/public?symbol=${encodeURIComponent(symbol)}`,
      { method: "DELETE" }
    ),

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

  // Compact all-timeframe verdict for the card's MTF ribbon. Cached server-side
  // until a timeframe's bars change; independent of the selected timeframe.
  confluence: (symbol: string) =>
    request<import("./market/types").ConfluenceResponse>(
      `/api/market/analysis/${encodeURIComponent(symbol)}/confluence`
    ),

  // Force-refresh one market, bypassing the server's candle cache. `all` also
  // attaches the per-timeframe strip the detail sheet shows.
  refreshSymbol: (symbol: string, timeframe: string, all = false) =>
    request<import("./market/types").MarketResult>(
      `/api/market/analysis/${encodeURIComponent(symbol)}/refresh` +
        `?timeframe=${encodeURIComponent(timeframe)}${all ? "&all=1" : ""}`,
      { method: "POST" }
    ),

  captures: (limit = 40) =>
    request<{ captures: import("./market/types").MarketSnapshot[]; updatedAt: number }>(
      `/api/market/captures?limit=${limit}`
    ),

  breakouts: (params: { limit?: number; offset?: number; types?: string; session?: string; symbol?: string }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" ) qs.set(k, String(v));
    return request<import("./market/types").BreakoutsResponse>(`/api/market/breakouts?${qs.toString()}`);
  },

  // Published research note for one breakout event. 404 = not generated yet.
  narration: (eventKey: string) =>
    request<import("./market/types").NarrationNote>(
      `/api/market/narrations?event=${encodeURIComponent(eventKey)}`
    ),

  settings: () => request<import("./market/types").MarketSettings>("/api/market/settings"),

  saveSettings: (patch: Partial<import("./market/types").MarketSettings>) =>
    request<import("./market/types").MarketSettings>("/api/market/settings", {
      method: "POST",
      body: patch,
    }),
};

// ---------------------------------------------------------------------------
// Signals (public feed, admin-managed), see src/server/signals
// ---------------------------------------------------------------------------

export interface SignalInputPayload {
  symbol: string;
  direction: "buy" | "sell";
  entry?: number | null;
  /** Upper bound when entry is a range; null or omitted for a single entry. */
  entryMax?: number | null;
  target: number;
  target2?: number | null;
  target3?: number | null;
  stop: number;
  timeframe?: string | null;
  note?: string;
  expiresAt?: string | null;
  /** Retry a create despite an existing active signal for the same pair. */
  force?: boolean;
}

export const signalsApi = {
  list: (params: { status?: string; symbol?: string; direction?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return request<import("./signals/types").SignalListResponse>(`/api/signals?${qs.toString()}`);
  },

  get: (id: string) =>
    request<{ signal: import("./signals/types").Signal }>(`/api/signals/${encodeURIComponent(id)}`),

  stats: () => request<import("./signals/types").SignalStats>("/api/signals/stats"),

  performance: () =>
    request<import("./signals/types").SignalPerformance>("/api/signals/performance"),

  prices: (symbols: string[]) =>
    request<{ prices: Record<string, import("./signals/types").PricePoint> }>(
      `/api/signals/prices?symbols=${encodeURIComponent(symbols.join(","))}`
    ),

  create: (input: SignalInputPayload) =>
    request<{ signal: import("./signals/types").Signal }>("/api/signals", {
      method: "POST",
      body: input,
    }),

  update: (id: string, patch: Partial<SignalInputPayload>) =>
    request<{ signal: import("./signals/types").Signal }>(`/api/signals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    }),

  postUpdate: (id: string, note: string) =>
    request<{ signal: import("./signals/types").Signal }>(
      `/api/signals/${encodeURIComponent(id)}/updates`,
      { method: "POST", body: { note } }
    ),

  invalidate: (id: string, reason: string) =>
    request<{ signal: import("./signals/types").Signal }>(
      `/api/signals/${encodeURIComponent(id)}/invalidate`,
      { method: "POST", body: { reason } }
    ),

  restore: (id: string) =>
    request<{ signal: import("./signals/types").Signal }>(
      `/api/signals/${encodeURIComponent(id)}/restore`,
      { method: "POST" }
    ),

  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/signals/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

// ---------------------------------------------------------------------------
// Telegram notifications, see src/server/telegram
// ---------------------------------------------------------------------------

export interface TelegramStatus {
  enabled: boolean;
  botUsername: string;
  linked: boolean;
  username: string | null;
  firstName: string | null;
  notificationsEnabled: boolean;
  linkedAt: string | null;
  lastError: string | null;
}

export interface TelegramLinkResponse {
  code: string;
  expiresAt: string;
  deepLink: string;
  botUsername: string;
}

export const telegramApi = {
  status: () => request<TelegramStatus>("/api/telegram/status"),

  link: () => request<TelegramLinkResponse>("/api/telegram/link", { method: "POST" }),

  unlink: () => request<{ ok: boolean }>("/api/telegram/unlink", { method: "POST" }),

  setPrefs: (notificationsEnabled: boolean) =>
    request<{ ok: boolean; notificationsEnabled: boolean }>("/api/telegram/prefs", {
      method: "PATCH",
      body: { notificationsEnabled },
    }),

  test: () => request<{ ok: boolean }>("/api/telegram/test", { method: "POST" }),
};

// ---------------------------------------------------------------------------
// Trade Journal, see src/server/journal
// ---------------------------------------------------------------------------

export type JournalSource = "manual" | "ctrader";
export type JournalSide = "buy" | "sell";
export type JournalStatus = "open" | "closed";

export interface JournalEntry {
  id: string;
  source: JournalSource;
  dealId: number | null;
  accountCtid: number | null;
  accountLabel: string | null;
  symbol: string;
  side: JournalSide;
  lots: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  stop: number | null;
  target: number | null;
  pnl: number | null;
  fees: number | null;
  openedAt: string | null;
  closedAt: string | null;
  status: JournalStatus;
  verified: boolean;
  strategy: string;
  tags: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface JournalStats {
  total: number;
  open: number;
  closed: number;
  verified: number;
  manual: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgPnl: number | null;
  totalPnl: number;
  profitFactor: number | null;
  bestPnl: number | null;
  worstPnl: number | null;
}

export interface JournalListResponse {
  entries: JournalEntry[];
  total: number;
  stats: JournalStats;
  lastSyncedAt: string | null;
}

export interface JournalInputPayload {
  symbol: string;
  side: JournalSide;
  lots?: number | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  stop?: number | null;
  target?: number | null;
  pnl?: number | null;
  fees?: number | null;
  openedAt?: string | null;
  closedAt?: string | null;
  status: JournalStatus;
  strategy?: string;
  tags?: string[];
  note?: string;
}

export interface JournalImportResult {
  imported: number;
  skipped: number;
  total: number;
  accountLabel: string;
}

function filterQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  return qs.toString();
}

export const journalApi = {
  list: (params: { status?: string; source?: string; symbol?: string; limit?: number; offset?: number } = {}) =>
    request<JournalListResponse>(`/api/journal?${filterQuery(params)}`),

  create: (input: JournalInputPayload) =>
    request<{ entry: JournalEntry }>("/api/journal", { method: "POST", body: input }),

  update: (id: string, input: JournalInputPayload) =>
    request<{ entry: JournalEntry }>(`/api/journal/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    }),

  updateNote: (id: string, note: string) =>
    request<{ entry: JournalEntry }>(`/api/journal/${encodeURIComponent(id)}/note`, {
      method: "PATCH",
      body: { note },
    }),

  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/journal/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // The CSV endpoint needs the bearer token, so it cannot be a plain link.
  exportCsv: async (params: { status?: string; source?: string; symbol?: string } = {}) => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`/api/journal/export?${filterQuery(params)}`, { headers });
    if (!res.ok) throw new ApiError("Could not export the journal", res.status);
    return res.blob();
  },
};

// ---------------------------------------------------------------------------
// Price alerts, see src/server/alerts
// ---------------------------------------------------------------------------

export type AlertCondition = "above" | "below";
export type AlertStatus = "active" | "triggered" | "paused";

export interface AlertView {
  id: string;
  symbol: string;
  condition: AlertCondition;
  level: number;
  note: string;
  status: AlertStatus;
  triggeredAt: string | null;
  triggeredPrice: number | null;
  lastPrice: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertCounts {
  active: number;
  triggered: number;
  paused: number;
  total: number;
}

export interface AlertListResponse {
  alerts: AlertView[];
  counts: AlertCounts;
}

export interface AlertInputPayload {
  symbol: string;
  condition: AlertCondition;
  level: number;
  note?: string;
  status?: AlertStatus;
}

export const alertsApi = {
  list: () => request<AlertListResponse>("/api/alerts"),

  create: (input: AlertInputPayload) =>
    request<{ alert: AlertView }>("/api/alerts", { method: "POST", body: input }),

  update: (id: string, input: AlertInputPayload) =>
    request<{ alert: AlertView }>(`/api/alerts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    }),

  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/alerts/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

// ---------------------------------------------------------------------------
// Paper trading, see src/server/simulation
// ---------------------------------------------------------------------------

export type PaperSide = "buy" | "sell";
export type PaperCloseReason = "manual" | "stop" | "target";

export interface PaperPosition {
  id: string;
  symbol: string;
  side: PaperSide;
  notional: number;
  entryPrice: number;
  stop: number | null;
  target: number | null;
  exitPrice: number | null;
  pnl: number | null;
  status: "open" | "closed";
  closeReason: PaperCloseReason | null;
  lastPrice: number | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
}

export interface PaperAccount {
  startBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  equity: number;
  openCount: number;
  closedCount: number;
  exposure: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

export interface PaperListResponse {
  account: PaperAccount;
  open: PaperPosition[];
  closed: PaperPosition[];
}

export interface PaperInputPayload {
  symbol: string;
  side: PaperSide;
  notional: number;
  stop?: number | null;
  target?: number | null;
}

export const simulationApi = {
  list: () => request<PaperListResponse>("/api/simulation"),

  open: (input: PaperInputPayload) =>
    request<{ position: PaperPosition }>("/api/simulation", { method: "POST", body: input }),

  close: (id: string) =>
    request<{ position: PaperPosition }>(`/api/simulation/${encodeURIComponent(id)}/close`, {
      method: "POST",
    }),

  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/simulation/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

// ---------------------------------------------------------------------------
// Daily briefing, see src/server/briefing
// ---------------------------------------------------------------------------

export interface BriefingMover {
  symbol: string;
  last: number;
  changePct: number;
}

export interface BriefingSignal {
  id: string;
  symbol: string;
  direction: "buy" | "sell";
  entry: number | null;
  entryMax: number | null;
  target: number;
  stop: number;
  createdAt: string;
  ageHours: number;
}

export interface BriefingSnapshot {
  dateKey: string;
  generatedAt: string;
  movers: BriefingMover[];
  signals: BriefingSignal[];
}

export interface BriefingRecord {
  dateKey: string;
  generatedAt: string;
  model: string | null;
  narrative: string | null;
  error: string | null;
  snapshot: BriefingSnapshot;
}

export interface BriefingResponse {
  aiReady: boolean;
  briefing: BriefingRecord | null;
}

export const briefingApi = {
  get: () => request<BriefingResponse>("/api/briefing"),

  refresh: () =>
    request<BriefingResponse>("/api/briefing/refresh", { method: "POST" }),
};

export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  status: "active" | "pending";
  emailVerified: boolean;
  createdAt: string | null;
}

export interface AdminCtraderHealthRow {
  userId: string;
  username: string;
  mode: "oauth" | "manual";
  accounts: AccountView[];
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  reauthRequired: boolean;
}

export interface AdminCtraderHealth {
  connections: AdminCtraderHealthRow[];
  summary: {
    connected: number;
    reauthRequired: number;
    failing: number;
  };
}

// ---------------------------------------------------------------------------
// Site presentation, see src/server/settings
// ---------------------------------------------------------------------------

export type ThemeMode = "dark" | "light";

export interface SiteAddressSettings {
  publicBaseUrl: string;
}

export type RegistrationMode = "open" | "approval" | "invite" | "closed";

export interface PublicRegistrationSettings {
  mode: RegistrationMode;
  message: string;
  inviteRequired: boolean;
  requireEmailVerification: boolean;
}

export interface RegistrationSettings {
  mode: RegistrationMode;
  message: string;
  inviteCode: string;
  requireEmailVerification: boolean;
}

export interface LegalSettings {
  termsUrl: string;
  privacyUrl: string;
  riskDisclaimer: string;
}

export interface BrandingSettings {
  name: string;
  tagline: string;
  description: string;
  logoUrl: string;
  supportEmail: string;
  websiteUrl: string;
  footerText: string;
}

export type ThemeFont = "inter" | "system" | "serif";
export type ThemeDensity = "compact" | "comfortable" | "spacious";

export interface ThemeSettings {
  mode: ThemeMode;
  font: ThemeFont;
  density: ThemeDensity;
  radius: number;
  accent: string;
  accentHover: string;
  accentDeep: string;
  accentFg: string;
  canvas: string;
  canvasSoft: string;
  surface: string;
  surfaceHover: string;
  surfaceActive: string;
  borderStrong: string;
  text: string;
  success: string;
  danger: string;
  strongSell: string;
  strongBuy: string;
  ratingNeutral: string;
}

export type ModuleKey =
  | "analysis"
  | "signals"
  | "breakouts"
  | "learn"
  | "trading"
  | "alerts"
  | "briefing";

export type ModuleAccess = "public" | "signed-in" | "admin";

export interface ModuleSettings {
  key: ModuleKey;
  label: string;
  hidden: boolean;
  access: ModuleAccess;
}

export type LandingKey = "home" | "analysis" | "signals";

export interface NavigationSettings {
  modules: ModuleSettings[];
  landing: {
    signedIn: LandingKey;
    signedOut: LandingKey;
  };
}

export interface MaintenanceSettings {
  enabled: boolean;
  message: string;
  allowAdmins: boolean;
}

export type AnnouncementTone = "info" | "success" | "warning" | "danger";

export interface AnnouncementSettings {
  enabled: boolean;
  text: string;
  tone: AnnouncementTone;
  linkLabel: string;
  linkUrl: string;
  dismissible: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export type AnalyticsProvider = "none" | "plausible" | "umami" | "google";

export interface SeoSettings {
  title: string;
  description: string;
  canonicalUrl: string;
  ogImageUrl: string;
  keywords: string;
  noindex: boolean;
  analyticsProvider: AnalyticsProvider;
  analyticsScriptUrl: string;
  analyticsSiteId: string;
  analyticsRequireConsent: boolean;
}

export interface ContentSettings {
  heroTitle: string;
  heroBody: string;
  featuresTitle: string;
  featuresBody: string;
  loginIntro: string;
  registerIntro: string;
  emptyStates: {
    analysis: string;
    signals: string;
    breakouts: string;
    trading: string;
    alerts: string;
    briefing: string;
  };
}

export type DefaultOrderType = "MARKET" | "LIMIT";

export interface TradingDefaultsSettings {
  defaultOrderType: DefaultOrderType;
  defaultRiskPercent: number;
  signalExpiryHours: number;
}

export interface AnalysisSettings {
  watchlistLimit: number;
}

export type DateFormat = "locale" | "iso" | "dmy" | "mdy";
export type NumberFormat = "locale" | "comma-dot" | "dot-comma";

export interface LocaleSettings {
  locale: string;
  timezone: string;
  currency: string;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
}

export interface SocialSettings {
  x: string;
  telegram: string;
  discord: string;
  youtube: string;
  linkedin: string;
  github: string;
}

export interface PwaSettings {
  enabled: boolean;
  shortName: string;
  themeColor: string;
  backgroundColor: string;
  display: "standalone" | "browser";
}

export interface EmailTemplateSettings {
  subject: string;
  body: string;
}

export interface TemplateSettings {
  email: {
    passwordReset: EmailTemplateSettings;
    verifyEmail: EmailTemplateSettings;
    adminInvite: EmailTemplateSettings;
  };
  telegram: {
    signalPublished: string;
    alertTriggered: string;
    test: string;
  };
}

export interface WebhookSettings {
  enabled: boolean;
  url: string;
  secret: string;
  signalPublished: boolean;
  alertTriggered: boolean;
}

export interface SiteConfig {
  site: SiteAddressSettings;
  branding: BrandingSettings;
  theme: ThemeSettings;
  navigation: NavigationSettings;
  maintenance: MaintenanceSettings;
  announcement: AnnouncementSettings;
  registration: PublicRegistrationSettings;
  legal: LegalSettings;
  seo: SeoSettings;
  content: ContentSettings;
  tradingDefaults: TradingDefaultsSettings;
  locale: LocaleSettings;
  social: SocialSettings;
  pwa: PwaSettings;
  version: string | null;
}

export interface SiteSettings extends Omit<SiteConfig, "registration"> {
  registration: RegistrationSettings;
  analysis: AnalysisSettings;
  templates: TemplateSettings;
  webhooks: WebhookSettings;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AdminSetupCheck {
  key: string;
  label: string;
  status: "ok" | "todo" | "optional";
  detail: string;
}

// ---------------------------------------------------------------------------
// Integrations, see src/server/integrations
// ---------------------------------------------------------------------------

export type IntegrationProvider = "ctrader" | "telegram" | "smtp" | "ai";

export type IntegrationFieldKind = "text" | "secret" | "number" | "boolean" | "select";

export type IntegrationSource = "database" | "environment" | "default" | "unset";

export interface IntegrationFieldOption {
  value: string;
  label: string;
}

export interface IntegrationFieldState {
  key: string;
  label: string;
  kind: IntegrationFieldKind;
  required: boolean;
  /** Non-secret effective value; always null for secrets. */
  value: string | number | boolean | null;
  configured: boolean;
  source: IntegrationSource;
  hint: string | null;
  error: string | null;
  options?: readonly IntegrationFieldOption[];
  placeholder?: string;
  maxLength?: number;
}

export interface IntegrationState {
  provider: IntegrationProvider;
  label: string;
  description: string;
  ready: boolean;
  fields: IntegrationFieldState[];
  errors: string[];
  warnings: string[];
  updatedAt: string | null;
  updatedBy: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  lastTestDraft: boolean;
}

export interface IntegrationTestResult {
  ok: boolean;
  message: string;
}

export interface IntegrationPatch {
  values?: Record<string, unknown>;
  clear?: string[];
}

export interface CallbackCandidates {
  baseUrl: string | null;
  primary: string | null;
  api: string | null;
}

export interface AiProviderOption {
  value: string;
  label: string;
  baseUrl: string;
  keyRequired: boolean;
  keyUrl: string | null;
  keyHint: string;
  docsUrl: string | null;
  models: readonly string[];
  defaultModel: string | null;
}

export interface AiModelsResult {
  ok: boolean;
  models: string[];
  message: string;
  total?: number;
  available?: number;
  unavailable?: number;
  unknown?: number;
}

export interface AdminIntegrationsResponse {
  integrations: IntegrationState[];
  encryptionAvailable: boolean;
  requestOrigin: string | null;
  callbacks: CallbackCandidates;
  aiProviders: AiProviderOption[];
}

export const configApi = {
  get: () => request<SiteConfig>("/api/config"),
};

export const adminApi = {
  status: () =>
    request<{
      checks: AdminSetupCheck[];
      registrationMode: RegistrationMode;
      requireEmailVerification: boolean;
      version: string;
      nodeVersion: string;
      settingsUpdatedAt: string | null;
    }>("/api/admin/status"),

  users: () => request<{ users: AdminUser[] }>("/api/admin/users"),

  ctraderHealth: () => request<AdminCtraderHealth>("/api/admin/ctrader/health"),

  createUser: (input: {
    username: string;
    email: string;
    password: string;
    role: UserRole;
  }) =>
    request<{ user: AdminUser }>("/api/admin/users", { method: "POST", body: input }),

  inviteUser: (input: { username: string; email: string; role: UserRole }) =>
    request<{ user: AdminUser }>("/api/admin/users/invite", { method: "POST", body: input }),

  updateUser: (id: string, patch: { role?: UserRole; status?: "active" | "pending" }) =>
    request<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    }),

  resetUserPassword: (id: string, password: string) =>
    request<{ ok: boolean }>(
      `/api/admin/users/${encodeURIComponent(id)}/password`,
      { method: "POST", body: { password } }
    ),

  deleteUser: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }),

  exportUser: (id: string) =>
    downloadFile(`/api/admin/users/${encodeURIComponent(id)}/export`, "doochy-user-data.json"),

  settings: () => request<{ settings: SiteSettings }>("/api/admin/settings"),

  testWebhook: () =>
    request<{ ok: boolean; status: number | null }>("/api/admin/settings/webhooks/test", {
      method: "POST",
    }),

  saveSettings: (patch: {
    site?: Partial<SiteAddressSettings>;
    branding?: Partial<BrandingSettings>;
    theme?: Partial<ThemeSettings>;
    navigation?: Partial<NavigationSettings>;
    maintenance?: Partial<MaintenanceSettings>;
    announcement?: Partial<AnnouncementSettings>;
    registration?: Partial<RegistrationSettings>;
    analysis?: Partial<AnalysisSettings>;
    legal?: Partial<LegalSettings>;
    seo?: Partial<SeoSettings>;
    content?: Partial<ContentSettings>;
    tradingDefaults?: Partial<TradingDefaultsSettings>;
    locale?: Partial<LocaleSettings>;
    social?: Partial<SocialSettings>;
    pwa?: Partial<PwaSettings>;
    templates?: Partial<TemplateSettings>;
    webhooks?: Partial<WebhookSettings>;
  }) =>
    request<{ settings: SiteSettings }>("/api/admin/settings", {
      method: "PUT",
      body: patch,
    }),

  integrations: () => request<AdminIntegrationsResponse>("/api/admin/integrations"),

  saveIntegration: (provider: IntegrationProvider, patch: IntegrationPatch) =>
    request<{ integration: IntegrationState }>(
      `/api/admin/integrations/${encodeURIComponent(provider)}`,
      { method: "PUT", body: patch }
    ),

  testIntegration: (provider: IntegrationProvider, patch: IntegrationPatch) =>
    request<{ result: IntegrationTestResult; integration: IntegrationState }>(
      `/api/admin/integrations/${encodeURIComponent(provider)}/test`,
      { method: "POST", body: patch }
    ),

  aiModels: (patch: IntegrationPatch) =>
    request<AiModelsResult>("/api/admin/integrations/ai/models", {
      method: "POST",
      body: patch,
    }),
};

export const api = {
  register: (
    username: string,
    email: string,
    password: string,
    inviteCode?: string,
    acceptedTerms = false
  ) =>
    request<{
      token?: string;
      pending?: boolean;
      verificationRequired?: boolean;
      verificationSent?: boolean;
      message?: string;
      email?: string;
    }>("/api/auth/register", {
      method: "POST",
      body: { username, email, password, inviteCode, acceptedTerms },
    }),

  login: (username: string, password: string) =>
    request<{ token: string }>("/api/auth/login", { method: "POST", body: { username, password } }),

  forgotPassword: (email: string) =>
    request<{ ok: boolean }>("/api/auth/forgot-password", {
      method: "POST",
      body: { email },
    }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean }>("/api/auth/reset-password", {
      method: "POST",
      body: { token, password },
    }),

  verifyEmail: (token: string) =>
    request<{ ok: boolean }>("/api/auth/verify-email", {
      method: "POST",
      body: { token },
    }),

  resendVerification: (email: string) =>
    request<{ ok: boolean }>("/api/auth/resend-verification", {
      method: "POST",
      body: { email },
    }),

  acceptInvite: (token: string, password: string, acceptedTerms = false) =>
    request<{ token: string; username: string }>("/api/auth/accept-invite", {
      method: "POST",
      body: { token, password, acceptedTerms },
    }),

  me: (token?: string) =>
    request<{
      username: string;
      email: string | null;
      emailVerified: boolean;
      role: UserRole;
      hasCredentials: boolean;
      clientIdMasked: string | null;
      ctraderOAuth: boolean;
      ctraderManual: boolean;
      accounts: AccountView[];
    }>("/api/me", { token }),

  exportMyData: () => downloadFile("/api/me/export", "doochy-my-data.json"),

  updateEmail: (email: string, password: string) =>
    request<{
      ok: true;
      email: string;
      emailVerified: boolean;
      verificationSent: boolean;
    }>("/api/me/email", { method: "PATCH", body: { email, password } }),

  connect: (creds: ConnectInput, token?: string) =>
    request<{ accounts: AccountView[] }>("/api/connect", { method: "POST", body: creds, token }),

  ctraderOAuthStart: () =>
    request<{ url: string }>("/api/ctrader/oauth/start", { method: "POST" }),

  accounts: () => request<{ accounts: AccountView[] }>("/api/accounts"),

  positions: (ctid: number) => request<{ positions: PositionRow[] }>(`/api/accounts/${ctid}/positions`),

  orders: (ctid: number) => request<{ orders: OrderRow[] }>(`/api/accounts/${ctid}/orders`),

  orderHistory: (ctid: number, days = 7) =>
    request<OrderHistoryResult>(`/api/accounts/${ctid}/history?days=${encodeURIComponent(String(days))}`),

  accountSymbols: (ctid: number) => request<{ symbols: string[] }>(`/api/accounts/${ctid}/symbols`),

  accountQuote: (ctid: number, symbol: string) =>
    request<{ quote: SymbolQuote | null }>(
      `/api/accounts/${ctid}/quote?symbol=${encodeURIComponent(symbol)}`
    ),

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