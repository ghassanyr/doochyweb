// Persistence for the public Signals feed.
//
// One document per signal. Admins are recorded on create/edit/invalidate for
// accountability, but those fields never leave this module: `toView` strips them
// so cards cannot reveal who posted.
//
// Expiry is lazy. There is no background job in v1, so every read first flips
// active signals whose `expiresAt` has passed to `expired`. The automatic
// target/stop resolver (phase 4) can reuse the same lifecycle.

import mongoose from "mongoose";

import type {
  SignalCounts,
  SignalInput,
  SignalResolution,
  SignalStats,
  SignalStatus,
  SignalView,
} from "./types";
import { computeRR, validateSignalInput } from "./validate";

const STATUSES: SignalStatus[] = ["active", "invalidated", "expired", "target_hit", "stopped_out"];

export class SignalError extends Error {
  status: number;
  extra?: unknown;

  constructor(status: number, message: string, extra?: unknown) {
    super(message);
    this.name = "SignalError";
    this.status = status;
    this.extra = extra;
  }
}

const updateSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    note: { type: String, required: true },
  },
  { _id: false }
);

const signalSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, index: true },
    direction: { type: String, enum: ["buy", "sell"], required: true },
    entry: { type: Number, default: null },
    entryMax: { type: Number, default: null },
    target: { type: Number, required: true },
    target2: { type: Number, default: null },
    target3: { type: Number, default: null },
    stop: { type: Number, required: true },
    timeframe: { type: String, default: null },
    note: { type: String, default: "" },
    status: { type: String, enum: STATUSES, default: "active", index: true },
    expiresAt: { type: Date, default: null },
    invalidatedAt: { type: Date, default: null },
    invalidatedBy: { type: String, default: null },
    invalidationReason: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    resolution: { type: String, enum: ["target_hit", "stopped_out", null], default: null },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
    updates: { type: [updateSchema], default: [] },
  },
  { timestamps: true }
);

signalSchema.index({ status: 1, createdAt: -1 });
signalSchema.index({ symbol: 1, createdAt: -1 });

const Signal = mongoose.model("Signal", signalSchema);

function iso(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Public projection. Never include createdBy / updatedBy / invalidatedBy. */
export function toView(doc: any): SignalView {
  return {
    id: String(doc._id),
    symbol: doc.symbol,
    direction: doc.direction,
    entry: doc.entry ?? null,
    entryMax: doc.entryMax ?? null,
    target: doc.target,
    target2: doc.target2 ?? null,
    target3: doc.target3 ?? null,
    stop: doc.stop,
    timeframe: doc.timeframe ?? null,
    note: doc.note ?? "",
    status: doc.status,
    expiresAt: iso(doc.expiresAt),
    createdAt: iso(doc.createdAt)!,
    updatedAt: iso(doc.updatedAt)!,
    invalidatedAt: iso(doc.invalidatedAt),
    invalidationReason: doc.invalidationReason ?? null,
    resolvedAt: iso(doc.resolvedAt),
    resolution: (doc.resolution ?? null) as SignalResolution,
    updates: (doc.updates ?? []).map((u: any) => ({ at: iso(u.at)!, note: u.note })),
  };
}

/** Flip active signals whose expiry has passed. Returns how many changed. */
export async function expireDue(now: Date = new Date()): Promise<number> {
  const due = await Signal.find({ status: "active", expiresAt: { $ne: null, $lte: now } })
    .select({ _id: 1 })
    .lean()
    .exec();
  if (!due.length) return 0;
  await Signal.bulkWrite(
    due.map((d) => ({
      updateOne: {
        filter: { _id: d._id, status: "active" },
        update: { $set: { status: "expired" } },
      },
    }))
  );
  return due.length;
}

async function readCounts(): Promise<SignalCounts> {
  const rows = await Signal.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).exec();
  const by = new Map<string, number>(rows.map((r: any) => [String(r._id), Number(r.n)]));
  const active = by.get("active") ?? 0;
  const invalidated = by.get("invalidated") ?? 0;
  const expired = by.get("expired") ?? 0;
  const targetHit = by.get("target_hit") ?? 0;
  const stoppedOut = by.get("stopped_out") ?? 0;
  const total = active + invalidated + expired + targetHit + stoppedOut;
  return { active, invalidated, expired, targetHit, stoppedOut, total, history: total - active };
}

