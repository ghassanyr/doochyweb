// Narration input contract and deterministic template (Phase 2, use case 1).
//
// The model may cite only fields present in NarrationInput. This module builds
// that snapshot from a breakout run plus analogue results, and renders a
// template-only narration so there is always a grounded baseline to compare
// model output against. Pure: no fs, no network.

import { HORIZON, type SearchResult, type Summary } from "./analogues";
import { breakoutKey, classifyAsset, normalizeBreakout, type BreakoutType } from "./breakouts";
import type { RunRecord } from "./breakoutFeed";
import { atrFromBreak, contextFacts, type MarketContext } from "./context";
import { buildEvidence, evidenceFacts, type Evidence } from "./evidence";

export const NARRATION_VERSION = 3;
/** Bumped independently: old template records used the model prompt version. */
export const TEMPLATE_PROMPT_VERSION = 5;
export const TEMPLATE_MODEL = "template";
export const NARRATION_MAX_WORDS = 240;
/** A close this far beyond the level invalidates the break. */
export const INVALIDATION_ATR_BUFFER = 0.75;
/** Legacy disclaimer kept in the audit snapshot only; it is no longer shown in public notes. */
export const RESEARCH_LABEL =
  "RESEARCH ONLY. Past analogue outcomes do not predict future results. Not financial advice.";

export interface OutcomeRates {
  n: number;
  up_first: number;
  down_first: number;
  tie: number;
  neither: number;
  up_first_rate: number | null;
  down_first_rate: number | null;
  up_first_ci95: [number, number] | null;
  down_first_ci95: [number, number] | null;
  median_mfe: number | null;
  median_mae: number | null;
}

export interface AnalogueInput {
  as_of: string;
  k: number;
  pool_size: number;
  sample_size: number;
  match: OutcomeRates;
  base_rate: OutcomeRates;
  out_of_sample: {
    train: OutcomeRates;
    test: OutcomeRates;
    match_split: { train: number; test: number };
  };
  note: string;
}

export interface NarrationBriefHistory {
  sample_size: number;
  pool_size: number;
  up_first: number;
  down_first: number;
  tie: number;
  neither: number;
  decisive_up_share: number | null;
  decisive_down_share: number | null;
  base_n: number;
  base_up_share: number | null;
  base_down_share: number | null;
  recent_n: number;
  recent_up_share: number | null;
  recent_down_share: number | null;
  recent_conflicts: boolean;
  median_mfe: number | null;
  median_mae: number | null;
  base_median_mfe: number | null;
  base_median_mae: number | null;
  match_train: number;
  match_test: number;
}

/** Compact, deterministic facts for one event. The model rewrites these; it does not compute them. */
export interface NarrationBrief {
  symbol: string;
  event: string;
  direction: "above" | "below";
  session: string;
  level_price: number;
  level_type: string;
  break_price: number;
  break_atr_mult: number;
  /** Level ± an ATR buffer, not the raw level. */
  invalidation_level: number;
  invalidation_atr_buffer: number;
  /** 4H backdrop at the break; null when no bars were available. */
  context: MarketContext | null;
  /** Matched-vs-base difference with its interval and grade; null without history. */
  evidence: Evidence | null;
  history: NarrationBriefHistory | null;
  quality: string[];
  limits: string[];
}

export interface NarrationBreakout {
  symbol: string;
  type: BreakoutType;
  asset_class: string;
  session: string;
  timestamp_utc: string;
  level_price: number;
  level_type: string;
  break_price: number;
  break_atr_mult: number;
  confirmation: string;
  analogue: AnalogueInput | null;
  analogue_error: string | null;
  /** Present on new records; old records can be read without it. */
  brief?: NarrationBrief | null;
}

export interface NarrationInput {
  narration_version: number;
  run_id: string;
  /** Set for a single-event note; null for the older one-note-per-run contract. */
  event_key?: string | null;
  symbol?: string | null;
  generated_at: string;
  run: {
    timestamp_utc: string;
    as_of: string;
    backfilled: boolean;
    evaluated_count: number;
    skipped: Record<string, string>;
  };
  breakouts: NarrationBreakout[];
  caveats: string[];
}

