// Evidence grading for the matched-vs-base comparison. Pure and conservative:
// a difference is only called "clear" when a Newcombe interval excludes zero,
// the sample is not tiny, and the gap is large enough to matter.
//
// The interval is a difference of two Wilson score intervals, not a p-value.
// It is descriptive: it says how uncertain the gap is, not how likely a future
// break is to do anything.

import { wilson } from "./analogues";

export type EvidenceGrade = "insufficient" | "weak" | "moderate" | "strong";

export interface EvidenceInput {
  up_first: number;
  down_first: number;
  base_up_first: number;
  base_down_first: number;
}

export interface Evidence {
  /** Matched decisive upside share minus the base decisive upside share, -1..1. */
  diff: number;
  /** 95% Newcombe interval for `diff`. */
  diff_ci95: [number, number] | null;
  grade: EvidenceGrade;
  /** Plain-language grade, safe for prose. */
  label: string;
  n_match: number;
  n_base: number;
  match_up_share: number;
  base_up_share: number;
}

const GRADE_LABEL: Record<EvidenceGrade, string> = {
  insufficient: "not enough decisive cases to grade",
  weak: "no clear difference",
  moderate: "moderate difference",
  strong: "clear difference",
};

/**
 * Newcombe hybrid score interval for the difference of two independent
 * proportions. Each proportion gets its own Wilson interval, then the
 * differences of the bounds are combined in quadrature.
 */
export function differenceCI(
  k1: number,
  n1: number,
  k2: number,
  n2: number
): { diff: number; ci: [number, number] } | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const w1 = wilson(k1, n1);
  const w2 = wilson(k2, n2);
  if (!w1 || !w2) return null;
  const [l1, u1] = w1;
  const [l2, u2] = w2;
  const diff = p1 - p2;
  const lower = diff - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2);
  const upper = diff + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2);
  return {
    diff,
    ci: [Math.max(-1, lower), Math.min(1, upper)],
  };
}

export function buildEvidence(x: EvidenceInput): Evidence | null {
  const nMatch = x.up_first + x.down_first;
  const nBase = x.base_up_first + x.base_down_first;
  if (nMatch <= 0 || nBase <= 0) return null;

  const matchUpShare = x.up_first / nMatch;
  const baseUpShare = x.base_up_first / nBase;
  const result = differenceCI(x.up_first, nMatch, x.base_up_first, nBase);
  if (!result) return null;

  const diff = result.diff;
  const [low, high] = result.ci;
  const crossesZero = low <= 0 && high >= 0;
  const magnitude = Math.abs(diff);

  let grade: EvidenceGrade;
  if (nMatch < 10 || nBase < 20) grade = "insufficient";
  else if (crossesZero) grade = "weak";
  else if (magnitude >= 0.15 && nMatch >= 30) grade = "strong";
  else if (magnitude >= 0.08) grade = "moderate";
  else grade = "weak";

  return {
    diff,
    diff_ci95: result.ci,
    grade,
    label: GRADE_LABEL[grade],
    n_match: nMatch,
    n_base: nBase,
    match_up_share: matchUpShare,
    base_up_share: baseUpShare,
  };
}

/** Signed gap in percentage points, for prose and the evidence strip. */
export function evidencePoints(ev: Evidence): number {
  return Math.round(ev.diff * 100);
}

/** One grounded sentence describing the comparison. */
export function evidenceFacts(ev: Evidence): string[] {
  const points = Math.abs(evidencePoints(ev));
  const side = ev.diff >= 0 ? "above" : "below";
  if (ev.grade === "insufficient") {
    return [
      `There are too few decisive cases (${ev.n_match} matched, ${ev.n_base} base) to grade the difference from the base rate.`,
    ];
  }
  if (points === 0) {
    return [
      `The matched decisive upside share is level with the base rate, ` +
        `and the interval includes no difference (${ev.label}).`,
    ];
  }
  if (ev.grade === "weak") {
    return [
      `The matched decisive upside share is ${points} points ${side} the base rate, ` +
        `but the interval still includes no difference (${ev.label}).`,
    ];
  }
  const bound = ev.diff >= 0 ? "above" : "below";
  return [
    `The matched decisive upside share is ${points} points ${side} the base rate, ` +
      `and the interval stays ${bound} zero (${ev.label}).`,
  ];
}
