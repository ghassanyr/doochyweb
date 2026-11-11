// Per-event narration: build one grounded note for one breakout, retry once if
// the guard flags it, and publish only clean notes. Shared by the live breakout
// runner and the backfill CLI so both use the same contract.

import { connectDb } from "../db";
import { H4_MS, searchAnalogues, type SearchResult } from "./analogues";
import { readRuns, type RunRecord } from "./breakoutFeed";
import { buildMarketContext, type MarketContext } from "./context";
import { loadHistory, readHistory } from "./history";
import {
  NARRATION_MAX_WORDS, TEMPLATE_MODEL, TEMPLATE_PROMPT_VERSION, buildNarrationInput, canPublish,
  groundednessWarnings, narrationEventKey, narrationId, narrationWords, templateNarration,
  type NarrationRecord,
} from "./narration";
import { NARRATION_PROMPT_VERSION, modelNarration, narrationConfig, type NarrationConfig } from "./narrationModel";
import { listNarrations, saveNarration } from "./narrationStore";
import { loadCatalog, resolveMeta } from "./catalog";
import type { Candle } from "./types";

/** Analogue results for every symbol in one run. Missing symbols are explicit errors. */
export async function loadAnaloguesForRun(run: RunRecord, k: number, days: number, onlySymbols?: string[]) {
  const results = new Map<string, SearchResult>();
  const errors = new Map<string, string>();
  const bars = new Map<string, Candle[]>();
  const symbols = onlySymbols?.length
    ? [...new Set(onlySymbols)]
    : [...new Set(run.breakouts.map((b) => b.symbol))];
  if (!symbols.length) return { results, errors, bars };

  await connectDb();
  const catalog = await loadCatalog();
  const asOf = Date.parse(run.asOf);
  for (const symbol of symbols) {
    try {
      const meta = resolveMeta(symbol, catalog.items);
      if (!meta) throw new Error("not tradable on the market account");
      const series = await loadHistory(meta, "4h", days, asOf);
      bars.set(symbol, series);
      const all = readHistory(symbol, "4h");
      const newest = all.length ? all[all.length - 1].time : 0;
      if (!series.length || newest + 2 * H4_MS < asOf) throw new Error("history is stale; refusing to search");
      results.set(symbol, searchAnalogues(series, asOf, k));
    } catch (err) {
      errors.set(symbol, err instanceof Error ? err.message : String(err));
    }
  }
  return { results, errors, bars };
}

export function buildContextsForRun(
  run: RunRecord,
  bars: Map<string, Candle[]>,
  eventKeys?: string[]
): Map<string, MarketContext | null> {
  const out = new Map<string, MarketContext | null>();
  for (const b of run.breakouts) {
    const key = narrationEventKey(b);
    if (eventKeys && !eventKeys.includes(key)) continue;
    if (out.has(key)) continue;
    const series = bars.get(b.symbol);
    out.set(key, series?.length ? buildMarketContext(series, b, b.timestamp_utc) : null);
  }
  return out;
}

export interface EventNarrationOptions {
  k: number;
  days: number;
  model: string;
  cfg?: NarrationConfig | null;
  fetchImpl?: typeof fetch;
  /** Default 2: the first call plus one retry after a lint/word failure. */
  maxAttempts?: number;
  force?: boolean;
  /** Limit generation to these event keys (used by `--event=`). */
  eventKeys?: string[];
  now?: number;
  save?: boolean;
}

export interface EventNarrationResult {
  records: NarrationRecord[];
  generated: number;
  skipped: number;
  published: number;
  failed: number;
}

/**
 * Generate one note per event in `run`. Existing records for the same model and
 * prompt version are skipped unless `force`. Notes that fail the guard are saved
 * for audit but marked unpublished, so the public API never serves them.
 */
