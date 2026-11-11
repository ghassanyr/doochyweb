import { randomUUID } from "node:crypto";
import { CtraderEnv, isTokenError, userSockets } from "./connection";
import { quoteUsdFactor, resolveTradableSymbol } from "./reads";
import { resolveLevel } from "./levels";

// Manual order management. Every call maps a web request onto a cTrader write,
// following the broker's event-driven model:
//
//   - ProtoOANewOrderReq (MARKET/IMMEDIATE_OR_CANCEL, or resting LIMIT/STOP with
//     SL/TP attached) has no synchronous response. Success/failure arrives as
//     ProtoOAExecutionEvent / ProtoOAOrderErrorEvent, correlated by the order's
//     `label`.
//   - Amends (ProtoOAAmendOrderReq / ProtoOAAmendPositionSLTPReq) carry a
//     clientMsgId that ProtoOAOrderErrorEvent echoes; success is an ORDER_REPLACED
//     execution event.
//   - Cancel/close (ProtoOACancelOrderReq / ProtoOAClosePositionReq) resolve
//     synchronously (the broker rejects via ProtoErrorRes if the call is refused).
//
// Referenced protocol details are lifted from /home/san/doochy/src/ctrader
// (orders.ts, amend.ts) - only the wire protocol, none of its automation.

export interface TicketInput {
  symbol?: string;
  side?: string;
  orderType?: string;
  lots?: number;
  price?: number | null;
  sl?: number | null;
  tp?: number | null;
  expiration?: number | null;
}

