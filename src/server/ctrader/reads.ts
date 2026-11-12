import { userSockets, CtraderEnv, SpotQuote } from "./connection";
import { loadCredentials, StoredAccount } from "../db";
import { resolveLevel } from "./levels";

interface SymbolSpec {
  name: string;
  lotSize: number;  // volume units per 1.0 lot
  digits: number;   // decimal places for display
  minVolume: number;  // smallest tradable volume (cents)
  stepVolume: number; // volume grid step (cents)
  maxVolume: number;  // largest tradable volume (cents)
  quoteAsset: string | null; // quote currency name ("USD", "EUR", ...)
}

// Per-account symbol metadata. Two broker calls populate it once (cached and
// static per account): the symbols LIST carries the display name (symbolName)
// and quote asset id but NOT contract details, while symbolById carries
// lotSize/digits but NO name - so both are needed and merged per symbolId.
interface SymbolMeta {
  nameById: Map<number, string>;
  nameToId: Map<string, number>;
  quoteById: Map<number, number>;
  assetNameById: Map<number, string>;
  specById: Map<number, { lotSize: number; digits: number; minVolume: number; stepVolume: number; maxVolume: number }>;
}

const symbolMetaCache = new Map<string, SymbolMeta>();

function envFor(isLive: boolean): CtraderEnv {
  return isLive ? "live" : "demo";
}

async function symbolMeta(userId: string, env: CtraderEnv, ctid: number): Promise<SymbolMeta> {
  const key = String(ctid);
  const cached = symbolMetaCache.get(key);
  if (cached) return cached;

  const sockets = userSockets(userId);
  const [syms, assets] = await Promise.all([
    sockets.send(env, "ProtoOASymbolsListReq", { ctidTraderAccountId: ctid, includeArchivedSymbols: false }, { ctid }),
    sockets.send(env, "ProtoOAAssetListReq", { ctidTraderAccountId: ctid }, { ctid }),
  ]);

  const nameById = new Map<number, string>();
  const nameToId = new Map<string, number>();
  const quoteById = new Map<number, number>();
  for (const s of (syms?.symbol ?? []) as any[]) {
    const id = Number(s.symbolId);
    const name = String(s.symbolName ?? "").trim();
    if (name) {
      nameById.set(id, name);
      if (!nameToId.has(name)) nameToId.set(name, id);
    }
    if (s.quoteAssetId != null) quoteById.set(id, Number(s.quoteAssetId));
  }

  const assetNameById = new Map<number, string>();
  for (const a of (assets?.asset ?? []) as any[]) {
    assetNameById.set(Number(a.assetId), String(a.name ?? ""));
  }

  const meta: SymbolMeta = { nameById, nameToId, quoteById, assetNameById, specById: new Map() };
  symbolMetaCache.set(key, meta);
  return meta;
}

// Fetch missing symbol specs (lotSize/digits/volume grid) for the given IDs,
// using the per-account cache and falling back to broker requests only for IDs
// not yet seen.
async function ensureSpecs(userId: string, env: CtraderEnv, ctid: number, meta: SymbolMeta, symbolIds: number[]): Promise<void> {
  const missing = [...new Set(symbolIds.filter((id) => id && !meta.specById.has(id)))];
  if (!missing.length) return;
  const sockets = userSockets(userId);
  const res = await sockets.send(env, "ProtoOASymbolByIdReq", { ctidTraderAccountId: ctid, symbolId: missing }, { ctid });
  for (const s of (res?.symbol ?? []) as any[]) {
    meta.specById.set(Number(s.symbolId), {
      lotSize: Number(s.lotSize) || 0,
      digits: Number(s.digits ?? 0),
      minVolume: Number(s.minVolume) || 0,
      stepVolume: Number(s.stepVolume) || 1,
      maxVolume: Number(s.maxVolume) || 0,
    });
  }
}

function specFor(meta: SymbolMeta, symbolId: number): SymbolSpec {
  const spec = meta.specById.get(symbolId);
  const quoteAssetId = meta.quoteById.get(symbolId);
  return {
    name: meta.nameById.get(symbolId) ?? `#${symbolId}`,
    lotSize: spec?.lotSize ?? 0,
    digits: spec?.digits ?? 0,
    minVolume: spec?.minVolume ?? 0,
    stepVolume: spec?.stepVolume ?? 1,
    maxVolume: spec?.maxVolume ?? 0,
    quoteAsset: quoteAssetId != null ? (meta.assetNameById.get(quoteAssetId) ?? null) : null,
  };
}