export async function narrateRunEvents(
  run: RunRecord,
  opts: EventNarrationOptions
): Promise<EventNarrationResult> {
  const out: EventNarrationResult = { records: [], generated: 0, skipped: 0, published: 0, failed: 0 };
  if (!run.breakouts.length) return out;

  const isTemplate = opts.model === TEMPLATE_MODEL;
  const promptVersion = isTemplate ? TEMPLATE_PROMPT_VERSION : NARRATION_PROMPT_VERSION;
  const cfg = isTemplate ? null : opts.cfg ?? narrationConfig();
  if (!isTemplate && !cfg) throw new Error("NVIDIA_API_KEY / NARRATION_MODEL is not configured");

  const scoped = opts.eventKeys
    ? run.breakouts.filter((b) => opts.eventKeys!.includes(narrationEventKey(b)))
    : run.breakouts;
  const { results, errors, bars } = await loadAnaloguesForRun(
    run,
    opts.k,
    opts.days,
    [...new Set(scoped.map((b) => b.symbol))]
  );
  const contexts = buildContextsForRun(run, bars, opts.eventKeys);
  const existing = new Set(
    listNarrations()
      .filter((r) => r.event_key && r.model === opts.model && r.prompt_version === promptVersion)
      .map((r) => r.event_key as string)
  );

  const seen = new Set<string>();
  for (const b of run.breakouts) {
    const eventKey = narrationEventKey(b);
    if (seen.has(eventKey)) continue;
    seen.add(eventKey);
    if (opts.eventKeys && !opts.eventKeys.includes(eventKey)) continue;
    if (!opts.force && existing.has(eventKey)) {
      out.skipped++;
      continue;
    }

    const input = buildNarrationInput(run, results, {
      eventKey, k: opts.k, analogueErrors: errors, now: opts.now, contexts,
    });
    if (input.breakouts.length !== 1) {
      out.skipped++;
      continue;
    }

    const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
    let output = "";
    let error: string | null = null;
    let warnings: string[] = [];
    let attempts = 0;
    for (attempts = 1; attempts <= maxAttempts; attempts++) {
      if (isTemplate) {
        output = templateNarration(input);
        error = null;
      } else {
        try {
          const res = await modelNarration(input, { ...cfg!, model: opts.model }, opts.fetchImpl);
          output = res.text;
          error = null;
        } catch (err) {
          output = "";
          error = err instanceof Error ? err.message : String(err);
        }
      }
      warnings = groundednessWarnings(input, output);
      if (!error && canPublish(output, warnings)) break;
    }
    if (attempts > maxAttempts) attempts = maxAttempts;

    // Deterministic notes are grounded by construction: publish a non-empty one
    // within the word limit even if a rounding check flags something for audit.
    const published = isTemplate
      ? Boolean(output.trim()) && narrationWords(output) <= NARRATION_MAX_WORDS
      : !error && canPublish(output, warnings);
    const record: NarrationRecord = {
      id: narrationId(input.run_id, opts.model, promptVersion, eventKey),
      run_id: input.run_id,
      event_key: eventKey,
      symbol: input.symbol ?? input.breakouts[0]?.symbol ?? null,
      created_at: new Date(opts.now ?? Date.now()).toISOString(),
      model: opts.model,
      prompt_version: promptVersion,
      input,
      output,
      groundedness: warnings,
      published,
      attempts,
      error,
      source: isTemplate ? "deterministic" : "model",
    };
    if (opts.save !== false) saveNarration(record);
    out.records.push(record);
    out.generated++;
    if (published) out.published++;
    if (error) out.failed++;
  }

  return out;
}

const deterministicInflight = new Map<string, Promise<NarrationRecord | null>>();

/**
 * Return the current deterministic note for one event, generating it on first
 * request. This never spends a model call: it is the always-available note.
 */
export async function ensureDeterministicNote(
  eventKey: string,
  opts: { now?: number; save?: boolean } = {}
): Promise<NarrationRecord | null> {
  const existing = listNarrations().find(
    (r) =>
      r.event_key === eventKey &&
      r.model === TEMPLATE_MODEL &&
      r.prompt_version === TEMPLATE_PROMPT_VERSION &&
      r.published !== false &&
      !r.error &&
      r.output.trim().length > 0
  );
  if (existing) return existing;

  const pending = deterministicInflight.get(eventKey);
  if (pending) return pending;

  const task = (async () => {
    const run = readRuns().find((r) => r.breakouts.some((b) => narrationEventKey(b) === eventKey));
    if (!run) return null;
    const res = await narrateRunEvents(run, {
      k: 20,
      days: 730,
      model: TEMPLATE_MODEL,
      eventKeys: [eventKey],
      maxAttempts: 1,
      now: opts.now,
      save: opts.save,
      // A published note was not found above, so regenerate even if an older
      // unpublished template record exists for this event.
      force: true,
    });
    return res.records[0] ?? null;
  })().finally(() => deterministicInflight.delete(eventKey));

  deterministicInflight.set(eventKey, task);
  return task;
}

/** Live hook: only when explicitly enabled and a model is configured. */
export async function publishRunNarrations(
  run: RunRecord,
  log: (msg: string) => void = console.log
): Promise<EventNarrationResult | null> {
  if (process.env.NARRATION_ENABLED !== "true") return null;
  if (!run.breakouts.length) return null;
  const cfg = narrationConfig();
  if (!cfg) return null;
  const k = Math.min(100, Math.max(1, Number(process.env.NARRATION_K ?? 20)));
  const days = Math.min(1000, Math.max(30, Number(process.env.NARRATION_DAYS ?? 730)));
  try {
    const res = await narrateRunEvents(run, { k, days, model: cfg.model, cfg, maxAttempts: 2 });
    log(`[narrate] ${run.asOf}: ${res.published}/${res.generated} published, ${res.skipped} skipped, ${res.failed} failed`);
    return res;
  } catch (err) {
    log(`[narrate] ${run.asOf} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
