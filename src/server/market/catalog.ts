// Broker + crypto symbol catalog, shared by the Analysis router and the Signals
// router. Extracted from routes.ts so a second feature can resolve symbols
// without importing the whole Analysis router (and its Express wiring).
//
// The catalog is cached in-process for a minute. The cTrader half is optional:
// without credentials the Binance list still serves, and `brokerError` explains
// why the broker half is empty.

import { clearCache, cTraderCatalog } from "./providers/index";
import { cryptoPairs } from "./crypto";
import { buildCatalog, normalizeSymbol, resolveAgainstBroker, toSymbolMeta } from "./symbols";
import type { CatalogEntry, SymbolMeta } from "./types";

const CATALOG_TTL_MS = 60_000;

let catalogCache: { at: number; items: CatalogEntry[]; brokerError: string | null } | null = null;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The full catalog: every symbol the account can trade, with the Binance crypto
 * universe merged in.
 *
 * Each source is optional. Without an account the crypto list still serves, so
 * the page is not blank just because cTrader credentials are missing.
 *
 * `brokerError` is kept because a missing broker catalog must not be reported as
 * "that symbol is not tradable": with an expired cTrader token the whole list
 * comes back empty, and every forex and metals symbol would otherwise claim it
 * does not exist.
 */
export async function loadCatalog(): Promise<{ items: CatalogEntry[]; brokerError: string | null }> {
  const crypto = await cryptoPairs();
  let broker: string[] = [];
  let brokerError: string | null = null;
  try {
    broker = await cTraderCatalog();
  } catch (err) {
    brokerError = message(err);
  }
  return { items: buildCatalog(broker, crypto), brokerError };
}

/**
 * Resolve a requested symbol to the sources that can serve it.
 *
 * The two universes are kept apart on purpose. A crypto catalog entry carries the
 * Binance pair as its `name`, so handing the whole catalog to the broker
 * resolver would let it match "SOLUSDT" as though it were a broker symbol.
 */
export function resolveMeta(symbol: string, catalog: CatalogEntry[]): SymbolMeta | null {
  const short = normalizeSymbol(symbol);
  const entry = catalog.find((c) => c.symbol === short);
  const pair = entry?.provider === "binance" ? entry.name : null;
  const brokerNames = catalog.filter((c) => c.provider !== "binance").map((c) => c.name);
  const brokerName = resolveAgainstBroker(symbol, brokerNames);
  if (!brokerName && !pair) return null;
  return toSymbolMeta(brokerName, symbol, pair);
}

/**
 * Why a symbol could not be resolved. Distinguishes "the broker is unreachable"
 * from "this symbol genuinely is not offered", which look identical when the
 * catalog is empty but call for very different fixes.
 */
export function unresolvableError(symbol: string, brokerError: string | null): string {
  if (brokerError) {
    return (
      `Could not read the cTrader symbol list, so "${symbol}" cannot be checked. ` +
      `${brokerError.slice(0, 200)}`
    );
  }
  return `"${symbol}" is neither tradable on the connected cTrader account nor listed on Binance`;
}

export async function cachedCatalog(): Promise<CatalogEntry[]> {
  return (await cachedCatalogFull()).items;
}

/** The catalog plus whatever went wrong reading the broker half. */
export async function cachedCatalogFull(): Promise<{ items: CatalogEntry[]; brokerError: string | null }> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache;
  const loaded = await loadCatalog();
  catalogCache = { at: Date.now(), ...loaded };
  return catalogCache;
}

/** Force the catalog to be re-read, e.g. after credentials change. */
export function clearCatalogCache(): void {
  catalogCache = null;
  clearCache();
}
