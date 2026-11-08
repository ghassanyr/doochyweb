// Public trainer API (Phase 5).
//
// Mounted at `/api/trainer` by index.ts. No auth: clients are anonymous and
// identify themselves with an opaque session id. The pre-answer routes only
// serve anonymized context; the outcome and future bars are available only from
// `POST /reveal`, which refuses until the session has answered that item.

import { Router, type Request, type Response } from "express";

import type { Candle } from "../market/types";
import {
  createAttemptStore,
  type AttemptStore,
  type Trade,
} from "./attempts";
import { readTrainerBars } from "./bars";
import { TAGS } from "./config";
import {
  anonymizeItem,
  isValidSessionId,
  publicItemId,
  revealItem,
} from "./payload";
import {
  seriesKey,
  TrainerBatches,
  TrainerItems,
} from "./publish";
import type {
  TrainerBatch,
  TrainerItem,
  TrainerSymbol,
  TrainerTimeframe,
} from "./types";

const BATCH_CACHE_MS = 30_000;
const DEFAULT_SESSION_ITEMS = 10;
const MAX_SESSION_ITEMS = 20;
const MAX_ITEM_ID_LENGTH = 300;

export interface TrainerRouterOptions {
  /**
   * Inject a batch for tests or embedding. `null` means "no batch published".
   * When omitted, the latest batch is loaded lazily from Mongo and cached.
   */
  batch?: TrainerBatch | null;
  /** Override the TrainerBars reader; tests pass an in-memory series map. */
  loadBars?: (
    symbol: TrainerSymbol,
    timeframe: TrainerTimeframe
  ) => Promise<readonly Candle[] | null>;
  /** Override the in-memory attempt store. */
  attempts?: AttemptStore;
  /** Clock override for deterministic tests. */
  now?: () => number;
}

class TrainerDataUnavailableError extends Error {}

function internalError(res: Response): void {
  res.status(500).json({ error: "trainer request failed" });
}

function unavailable(res: Response): void {
  res.status(503).json({ error: "trainer data unavailable" });
}

async function loadPublishedBatch(): Promise<TrainerBatch | null> {
  const meta = await TrainerBatches.findOne()
    .sort({ publishedAt: -1 })
    .lean()
    .exec();
  if (!meta) return null;

  const version = String(meta._id);
  const docs = await TrainerItems.find({ batchVersion: version }).lean().exec();
  const items = docs
    .map((doc) => {
      const record = doc as unknown as Record<string, unknown> & { _id: unknown };
      const { _id, ...rest } = record;
      return { ...rest, id: String(_id) } as unknown as TrainerItem;
    })
    .sort((a, b) => a.cutIndex - b.cutIndex || a.id.localeCompare(b.id));

  return {
    version,
    createdAt: Number(meta.createdAt),
    symbols: [...meta.symbols] as TrainerSymbol[],
    timeframes: [...meta.timeframes] as TrainerTimeframe[],
    barrierAtrMult: Number(meta.barrierAtrMult),
    barrierHorizon: Number(meta.barrierHorizon),
    baseRates: meta.baseRates as TrainerBatch["baseRates"],
    baseRateCounts: meta.baseRateCounts as TrainerBatch["baseRateCounts"],
    items,
  };
}

function hashSessionId(sessionId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < sessionId.length; i++) {
    hash ^= sessionId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rotate<T>(items: readonly T[], seed: number): T[] {
  if (items.length <= 1) return [...items];
  const offset = seed % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

/**
 * Deterministic per-session selection: rotate the eligible list by a hash of the
 * session id, then take one item per tag in rotating tag order. That keeps a
 * drill varied across concepts even when one tag is over-represented.
 */
function selectForSession(
  items: readonly TrainerItem[],
  sessionId: string,
  count: number
): TrainerItem[] {
  if (count <= 0 || items.length === 0) return [];

  const seed = hashSessionId(sessionId);
  const rotated = rotate(items, seed);
  const groups = new Map<string, TrainerItem[]>();
  for (const tag of TAGS) groups.set(tag, []);
  for (const item of rotated) {
    const group = groups.get(item.tag);
    if (group) group.push(item);
    else groups.set(item.tag, [item]);
  }

  const tagOrder = rotate([...groups.keys()], seed);
  const positions = new Map<string, number>();
  const out: TrainerItem[] = [];

  while (out.length < count) {
    let added = false;
    for (const tag of tagOrder) {
      if (out.length >= count) break;
      const group = groups.get(tag)!;
      const index = positions.get(tag) ?? 0;
      if (index >= group.length) continue;
      out.push(group[index]);
      positions.set(tag, index + 1);
      added = true;
    }
    if (!added) break;
  }

  return out;
}

function parseCount(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SESSION_ITEMS;
  return Math.min(MAX_SESSION_ITEMS, Math.max(1, Math.trunc(parsed)));
}

function readSessionId(value: unknown, res: Response): string | null {
  if (!isValidSessionId(value)) {
    res.status(400).json({ error: "invalid sessionId" });
    return null;
  }
  return value;
}

function readItemId(value: unknown, res: Response): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ITEM_ID_LENGTH
  ) {
    res.status(400).json({ error: "invalid itemId" });
    return null;
  }
  return value;
}

/** Resolve an opaque public id back to the batch item without exposing the key. */
function findByPublicId(
  batch: TrainerBatch,
  publicId: string
): TrainerItem | undefined {
  return batch.items.find((item) => publicItemId(item.id) === publicId);
}