// Resolve a display symbol name to its broker id and contract spec for a given
// account, reusing the per-account metadata cache. Returns null when the symbol
// is unknown to this broker account.
export async function resolveTradableSymbol(
  userId: string,
  env: CtraderEnv,
  ctid: number,
  name: string
): Promise<{ symbolId: number; spec: SymbolSpec } | null> {
  const meta = await symbolMeta(userId, env, ctid);
  const symbolId = meta.nameToId.get(name);
  if (symbolId == null) return null;
  await ensureSpecs(userId, env, ctid, meta, [symbolId]);
  return { symbolId, spec: specFor(meta, symbolId) };
}

export interface SymbolQuote {
  symbol: string;
  bid: number;
  ask: number;
  digits: number;
  time: number;
}

// Latest live bid/ask for one symbol on an account. Reads the cached spot when
// the stream is already open (the order ticket polls this) and otherwise
// subscribes and waits briefly for the first tick, like the order preview.
// Returns null when the symbol is unknown or no tick arrives.
export async function symbolQuote(
  userId: string,
  ctid: number,
  isLive: boolean,
  name: string
): Promise<SymbolQuote | null> {
  const symbol = name.trim().toUpperCase();
  if (!symbol) return null;
  const env = envFor(isLive);
  const resolved = await resolveTradableSymbol(userId, env, ctid, symbol);
  if (!resolved) return null;
  const quote = await userSockets(userId).waitForQuote(env, ctid, resolved.symbolId, 1200);
  if (!quote) return null;
  return { symbol, bid: quote.bid, ask: quote.ask, digits: resolved.spec.digits ?? 0, time: quote.time };
}

// USD conversion factor for a symbol's quote currency at the current cached
// spot (1 for USD-quoted symbols, or when no conversion pair exists yet).
// Used by the order-ticket preview so risk figures land in USD like the
// positions table's net P&L column.
export async function quoteUsdFactor(userId: string, ctid: number, isLive: boolean, symbolId: number): Promise<number | null> {
  const env = envFor(isLive);
  const meta = await symbolMeta(userId, env, ctid);
  const quote = specFor(meta, symbolId).quoteAsset;
  if (!quote || quote === "USD") return 1;
  let convName: string | null = null;
  if (meta.nameToId.get(`USD${quote}`) != null) convName = `USD${quote}`;
  else if (meta.nameToId.get(`${quote}USD`) != null) convName = `${quote}USD`;
  if (!convName) return null;
  const sockets = userSockets(userId);
  // Subscribe/wait for the conversion pair too: without it a JPY- or
  // CHF-quoted symbol would show its risk as if it were USD.
  const convId = meta.nameToId.get(convName)!;
  const convQuote = await sockets.waitForQuote(env, ctid, convId, 750);
  return quoteToUsdFactor(convQuote, convName);
}

// The broker symbol whose spot gives a non-USD quote currency's USD value as a
// conversion factor, or null when the quote is USD or no USD pair exists.
function conversionId(meta: SymbolMeta, quote: string): number | null {
  if (!quote || quote === "USD") return null;
  const usdQ = meta.nameToId.get(`USD${quote}`);
  if (usdQ != null) return usdQ;
  return meta.nameToId.get(`${quote}USD`) ?? null;
}

// Multiplier converting an amount in `quote` currency into USD, read live from
// the conversion pair's cached spot (USDJPY-like pairs are inverted). Returns
// null when no rate is available yet - callers show a placeholder rather than a
// wrong number. USD-quoted symbols are exactly 1.
function quoteToUsdFactor(quote: SpotQuote | null, convName: string): number | null {
  if (!quote) return null;
  const mid = quote.bid > 0 && quote.ask > 0 ? (quote.bid + quote.ask) / 2 : quote.bid > 0 ? quote.bid : quote.ask;
  if (mid <= 0) return null;
  return convName.startsWith("USD") ? 1 / mid : mid;
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
}

export interface ReconcileResult {
  positions: PositionRow[];
  orders: OrderRow[];
}

// Guard: one reconcile per account at a time. If a poll overlaps the previous
// one (auto-refresh is 8s, reconcile can take 15s), the caller gets the same
// promise back instead of flooding the broker.
const inFlight = new Map<string, Promise<ReconcileResult>>();

