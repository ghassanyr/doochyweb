import { listJournal } from "../journal/store";
import type { JournalEntryView } from "../journal/types";
import { cachedCatalogFull, resolveMeta } from "../market/catalog";
import { cachedBars, getCandles } from "../market/providers/index";
import { publicSettings } from "../market/store";
import type { Candle } from "../market/types";
import { getBriefingWatchlist } from "../market/userWatchlist";
import { DEFAULT_BRANDING } from "../settings/defaults";
import { getSiteSettings } from "../settings/store";
import { signalPrices } from "../signals/prices";
import { listSignals } from "../signals/store";
import type { SignalView } from "../signals/types";
import { buildSnapshot, type WatchlistInput } from "./build";
import type { BriefingFocusSession, BriefingSnapshot, BriefingQuote } from "./types";

const MAX_SYMBOLS = 12;
const MAX_SIGNAL_CANDIDATES = 24;
const MAX_JOURNAL_CANDIDATES = 24;
const FAST_TIMEOUT_MS = 2_000;
const FAST_CONCURRENCY = 4;
const QUOTE_CHUNK_SIZE = 16;

async function withTimeout<T>(work: () => Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const value = work().catch(() => fallback);
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([value, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function briefingBrandName(): Promise<string> {
  try {
    const settings = await getSiteSettings();
    return settings.branding.name.trim() || DEFAULT_BRANDING.name;
  } catch {
    return DEFAULT_BRANDING.name;
  }
}

async function gatherWatchlist(
  userId: string,
  fast: boolean
): Promise<{ rows: WatchlistInput[]; notes: string[] }> {
  const watchlist = fast
    ? await withTimeout(() => getBriefingWatchlist(userId), FAST_TIMEOUT_MS, null)
    : await getBriefingWatchlist(userId).catch(() => null);
  if (!watchlist) {
    return {
      rows: [],
      notes: [fast ? "The watchlist was unavailable in time." : "The watchlist was unavailable."],
    };
  }
  const symbols = watchlist.slice(0, MAX_SYMBOLS);
  if (!symbols.length) return { rows: [], notes: [] };

  let catalog: Awaited<ReturnType<typeof cachedCatalogFull>>["items"] = [];
  let catalogMissing = false;
  try {
    const result = fast
      ? await withTimeout(() => cachedCatalogFull(), FAST_TIMEOUT_MS, null)
      : await cachedCatalogFull();
    if (result) catalog = result.items;
    else catalogMissing = true;
  } catch {
    catalogMissing = true;
  }
  if (catalogMissing) {
    return {
      rows: symbols.map((symbol) => ({ symbol, bars: [] })),
      notes: [
        fast
          ? "The market catalog was slow to load, so daily bars were skipped."
          : "The market catalog was unavailable, so no daily bars were loaded.",
      ],
    };
  }

  const analysis = fast
    ? await withTimeout(() => publicSettings().catch(() => ({}) as any), FAST_TIMEOUT_MS, {} as any)
    : await publicSettings().catch(() => ({}) as any);

  const items = await mapWithConcurrency(symbols, FAST_CONCURRENCY, async (symbol) => {
    const meta = resolveMeta(symbol, catalog);
    if (!meta) {
      return {
        row: { symbol, bars: [] } as WatchlistInput,
        note: `${symbol}: the market catalog could not resolve this symbol.`,
      };
    }
    try {
      let bars: Candle[] = cachedBars(meta, "1d") ?? [];
      if (!bars.length) {
        const result = fast
          ? await withTimeout(() => getCandles(meta, "1d", analysis), FAST_TIMEOUT_MS, null)
          : await getCandles(meta, "1d", analysis);
        bars = result?.bars ?? [];
      }
      return {
        row: { symbol, name: meta.name, type: meta.type, bars } as WatchlistInput,
        note: bars.length
          ? null
          : `${symbol}: daily bars were ${fast ? "unavailable in time" : "unavailable"}.`,
      };
    } catch (err) {
      return {
        row: { symbol, name: meta.name, type: meta.type, bars: [] } as WatchlistInput,
        note: `${symbol}: daily bars were unavailable (${
          err instanceof Error ? err.message : "provider error"
        }).`,
      };
    }
  });

  return {
    rows: items.map((item) => item.row),
    notes: items.flatMap((item) => (item.note ? [item.note] : [])),
  };
}

async function gatherSignals(now: Date): Promise<SignalView[]> {
  try {
    const result = await listSignals({ status: "active", limit: MAX_SIGNAL_CANDIDATES, now });
    return result.signals;
  } catch {
    return [];
  }
}

async function gatherJournal(userId: string): Promise<JournalEntryView[]> {
  try {
    const result = await listJournal(userId, { status: "open", limit: MAX_JOURNAL_CANDIDATES });
    return result.entries;
  } catch {
    return [];
  }
}

function uniqueSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const symbol = String(raw ?? "").trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

async function gatherQuotes(
  symbols: string[],
  fast: boolean
): Promise<{ quotes: Record<string, BriefingQuote>; notes: string[] }> {
  const unique = uniqueSymbols(symbols);
  const quotes: Record<string, BriefingQuote> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += QUOTE_CHUNK_SIZE) {
    chunks.push(unique.slice(i, i + QUOTE_CHUNK_SIZE));
  }
  let incomplete = false;

  await mapWithConcurrency(chunks, fast ? 2 : 1, async (chunk) => {
    const points = fast
      ? await withTimeout(() => signalPrices(chunk), FAST_TIMEOUT_MS, null)
      : await signalPrices(chunk).catch(() => null);
    if (!points) {
      incomplete = true;
      return;
    }
    for (const [symbol, point] of Object.entries(points)) {
      quotes[symbol.toUpperCase()] = {
        price: point.price,
        at: point.at,
        source: "latest",
      };
    }
  });

  return {
    quotes,
    notes: incomplete
      ? [fast ? "Some live quotes were unavailable in time." : "Some live quotes were unavailable."]
      : [],
  };
}

function withDailyQuote(row: WatchlistInput, quotes: Record<string, BriefingQuote>): WatchlistInput {
  if (quotes[row.symbol.toUpperCase()]) return { ...row, quote: quotes[row.symbol.toUpperCase()] };
  const last = row.bars[row.bars.length - 1];
  if (!last || !Number.isFinite(last.close)) return { ...row, quote: null };
  const at = new Date(last.time);
  if (!Number.isFinite(at.getTime())) return { ...row, quote: null };
  return {
    ...row,
    quote: { price: last.close, at: at.toISOString(), source: "daily" },
  };
}

export async function buildBriefingSnapshot(
  userId: string,
  now: Date,
  focusSessions: BriefingFocusSession[],
  options: { fast?: boolean } = {}
): Promise<{ snapshot: BriefingSnapshot; brandName: string }> {
  const fast = options.fast ?? false;
  const [watchlist, signals, journal, brandName] = await Promise.all([
    gatherWatchlist(userId, fast),
    gatherSignals(now),
    gatherJournal(userId),
    briefingBrandName(),
  ]);

  const quoted = await gatherQuotes(
    [
      ...watchlist.rows.map((row) => row.symbol),
      ...signals.map((signal) => signal.symbol),
      ...journal.map((entry) => entry.symbol),
    ],
    fast
  );
  const watchlistRows = watchlist.rows.map((row) => withDailyQuote(row, quoted.quotes));
  for (const row of watchlistRows) {
    if (row.quote) quoted.quotes[row.symbol.toUpperCase()] = row.quote;
  }

  return {
    snapshot: buildSnapshot({
      now,
      focusSessions,
      watchlist: watchlistRows,
      signals,
      journalEntries: journal,
      quotes: quoted.quotes,
      dataNotes: [...watchlist.notes, ...quoted.notes],
    }),
    brandName,
  };
}