export interface NarrationRecord {
  id: string;
  run_id: string;
  /** Set for a per-event note; old run-level records leave it undefined. */
  event_key?: string | null;
  symbol?: string | null;
  created_at: string;
  model: string;
  prompt_version: number;
  input: NarrationInput;
  output: string;
  /** Deterministic checks on the output. Empty means no red flags, not proof of truth. */
  groundedness: string[];
  /** True only when the note passed the guard and may be shown publicly. */
  published?: boolean;
  attempts?: number;
  /** Set when a model call was attempted and failed; the input snapshot is kept. */
  error?: string | null;
  /** How the text was produced. Old records leave it undefined. */
  source?: "model" | "deterministic";
}

const rates = (s: Summary): OutcomeRates => ({
  n: s.n,
  up_first: s.up_first,
  down_first: s.down_first,
  tie: s.tie,
  neither: s.neither,
  up_first_rate: s.upFirstRate,
  down_first_rate: s.downFirstRate,
  up_first_ci95: s.upFirstCI95,
  down_first_ci95: s.downFirstCI95,
  median_mfe: s.medianMfe,
  median_mae: s.medianMae,
});

const SESSION_NAME: Record<string, string> = {
  asia: "Asia",
  tokyo: "Tokyo",
  london: "London",
  pre_ny: "pre-New York",
  ny: "New York",
  ny_afternoon: "New York afternoon",
};

const humanize = (value: string): string => value.replace(/_/g, " ").trim() || value;

const decisiveShare = (up: number, down: number): number | null => {
  const decisive = up + down;
  return decisive > 0 ? up / decisive : null;
};

const recentConflicts = (matchUp: number | null, recentUp: number | null): boolean => {
  if (matchUp == null || recentUp == null) return false;
  const matchLean = matchUp - 0.5;
  const recentLean = recentUp - 0.5;
  return Math.abs(matchLean) >= 0.05 && matchUp !== recentUp && matchLean * recentLean < 0;
};

export interface NarrationBriefExtras {
  context?: MarketContext | null;
}

function buildNarrationBrief(b: NarrationBreakout, extras: NarrationBriefExtras = {}): NarrationBrief {
  const direction: "above" | "below" =
    b.type === "resistance_break" ? "above" : b.type === "support_break" ? "below" : b.break_price >= b.level_price ? "above" : "below";
  const quality: string[] = [];
  let history: NarrationBriefHistory | null = null;
  let evidence: Evidence | null = null;
  const context = extras.context ?? null;

  if (b.analogue) {
    const a = b.analogue;
    const recent = a.out_of_sample.test;
    const upShare = decisiveShare(a.match.up_first, a.match.down_first);
    const baseUpShare = decisiveShare(a.base_rate.up_first, a.base_rate.down_first);
    const recentUpShare = decisiveShare(recent.up_first, recent.down_first);
    const conflict = recentConflicts(upShare, recentUpShare);
    history = {
      sample_size: a.sample_size,
      pool_size: a.pool_size,
      up_first: a.match.up_first,
      down_first: a.match.down_first,
      tie: a.match.tie,
      neither: a.match.neither,
      decisive_up_share: upShare,
      decisive_down_share: upShare == null ? null : 1 - upShare,
      base_n: a.base_rate.n,
      base_up_share: baseUpShare,
      base_down_share: baseUpShare == null ? null : 1 - baseUpShare,
      recent_n: recent.n,
      recent_up_share: recentUpShare,
      recent_down_share: recentUpShare == null ? null : 1 - recentUpShare,
      recent_conflicts: conflict,
      median_mfe: a.match.median_mfe,
      median_mae: a.match.median_mae,
      base_median_mfe: a.base_rate.median_mfe,
      base_median_mae: a.base_rate.median_mae,
      match_train: a.out_of_sample.match_split.train,
      match_test: a.out_of_sample.match_split.test,
    };
    evidence = buildEvidence({
      up_first: a.match.up_first,
      down_first: a.match.down_first,
      base_up_first: a.base_rate.up_first,
      base_down_first: a.base_rate.down_first,
    });
    if (a.sample_size < 30) quality.push(`Small sample (${a.sample_size} matches).`);
    if (a.out_of_sample.match_split.test < 10) {
      quality.push(`${a.out_of_sample.match_split.test} of ${a.sample_size} matches are from the recent pool.`);
    }
  }

  const atr = context?.atr ?? atrFromBreak(b);
  const buffer = atr != null && atr > 0 ? INVALIDATION_ATR_BUFFER * atr : 0;
  const invalidationLevel = direction === "above" ? b.level_price - buffer : b.level_price + buffer;

  const limits: string[] = [];
  if (history) {
    limits.push("Nearby bars are generic 4H bars, not prior breakouts.");
    limits.push(`A first touch is not a profit or loss; outcomes use a ${HORIZON}-bar horizon from the next open.`);
  }
  if (!context) limits.push("No 4H context was available at the break.");

  return {
    symbol: b.symbol,
    event: humanize(b.type),
    direction,
    session: SESSION_NAME[b.session] ?? humanize(b.session),
    level_price: b.level_price,
    level_type: humanize(b.level_type),
    break_price: b.break_price,
    break_atr_mult: b.break_atr_mult,
    invalidation_level: Number(invalidationLevel.toFixed(6)),
    invalidation_atr_buffer: buffer > 0 ? INVALIDATION_ATR_BUFFER : 0,
    context,
    evidence,
    history,
    quality,
    limits,
  };
}

