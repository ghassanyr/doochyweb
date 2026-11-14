// The connection and symbol-spec modules pull in the broker client and the
// database layer. Keep them type-only/dynamic so the pure mapping helpers in
// this file can be unit-tested without booting either.
import type { CtraderEnv } from "./connection";
import type { SymbolSpec } from "./reads";

// Closed-trade history comes from ProtoOADealListReq. The broker caps a single
// request at seven days, so longer ranges are paged week by week and each week
// is paginated with hasMore until the last deal is read. Only closing deals
// carry closePositionDetail (entry price and realised P&L); opening deals are
// skipped, which is the round-trip view cTrader shows in its History tab.

export const WEEK_MS = 604_800_000;
export const MAX_HISTORY_DAYS = 30;
const MAX_PAGES_PER_WINDOW = 20;

export interface OrderHistoryRow {
  dealId: number;
  orderId: number | null;
  positionId: number | null;
  symbol: string;
  /** Side of the original position; the closing deal trades the opposite way. */
  side: "BUY" | "SELL";
  lots: number;
  entryPrice: number;
  exitPrice: number;
  grossProfit: number;
  swap: number;
  commission: number;
  /** Realised P&L in the account's deposit currency. */
  net: number;
  digits: number;
  closeTimestamp: number;
}

export interface OrderHistoryResult {
  trades: OrderHistoryRow[];
  days: number;
  /** True when a page/window cap stopped the read before the whole range. */
  truncated: boolean;
}

/** Clamp the ?days query to a sane range. Defaults to one week. */
export function clampHistoryDays(value: unknown): number {
  if (value == null || value === "") return 7;
  const days = Number(value);
  if (!Number.isFinite(days)) return 7;
  return Math.min(MAX_HISTORY_DAYS, Math.max(1, Math.round(days)));
}

function isFilledDeal(deal: any): boolean {
  const status = deal?.dealStatus;
  return status === 2 || status === 3 || status === "FILLED" || status === "PARTIALLY_FILLED";
}

function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Map one broker deal to a history row. Returns null for opening deals and for
 * anything that is not a filled close. Pure so it can be tested without a
 * socket; money fields are integers scaled by 10^moneyDigits.
 */
export function mapClosedDeal(deal: any, spec: SymbolSpec): OrderHistoryRow | null {
  const cpd = deal?.closePositionDetail;
  if (!cpd || !isFilledDeal(deal)) return null;

  const closeTimestamp = finite(deal.executionTimestamp, 0);
  if (closeTimestamp <= 0) return null;

  const moneyDigits = finite(cpd.moneyDigits ?? deal.moneyDigits, 2);
  const divisor = Math.pow(10, moneyDigits);
  const grossProfit = finite(cpd.grossProfit) / divisor;
  const swap = finite(cpd.swap) / divisor;
  const commission = finite(cpd.commission) / divisor;
  const volume = finite(deal.filledVolume ?? deal.volume);
  const side = deal.tradeSide === "BUY" ? "SELL" : "BUY";

  return {
    dealId: finite(deal.dealId),
    orderId: deal.orderId == null ? null : finite(deal.orderId),
    positionId: deal.positionId == null ? null : finite(deal.positionId),
    symbol: spec.name,
    side,
    lots: spec.lotSize ? Math.round((volume / spec.lotSize) * 10000) / 10000 : volume,
    entryPrice: finite(cpd.entryPrice),
    exitPrice: finite(deal.executionPrice),
    grossProfit,
    swap,
    commission,
    net: Math.round((grossProfit + swap + commission) * 100) / 100,
    digits: spec.digits,
    closeTimestamp,
  };
}

function envFor(isLive: boolean): CtraderEnv {
  return isLive ? "live" : "demo";
}

/**
 * Closed trades for one account over the last `days` days, newest first. The
 * broker's deal list is read-only, so this never refreshes tokens indirectly:
 * it uses the normal socket path and lets the caller surface any auth failure.
 */
export async function fetchOrderHistory(
  userId: string,
  ctid: number,
  isLive: boolean,
  requestedDays: number
): Promise<OrderHistoryResult> {
  const days = clampHistoryDays(requestedDays);
  const env = envFor(isLive);
  const [{ userSockets }, { symbolSpecsById }] = await Promise.all([
    import("./connection"),
    import("./reads"),
  ]);
  const sockets = userSockets(userId);
  // Stay a second behind wall-clock: the broker rejects a future timestamp.
  const to = Date.now() - 1000;
  const from = to - days * 86_400_000;
  const raw: any[] = [];
  let truncated = false;

  for (let start = from; start < to; start += WEEK_MS) {
    const end = Math.min(start + WEEK_MS, to);
    let cursor = start;

    for (let page = 0; page < MAX_PAGES_PER_WINDOW; page++) {
      const res = await sockets.send(
        env,
        "ProtoOADealListReq",
        {
          ctidTraderAccountId: ctid,
          fromTimestamp: cursor,
          toTimestamp: end,
          maxRows: 1000,
        },
        { ctid }
      );

      const deals = Array.isArray(res?.deal) ? res.deal : [];
      raw.push(...deals);

      if (!res?.hasMore) break;
      const lastTs = deals.reduce(
        (max: number, deal: any) => Math.max(max, finite(deal.executionTimestamp)),
        cursor
      );
      if (lastTs <= cursor) {
        truncated = true;
        break;
      }
      cursor = lastTs;

      if (page === MAX_PAGES_PER_WINDOW - 1) truncated = true;
    }
  }

  // A deal can sit exactly on a page boundary and come back twice.
  const byId = new Map<string, any>();
  for (const deal of raw) {
    const id = String(deal?.dealId ?? "");
    if (id) byId.set(id, deal);
    else if (deal?.closePositionDetail) byId.set(`${deal.positionId}:${deal.executionTimestamp}`, deal);
  }
  const closing = [...byId.values()].filter((deal) => deal?.closePositionDetail);

  if (closing.length === 0) return { trades: [], days, truncated };

  const symbolIds = [...new Set(closing.map((deal) => finite(deal.symbolId)).filter(Boolean))];
  const specs = await symbolSpecsById(userId, env, ctid, symbolIds);

  const trades: OrderHistoryRow[] = [];
  for (const deal of closing) {
    const spec = specs.get(finite(deal.symbolId));
    if (!spec) continue;
    const row = mapClosedDeal(deal, spec);
    if (row) trades.push(row);
  }
  trades.sort((a, b) => b.closeTimestamp - a.closeTimestamp);

  return { trades, days, truncated };
}
