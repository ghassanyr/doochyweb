// Resolves which cTrader account supplies prices for the Analysis page.
//
// The page is public, so it cannot use a visitor's credentials: it runs on one
// shared account belonging to whoever administers this deployment. That account
// is pinned explicitly with MARKET_CTRADER_USER_ID / MARKET_CTRADER_CTID when
// set, and otherwise auto-selected: the first demo account with credentials,
// falling back to the first account of any kind.
//
// Demo is preferred deliberately. The page is read-only, but a demo account
// still exposes the broker's full symbol list and prices, so there is no reason
// to point a public endpoint at a live account.

import { User, loadCredentials, type StoredAccount } from "../db";
import type { MarketAccount } from "./types";

let cached: MarketAccount | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

/**
 * Pick the account to analyse with, or throw with an actionable message when no
 * usable credentials exist.
 */
export async function resolveMarketAccount(force = false): Promise<MarketAccount> {
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached;

  const pinnedUser = process.env.MARKET_CTRADER_USER_ID;
  const pinnedCtid = Number(process.env.MARKET_CTRADER_CTID);

  const users = await User.find({
    ...(pinnedUser ? { _id: pinnedUser } : {}),
    accountType: { $ne: "demo" },
  }).lean();
  let found: MarketAccount | null = null;

  for (const u of users) {
    const creds = await loadCredentials(String(u._id));
    if (!creds || !creds.accounts.length) continue;

    if (Number.isFinite(pinnedCtid) && pinnedCtid > 0) {
      const pinned = creds.accounts.find((a: StoredAccount) => a.ctid === pinnedCtid);
      if (pinned) {
        found = { userId: String(u._id), ctid: pinned.ctid, isLive: pinned.isLive };
        break;
      }
      continue;
    }

    // Demo first, so a public read-only page never touches a live account.
    const demo = creds.accounts.find((a: StoredAccount) => !a.isLive) ?? creds.accounts[0];
    found = { userId: String(u._id), ctid: demo.ctid, isLive: demo.isLive };
    break;
  }

  if (!found) {
    throw new Error(
      "No cTrader account is connected for market analysis. " +
        "Add cTrader Open API credentials in Settings, or set MARKET_CTRADER_USER_ID / " +
        "MARKET_CTRADER_CTID to choose an account explicitly."
    );
  }

  cached = found;
  cachedAt = Date.now();
  return found;
}

/** The pinned/auto-selected account, or null with a reason, for the settings UI. */
export async function describeMarketAccount(): Promise<{
  account: MarketAccount | null;
  login: number | null;
  broker: string | null;
  error: string | null;
}> {
  try {
    const acct = await resolveMarketAccount();
    const creds = await loadCredentials(acct.userId);
    const row = creds?.accounts.find((a: StoredAccount) => a.ctid === acct.ctid);
    return {
      account: acct,
      login: row?.login ?? null,
      broker: row?.broker ?? null,
      error: null,
    };
  } catch (err) {
    return {
      account: null,
      login: null,
      broker: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function clearMarketAccountCache(): void {
  cached = null;
  cachedAt = 0;
}