const cleanIso = (iso: string): string => iso.replace(/[^0-9A-Za-z]/g, "");

/** Stable id for the breakout run, safe as a filename component. */
export function narrationRunId(run: RunRecord): string {
  return `run-${cleanIso(run.timestamp_utc)}-${cleanIso(run.asOf)}`;
}

/** 32-bit FNV-1a, hex. Keeps a per-event filename short; the run id is included too. */
function shortHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Audit file id. One record per run + model + prompt version, so bake-offs coexist.
 * A per-event note appends a hash of the event key.
 */
export function narrationId(
  runId: string,
  model: string,
  promptVersion = NARRATION_VERSION,
  eventKey?: string | null
): string {
  const m = model.trim().replace(/[^0-9A-Za-z._-]+/g, "_") || "model";
  return `${runId}__${m}__v${promptVersion}${eventKey ? `__${shortHash(eventKey)}` : ""}`;
}

/** Stable key shared by the feed, the note and its deep link. */
export function narrationEventKey(b: { symbol: string; type: string; level_price: number | null; level_type: string; break_price: number | null; break_atr_mult: number | null; confirmation: string; session: string; timestamp_utc: string }): string {
  const normalized = normalizeBreakout(b);
  if (normalized) return breakoutKey(normalized);
  return [b.symbol, b.type, b.session, b.timestamp_utc, b.level_price ?? "", b.level_type].join("|");
}

export const narrationWords = (text: string): number =>
  text.trim() ? text.trim().split(/\s+/).length : 0;

/** Publish only a non-empty, lint-clean note within the word limit. */
export function canPublish(output: string, warnings: string[]): boolean {
  return !output.trim() ? false : warnings.length === 0 && narrationWords(output) <= NARRATION_MAX_WORDS;
}

const analogueError = (symbol: string, errors?: Map<string, string>): string | null =>
  errors?.get(symbol) ?? null;

const toAnalogue = (r: SearchResult, k: number): AnalogueInput => ({
  as_of: r.asOf,
  k,
  pool_size: r.poolSize,
  sample_size: r.matchSummary.n,
  match: rates(r.matchSummary),
  base_rate: rates(r.baseRate),
  out_of_sample: {
    train: rates(r.bySplit.train),
    test: rates(r.bySplit.test),
    match_split: r.matchSplit,
  },
  note: r.note,
});

/**
 * Build the exact object the model is allowed to cite. Analogue results are
 * joined by symbol; missing ones are explicit nulls with a reason.
 */