export async function listSignals(options: {
  status?: string;
  symbol?: string;
  direction?: string;
  limit?: number;
  offset?: number;
  now?: Date;
}): Promise<{ signals: SignalView[]; total: number; counts: SignalCounts }> {
  await expireDue(options.now);
  const filter: Record<string, unknown> = {};
  if (options.status === "active") filter.status = "active";
  // "all" (and an absent status) intentionally leaves status unfiltered.
  else if (options.status === "history") filter.status = { $ne: "active" };
  else if (options.status && (STATUSES as string[]).includes(options.status)) filter.status = options.status;
  if (options.symbol) filter.symbol = options.symbol.toUpperCase();
  if (options.direction === "buy" || options.direction === "sell") filter.direction = options.direction;

  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const sort: Record<string, 1 | -1> =
    options.status === "active" ? { createdAt: -1 } : { updatedAt: -1 };

  const [docs, total, counts] = await Promise.all([
    Signal.find(filter).sort(sort).skip(offset).limit(limit).lean().exec(),
    Signal.countDocuments(filter).exec(),
    readCounts(),
  ]);
  return { signals: docs.map(toView), total, counts };
}

export async function getSignal(id: string, now: Date = new Date()): Promise<SignalView | null> {
  await expireDue(now);
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await Signal.findById(id).lean().exec();
  return doc ? toView(doc) : null;
}

export async function createSignal(
  input: SignalInput,
  username: string | undefined,
  { force = false }: { force?: boolean } = {}
): Promise<SignalView> {
  // Apply expiry first so an already-closed signal does not block a fresh one.
  await expireDue();
  if (!force) {
    const existing = await Signal.findOne({
      symbol: input.symbol,
      direction: input.direction,
      status: "active",
    })
      .lean()
      .exec();
    if (existing) {
      throw new SignalError(
        409,
        `an active ${input.symbol} ${input.direction} signal already exists`,
        toView(existing)
      );
    }
  }
  const doc = await Signal.create({
    ...input,
    status: "active",
    createdBy: username ?? null,
    updatedBy: username ?? null,
  });
  return toView(doc.toObject());
}

