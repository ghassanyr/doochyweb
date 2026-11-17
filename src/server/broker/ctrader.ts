import { userSockets, type CtraderEnv } from "../ctrader/connection";
import {
  listAccounts as ctraderListAccounts,
  listTradableNames as ctraderListTradableNames,
  quoteUsdFactor as ctraderQuoteUsdFactor,
  reconcileAccount as ctraderReconcileAccount,
  resolveTradableSymbol as ctraderResolveTradableSymbol,
  symbolQuote as ctraderSymbolQuote,
  type AccountView as CtraderAccountView,
  type OrderRow as CtraderOrderRow,
  type PositionRow as CtraderPositionRow,
  type SymbolSpec as CtraderSymbolSpec,
} from "../ctrader/reads";
import {
  amendPositionSLTP as ctraderAmendPositionSLTP,
  cancelOrder as ctraderCancelOrder,
  closePosition as ctraderClosePosition,
  modifyOrder as ctraderModifyOrder,
  placeOrder as ctraderPlaceOrder,
  previewOrder as ctraderPreviewOrder,
  type OrderPreview as CtraderOrderPreview,
  type OrderResult as CtraderOrderResult,
  type TicketInput as CtraderTicketInput,
} from "../ctrader/execute";
import { fetchOrderHistory as ctraderFetchOrderHistory } from "../ctrader/history";
import type {
  BrokerAccountRef,
  BrokerAccountView,
  BrokerAdapter,
  BrokerCandle,
  BrokerCandleQuery,
  BrokerHistoryResult,
  BrokerOrder,
  BrokerOrderPreview,
  BrokerPosition,
  BrokerQuote,
  BrokerReconciliation,
  BrokerSymbol,
  BrokerSymbolSpec,
  BrokerTicket,
} from "./types";

const DEFAULT_CANDLE_COUNT = 480;
const PRICE_SCALE = 100_000;

function ctidFor(ref: BrokerAccountRef): number {
  const ctid = Number(ref.accountId);
  if (!Number.isFinite(ctid) || ctid <= 0) {
    throw new Error("Invalid cTrader account reference");
  }
  return ctid;
}

function envFor(ref: BrokerAccountRef): CtraderEnv {
  return ref.mode === "live" ? "live" : "demo";
}

export function ctraderAccountRef(userId: string, ctid: number, isLive: boolean): BrokerAccountRef {
  return { userId, broker: "ctrader", accountId: String(ctid), mode: isLive ? "live" : "demo" };
}

function mapAccount(account: CtraderAccountView): BrokerAccountView {
  return {
    id: String(account.ctid),
    broker: "ctrader",
    login: String(account.login),
    name: account.broker || "cTrader",
    mode: account.isLive ? "live" : "demo",
    balance: account.balance,
    currency: account.currency,
    nickname: account.nickname,
    color: account.color,
  };
}

function mapSymbolSpec(spec: CtraderSymbolSpec): BrokerSymbolSpec {
  return {
    symbol: spec.name,
    lotSize: spec.lotSize,
    digits: spec.digits,
    minVolume: spec.minVolume,
    stepVolume: spec.stepVolume,
    maxVolume: spec.maxVolume,
    quoteAsset: spec.quoteAsset,
  };
}

function mapPosition(row: CtraderPositionRow): BrokerPosition {
  return {
    id: String(row.positionId),
    symbol: row.symbol,
    side: row.side,
    lots: row.lots,
    entryPrice: row.entryPrice,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    profitUsd: row.netUsd,
    digits: row.digits,
    openedAt: row.openTimestamp,
  };
}

function mapOrder(row: CtraderOrderRow): BrokerOrder {
  return {
    id: String(row.orderId),
    symbol: row.symbol,
    side: row.side,
    type: row.orderType,
    price: row.price,
    lots: row.lots,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    digits: row.digits,
    expiresAt: row.expirationTimestamp,
    expirationType: row.expirationType,
  };
}

function toTicket(ticket: BrokerTicket): CtraderTicketInput {
  return {
    symbol: ticket.symbol,
    side: ticket.side,
    orderType: ticket.type,
    lots: ticket.lots,
    price: ticket.price,
    sl: ticket.sl,
    tp: ticket.tp,
    expiration: ticket.expiration,
  };
}

function mapPreview(preview: CtraderOrderPreview): BrokerOrderPreview {
  return {
    symbol: preview.symbol,
    snapped: preview.snapped,
    lots: preview.lots,
    minLots: preview.minLots,
    lotStep: preview.lotStep,
    entryRef: preview.entryRef,
    riskUsd: preview.riskUSD,
    rewardUsd: preview.rewardUSD,
    rr: preview.rr,
    warnings: preview.warnings,
  };
}