export function createTrainerRouter(
  options: TrainerRouterOptions = {}
): Router {
  const router = Router();
  const now = options.now ?? Date.now;
  const attempts =
    options.attempts ?? createAttemptStore({ now });

  const defaultLoadBars = async (
    symbol: TrainerSymbol,
    timeframe: TrainerTimeframe
  ): Promise<readonly Candle[] | null> => {
    const stored = await readTrainerBars(symbol, timeframe);
    return stored?.bars ?? null;
  };
  const loadBars = options.loadBars ?? defaultLoadBars;

  let cached: { at: number; value: TrainerBatch | null } | null = null;
  let inflight: Promise<TrainerBatch | null> | null = null;

  async function getBatch(): Promise<TrainerBatch | null> {
    if (options.batch !== undefined) return options.batch;

    const at = now();
    if (cached && at - cached.at < BATCH_CACHE_MS) return cached.value;

    if (!inflight) {
      inflight = loadPublishedBatch()
        .then((value) => {
          cached = { at: now(), value };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  function createBarsCache(): (
    item: TrainerItem
  ) => Promise<readonly Candle[] | null> {
    const cache = new Map<string, readonly Candle[] | null>();
    return async (item) => {
      const key = seriesKey(item.symbol, item.timeframe);
      if (!cache.has(key)) {
        cache.set(key, await loadBars(item.symbol, item.timeframe));
      }
      return cache.get(key) ?? null;
    };
  }

  async function requireBars(
    item: TrainerItem,
    barsFor: (item: TrainerItem) => Promise<readonly Candle[] | null>
  ): Promise<readonly Candle[]> {
    const bars = await barsFor(item);
    if (!bars) throw new TrainerDataUnavailableError();
    return bars;
  }

  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res);
      } catch (err) {
        if (err instanceof TrainerDataUnavailableError) unavailable(res);
        else internalError(res);
      }
    };

  router.get(
    "/batch",
    handle(async (_req, res) => {
      const batch = await getBatch();
      if (!batch) {
        res.status(503).json({ error: "no batch published" });
        return;
      }
      res.json({
        version: batch.version,
        createdAt: batch.createdAt,
        itemCount: batch.items.length,
        barrierAtrMult: batch.barrierAtrMult,
        barrierHorizon: batch.barrierHorizon,
      });
    })
  );

  router.get(
    "/session",
    handle(async (req, res) => {
      const sessionId = readSessionId(req.query.sessionId, res);
      if (sessionId === null) return;

      const batch = await getBatch();
      if (!batch) {
        res.status(503).json({ error: "no batch published" });
        return;
      }

      const count = parseCount(req.query.count);
      const answered = attempts.answeredIds(sessionId);
      const eligible = batch.items.filter((item) => !answered.has(item.id));
      const selected = selectForSession(eligible, sessionId, count);
      const barsFor = createBarsCache();

      const items = [];
      for (const item of selected) {
        const bars = await requireBars(item, barsFor);
        items.push(anonymizeItem(item, bars));
      }

      res.json({ sessionId, count: items.length, items });
    })
  );

  router.get(
    "/item/:id",
    handle(async (req, res) => {
      const batch = await getBatch();
      if (!batch) {
        res.status(503).json({ error: "no batch published" });
        return;
      }

      const item = findByPublicId(batch, req.params.id);
      if (!item) {
        res.status(404).json({ error: "item not found" });
        return;
      }

      const barsFor = createBarsCache();
      const bars = await requireBars(item, barsFor);
      res.json({ item: anonymizeItem(item, bars) });
    })
  );

  router.post(
    "/answer",
    handle(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sessionId = readSessionId(body.sessionId, res);
      if (sessionId === null) return;
      const itemId = readItemId(body.itemId, res);
      if (itemId === null) return;

      const rawProbability = body.probability;
      const rawTrade = body.trade;
      const hasProbability = rawProbability !== undefined && rawProbability !== null;
      const hasTrade = rawTrade !== undefined && rawTrade !== null;

      if (!hasProbability && !hasTrade) {
        res.status(400).json({
          error: "at least one of probability or trade is required",
        });
        return;
      }

      let probability: number | null = null;
      if (hasProbability) {
        if (
          typeof rawProbability !== "number" ||
          !Number.isFinite(rawProbability) ||
          rawProbability < 0 ||
          rawProbability > 1
        ) {
          res.status(400).json({
            error: "probability must be a number between 0 and 1",
          });
          return;
        }
        probability = rawProbability;
      }

      let trade: Trade | null = null;
      if (hasTrade) {
        if (rawTrade !== "take" && rawTrade !== "pass") {
          res.status(400).json({ error: 'trade must be "take" or "pass"' });
          return;
        }
        trade = rawTrade;
      }

      const batch = await getBatch();
      if (!batch) {
        res.status(503).json({ error: "no batch published" });
        return;
      }
      const item = findByPublicId(batch, itemId);
      if (!item) {
        res.status(404).json({ error: "item not found" });
        return;
      }

      const result = attempts.record({
        sessionId,
        itemId: item.id,
        probability,
        trade,
      });
      res.json({ ok: true, conflict: result.conflict });
    })
  );

  router.post(
    "/reveal",
    handle(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sessionId = readSessionId(body.sessionId, res);
      if (sessionId === null) return;
      const itemId = readItemId(body.itemId, res);
      if (itemId === null) return;

      const batch = await getBatch();
      if (!batch) {
        res.status(503).json({ error: "no batch published" });
        return;
      }

      const item = findByPublicId(batch, itemId);
      if (!item) {
        res.status(404).json({ error: "item not found" });
        return;
      }

      if (!attempts.get(sessionId, item.id)) {
        res.status(409).json({ error: "answer required" });
        return;
      }

      const barsFor = createBarsCache();
      const bars = await requireBars(item, barsFor);
      res.json({ reveal: revealItem(item, bars, batch) });
    })
  );

  return router;
}
