import { useCallback, useEffect, useState } from "react";

import {
  api,
  type AccountView,
  type BrokerAccountView,
  type ConnectInput,
  type UserAccountType,
  type UserRole,
} from "./api";

// Account state is shared by the trading view and the Settings takeover, so it
// lives here rather than inside either component. Owned by App and passed down.
//
// `enabled` is false while signed out: the Analysis page is public, so the hook
// is mounted even when there is no token, and must not fire authenticated calls.

export function useAccounts(enabled: boolean) {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [brokerAccounts, setBrokerAccounts] = useState<BrokerAccountView[]>([]);
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
  const [hasMt5Accounts, setHasMt5Accounts] = useState(false);
  const [me, setMe] = useState<{
    username: string;
    role: UserRole;
    accountType: UserAccountType;
    demo: boolean;
    ctraderOAuth: boolean;
    ctraderManual: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setAccounts([]);
      setBrokerAccounts([]);
      setHasCredentials(null);
      setHasMt5Accounts(false);
      setMe(null);
      return [];
    }
    try {
      const res = await api.me();
      setHasCredentials(res.hasCredentials);
      setHasMt5Accounts(res.hasMt5Accounts);
      setAccounts(res.accounts);
      setBrokerAccounts(res.brokerAccounts);
      setMe({
        username: res.username,
        role: res.role,
        accountType: res.accountType,
        demo: res.demo,
        ctraderOAuth: res.ctraderOAuth,
        ctraderManual: res.ctraderManual,
      });
      return res.accounts;
    } catch {
      setHasCredentials(false);
      setHasMt5Accounts(false);
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
      const { accounts: fresh, brokerAccounts: freshBrokerAccounts } = await api.accounts();
      setAccounts(fresh);
      setBrokerAccounts(freshBrokerAccounts);
      setHasMt5Accounts(freshBrokerAccounts.some((account) => account.broker === "mt5"));
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
      await refreshBalances();
      return fresh;
    },
    [refreshBalances]
  );

  return {
    accounts,
    brokerAccounts,
    setAccounts,
    setBrokerAccounts,
    hasCredentials,
    hasMt5Accounts,
    me,
    load,
    refreshBalances,
    connect,
  };
}