export interface OrderResult {
  ok: boolean;
  error?: string;
  note?: string;
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

// ---------------------------------------------------------------------------
// At-most-once per account. Order error events carry no label (only the orderId
// we learn from an ACCEPTED event), so two overlapping writes for the same
// account could otherwise mis-attribute a rejection. Serialize writes instead.
// ---------------------------------------------------------------------------
const busyAccounts = new Set<string>();

async function withOpLock(userId: string, ctid: number, fn: () => Promise<OrderResult>): Promise<OrderResult> {
  const key = `${userId}:${ctid}`;
  if (busyAccounts.has(key)) {
    return { ok: false, error: "Another operation is already running for this account - wait a moment" };
  }
  busyAccounts.add(key);
  try {
    return await fn();
  } finally {
    busyAccounts.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function err(message: string): OrderResult {
  return { ok: false, error: message };
}

function round(v: number, digits: number): number {
  if (!Number.isFinite(v)) return v;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

function priceDigits(v: number): number {
  const s = String(v);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

// Reject rather than silently rewrite: the ticket must show why an order won't
// go through. Only checked when a reference price exists (resting level, or the
// position entry for SL/TP amends); market orders without a live price defer to
// the broker's own validation.
function sideError(direction: "BUY" | "SELL", entry: number | null, sl: number | null, tp: number | null): string | null {
  if (entry == null || entry <= 0) return null;
  if (direction === "BUY") {
    if (tp != null && tp <= entry) return `For a BUY, take profit must be above the entry (${entry})`;
    if (sl != null && sl >= entry) return `For a BUY, stop loss must be below the entry (${entry})`;
  } else {
    if (tp != null && tp >= entry) return `For a SELL, take profit must be below the entry (${entry})`;
    if (sl != null && sl <= entry) return `For a SELL, stop loss must be above the entry (${entry})`;
  }
  return null;
}

// Lots -> broker volume (cents), snapped to the symbol's step/min/max grid so
// an off-grid size isn't rejected outright. Mirrors doochy's manual-size path.
function snapVolume(lots: number, lotSize: number, minVolume: number, stepVolume: number, maxVolume: number): {
  volume: number;
  requested: number;
} {
  const requested = Math.round(lots * lotSize);
  let vol = requested;
  if (stepVolume > 0) vol = Math.round(vol / stepVolume) * stepVolume;
  if (minVolume && vol < minVolume) vol = minVolume;
  if (maxVolume && vol > maxVolume) vol = maxVolume;
  return { volume: vol <= 0 ? 0 : vol, requested };
}

function fmtErr(e: any, fallback: string): string {
  const parts = [String(e?.errorCode ?? "").trim(), String(e?.description ?? e?.message ?? "").trim()].filter(Boolean);
  return parts.length ? parts.join(": ") : fallback;
}

function envFor(isLive: boolean): CtraderEnv {
  return isLive ? "live" : "demo";
}

// Order error events may or may not carry the account id; when absent we assume
// it is ours (write ops are serialized per account, so no cross-talk mid-request).
function isOurOrderError(data: any, ctid: number): boolean {
  return data?.ctidTraderAccountId == null || Number(data.ctidTraderAccountId) === ctid;
}

// ---------------------------------------------------------------------------
// Evented send: place/amend a request and wait for its asynchronous outcome.
// Re-registers listeners on the final channel if a token rotation reopens the
// socket mid-request. `timeout` resolves with onTimeout() so a placed-but-slow
// order isn't double-cancelled by the caller.
// ---------------------------------------------------------------------------
interface ListenSpec {
  name: string;
  match: (data: any) => boolean;
  ok?: boolean;
  describe?: (data: any) => string;
}

type EventOutcome = { kind: "ok"; description?: string } | { kind: "error"; error: string };

async function sendEvented(
  userId: string,
  env: CtraderEnv,
  ctid: number,
  reqName: string,
  payload: Record<string, any>,
  msgId: string | null,
  listeners: ListenSpec[],
  timeoutMs: number,
  onTimeout: () => EventOutcome
): Promise<EventOutcome> {
  const sockets = userSockets(userId);

  return new Promise<EventOutcome>((resolveRoot) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    const cleanups: Array<() => void> = [];

    const cleanup = () => {
      if (timeout) { clearTimeout(timeout); timeout = null; }
      cleanups.splice(0).forEach((fn) => fn());
    };

    const settle = (outcome: EventOutcome) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveRoot(outcome);
    };

    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveRoot(onTimeout());
    }, timeoutMs);

    const run = async () => {
      let attempts = 0;
      while (!settled) {
        attempts++;
        cleanups.splice(0).forEach((fn) => fn());
        try {
          const ch = await sockets.channelForAccount(env, ctid);
          for (const ls of listeners) {
            const id = ch.on(ls.name, (event: any) => {
              if (settled) return;
              const data = event?.descriptor ?? event;
              if (!ls.match(data)) return;
              settle(
                ls.ok
                  ? { kind: "ok", description: ls.describe ? ls.describe(data) : undefined }
                  : { kind: "error", error: ls.describe ? ls.describe(data) : "rejected by broker" }
              );
            });
            cleanups.push(() => ch.off(id));
          }
          await ch.send(reqName, payload, msgId ?? undefined);
          return; // request sent; outcome arrives via events or the timeout
        } catch (e: any) {
          cleanups.splice(0).forEach((fn) => fn());
          if (isTokenError(e) && attempts < 2) {
            await sockets.rotateTokens();
            continue;
          }
          settle({ kind: "error", error: fmtErr(e, `${reqName} request failed`) });
          return;
        }
      }
    };

    void run();
  });
}

// ---------------------------------------------------------------------------
// Place an order
// ---------------------------------------------------------------------------

export function placeOrder(userId: string, ctid: number, isLive: boolean, p: TicketInput): Promise<OrderResult> {
  return withOpLock(userId, ctid, () => doPlace(userId, ctid, isLive, p));
}

async function doPlace(userId: string, ctid: number, isLive: boolean, p: TicketInput): Promise<OrderResult> {
  const symbol = String(p.symbol ?? "").trim().toUpperCase();
  const side: "BUY" | "SELL" = p.side === "SELL" ? "SELL" : "BUY";
  const orderType: "MARKET" | "LIMIT" | "STOP" = p.orderType === "LIMIT" || p.orderType === "STOP" ? p.orderType : "MARKET";
  const lots = Number(p.lots);

  if (!symbol) return err("symbol is required");
  if (!Number.isFinite(lots) || lots <= 0) return err("enter a size in lots");

  const env = envFor(isLive);
  const resolved = await resolveTradableSymbol(userId, env, ctid, symbol);
  if (!resolved || !resolved.spec.lotSize) return err(`${symbol} is not available on this broker`);
  const { symbolId, spec } = resolved;

  const box = snapVolume(lots, spec.lotSize, spec.minVolume, spec.stepVolume, spec.maxVolume);
  if (box.volume <= 0) return err("that size rounds to zero on this symbol");
  const volume = box.volume;

  let price: number | null = null;
  if (orderType === "LIMIT" || orderType === "STOP") {
    price = Number(p.price);
    if (!Number.isFinite(price) || price <= 0) return err(`a ${orderType} order needs a level price`);
    price = round(price, spec.digits || 0);
  }

  const sl = p.sl != null && Number(p.sl) > 0 ? round(Number(p.sl), spec.digits || 0) : null;
  const tp = p.tp != null && Number(p.tp) > 0 ? round(Number(p.tp), spec.digits || 0) : null;

  const se = sideError(side, orderType === "MARKET" ? null : price, sl, tp);
  if (se) return err(se);

  let expiration: number | null = null;
  if (p.expiration != null) {
    const exp = Number(p.expiration);
    if (Number.isFinite(exp) && exp > 0) {
      if (exp <= Date.now()) return err("expiration is in the past");
      expiration = exp;
    }
  }

  const label = randomUUID();
  const payload: Record<string, any> = {
    ctidTraderAccountId: ctid,
    symbolId,
    orderType,
    tradeSide: side,
    volume,
    label,
  };

  if (orderType === "MARKET") {
    payload.timeInForce = "IMMEDIATE_OR_CANCEL";
  } else {
    payload.timeInForce = expiration ? "GOOD_TILL_DATE" : "GOOD_TILL_CANCEL";
    if (orderType === "LIMIT") payload.limitPrice = price;
    else payload.stopPrice = price;
    if (expiration) payload.expirationTimestamp = expiration;
    if (sl != null) payload.stopLoss = sl;
    if (tp != null) payload.takeProfit = tp;
  }

  if (orderType === "MARKET") {
    // Fill or immediate-or-cancel: accept either the fill or the accepted ack
    // and let the poll reveal the final state. An IOC order can't drift, so no
    // auto-cancel is needed on timeout.
    let fillPositionId: number | null = null;
    const outcome = await sendEvented(
      userId, env, ctid, "ProtoOANewOrderReq", payload, null,
      [
        {
          name: "ProtoOAExecutionEvent",
          match: (d) => d?.order?.tradeData?.label === label,
          ok: true,
          describe: (d) => {
            if (d?.executionType === "ORDER_FILLED" && d?.position?.positionId) {
              fillPositionId = Number(d.position.positionId);
              return `Filled ${side} ${volume / spec.lotSize} ${symbol} at ${d?.deal?.executionPrice ?? "market"}`;
            }
            return `Order accepted (${side} ${symbol})`;
          },
        },
        {
          name: "ProtoOAOrderErrorEvent",
          match: (d) => isOurOrderError(d, ctid),
          describe: (d) => `${String(d?.errorCode ?? "rejected")}: ${String(d?.description ?? "")}`.trim(),
        },
      ],
      15_000,
      () => ({ kind: "ok", description: `Order sent; fill status will show on refresh (${side} ${symbol})` })
    );

    if (outcome.kind === "error") {
      return err(outcome.error);
    }
    let note = outcome.description ?? "Order processed";
    if (box.volume !== box.requested) note += ` (adjusted to ${volume / spec.lotSize} lots by the broker's size grid)`;
    if (sl != null || tp != null) {
      // cTrader won't take SL/TP on an IOC market order, and doochy applies them
      // via a separate amend after the fill. Do the same once we know the fill's
      // position id; otherwise the poll shows the truth and the user can set
      // levels from the position's SL/TP action.
      if (fillPositionId != null) {
        const pid = fillPositionId;
        setTimeout(() => {
          void amendPositionSLTP(userId, ctid, isLive, pid, sl, tp).then((r) => {
            if (!r.ok) console.warn(`[EXECUTE] post-fill SL/TP for #${pid} failed: ${r.error}`);
          });
        }, 0);
        note += " (SL/TP applied after the fill)";
      } else {
        note += " (SL/TP enter after the fill - set them on the position if the refresh doesn't show them)";
      }
    }
    return { ok: true, note };
  }

  // Resting LIMIT/STOP: succeed when the broker accepts the order; a rejection
  // arrives as OrderErrorEvent. On total silence (10s) report failure WITHOUT
  // cancelling - the order may still be live, and the poll will show the truth.
  const outcome = await sendEvented(
    userId, env, ctid, "ProtoOANewOrderReq", payload, null,
    [
      {
        name: "ProtoOAExecutionEvent",
        match: (d) =>
          d?.order?.tradeData?.label === label &&
          (d?.executionType === "ORDER_ACCEPTED" || d?.executionType === "ORDER_FILLED" || d?.executionType === 2 || d?.executionType === 1),
        ok: true,
        describe: () => `${side} ${orderType} ${volume / spec.lotSize} ${symbol} placed at ${price}`,
      },
      {
        name: "ProtoOAOrderErrorEvent",
        match: (d) => isOurOrderError(d, ctid),
        describe: (d) => `${String(d?.errorCode ?? "rejected")}: ${String(d?.description ?? "")}`.trim(),
      },
    ],
    10_000,
    () => ({ kind: "error", error: `No broker acknowledgement for the ${orderType} order (it may still be pending - check Pending Orders)` })
  );

  if (outcome.kind === "error") {
    return err(outcome.error);
  }
  const snappedNote = box.volume !== box.requested ? ` (adjusted to ${volume / spec.lotSize} lots by the broker's size grid)` : "";
  return { ok: true, note: `${outcome.description ?? "Order placed"}${snappedNote}` };
}

// ---------------------------------------------------------------------------
// Cancel a resting order
// ---------------------------------------------------------------------------

export function cancelOrder(userId: string, ctid: number, isLive: boolean, orderId: number): Promise<OrderResult> {
  return withOpLock(userId, ctid, async () => {
    if (!Number.isFinite(orderId) || orderId <= 0) return err("invalid order id");
    const env = envFor(isLive);
    const sockets = userSockets(userId);
    try {
      await sockets.send(env, "ProtoOACancelOrderReq", { ctidTraderAccountId: ctid, orderId }, { ctid });
      return { ok: true, note: "Cancel request sent" };
    } catch (e: any) {
      return err(fmtErr(e, "cancel failed"));
    }
  });
}

// ---------------------------------------------------------------------------
// Modify a resting order's level and/or SL/TP. Reads the order fresh from the
// broker (authoritative type/side/volume); nulls keep their current value.
// ---------------------------------------------------------------------------

export function modifyOrder(
  userId: string,
  ctid: number,
  isLive: boolean,
  orderId: number,
  changes: { price?: number | null; sl?: number | null; tp?: number | null }
): Promise<OrderResult> {
  return withOpLock(userId, ctid, async () => {
    if (!Number.isFinite(orderId) || orderId <= 0) return err("invalid order id");
    const env = envFor(isLive);
    const sockets = userSockets(userId);

    let res: any;
    try {
      res = await sockets.send(env, "ProtoOAReconcileReq", { ctidTraderAccountId: ctid }, { ctid });
    } catch (e: any) {
      return err(fmtErr(e, "could not load the order"));
    }

    const o = (res?.order ?? []).find((x: any) => Number(x.orderId) === orderId);
    if (!o) return err("order not found (it may have filled or been cancelled)");
    if (o.orderType !== "LIMIT" && o.orderType !== "STOP") return err("only LIMIT/STOP orders can be modified");

    const td = o.tradeData || {};
    const direction: "BUY" | "SELL" = td.tradeSide === "SELL" ? "SELL" : "BUY";
    const isLimit = o.orderType === "LIMIT";
    const curLevel = isLimit ? Number(o.limitPrice) || 0 : Number(o.stopPrice) || 0;

    const newPrice = changes.price != null && Number(changes.price) > 0 ? Number(changes.price) : null;
    const entry = newPrice != null && newPrice > 0 ? newPrice : curLevel;
    const digits = priceDigits(curLevel || entry);

    // Existing SL/TP resolve from the CURRENT level (that's what the relative
    // form was measured from), then the user's changes override them.
    const curSl = resolveLevel(curLevel, direction, "SL", o.stopLoss, o.relativeStopLoss);
    const curTp = resolveLevel(curLevel, direction, "TP", o.takeProfit, o.relativeTakeProfit);
    const sl = changes.sl != null && Number(changes.sl) > 0 ? Number(changes.sl) : curSl;
    const tp = changes.tp != null && Number(changes.tp) > 0 ? Number(changes.tp) : curTp;

    const se = sideError(direction, entry, sl != null ? round(sl, digits) : null, tp != null ? round(tp, digits) : null);
    if (se) return err(se);

    const fields: Record<string, any> = {
      volume: Number(td.volume) || 0,
      ...(isLimit ? { limitPrice: round(entry, digits) } : { stopPrice: round(entry, digits) }),
    };
    if (sl != null) fields.stopLoss = round(sl, digits);
    if (tp != null) fields.takeProfit = round(tp, digits);
    if (o.expirationTimestamp) fields.expirationTimestamp = Number(o.expirationTimestamp);

    const msgId = randomUUID();
    const outcome = await sendEvented(
      userId, env, ctid, "ProtoOAAmendOrderReq", { ctidTraderAccountId: ctid, orderId, ...fields }, msgId,
      [
        {
          name: "ProtoOAExecutionEvent",
          match: (d) => Number(d?.order?.orderId) === orderId && (d?.executionType === "ORDER_REPLACED" || d?.executionType === 3),
          ok: true,
          describe: () => `Order updated (level ${round(entry, digits)}, SL ${sl ?? "-"}, TP ${tp ?? "-"})`,
        },
        {
          name: "ProtoOAOrderErrorEvent",
          match: (d) => d?.clientMsgId === msgId,
          describe: (d) => `${String(d?.errorCode ?? "rejected")}: ${String(d?.description ?? "")}`.trim(),
        },
      ],
      8_000,
      () => ({ kind: "ok", description: "Update sent; it will appear on the next refresh" })
    );

    return outcome.kind === "error" ? err(outcome.error) : { ok: true, note: outcome.description };
  });
}

// ---------------------------------------------------------------------------
// Close a position at market
// ---------------------------------------------------------------------------

export function closePosition(userId: string, ctid: number, isLive: boolean, positionId: number): Promise<OrderResult> {
  return withOpLock(userId, ctid, async () => {
    if (!Number.isFinite(positionId) || positionId <= 0) return err("invalid position id");
    const env = envFor(isLive);
    const sockets = userSockets(userId);

    let res: any;
    try {
      res = await sockets.send(env, "ProtoOAReconcileReq", { ctidTraderAccountId: ctid }, { ctid });
    } catch (e: any) {
      return err(fmtErr(e, "could not load the position"));
    }

    const pos = (res?.position ?? []).find((x: any) => {
      if (Number(x.positionId) !== positionId) return false;
      const st = x.positionStatus;
      return st == null || st === "POSITION_STATUS_OPEN" || st === 1;
    });
    if (!pos) return err("position not found (it may already be closed)");

    const volume = Number(pos.tradeData?.volume) || 0;
    if (volume <= 0) return err("position volume unavailable");

    try {
      await sockets.send(env, "ProtoOAClosePositionReq", { ctidTraderAccountId: ctid, positionId, volume }, { ctid });
      return { ok: true, note: "Close request sent" };
    } catch (e: any) {
      return err(fmtErr(e, "close failed"));
    }
  });
}

// ---------------------------------------------------------------------------
// Set a position's SL/TP. cTrader's amend replaces the FULL SL/TP state, so the
// previous SL/TP must be resent or it is wiped - the frontend sends both.
// ---------------------------------------------------------------------------

export function amendPositionSLTP(
  userId: string,
  ctid: number,
  isLive: boolean,
  positionId: number,
  sl: number | null,
  tp: number | null
): Promise<OrderResult> {
  return withOpLock(userId, ctid, async () => {
    if (!Number.isFinite(positionId) || positionId <= 0) return err("invalid position id");
    const env = envFor(isLive);
    const sockets = userSockets(userId);

    let res: any;
    try {
      res = await sockets.send(env, "ProtoOAReconcileReq", { ctidTraderAccountId: ctid }, { ctid });
    } catch (e: any) {
      return err(fmtErr(e, "could not load the position"));
    }

    const pos = (res?.position ?? []).find((x: any) => {
      if (Number(x.positionId) !== positionId) return false;
      const st = x.positionStatus;
      return st == null || st === "POSITION_STATUS_OPEN" || st === 1;
    });
    if (!pos) return err("position not found (it may already be closed)");

    const entry = Number(pos.price) || 0;
    const direction: "BUY" | "SELL" = pos.tradeData?.tradeSide === "SELL" ? "SELL" : "BUY";
    const digits = entry > 0 ? priceDigits(entry) : 2;

    const slR = sl != null && Number(sl) > 0 ? round(Number(sl), digits) : null;
    const tpR = tp != null && Number(tp) > 0 ? round(Number(tp), digits) : null;
    if (slR == null && tpR == null) return err("nothing to change - set a stop loss and/or take profit");

    const se = sideError(direction, entry > 0 ? entry : null, slR, tpR);
    if (se) return err(se);

    const fields: Record<string, any> = {};
    if (slR != null) fields.stopLoss = slR;
    if (tpR != null) fields.takeProfit = tpR;

    const msgId = randomUUID();
    const outcome = await sendEvented(
      userId, env, ctid, "ProtoOAAmendPositionSLTPReq", { ctidTraderAccountId: ctid, positionId, ...fields }, msgId,
      [
        {
          name: "ProtoOAExecutionEvent",
          match: (d) => {
            const evtPositionId = String(d?.position?.positionId ?? d?.order?.positionId ?? "");
            if (evtPositionId !== String(positionId)) return false;
            const orderType = d?.order?.orderType;
            if (orderType !== "STOP_LOSS_TAKE_PROFIT" && orderType !== 4) return false;
            const et = d?.executionType;
            return et === "ORDER_ACCEPTED" || et === 2 || et === "ORDER_REPLACED" || et === 4;
          },
          ok: true,
          describe: () => `SL/TP updated (SL ${slR ?? "-"}, TP ${tpR ?? "-"})`,
        },
        {
          name: "ProtoOAOrderErrorEvent",
          match: (d) => d?.clientMsgId === msgId,
          describe: (d) => `${String(d?.errorCode ?? "rejected")}: ${String(d?.description ?? "")}`.trim(),
        },
      ],
      8_000,
      () => ({ kind: "ok", description: "SL/TP update sent; it will appear on the next refresh" })
    );

    return outcome.kind === "error" ? err(outcome.error) : { ok: true, note: outcome.description };
  });
}

// ---------------------------------------------------------------------------
// Preview: resolve + validate + snap a ticket before it is placed, so the UI
// shows the exact size the broker would accept (and approx risk/reward in USD).
// ---------------------------------------------------------------------------

export async function previewOrder(userId: string, ctid: number, isLive: boolean, p: TicketInput): Promise<{
  ok: boolean;
  error?: string;
  preview?: OrderPreview;
}> {
  const symbol = String(p.symbol ?? "").trim().toUpperCase();
  const side: "BUY" | "SELL" = p.side === "SELL" ? "SELL" : "BUY";
  const orderType: "MARKET" | "LIMIT" | "STOP" = p.orderType === "LIMIT" || p.orderType === "STOP" ? p.orderType : "MARKET";
  const lots = Number(p.lots);

  if (!symbol) return { ok: false, error: "symbol is required" };
  if (!Number.isFinite(lots) || lots <= 0) return { ok: false, error: "enter a size in lots" };

  const env = envFor(isLive);
  const resolved = await resolveTradableSymbol(userId, env, ctid, symbol);
  if (!resolved || !resolved.spec.lotSize) return { ok: false, error: `${symbol} is not available on this broker` };
  const { symbolId, spec } = resolved;

  const box = snapVolume(lots, spec.lotSize, spec.minVolume, spec.stepVolume, spec.maxVolume);
  if (box.volume <= 0) return { ok: false, error: "that size rounds to zero on this symbol" };

  let entryRef: number | null = null;
  let sl = p.sl != null && Number(p.sl) > 0 ? Number(p.sl) : null;
  let tp = p.tp != null && Number(p.tp) > 0 ? Number(p.tp) : null;

  if (orderType === "LIMIT" || orderType === "STOP") {
    const price = Number(p.price);
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: `a ${orderType} order needs a level price` };
    entryRef = round(price, spec.digits || 0);
  } else if (sl != null || tp != null) {
    // Market: anchor risk/reward to the live quote. If the symbol has no open
    // position it was never subscribed, so ask for a spot stream and wait for
    // the first tick instead of silently leaving risk/reward empty.
    // A BUY enters at the ask, a SELL at the bid (same sides the positions
    // table uses for close marks).
    const sockets = userSockets(userId);
    const q = await sockets.waitForQuote(env, ctid, symbolId, 1200);
    if (q) {
      const px = side === "BUY" ? (q.ask || q.bid) : (q.bid || q.ask);
      if (px > 0) entryRef = px;
    }
  }

