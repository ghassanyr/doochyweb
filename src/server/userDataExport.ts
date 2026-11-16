import mongoose from "mongoose";

import { PriceAlert, toAlertView } from "./alerts/store";
import type { AlertView } from "./alerts/types";
import { Briefing, toBriefingRecord } from "./briefing/store";
import type { BriefingRecord } from "./briefing/types";
import { Credentials, User, type StoredAccount } from "./db";
import { JournalEntry, JournalSync, toJournalView } from "./journal/store";
import type { JournalEntryView } from "./journal/types";
import { UserWatchlist, type WatchlistMode } from "./market/userWatchlist";
import { PaperPosition, toPaperView } from "./simulation/store";
import type { PaperPositionView } from "./simulation/types";
import { TelegramLink, toLinkView, type TelegramLinkRecord } from "./telegram/store";

export const USER_EXPORT_FORMAT = "doochy-user-data";
export const USER_EXPORT_VERSION = 2;

export interface UserDataExport {
  format: typeof USER_EXPORT_FORMAT;
  version: typeof USER_EXPORT_VERSION;
  exportedAt: string;
  user: {
    id: string;
    username: string;
    email: string | null;
    role: string;
    status: string;
    emailVerified: boolean;
    termsAcceptedAt: string | null;
    createdAt: string | null;
  };
  ctrader: {
    connected: boolean;
    mode: "oauth" | "manual" | null;
    accounts: StoredAccount[];
    updatedAt: string | null;
  };
  alerts: AlertView[];
  journal: {
    entries: JournalEntryView[];
    sync: {
      lastRunAt: string | null;
      lastImported: number;
      lastError: string | null;
    } | null;
  };
  paperTrading: PaperPositionView[];
  briefings: BriefingRecord[];
  telegram: TelegramLinkRecord | null;
  watchlist: {
    mode: WatchlistMode;
    symbols: string[];
    order: string[];
  } | null;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function userDataExportFilename(username: string, now: Date = new Date()): string {
  const safe =
    username
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "user";
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `doochy-${safe}-${stamp}.json`;
}

export async function exportUserData(
  userId: string,
  now: Date = new Date()
): Promise<UserDataExport | null> {
  if (!mongoose.isValidObjectId(userId)) return null;
  const owner = new mongoose.Types.ObjectId(userId);

  const [user, credentials, alerts, journal, sync, paper, briefings, telegram, watchlist] =
    await Promise.all([
      User.findById(owner).lean().exec(),
      Credentials.findOne({ userId: owner }).lean().exec(),
      PriceAlert.find({ userId: owner }).sort({ createdAt: 1 }).lean().exec(),
      JournalEntry.find({ userId: owner }).sort({ createdAt: 1 }).lean().exec(),
      JournalSync.findOne({ userId: owner }).lean().exec(),
      PaperPosition.find({ userId: owner }).sort({ openedAt: 1 }).lean().exec(),
      Briefing.find({ userId: owner }).sort({ dateKey: 1 }).lean().exec(),
      TelegramLink.findOne({ userId: owner }).lean().exec(),
      UserWatchlist.findOne({ userId: owner }).lean().exec(),
    ]);

  if (!user) return null;

  return {
    format: USER_EXPORT_FORMAT,
    version: USER_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    user: {
      id: String(user._id),
      username: String(user.username ?? ""),
      email: typeof user.email === "string" && user.email ? user.email : null,
      role: typeof user.role === "string" ? user.role : "user",
      status: typeof user.status === "string" ? user.status : "active",
      emailVerified: user.emailVerified !== false,
      termsAcceptedAt: iso(user.termsAcceptedAt),
      createdAt: iso(user.createdAt),
    },
    ctrader: {
      connected: credentials != null,
      mode: credentials ? (credentials.clientId ? "manual" : "oauth") : null,
      accounts: (credentials?.accounts ?? []) as StoredAccount[],
      updatedAt: iso(credentials?.updatedAt),
    },
    alerts: (alerts as any[]).map(toAlertView),
    journal: {
      entries: (journal as any[]).map(toJournalView),
      sync: sync
        ? {
            lastRunAt: iso((sync as any).lastRunAt),
            lastImported: Number((sync as any).lastImported ?? 0),
            lastError: typeof (sync as any).lastError === "string" ? (sync as any).lastError : null,
          }
        : null,
    },
    paperTrading: (paper as any[]).map(toPaperView),
    briefings: (briefings as any[]).map(toBriefingRecord),
    telegram: telegram ? toLinkView(telegram) : null,
    watchlist: watchlist
      ? {
          mode: (watchlist as any).mode === "mine" ? "mine" : "site",
          symbols: Array.isArray((watchlist as any).symbols)
            ? (watchlist as any).symbols
            : [],
          order: Array.isArray((watchlist as any).order) ? (watchlist as any).order : [],
        }
      : null,
  };
}