export const ctraderBrokerAdapter: BrokerAdapter = {
  id: "ctrader",

  async listAccounts(userId) {
    const accounts = await ctraderListAccounts(userId);
    return accounts.map(mapAccount);
  },

  async reconcile(ref): Promise<BrokerReconciliation> {
    const result = await ctraderReconcileAccount(ref.userId, ctidFor(ref), ref.mode === "live");
    return {
      positions: result.positions.map(mapPosition),
      orders: result.orders.map(mapOrder),
    };
  },

  async resolveSymbol(ref, symbol): Promise<BrokerSymbol | null> {
    const resolved = await ctraderResolveTradableSymbol(
      ref.userId,
      envFor(ref),
      ctidFor(ref),
      symbol
    );
    return resolved ? { id: String(resolved.symbolId), spec: mapSymbolSpec(resolved.spec) } : null;
  },

  async listSymbolNames(ref) {
    return ctraderListTradableNames(ref.userId, envFor(ref), ctidFor(ref));
  },

  async quote(ref, symbol): Promise<BrokerQuote | null> {
    const quote = await ctraderSymbolQuote(ref.userId, ctidFor(ref), ref.mode === "live", symbol);
    if (!quote) return null;
    return {
      symbol: quote.symbol,
      bid: quote.bid,
      ask: quote.ask,
      digits: quote.digits,
      time: quote.time,
    };
  },

  async quoteUsdFactor(ref, symbol) {
    const resolved = await ctraderResolveTradableSymbol(
      ref.userId,
      envFor(ref),
      ctidFor(ref),
      symbol
    );
    if (!resolved) return null;
    return ctraderQuoteUsdFactor(ref.userId, ctidFor(ref), ref.mode === "live", resolved.symbolId);
  },

  async fetchHistory(ref, days): Promise<BrokerHistoryResult> {
    const result = await ctraderFetchOrderHistory(ref.userId, ctidFor(ref), ref.mode === "live", days);
    return {
      trades: result.trades.map((trade) => ({
        id: String(trade.dealId),
        orderId: trade.orderId == null ? null : String(trade.orderId),
        positionId: trade.positionId == null ? null : String(trade.positionId),
        symbol: trade.symbol,
        side: trade.side,
        lots: trade.lots,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        grossProfit: trade.grossProfit,
        swap: trade.swap,
        commission: trade.commission,
        net: trade.net,
        digits: trade.digits,
        closedAt: trade.closeTimestamp,
      })),
      days: result.days,
      truncated: result.truncated,
    };
  },

  async fetchCandles(ref, query: BrokerCandleQuery): Promise<BrokerCandle[]> {
    const nativePeriod = query.timeframe.native?.ctrader;
    if (nativePeriod == null) {
      throw new Error(`cTrader has no bar period for ${query.timeframe.id}`);
    }
    const period = Number(nativePeriod);
    if (!Number.isFinite(period)) {
      throw new Error(`cTrader has no bar period for ${query.timeframe.id}`);
    }

    const symbol = query.symbol.trim().toUpperCase();
    const ctid = ctidFor(ref);
    const isLive = ref.mode === "live";
    const resolved = await ctraderResolveTradableSymbol(ref.userId, envFor(ref), ctid, symbol);
    if (!resolved) throw new Error(`${symbol} is not tradable on this cTrader account`);

    const to = query.to ?? Date.now();
    const count = query.count ?? DEFAULT_CANDLE_COUNT;
    const requestedSpan =
      query.from != null ? to - query.from : count * query.timeframe.ms;
    const boundedSpan = Math.min(
      requestedSpan > 0 ? requestedSpan : count * query.timeframe.ms,
      query.timeframe.maxRangeMs ?? Number.POSITIVE_INFINITY
    );
    const span = Math.max(query.timeframe.ms, boundedSpan);

    const res = await userSockets(ref.userId).send(
      envFor(ref),
      "ProtoOAGetTrendbarsReq",
      {
        ctidTraderAccountId: ctid,
        symbolId: resolved.symbolId,
        period,
        fromTimestamp: to - span,
        toTimestamp: to,
        count,
      },
      { ctid, rotateOnTokenError: false }
    );

    const bars = (res?.trendbar ?? []) as any[];
    if (!bars.length) throw new Error(`cTrader returned no ${query.timeframe.id} bars for ${symbol}`);

    return bars
      .map((bar) => {
        const low = Number(bar.low ?? 0);
        return {
          time: Number(bar.utcTimestampInMinutes ?? 0) * 60_000,
          open: (low + Number(bar.deltaOpen ?? 0)) / PRICE_SCALE,
          high: (low + Number(bar.deltaHigh ?? 0)) / PRICE_SCALE,
          low: low / PRICE_SCALE,
          close: (low + Number(bar.deltaClose ?? 0)) / PRICE_SCALE,
          volume: Number(bar.volume ?? 0),
        };
      })
      .sort((a, b) => a.time - b.time);
  },

  async previewOrder(ref, ticket) {
    const result = await ctraderPreviewOrder(ref.userId, ctidFor(ref), ref.mode === "live", toTicket(ticket));
    if (!result.preview) return { ok: result.ok, error: result.error };
    return { ok: result.ok, error: result.error, preview: mapPreview(result.preview) };
  },

  placeOrder(ref, ticket): Promise<CtraderOrderResult> {
    return ctraderPlaceOrder(ref.userId, ctidFor(ref), ref.mode === "live", toTicket(ticket));
  },

  modifyOrder(ref, orderId, changes) {
    return ctraderModifyOrder(
      ref.userId,
      ctidFor(ref),
      ref.mode === "live",
      Number(orderId),
      changes
    );
  },

  cancelOrder(ref, orderId) {
    return ctraderCancelOrder(ref.userId, ctidFor(ref), ref.mode === "live", Number(orderId));
  },

  closePosition(ref, positionId) {
    return ctraderClosePosition(ref.userId, ctidFor(ref), ref.mode === "live", Number(positionId));
  },

  amendPositionSLTP(ref, positionId, sl, tp) {
    return ctraderAmendPositionSLTP(
      ref.userId,
      ctidFor(ref),
      ref.mode === "live",
      Number(positionId),
      sl,
      tp
    );
  },
};
