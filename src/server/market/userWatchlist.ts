// Per-user watchlists for the Analysis page.
//
// The site list stays admin-curated and is the default for anonymous visitors
// and for signed-in members who have not switched to their own list. A personal
// list is one document per user, so switching modes is non-destructive: the
// personal symbols and order stay stored while "site" mode is active.

import mongoose from "mongoose";

import { briefingDateKey } from "../briefing/build";
import { clearBriefing } from "../briefing/store";
import { DEFAULT_ANALYSIS } from "../settings/defaults";
import { getSiteSettings } from "../settings/store";
import { getSettings } from "./store";

export type WatchlistMode = "site" | "mine";

export interface WatchlistLists {
  symbols: string[];
  order: string[];
}

export interface ResolvedWatchlist extends WatchlistLists {
  mode: WatchlistMode;
}

export interface WatchlistView extends ResolvedWatchlist {
  /** Maximum symbols allowed in a personal list. */
  limit: number;
}

const userWatchlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    mode: { type: String, enum: ["site", "mine"], default: "site" },
    symbols: { type: [String], default: [] },
    order: { type: [String], default: [] },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

export const UserWatchlist = mongoose.model("UserWatchlist", userWatchlistSchema);

function normalizeWatchlist(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const symbol = String(raw ?? "").trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

/**
 * Pick the list a caller should see. A missing personal document, or a document
 * still in "site" mode, resolves to the site list. Pure so the routing rules can
 * be tested without a database.
 */
export function resolveWatchlistView(
  mode: WatchlistMode,
  site: WatchlistLists,
  mine: WatchlistLists | null
): ResolvedWatchlist {
  if (mode === "mine" && mine) {
    return {
      mode: "mine",
      symbols: [...mine.symbols],
      order: [...mine.order],
    };
  }
  return {
    mode: "site",
    symbols: [...site.symbols],
    order: [...site.order],
  };
}

function objectId(userId: string): mongoose.Types.ObjectId | null {
  return mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : null;
}

async function personalLimit(): Promise<number> {
  try {
    return (await getSiteSettings()).analysis.watchlistLimit;
  } catch {
    return DEFAULT_ANALYSIS.watchlistLimit;
  }
}

async function siteLists(): Promise<WatchlistLists> {
  const { watchlist, cardOrder } = await getSettings();
  return { symbols: normalizeWatchlist(watchlist), order: normalizeWatchlist(cardOrder) };
}

/**
 * A change to the personal symbols makes today's frozen brief stale. Dropping
 * it means the next visit rebuilds from the new list instead of showing moves
 * for symbols the member no longer follows.
 */
async function invalidateBriefing(userId: string): Promise<void> {
  try {
    await clearBriefing(userId, briefingDateKey(new Date()));
  } catch {
    // The brief is regenerated on the next read if this fails.
  }
}

async function findMine(
  userId: string
): Promise<{ mode: WatchlistMode; symbols: string[]; order: string[] } | null> {
  const owner = objectId(userId);
  if (!owner) return null;
  const doc: any = await UserWatchlist.findOne({ userId: owner }).lean().exec();
  if (!doc) return null;
  return {
    mode: doc.mode === "mine" ? "mine" : "site",
    symbols: normalizeWatchlist(doc.symbols),
    order: normalizeWatchlist(doc.order),
  };
}

/** The effective list plus the mode and personal cap the page should show. */
export async function getWatchlistView(userId: string | null): Promise<WatchlistView> {
  const [site, limit] = await Promise.all([siteLists(), personalLimit()]);
  const mine = userId ? await findMine(userId) : null;
  return {
    ...resolveWatchlistView(mine?.mode ?? "site", site, mine),
    limit,
  };
}

/** The symbols an analysis sweep should read for this caller. */
export async function getEffectiveWatchlist(userId: string | null): Promise<string[]> {
  return (await getWatchlistView(userId)).symbols;
}

/**
 * The briefing prefers the member's own symbols whenever they have any, even
 * while the Analysis page is showing the site list. An empty personal list falls
 * back to the site list so a new member still gets a useful brief.
 */
export function preferPersonalWatchlist(
  site: WatchlistLists,
  mine: WatchlistLists | null
): string[] {
  return mine?.symbols.length ? [...mine.symbols] : [...site.symbols];
}

/** The symbols the daily briefing should read for this caller. */
export async function getBriefingWatchlist(userId: string | null): Promise<string[]> {
  const [site, mine] = await Promise.all([siteLists(), userId ? findMine(userId) : null]);
  return preferPersonalWatchlist(site, mine);
}

export type PersonalMutationResult =
  | { ok: true; view: WatchlistView }
  | { ok: false; code: "site-mode" | "limit" | "not-found"; limit?: number };

/**
 * Switch between the site list and the personal list. The first switch to
 * "mine" starts empty, so the member builds their own list rather than editing
 * a copy of the site list. Switching to "site" only changes the mode, so the
 * personal symbols and order survive for the next switch back.
 */
export async function setWatchlistMode(
  userId: string,
  mode: WatchlistMode
): Promise<WatchlistView> {
  const owner = objectId(userId);
  if (!owner) throw new Error("invalid user id");

  if (mode === "mine") {
    const existing = await findMine(userId);
    const symbols = existing?.symbols ?? [];
    const allowed = new Set(symbols);
    const order = (existing?.order ?? []).filter((symbol) => allowed.has(symbol));
    await UserWatchlist.updateOne(
      { userId: owner },
      { $set: { mode: "mine", symbols, order, updatedAt: new Date() } },
      { upsert: true }
    ).exec();
  } else {
    await UserWatchlist.updateOne(
      { userId: owner },
      { $set: { mode: "site", updatedAt: new Date() } },
      { upsert: true }
    ).exec();
  }

  return getWatchlistView(userId);
}

export async function addToPersonalWatchlist(
  userId: string,
  symbol: string
): Promise<PersonalMutationResult> {
  const owner = objectId(userId);
  if (!owner) return { ok: false, code: "not-found" };
  const mine = await findMine(userId);
  if (!mine || mine.mode !== "mine") return { ok: false, code: "site-mode" };

  const upper = String(symbol ?? "").trim().toUpperCase();
  if (!upper) return { ok: false, code: "not-found" };

  const limit = await personalLimit();
  const symbols = mine.symbols;
  if (!symbols.includes(upper)) {
    if (symbols.length >= limit) return { ok: false, code: "limit", limit };
    symbols.push(upper);
  }

  await UserWatchlist.updateOne(
    { userId: owner },
    { $set: { symbols, updatedAt: new Date() } },
    { upsert: true }
  ).exec();
  await invalidateBriefing(userId);
  return { ok: true, view: await getWatchlistView(userId) };
}

export async function removeFromPersonalWatchlist(
  userId: string,
  symbol: string
): Promise<PersonalMutationResult> {
  const owner = objectId(userId);
  if (!owner) return { ok: false, code: "not-found" };
  const mine = await findMine(userId);
  if (!mine || mine.mode !== "mine") return { ok: false, code: "site-mode" };

  const upper = String(symbol ?? "").trim().toUpperCase();
  await UserWatchlist.updateOne(
    { userId: owner },
    {
      $set: {
        symbols: mine.symbols.filter((item) => item !== upper),
        order: mine.order.filter((item) => item !== upper),
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  ).exec();
  await invalidateBriefing(userId);
  return { ok: true, view: await getWatchlistView(userId) };
}

export async function savePersonalOrder(
  userId: string,
  order: unknown
): Promise<PersonalMutationResult> {
  const owner = objectId(userId);
  if (!owner) return { ok: false, code: "not-found" };
  const mine = await findMine(userId);
  if (!mine || mine.mode !== "mine") return { ok: false, code: "site-mode" };

  const allowed = new Set(mine.symbols);
  const clean = normalizeWatchlist(order).filter((symbol) => allowed.has(symbol));
  await UserWatchlist.updateOne(
    { userId: owner },
    { $set: { order: clean, updatedAt: new Date() } },
    { upsert: true }
  ).exec();
  await invalidateBriefing(userId);
  return { ok: true, view: await getWatchlistView(userId) };
}