export async function reconcileAccount(
  userId: string,
  ctid: number,
  isLive: boolean
): Promise<ReconcileResult> {
  const key = `${userId}:${ctid}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const job = doReconcile(userId, ctid, isLive).finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

async function doReconcile(
  userId: string,
  ctid: number,
  isLive: boolean
): Promise<ReconcileResult> {
  const sockets = userSockets(userId);
  const env = envFor(isLive);
  const res = await sockets.send(env, "ProtoOAReconcileReq", { ctidTraderAccountId: ctid }, { ctid });

  const positions = (res?.position ?? []) as any[];
  const orders = (res?.order ?? []) as any[];

  const meta = await symbolMeta(userId, env, ctid);

  // All symbol IDs we need names/contracts for
  const allSymbolIds = new Set<number>();
  for (const p of positions) allSymbolIds.add(Number(p.tradeData?.symbolId));
  for (const o of orders) allSymbolIds.add(Number(o.tradeData?.symbolId));
  await ensureSpecs(userId, env, ctid, meta, [...allSymbolIds]);

  // Net USD needs quotes: subscribe to the traded symbols' spots first, plus the
  // conversion pair for any non-USD quote currency (so PnL lands in USD).
  const positionSymbolIds = [...new Set(positions.map((p: any) => Number(p.tradeData?.symbolId)).filter(Boolean))];
  const convIds = new Set<number>();
  for (const id of positionSymbolIds) {
    const quote = specFor(meta, id).quoteAsset;
    const convId = conversionId(meta, quote ?? "");
    if (convId != null) convIds.add(convId);
  }
  if (positionSymbolIds.length || convIds.size) {
    await sockets.ensureSpots(env, ctid, [...new Set([...positionSymbolIds, ...convIds])]);
  }

  const mappedPositions: PositionRow[] = positions
    .filter((p: any) => {
      const st = p.positionStatus;
      return st == null || st === "POSITION_STATUS_OPEN" || st === 1;
    })
    .map((p: any) => {
      const td = p.tradeData || {};
      const symId = Number(td.symbolId);
      const spec = specFor(meta, symId);
      const side = td.tradeSide === "SELL" ? "SELL" : "BUY";
      const volumeCents = Number(td.volume) || 0;
      const entryPrice = Number(p.price) || 0;
      return {
        positionId: Number(p.positionId),
        symbol: spec.name,
        side,
        lots: spec.lotSize ? roundLots(volumeCents / spec.lotSize) : volumeCents,
        entryPrice,
        stopLoss: resolveLevel(entryPrice, side, "SL", p.stopLoss, p.relativeStopLoss),
        takeProfit: resolveLevel(entryPrice, side, "TP", p.takeProfit, p.relativeTakeProfit),
        netUsd: netUsdFor(sockets, env, meta, symId, spec, side, entryPrice, volumeCents),
        digits: spec.digits,
        openTimestamp: td.openTimestamp != null ? Number(td.openTimestamp) : null,
      };
    });

  const mappedOrders: OrderRow[] = orders.map((o: any) => {
    const td = o.tradeData || {};
    const symId = Number(td.symbolId);
    const spec = specFor(meta, symId);
    const volumeCents = Number(td.volume) || 0;
    const type = String(o.orderType ?? "");
    const price = type === "LIMIT" ? Number(o.limitPrice) || 0 : Number(o.stopPrice) || 0;
    const exp = o.expirationTimestamp ? Number(o.expirationTimestamp) : null;
    return {
      orderId: Number(o.orderId),
      symbol: spec.name,
      side: td.tradeSide === "SELL" ? "SELL" : "BUY",
      orderType: type,
      price,
      lots: spec.lotSize ? roundLots(volumeCents / spec.lotSize) : volumeCents,
      stopLoss: resolveLevel(price, td.tradeSide === "SELL" ? "SELL" : "BUY", "SL", o.stopLoss, o.relativeStopLoss),
      takeProfit: resolveLevel(price, td.tradeSide === "SELL" ? "SELL" : "BUY", "TP", o.takeProfit, o.relativeTakeProfit),
      digits: spec.digits,
      expirationTimestamp: exp,
      expirationType: exp ? "GTD" : "GTC",
    };
  });

  return { positions: mappedPositions, orders: mappedOrders };
}

// Floating P&L in USD for one position, mirroring doochy's verified money model:
//   $PnL = priceDiff x (volumeCents / 100) x quoteToUsd
// where priceDiff uses the side-appropriate live mark (BUY closes at the bid,
// SELL closes at the ask). Returns null until a live quote is available.
function netUsdFor(
  sockets: ReturnType<typeof userSockets>,
  env: CtraderEnv,
  meta: SymbolMeta,
  symId: number,
  spec: SymbolSpec,
  side: "BUY" | "SELL",
  entryPrice: number,
  volumeCents: number
): number | null {
  const quote = sockets.getQuote(env, symId);
  if (!quote) return null;
  const mark = side === "BUY" ? quote.bid : quote.ask;
  if (mark <= 0) return null;

  const quoteName = spec.quoteAsset;
  let factor: number | null = 1;
  let convName: string | null = null;
  if (quoteName && quoteName !== "USD") {
    if (meta.nameToId.get(`USD${quoteName}`) != null) convName = `USD${quoteName}`;
    else if (meta.nameToId.get(`${quoteName}USD`) != null) convName = `${quoteName}USD`;
    if (!convName) return null;
    factor = quoteToUsdFactor(sockets.getQuote(env, meta.nameToId.get(convName)!), convName);
    if (factor == null) return null;
  }

  const priceDiff = side === "BUY" ? mark - entryPrice : entryPrice - mark;
  const usd = priceDiff * (volumeCents / 100) * factor;
  return Math.round(usd * 100) / 100;
}

function roundLots(lots: number): number {
  // 4 decimal places for lot display - matches standard cTrader precision
  return Math.round(lots * 10000) / 10000;
}

// Fetch trader data (balance, currency, broker name) for an account. Balances
// are optional per plan §5; errors are non-fatal and result in null balance on
// the frontend. brokerName (ProtoOATrader field 16) is the whitelabel assigned
// at account creation - the one reliable source of the broker's display name.
export async function getTrader(userId: string, ctid: number, isLive: boolean): Promise<{
  balance: number | null;
  currency: string | null;
  brokerName: string | null;
}> {
  const sockets = userSockets(userId);
  const env = envFor(isLive);
  const res = await sockets.send(env, "ProtoOATraderReq", { ctidTraderAccountId: ctid }, { ctid });
  const t = res?.trader;
  if (!t) return { balance: null, currency: null, brokerName: null };
  const div = Math.pow(10, Number(t.moneyDigits ?? 2));
  return {
    balance: t.balance != null ? Number(t.balance) / div : null,
    currency: t.currency ?? null,
    brokerName: t.brokerName ? String(t.brokerName) : null,
  };
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

// Fetch live balances for all stored accounts. Errors fetching individual
// accounts are tolerated (the account shows null balance instead of failing
// the whole request).
export async function listAccounts(userId: string): Promise<AccountView[]> {
  const creds = await loadCredentials(userId);
  if (!creds) return [];

  const accounts: AccountView[] = creds.accounts.map((a: StoredAccount) => ({
    ctid: a.ctid,
    login: a.login,
    broker: a.broker,
    isLive: a.isLive,
    balance: null,
    currency: null,
    nickname: a.nickname ?? null,
    color: a.color ?? null,
  }));

  // Fetch balances + broker names best-effort in parallel (each is a single
  // small request per account). The broker name is the only reliable source
  // from the cTrader Open API - the initial account list does not carry it.
  await Promise.all(
    accounts.map(async (a) => {
      try {
        const trader = await getTrader(userId, a.ctid, a.isLive);
        a.balance = trader.balance;
        a.currency = trader.currency;
        if (trader.brokerName) a.broker = trader.brokerName;
      } catch {
        /* leave null */
      }
    })
  );

  return accounts;
}

// Every tradable symbol name on the account, from the per-account metadata
// cache (populated by the symbols-list + asset-list round trip in symbolMeta).
// Used to resolve a market symbol to a broker symbolId.
export async function listTradableNames(
  userId: string,
  env: CtraderEnv,
  ctid: number
): Promise<string[]> {
  const meta = await symbolMeta(userId, env, ctid);
  return [...meta.nameToId.keys()];
}

// Clean up when a user disconnects (token revoked, etc.)
export function clearSymbolCache(ctid: number): void {
  symbolMetaCache.delete(String(ctid));
}