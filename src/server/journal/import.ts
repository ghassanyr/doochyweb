// Map cTrader closed-deal history onto journal documents.
//
// Kept pure so the mapping can be tested without a broker socket or a database.
// Only closing deals reach this function (see ctrader/history.ts); the net P&L
// is verified broker data, which is what earns the "verified" badge.

import type { OrderHistoryRow } from "../ctrader/history";

export interface ImportAccount {
  ctid: number;
  label: string;
}

export function historyRowToJournal(row: OrderHistoryRow, account: ImportAccount) {
  return {
    source: "ctrader" as const,
    dealId: row.dealId,
    accountCtid: account.ctid,
    accountLabel: account.label,
    symbol: row.symbol,
    side: row.side === "BUY" ? ("buy" as const) : ("sell" as const),
    lots: row.lots,
    entryPrice: row.entryPrice,
    exitPrice: row.exitPrice,
    stop: null,
    target: null,
    pnl: row.net,
    fees: Math.round((row.swap + row.commission) * 100) / 100,
    openedAt: null,
    closedAt: new Date(row.closeTimestamp),
    status: "closed" as const,
    verified: true,
    strategy: "",
    tags: [] as string[],
    note: "",
  };
}