  const se = sideError(side, entryRef, sl, tp);
  if (se) return { ok: false, error: se };

  const factor = await quoteUsdFactor(userId, ctid, isLive, symbolId);
  const warnings: string[] = [];
  if (factor == null) warnings.push("No USD conversion rate yet; risk figures are approximate.");
  if (orderType === "MARKET" && entryRef == null) warnings.push("No live quote yet for this symbol; risk figures will appear once it streams.");

  const riskDist = entryRef != null && sl != null ? Math.abs(entryRef - sl) : null;
  const rewardDist = entryRef != null && tp != null ? Math.abs(entryRef - tp) : null;
  const f = factor ?? 1;
  const riskUSD = riskDist != null ? riskDist * (box.volume / 100) * f : null;
  const rewardUSD = rewardDist != null ? rewardDist * (box.volume / 100) * f : null;
  const rr = riskUSD != null && riskUSD > 0 && rewardUSD != null ? rewardUSD / riskUSD : null;

  if (sl == null) warnings.push("No stop loss: risk is unbounded.");
  if (box.volume !== box.requested) warnings.push(`Adjusted to ${round(box.volume / spec.lotSize, 4)} lots (broker's size grid).`);
  if (orderType === "MARKET" && (sl != null || tp != null)) warnings.push("SL/TP on a market order are applied right after the fill.");

  return {
    ok: true,
    preview: {
      symbol,
      snapped: box.volume !== box.requested,
      lots: round(box.volume / spec.lotSize, 4),
      minLots: spec.minVolume ? spec.minVolume / spec.lotSize : null,
      lotStep: spec.stepVolume ? spec.stepVolume / spec.lotSize : null,
      entryRef,
      riskUSD: riskUSD != null ? Math.round(riskUSD * 100) / 100 : null,
      rewardUSD: rewardUSD != null ? Math.round(rewardUSD * 100) / 100 : null,
      rr: rr != null ? Math.round(rr * 100) / 100 : null,
      warnings,
    },
  };
}