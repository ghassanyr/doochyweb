import { useCallback, useEffect, useState } from "react";

import { api, type AccountView, type ConnectInput, type UserRole } from "./api";

// Account state is shared by the trading view and the Settings takeover, so it
// lives here rather than inside either component. Owned by App and passed down.
//
// `enabled` is false while signed out: the Analysis page is public, so the hook
// is mounted even when there is no token, and must not fire authenticated calls.

export function useAccounts(enabled: boolean) {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
  const [me, setMe] = useState<{ username: string; role: UserRole } | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setAccounts([]);
      setHasCredentials(null);
      setMe(null);
      return [];
    }
    try {
      const res = await api.me();
      setHasCredentials(res.hasCredentials);
      setAccounts(res.accounts);
      setMe({ username: res.username, role: res.role });
      return res.accounts;
    } catch {
      setHasCredentials(false);
      return [];
    }
  }, [enabled]);

  // (Re)load whenever we become authenticated, so signing in from the Trading
  // tab fetches the account list without needing a page reload.
  useEffect(() => {
    void load();
  }, [load]);

  /** Re-read balances + broker names without touching the credential state. */
  const refreshBalances = useCallback(async () => {
    if (!enabled) return;
    try {
      const { accounts: fresh } = await api.accounts();
      setAccounts(fresh);
    } catch {
      /* leave the previous balances on screen */
    }
  }, [enabled]);

  /** Validate a credential set, persist it, and adopt the discovered accounts. */
  const connect = useCallback(
    async (creds: ConnectInput) => {
      const { accounts: fresh } = await api.connect(creds);
      setHasCredentials(true);
      setAccounts(fresh);
      return fresh;
    },
    []
  );

  return { accounts, setAccounts, hasCredentials, me, load, refreshBalances, connect };
}
