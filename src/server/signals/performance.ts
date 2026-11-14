// Verified performance for the Signals feed.
//
// Only signals the automatic resolver has closed are counted: `target_hit` is a
// win worth its planned R:R, `stopped_out` is a loss of exactly 1R. Open and
// expired ideas are excluded because they have no outcome, so the hit rate is
// never diluted by signals that simply ran out of time.
//
// The aggregation is a pure function so the rules are unit-testable; the store
// read at the bottom is a thin query around it.

import { computeRR } from "./validate";
import type {
  PerformanceBucket,
  PerformancePoint,
  ResolvedSignalRow,
  SignalDirection,
  SignalPerformance,
} from "./types";

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

export const OVERALL_KEY = "all";

interface ScoredRow extends ResolvedSignalRow {
  r: number;
}

/** R multiple for one resolved signal. A win with no usable R:R counts as 1R. */
export function scoreResolvedSignal(row: ResolvedSignalRow): number {
  if (row.status === "stopped_out") return -1;
  const rr = computeRR(row.entry, row.target, row.stop, row.entryMax);
  return rr != null && Number.isFinite(rr) ? rr : 1;
}

function monthKey(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "unknown";
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

function monthLabel(key: string): string {
  if (key === "unknown") return "Unknown";
  const [year, month] = key.split("-");
  const index = Number(month) - 1;
  if (!Number.isInteger(index) || index < 0 || index > 11) return key;
  return `${MONTHS[index]} ${year}`;
}

function bucket(key: string, label: string, rows: ScoredRow[]): PerformanceBucket {
  const resolved = rows.length;
  const wins = rows.filter((row) => row.status === "target_hit").length;
  const losses = resolved - wins;
  const totalR = rows.reduce((sum, row) => sum + row.r, 0);
  const grossWin = rows.filter((row) => row.r > 0).reduce((sum, row) => sum + row.r, 0);
  const grossLoss = Math.abs(
    rows.filter((row) => row.r < 0).reduce((sum, row) => sum + row.r, 0)
  );

  return {
    key,
    label,
    resolved,
    wins,
    losses,
    winRate: resolved ? wins / resolved : null,
    avgR: resolved ? totalR / resolved : null,
    totalR: round(totalR),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sortBuckets(buckets: PerformanceBucket[]): PerformanceBucket[] {
  return [...buckets].sort(
    (a, b) => b.resolved - a.resolved || a.key.localeCompare(b.key)
  );
}

/** Aggregate resolved rows into overall, symbol, direction and month buckets. */
export function computePerformance(
  input: ResolvedSignalRow[],
  now: Date = new Date()
): SignalPerformance {
  const rows: ScoredRow[] = input
    .filter((row) => row.status === "target_hit" || row.status === "stopped_out")
    .map((row) => ({ ...row, r: scoreResolvedSignal(row) }))
    .sort((a, b) => new Date(a.resolvedAt).getTime() - new Date(b.resolvedAt).getTime());

  const symbolMap = new Map<string, ScoredRow[]>();
  const directionMap = new Map<SignalDirection, ScoredRow[]>();
  const monthMap = new Map<string, ScoredRow[]>();

  for (const row of rows) {
    const symbolKey = row.symbol.toUpperCase();
    symbolMap.set(symbolKey, [...(symbolMap.get(symbolKey) ?? []), row]);
    directionMap.set(row.direction, [...(directionMap.get(row.direction) ?? []), row]);
    const key = monthKey(row.resolvedAt);
    monthMap.set(key, [...(monthMap.get(key) ?? []), row]);
  }

  let cumulative = 0;
  const curve: PerformancePoint[] = rows.map((row) => {
    cumulative += row.r;
    return {
      id: row.id,
      symbol: row.symbol,
      direction: row.direction,
      status: row.status,
      at: row.resolvedAt,
      r: round(row.r),
      cumulativeR: round(cumulative),
    };
  });

  return {
    overall: bucket(OVERALL_KEY, "All signals", rows),
    bySymbol: sortBuckets(
      [...symbolMap.entries()].map(([key, list]) => bucket(key, key, list))
    ),
    byDirection: sortBuckets(
      [...directionMap.entries()].map(([key, list]) => {
        const label = key === "buy" ? "Buy" : "Sell";
        return bucket(key, label, list);
      })
    ),
    byMonth: [...monthMap.entries()]
      .map(([key, list]) => bucket(key, monthLabel(key), list))
      .sort((a, b) => b.key.localeCompare(a.key)),
    curve,
    updatedAt: now.toISOString(),
  };
}

/** Read every resolved signal and aggregate it. */
export async function signalPerformance(now: Date = new Date()): Promise<SignalPerformance> {
  const { Signal } = await import("./store");
  const docs = await Signal.find({ status: { $in: ["target_hit", "stopped_out"] } })
    .select({
      symbol: 1,
      direction: 1,
      status: 1,
      resolvedAt: 1,
      updatedAt: 1,
      createdAt: 1,
      entry: 1,
      entryMax: 1,
      target: 1,
      stop: 1,
    })
    .lean()
    .exec();

  const rows: ResolvedSignalRow[] = docs.map((doc: any) => {
    const at = doc.resolvedAt ?? doc.updatedAt ?? doc.createdAt;
    return {
      id: String(doc._id),
      symbol: String(doc.symbol),
      direction: doc.direction as SignalDirection,
      status: doc.status as "target_hit" | "stopped_out",
      resolvedAt: at instanceof Date ? at.toISOString() : new Date(String(at)).toISOString(),
      entry: doc.entry ?? null,
      entryMax: doc.entryMax ?? null,
      target: Number(doc.target),
      stop: Number(doc.stop),
    };
  });

  return computePerformance(rows, now);
}
