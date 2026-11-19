// Pure mapping from broker rows to a new-signal draft. Kept out of the .tsx so
// the test suite can cover the field mapping without JSX.

import type { OrderRow, PositionRow } from "../api";
import type { SignalDraft } from "./types";

type PositionLike = Pick<
  PositionRow,
  "symbol" | "side" | "entryPrice" | "stopLoss" | "takeProfit"
>;

type OrderLike = Pick<OrderRow, "symbol" | "side" | "price" | "stopLoss" | "takeProfit">;

// A filled position uses its actual entry. Timeframe, expiry and note stay for
// the admin to add in the form.
export function draftFromPosition(position: PositionLike): SignalDraft {
  return {
    symbol: position.symbol,
    direction: position.side === "BUY" ? "buy" : "sell",
    entry: position.entryPrice,
    entryMax: null,
    target: position.takeProfit,
    stop: position.stopLoss,
  };
}

// A pending order uses its resting trigger as the entry. The broker may not
// have SL/TP attached yet, so nulls are left for the admin to fill.
export function draftFromOrder(order: OrderLike): SignalDraft {
  return {
    symbol: order.symbol,
    direction: order.side === "BUY" ? "buy" : "sell",
    entry: order.price,
    entryMax: null,
    target: order.takeProfit,
    stop: order.stopLoss,
  };
}