export function buildNarrationInput(
  run: RunRecord,
  analogues: Map<string, SearchResult>,
  opts: {
    now?: number;
    k?: number;
    analogueErrors?: Map<string, string>;
    eventKey?: string | null;
    /** Market context keyed by event key (not symbol: one symbol can fire twice). */
    contexts?: Map<string, MarketContext | null>;
  } = {}
): NarrationInput {
  const k = opts.k ?? 20;
  const source = opts.eventKey
    ? run.breakouts.filter((b) => narrationEventKey(b) === opts.eventKey)
    : run.breakouts;
  const breakouts: NarrationBreakout[] = source.map((b) => {
    const a = analogues.get(b.symbol);
    const eventKey = narrationEventKey(b);
    const nb: NarrationBreakout = {
      symbol: b.symbol,
      type: b.type,
      asset_class: classifyAsset(b.symbol),
      session: b.session,
      timestamp_utc: b.timestamp_utc,
      level_price: b.level_price,
      level_type: b.level_type,
      break_price: b.break_price,
      break_atr_mult: b.break_atr_mult,
      confirmation: b.confirmation,
      analogue: a ? toAnalogue(a, k) : null,
      analogue_error: a ? null : analogueError(b.symbol, opts.analogueErrors) ?? "no analogue result",
    };
    nb.brief = buildNarrationBrief(nb, { context: opts.contexts?.get(eventKey) ?? null });
    return nb;
  });

  const caveats: string[] = [RESEARCH_LABEL];
  if (!breakouts.length) caveats.push("No breakouts fired in this run; there is nothing to narrate.");
  if (run.backfilled) caveats.push("Historical backfill run, not a live alert.");
  const skipped = Object.entries(run.skipped);
  if (skipped.length) caveats.push(`Skipped symbols: ${skipped.map(([s]) => s).join(", ")}.`);
  for (const b of breakouts) {
    if (!b.analogue) {
      caveats.push(`${b.symbol}: no analogue result (${b.analogue_error}); do not infer historical odds.`);
      continue;
    }
    if (b.analogue.out_of_sample.test.n < 30) {
      caveats.push(
        `${b.symbol}: out-of-sample test sample is small (n=${b.analogue.out_of_sample.test.n}); treat as descriptive.`
      );
    }
    if (b.analogue.match.n < 10) {
      caveats.push(`${b.symbol}: only ${b.analogue.match.n} historical matches; rates are unstable.`);
    }
  }

  return {
    narration_version: NARRATION_VERSION,
    run_id: narrationRunId(run),
    event_key: opts.eventKey ?? null,
    symbol: opts.eventKey && breakouts.length === 1 ? breakouts[0].symbol : null,
    generated_at: new Date(opts.now ?? Date.now()).toISOString(),
    run: {
      timestamp_utc: run.timestamp_utc,
      as_of: run.asOf,
      backfilled: run.backfilled,
      evaluated_count: run.evaluated.length,
      skipped: run.skipped,
    },
    breakouts,
    caveats,
  };
}


const numberTokens = (text: string): number[] =>
  (text.match(/-?\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []).map((t) => Number(t.replace(/,/g, "")));

const near = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 0.001);

/**
 * Cheap, deterministic red-flag checks for narration output. It cannot prove a
 * sentence is true; it catches numbers absent from the snapshot, raw field
 * names, timestamps and confidence-interval notation that belong in the stats panel.
 */
export function groundednessWarnings(input: NarrationInput, output: string): string[] {
  const warnings: string[] = [];
  if (!output.trim()) return ["output is empty"];

  const allowed = numberTokens(JSON.stringify(input));
  // Constants used by the prose that are not fields on the snapshot.
  for (const v of [4, 6, 20, 95, 120, 180, INVALIDATION_ATR_BUFFER]) allowed.push(v);
  const magnitudes = allowed.map(Math.abs);
  for (const v of numberTokens(output)) {
    const hit = (a: number): boolean =>
      Number.isInteger(v) && Number.isInteger(a) ? v === a : near(v, a);
    // Facts round rates and excursion medians for prose; accept those roundings.
    if (!allowed.some(hit) && !magnitudes.some(hit) && !allowed.some((a) => near(v / 100, a))) {
      warnings.push(`number ${v} is not present in the input snapshot`);
    }
  }

  if (/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/.test(output)) {
    warnings.push("output contains a raw field name; translate it into plain English");
  }
  if (/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(output)) {
    warnings.push("output contains a raw ISO timestamp; use the event date or omit it");
  }
  if (/\bCI\s*95\b|\b95\s*%\s*(?:CI|confidence)\b|confidence interval/i.test(output)) {
    warnings.push("output includes confidence intervals; move them to the stats panel");
  }
  if (/\b(?:occurred|happened)\b[^.]{0,24}\b\d+\b|\b\d+\s*(?:times|tie|neither)\b/i.test(output)) {
    warnings.push("output restates outcome counts; use the deterministic brief and stats panel");
  }
  if (/\b(?:overlap|significan)\w*/i.test(output)) {
    warnings.push("output makes an inference claim; report the brief without interpreting significance");
  }
  // The deterministic template now carries the context and evidence blocks, so
  // its ceiling is higher than a model rewrite's. The model is told to use at
  // most seven statistics, well under this limit.
  if (numberTokens(output).length > 32) {
    warnings.push("output is number-heavy; move details to the stats panel");
  }
  return [...new Set(warnings)];
}

