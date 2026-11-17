import {
  mt5FetchCandles,
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
  getConfig: () => Promise<Mt5BridgeConfig> = resolveMt5Config
): BrokerAdapter {
  return {
    id: "mt5",

    async listAccounts(): Promise<BrokerAccountView[]> {
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
    },

    async reconcile(): Promise<never> {
      return unsupported("reconciliation");
    },

    async resolveSymbol(_ref, symbol): Promise<BrokerSymbol | null> {
      const config = await getConfig();
      const row = await mt5ResolveSymbol(config, symbol);
      return row ? { id: row.symbol, spec: specOf(row) } : null;
    },

    async listSymbolNames(): Promise<string[]> {
      const config = await getConfig();
      const symbols = await mt5ListSymbols(config);
      return symbols.map((row) => row.symbol);
    },

    async quote(_ref, symbol): Promise<BrokerQuote | null> {
      const config = await getConfig();
      return mt5Quote(config, symbol);
    },

    async quoteUsdFactor(_ref, symbol) {
      const config = await getConfig();
      const row = await mt5ResolveSymbol(config, symbol);
      if (!row) return null;
      if (typeof row.quoteUsdFactor === "number" && row.quoteUsdFactor > 0) {
        return row.quoteUsdFactor;
      }
      return isUsd(row.quoteAsset) ? 1 : null;
    },

    async fetchHistory(): Promise<BrokerHistoryResult> {
      return unsupported("trade history");
    },

    async fetchCandles(_ref, query: BrokerCandleQuery): Promise<BrokerCandle[]> {
      const config = await getConfig();
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