function has(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export async function updateSignal(
  id: string,
  patch: Record<string, unknown>,
  username: string | undefined
): Promise<SignalView> {
  if (!mongoose.isValidObjectId(id)) throw new SignalError(404, "signal not found");
  await expireDue();
  const doc = await Signal.findById(id).exec();
  if (!doc) throw new SignalError(404, "signal not found");
  if (doc.status !== "active") throw new SignalError(409, "only active signals can be edited");

  const merged = {
    symbol: has(patch, "symbol") ? patch.symbol : doc.symbol,
    direction: has(patch, "direction") ? patch.direction : doc.direction,
    entry: has(patch, "entry") ? patch.entry : doc.entry,
    entryMax: has(patch, "entryMax")
      ? patch.entryMax
      : has(patch, "entry") && (patch.entry == null || patch.entry === "")
        ? null
        : doc.entryMax,
    target: has(patch, "target") ? patch.target : doc.target,
    target2: has(patch, "target2") ? patch.target2 : doc.target2,
    target3: has(patch, "target3") ? patch.target3 : doc.target3,
    stop: has(patch, "stop") ? patch.stop : doc.stop,
    timeframe: has(patch, "timeframe") ? patch.timeframe : doc.timeframe,
    note: has(patch, "note") ? patch.note : doc.note,
    expiresAt: has(patch, "expiresAt") ? patch.expiresAt : doc.expiresAt,
  };
  const parsed = validateSignalInput(merged, { requireFutureExpiry: false });
  if (!parsed.ok) throw new SignalError(400, parsed.error);
  const value = parsed.value;

  const symbolChanged = value.symbol !== doc.symbol || value.direction !== doc.direction;
  if (symbolChanged) {
    const duplicate = await Signal.findOne({
      _id: { $ne: doc._id },
      symbol: value.symbol,
      direction: value.direction,
      status: "active",
    })
      .lean()
      .exec();
    if (duplicate) {
      throw new SignalError(
        409,
        `an active ${value.symbol} ${value.direction} signal already exists`,
        toView(duplicate)
      );
    }
  }

  doc.symbol = value.symbol;
  doc.direction = value.direction;
  doc.entry = value.entry;
  doc.entryMax = value.entryMax;
  doc.target = value.target;
  doc.target2 = value.target2;
  doc.target3 = value.target3;
  doc.stop = value.stop;
  doc.timeframe = value.timeframe;
  doc.note = value.note;
  doc.expiresAt = value.expiresAt;
  doc.updatedBy = username ?? null;
  await doc.save();
  return toView(doc.toObject());
}

export async function postUpdate(
  id: string,
  note: string,
  username: string | undefined
): Promise<SignalView> {
  if (!mongoose.isValidObjectId(id)) throw new SignalError(404, "signal not found");
  const text = note.trim();
  if (!text) throw new SignalError(400, "update note is required");
  if (text.length > 2000) throw new SignalError(400, "update note is too long");

  await expireDue();
  const doc = await Signal.findById(id).exec();
  if (!doc) throw new SignalError(404, "signal not found");
  if (doc.status !== "active") throw new SignalError(409, "only active signals can be updated");

  doc.updates.push({ at: new Date(), note: text });
  doc.updatedBy = username ?? null;
  await doc.save();
  return toView(doc.toObject());
}

export async function invalidateSignal(
  id: string,
  reason: string,
  username: string | undefined
): Promise<SignalView> {
  if (!mongoose.isValidObjectId(id)) throw new SignalError(404, "signal not found");
  await expireDue();
  const doc = await Signal.findById(id).exec();
  if (!doc) throw new SignalError(404, "signal not found");
  if (doc.status !== "active") throw new SignalError(409, "only active signals can be invalidated");

  doc.status = "invalidated";
  doc.invalidatedAt = new Date();
  doc.invalidatedBy = username ?? null;
  doc.invalidationReason = reason.trim() || null;
  doc.updatedBy = username ?? null;
  await doc.save();
  return toView(doc.toObject());
}

export async function restoreSignal(id: string, username: string | undefined): Promise<SignalView> {
  if (!mongoose.isValidObjectId(id)) throw new SignalError(404, "signal not found");
  const doc = await Signal.findById(id).exec();
  if (!doc) throw new SignalError(404, "signal not found");
  if (doc.status !== "invalidated") throw new SignalError(409, "only invalidated signals can be restored");

  // Restoring a signal whose window has already closed is not useful: it would
  // disappear from Active on the next read. Mark it expired instead.
  const expired = doc.expiresAt && doc.expiresAt.getTime() <= Date.now();
  doc.status = expired ? "expired" : "active";
  doc.invalidatedAt = null;
  doc.invalidatedBy = null;
  doc.invalidationReason = null;
  doc.updatedBy = username ?? null;
  await doc.save();
  return toView(doc.toObject());
}

export async function deleteSignal(id: string): Promise<void> {
  if (!mongoose.isValidObjectId(id)) throw new SignalError(404, "signal not found");
  const doc = await Signal.findByIdAndDelete(id).exec();
  if (!doc) throw new SignalError(404, "signal not found");
}

export async function signalStats(now: Date = new Date()): Promise<SignalStats> {
  await expireDue(now);
  const counts = await readCounts();
  const resolvedDocs = await Signal.find({ status: { $in: ["target_hit", "stopped_out"] } })
    .select({ status: 1, entry: 1, entryMax: 1, target: 1, stop: 1 })
    .lean()
    .exec();

  const resolved = resolvedDocs.length;
  const wins = resolvedDocs.filter((d) => d.status === "target_hit").length;
  const rValues = resolvedDocs
    .map((d) => {
      const rr = computeRR(d.entry, d.target, d.stop, d.entryMax);
      if (d.status === "target_hit") return rr ?? 1;
      return -1;
    })
    .filter((r) => Number.isFinite(r));
  const avgR = rValues.length ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null;

  return {
    ...counts,
    resolved,
    winRate: resolved ? wins / resolved : null,
    avgR,
  };
}

export { Signal };