const num = (x: number | null, digits = 2): string => (x == null ? "n/a" : x.toFixed(digits));
const pct = (r: number | null): string => (r == null ? "n/a" : `${(r * 100).toFixed(0)}%`);
const briefPrice = (x: number): string => (Number.isFinite(x) ? String(Number(x.toFixed(4))) : "n/a");

/** Plain-English facts the model may rewrite. All numbers are deterministic. */
export function narrationFacts(brief: NarrationBrief): string[] {
  const facts: string[] = [
    `${brief.symbol} closed at ${briefPrice(brief.break_price)}, ` +
      `${num(brief.break_atr_mult)} ATR ${brief.direction} the ${briefPrice(brief.level_price)} ` +
      `${brief.level_type} in ${brief.session}.`,
  ];
  if (brief.context) facts.push(...contextFacts(brief.context));
  const h = brief.history;
  if (!h) {
    facts.push("No nearby-bar history was available for this event, so no historical odds are implied.");
  } else {
    if (h.decisive_up_share != null && h.base_up_share != null) {
      facts.push(
        `Of ${h.sample_size} nearby 4H bars, upside was touched first in ${pct(h.decisive_up_share)} ` +
          `of decisive cases, versus ${pct(h.base_up_share)} for the base rate.`
      );
    } else {
      facts.push(`Of ${h.sample_size} nearby 4H bars, too few had a decisive first touch to compare a direction.`);
    }
    if (h.recent_up_share != null && h.recent_down_share != null) {
      facts.push(
        h.recent_conflicts
          ? `The recent pool leans the other way: downside first ${pct(h.recent_down_share)} versus ` +
              `upside ${pct(h.recent_up_share)} across ${h.recent_n} bars.`
          : `The recent pool is broadly in line: upside first ${pct(h.recent_up_share)} versus ` +
              `downside ${pct(h.recent_down_share)} across ${h.recent_n} bars.`
      );
    }
    if (h.median_mfe != null && h.median_mae != null) {
      facts.push(
        `Median excursion was ${num(h.median_mfe)} ATR in favour and ${num(Math.abs(h.median_mae))} ATR against.`
      );
    }
    if (brief.evidence) facts.push(...evidenceFacts(brief.evidence));
  }
  const side = brief.direction === "above" ? "below" : "above";
  facts.push(
    brief.invalidation_atr_buffer > 0
      ? `A close back ${side} ${briefPrice(brief.invalidation_level)} ` +
          `(${brief.invalidation_atr_buffer.toFixed(2)} ATR beyond the level) would invalidate the break.`
      : `A close back ${side} ${briefPrice(brief.invalidation_level)} would invalidate the break.`
  );
  return [...facts, ...brief.limits, ...brief.quality];
}

export interface NarrationModelInput {
  symbols: string[];
  facts: string[];
  caveats: string[];
}

/** Compact payload for the model: no run plumbing, skipped symbols or raw analogue JSON. */
export function narrationModelInput(input: NarrationInput): NarrationModelInput {
  const facts = input.breakouts.flatMap((b) => (b.brief ? narrationFacts(b.brief) : []));
  const caveats: string[] = [];
  if (input.run.backfilled) caveats.push("Historical backfill run, not a live alert.");
  if (!facts.length) caveats.push("No breakouts fired in this run; there is nothing to narrate.");
  return {
    symbols: [...new Set(input.breakouts.map((b) => b.symbol))],
    facts,
    caveats,
  };
}

/**
 * Grounded template. Every number comes from NarrationInput; nothing is inferred.
 * Used as the fallback and as the baseline in the model bake-off.
 */
export function templateNarration(input: NarrationInput): string {
  const lines: string[] = [];
  if (!input.breakouts.length) lines.push("No breakouts fired in this run.");

  for (const b of input.breakouts) {
    const brief = b.brief ?? buildNarrationBrief(b);
    if (lines.length) lines.push("");
    lines.push(`${brief.symbol} ${brief.event} (${brief.session})`, ...narrationFacts(brief));
  }

  if (input.run.backfilled) lines.push("", "Historical backfill run, not a live alert.");
  return lines.join("\n");
}
