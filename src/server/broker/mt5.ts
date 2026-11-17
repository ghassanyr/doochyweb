import {
  brokerAccountView,
  listMt5Accounts,
  resolveMt5AccountConfig,
} from "../mt5/accounts";
import {
  mt5FetchCandles,
  mt5FetchHistory,
  mt5ListOrders,
  mt5ListPositions,
  mt5ListSymbols,
  mt5Quote,
  mt5ResolveSymbol,
  resolveMt5Config,
  type Mt5BridgeConfig,
  type Mt5SymbolRecord,
} from "../mt5/bridge";
import type {
  BrokerAccountRef,
  BrokerAccountView,
  BrokerAdapter,
  BrokerCandle,
  BrokerCandleQuery,
  BrokerHistoryResult,
  BrokerOrderResult,
  BrokerQuote,
  BrokerReconciliation,
  BrokerSymbol,
  BrokerSymbolSpec,
} from "./types";

function unsupported(action: string): never {
  throw new Error(`MT5 ${action} is not part of the read-only phase`);
}

function specOf(row: Mt5SymbolRecord): BrokerSymbolSpec {
  return {
    symbol: row.symbol,
    lotSize: row.lotSize,
    digits: row.digits,
    minVolume: row.minVolume,
    stepVolume: row.stepVolume,
    maxVolume: row.maxVolume,
    quoteAsset: row.quoteAsset,
  };
}

function isUsd(asset: string | null): boolean {
  return asset === "USD" || asset === "USDT" || asset === "USDC";
}

export function mt5AccountRef(config: Mt5BridgeConfig): BrokerAccountRef {
  return {
    userId: config.userId,
    broker: "mt5",
    accountId: config.accountId,
    mode: config.mode,
  };
}

export function createMt5BrokerAdapter(
  getConfig: () => Promise<Mt5BridgeConfig> = resolveMt5Config,
  getAccountConfig: (userId: string, accountId: string) => Promise<Mt5BridgeConfig> =
    resolveMt5AccountConfig
): BrokerAdapter {
  async function configFor(ref?: BrokerAccountRef): Promise<Mt5BridgeConfig> {
    if (!ref || ref.userId === "market") return getConfig();
    return getAccountConfig(ref.userId, ref.accountId);
  }

  return {
    id: "mt5",

    async listAccounts(userId): Promise<BrokerAccountView[]> {
      if (!userId || userId === "market") {
        const config = await getConfig();
        return [
          {
            id: config.accountId,
            broker: "mt5",
            login: config.accountId,
            name: "MetaTrader 5",
            mode: config.mode,
            balance: null,
            currency: null,
            nickname: null,
            color: null,
          },
        ];
      }
      const accounts = await listMt5Accounts(userId);
      return accounts.map(brokerAccountView);
    },

    async reconcile(ref): Promise<BrokerReconciliation> {
      const config = await configFor(ref);
      const [positions, orders] = await Promise.all([
        mt5ListPositions(config),
        mt5ListOrders(config),
      ]);
      return { positions, orders };
    },

    async resolveSymbol(ref, symbol): Promise<BrokerSymbol | null> {
      const config = await configFor(ref);
      const row = await mt5ResolveSymbol(config, symbol);
      return row ? { id: row.symbol, spec: specOf(row) } : null;
    },

    async listSymbolNames(ref): Promise<string[]> {
      const config = await configFor(ref);
      const symbols = await mt5ListSymbols(config);
      return symbols.map((row) => row.symbol);
    },

    async quote(ref, symbol): Promise<BrokerQuote | null> {
      const config = await configFor(ref);
      return mt5Quote(config, symbol);
    },

    async quoteUsdFactor(ref, symbol) {
      const config = await configFor(ref);
      const row = await mt5ResolveSymbol(config, symbol);
      if (!row) return null;
      if (typeof row.quoteUsdFactor === "number" && row.quoteUsdFactor > 0) {
        return row.quoteUsdFactor;
      }
      return isUsd(row.quoteAsset) ? 1 : null;
    },

    async fetchHistory(ref, days): Promise<BrokerHistoryResult> {
      const config = await configFor(ref);
      return mt5FetchHistory(config, days);
    },

    async fetchCandles(ref, query: BrokerCandleQuery): Promise<BrokerCandle[]> {
      const config = await configFor(ref);
      const timeframe = String(query.timeframe.native?.mt5 ?? query.timeframe.id);
      return mt5FetchCandles(config, query.symbol, timeframe, {
        from: query.from,
        to: query.to,
        count: query.count,
      });
    },

    async previewOrder(): Promise<never> {
      return unsupported("order preview");
    },

    async placeOrder(): Promise<BrokerOrderResult> {
      return unsupported("order placement");
    },

    async modifyOrder(): Promise<BrokerOrderResult> {
      return unsupported("order changes");
    },

    async cancelOrder(): Promise<BrokerOrderResult> {
      return unsupported("order cancellation");
    },

    async closePosition(): Promise<BrokerOrderResult> {
      return unsupported("position close");
    },

    async amendPositionSLTP(): Promise<BrokerOrderResult> {
      return unsupported("position changes");
    },
  };
}

export const mt5BrokerAdapter = createMt5BrokerAdapter();
