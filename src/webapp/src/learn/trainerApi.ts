import { ApiError } from "../api";

// Anonymous trainer client. Unlike the account API this never sends an
// Authorization header: drill sessions are identified only by an opaque id.

export type Outcome = "up" | "down" | "scratch";
export type TradeChoice = "take" | "pass";

export interface NormalizedBar {
  offset: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarrierPercent {
  upperPct: number;
  lowerPct: number;
}

export interface AnonymizedItem {
  itemId: string;
  question: {
    kind: "probability_and_trade";
    prompt: string;
    barrierPct: BarrierPercent;
  };
  context: NormalizedBar[];
}

export interface RevealBaseRate {
  n: number;
  counts: Record<Outcome, number>;
  rates: Record<Outcome, number>;
}

export interface RevealedItem {
  itemId: string;
  reveal: NormalizedBar[];
  outcome: Outcome;
  outcomeOffset: number | null;
  barrierPct: BarrierPercent;
  mfeAtr: number;
  maeAtr: number;
  mfeR: number;
  maeR: number;
  tag: string;
  bounds: { startOffset: number; endOffset: number };
  levels: {
    levelUpperPct: number | null;
    levelLowerPct: number | null;
    necklinePct: number | null;
  };
  why: string;
  baseRates: { tag: RevealBaseRate; all: RevealBaseRate };
}

export interface TrainerBatchMeta {
  version: string;
  createdAt: number;
  itemCount: number;
  barrierAtrMult: number;
  barrierHorizon: number;
}

export interface TrainerSession {
  sessionId: string;
  count: number;
  items: AnonymizedItem[];
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
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

export const trainerApi = {
  batch: () => request<TrainerBatchMeta>("/api/trainer/batch"),

  session: (sessionId: string, count: number) =>
    request<TrainerSession>(
      `/api/trainer/session?sessionId=${encodeURIComponent(sessionId)}` +
        `&count=${encodeURIComponent(String(count))}`
    ),

  item: (itemId: string) =>
    request<{ item: AnonymizedItem }>(
      `/api/trainer/item/${encodeURIComponent(itemId)}`
    ),

  answer: (
    sessionId: string,
    itemId: string,
    probability: number,
    trade: TradeChoice
  ) =>
    request<{ ok: true; conflict: boolean }>("/api/trainer/answer", {
      method: "POST",
      body: { sessionId, itemId, probability, trade },
    }),

  reveal: (sessionId: string, itemId: string) =>
    request<{ reveal: RevealedItem }>("/api/trainer/reveal", {
      method: "POST",
      body: { sessionId, itemId },
    }),
};
