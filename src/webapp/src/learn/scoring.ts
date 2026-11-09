// Pure grading and daily-progress logic for the public trainer.
//
// A probability is converted to a directional call at 50% for v1; the raw
// probability is kept so calibration can be added later without a migration.
// Nothing in this module touches the DOM, storage or the network.

export type Outcome = "up" | "down" | "scratch";
export type DirectionCall = "up" | "down";
export type TradeChoice = "take" | "pass";

export function directionFromProbability(probability: number): DirectionCall {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("probability must be a number between 0 and 1");
  }
  return probability >= 0.5 ? "up" : "down";
}

export interface ScoredResult {
  /** Raw 0..1 probability, retained for future calibration work. */
  probability: number;
  trade: TradeChoice;
  directionCall: DirectionCall;
  outcome: Outcome;
  directionCorrect: boolean;
  tradeCorrect: boolean;
}

export function scoreAnswer(
  probability: number,
  trade: TradeChoice,
  outcome: Outcome
): ScoredResult {
  const directionCall = directionFromProbability(probability);
  const directionCorrect = outcome === directionCall;
  const tradeCorrect = trade === "take" ? directionCorrect : !directionCorrect;

  return {
    probability,
    trade,
    directionCall,
    outcome,
    directionCorrect,
    tradeCorrect,
  };
}

export interface AccuracyBucket {
  correct: number;
  total: number;
}

export interface AccuracySummary {
  direction: AccuracyBucket;
  trade: AccuracyBucket;
}

export function summarizeResults(
  results: readonly ScoredResult[]
): AccuracySummary {
  let directionCorrect = 0;
  let tradeCorrect = 0;

  for (const result of results) {
    if (result.directionCorrect) directionCorrect++;
    if (result.tradeCorrect) tradeCorrect++;
  }

  return {
    direction: { correct: directionCorrect, total: results.length },
    trade: { correct: tradeCorrect, total: results.length },
  };
}

export function accuracyPercent(bucket: AccuracyBucket): number | null {
  if (bucket.total === 0) return null;
  return (bucket.correct / bucket.total) * 100;
}

export interface DailyProgress {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  batchVersion: string;
  /** Opaque public item ids, in drill order. */
  itemIds: string[];
  /** Next item slot; equals itemIds.length once the drill is complete. */
  index: number;
  /** One graded result per answered slot, in drill order. */
  results: ScoredResult[];
}

export function localDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shouldResetDailyProgress(
  progress: Pick<DailyProgress, "date" | "batchVersion">,
  date: string,
  batchVersion: string
): boolean {
  return progress.date !== date || progress.batchVersion !== batchVersion;
}

export function createDailyProgress(
  date: string,
  batchVersion: string,
  itemIds: string[]
): DailyProgress {
  return {
    date,
    batchVersion,
    itemIds: [...itemIds],
    index: 0,
    results: [],
  };
}

export function recordDailyResult(
  progress: DailyProgress,
  result: ScoredResult
): DailyProgress {
  const results = progress.results.slice();
  results[progress.index] = result;
  return { ...progress, results };
}

export function advanceDailyProgress(progress: DailyProgress): DailyProgress {
  return {
    ...progress,
    index: Math.min(progress.index + 1, progress.itemIds.length),
  };
}

function isScoredResult(value: unknown): value is ScoredResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.probability === "number" &&
    result.probability >= 0 &&
    result.probability <= 1 &&
    (result.trade === "take" || result.trade === "pass") &&
    (result.directionCall === "up" || result.directionCall === "down") &&
    (result.outcome === "up" ||
      result.outcome === "down" ||
      result.outcome === "scratch") &&
    typeof result.directionCorrect === "boolean" &&
    typeof result.tradeCorrect === "boolean"
  );
}

export function isDailyProgress(value: unknown): value is DailyProgress {
  if (!value || typeof value !== "object") return false;
  const progress = value as Record<string, unknown>;
  if (
    typeof progress.date !== "string" ||
    typeof progress.batchVersion !== "string" ||
    !Array.isArray(progress.itemIds) ||
    !progress.itemIds.every((id) => typeof id === "string" && id.length > 0) ||
    !Number.isInteger(progress.index) ||
    (progress.index as number) < 0 ||
    (progress.index as number) > progress.itemIds.length ||
    !Array.isArray(progress.results) ||
    progress.results.length > progress.itemIds.length ||
    !progress.results.every(isScoredResult)
  ) {
    return false;
  }
  return true;
}
