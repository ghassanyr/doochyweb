import type { CatalogEntry } from "./types";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MAX_RESULTS = 8;

function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  const suffix = ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${suffix}`;
}

export function formatHandPickIdentified(now: Date = new Date()): string {
  const time = now.toISOString().slice(11, 19);
  const month = MONTHS[now.getUTCMonth()];
  return `${time} (UTC+00:00) on ${month} ${ordinal(now.getUTCDate())}, ${now.getUTCFullYear()}`;
}

function score(entry: CatalogEntry, query: string): number | null {
  const symbol = entry.symbol.toUpperCase();
  if (symbol === query) return 0;
  if (symbol.startsWith(query)) return 1;
  if (symbol.includes(query)) return 2;
  if (entry.name.toUpperCase().includes(query)) return 3;
  return null;
}

export function filterHandPickSymbols(
  catalog: CatalogEntry[],
  query: string,
  limit = MAX_RESULTS
): CatalogEntry[] {
  const q = query.trim().toUpperCase();
  if (!q || limit <= 0) return [];
  return catalog
    .map((entry) => ({ entry, value: score(entry, q) }))
    .filter((item): item is { entry: CatalogEntry; value: number } => item.value !== null)
    .sort((a, b) => a.value - b.value || a.entry.symbol.localeCompare(b.entry.symbol))
    .slice(0, limit)
    .map((item) => item.entry);
}
