// CLI for Phase 2 narration. Builds the grounded input snapshot for a run or one
// event, attaches analogue results, renders the template baseline or a model
// note, and stores an audit record. Model notes are published only if they pass
// the lint and word limit after at most one retry.
//
//   tsx src/server/market/narrateCli.ts [--run=latest|ISO] [--k=20] [--days=730]
//                                       [--model=<id>] [--template] [--no-save] [--full]
//
// Without --model (or NARRATION_MODEL) it renders the template baseline. A model
// call needs NVIDIA_API_KEY + NVIDIA_BASE_URL; failures are stored in the audit
// record with the input snapshot, and the process exits non-zero.
//   tsx src/server/market/narrateCli.ts --events [--models=a,b] [--template] [--force]
//   tsx src/server/market/narrateCli.ts --event=<event key> [--models=a,b] [--force]
//   tsx src/server/market/narrateCli.ts --event-runs[=N] [--models=a,b] [--template]
//                                       [--k=20] [--days=730] [--no-save]
//   tsx src/server/market/narrateCli.ts --list
//   tsx src/server/market/narrateCli.ts --id=<record id>
//
// stdout is JSON. Logs go to stderr.
import "dotenv/config";
import mongoose from "mongoose";

console.log = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n");

import { latestRun, readRuns, type RunRecord } from "./breakoutFeed";
import {
  TEMPLATE_MODEL, TEMPLATE_PROMPT_VERSION, buildNarrationInput, groundednessWarnings,
  narrationEventKey, narrationId, templateNarration, type NarrationRecord,
} from "./narration";
import { NARRATION_PROMPT_VERSION, modelNarration, narrationConfig } from "./narrationModel";
import { loadAnaloguesForRun, narrateRunEvents } from "./narrationEvents";
import { listNarrations, loadNarration, saveNarration } from "./narrationStore";

const arg = (name: string): string | undefined =>
  process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const flag = (name: string): boolean => process.argv.slice(2).includes(`--${name}`);
const present = (name: string): boolean =>
  process.argv.slice(2).some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

const pickRun = (runs: RunRecord[], wanted: string): RunRecord => {
  if (!runs.length) throw new Error("no breakout runs found");
  if (!wanted || wanted === "latest") {
    const run = latestRun(runs);
    if (!run) throw new Error("no breakout runs found");
    return run;
  }
  const at = Date.parse(wanted);
  if (!Number.isFinite(at)) throw new Error("--run must be latest or an ISO time");
  const run = runs.find(
    (r) => Date.parse(r.timestamp_utc) === at || Date.parse(r.asOf) === at
  );
  if (!run) throw new Error(`no breakout run at ${wanted}`);
  return run;
};


const words = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

async function render(input: ReturnType<typeof buildNarrationInput>, model: string) {
  if (model === TEMPLATE_MODEL) {
    return { output: templateNarration(input), error: null as string | null, ms: 0 };
  }
  const started = Date.now();
  const cfg = narrationConfig();
  if (!cfg) throw new Error("NVIDIA_API_KEY is not set; add it to .env or use --template");
  try {
    const res = await modelNarration(input, { ...cfg, model });
    return { output: res.text, error: null as string | null, ms: Date.now() - started };
  } catch (err) {
    return {
      output: "",
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
  }
}

async function bakeoff(runs: RunRecord[], k: number, days: number, models: string[]) {
  const eventRuns = runs
    .filter((r) => r.breakouts.length > 0)
    .sort((a, b) => Date.parse(a.timestamp_utc) - Date.parse(b.timestamp_utc));
  const limitArg = arg("event-runs");
  const limit = limitArg ? Math.max(1, Number(limitArg) || 0) : eventRuns.length;
  const selected = eventRuns.slice(-limit);
  const rows: Record<string, unknown>[] = [];
  for (const run of selected) {
    const { results, errors } = await loadAnaloguesForRun(run, k, days);
    const input = buildNarrationInput(run, results, { k, analogueErrors: errors });
    for (const model of models) {
      const { output, error, ms } = await render(input, model);
      const groundedness = groundednessWarnings(input, output);
      const promptVersion = model === TEMPLATE_MODEL ? TEMPLATE_PROMPT_VERSION : NARRATION_PROMPT_VERSION;
      const record: NarrationRecord = {
        id: narrationId(input.run_id, model, promptVersion),
        run_id: input.run_id,
        created_at: new Date().toISOString(),
        model,
        prompt_version: promptVersion,
        input,
        output,
        groundedness,
        error,
      };
      const file = flag("no-save") ? null : saveNarration(record);
      rows.push({
        run_id: record.run_id, model, breakouts: input.breakouts.length,
        words: words(output), warnings: groundedness, error, ms, saved: Boolean(file),
      });
    }
  }
  const byModel = models.map((model) => {
    const mine = rows.filter((r) => r.model === model);
    return {
      model,
      runs: mine.length,
      failures: mine.filter((r) => r.error).length,
      flagged: mine.filter((r) => (r.warnings as string[]).length > 0).length,
      avg_words: Math.round(mine.reduce((n, r) => n + (r.words as number), 0) / Math.max(1, mine.length)),
      avg_ms: Math.round(mine.reduce((n, r) => n + (r.ms as number), 0) / Math.max(1, mine.length)),
    };
  });
  return { selected: selected.length, rows, by_model: byModel };
}

async function eventNotes(runs: RunRecord[], k: number, days: number, models: string[], onlyKey: string | null) {
  const selected = onlyKey
    ? runs.filter((r) => r.breakouts.some((b) => narrationEventKey(b) === onlyKey))
    : runs.filter((r) => r.breakouts.length > 0);
  const summary: Record<string, unknown>[] = [];
  for (const model of models) {
    const isTemplate = model === TEMPLATE_MODEL;
    const cfg = isTemplate ? null : narrationConfig();
    if (!isTemplate && !cfg) throw new Error("NVIDIA_API_KEY / NARRATION_MODEL is not configured");
    const totals = { model, runs: selected.length, generated: 0, published: 0, skipped: 0, failed: 0 };
    for (const run of selected) {
      const res = await narrateRunEvents(run, {
        k, days, model, cfg, force: flag("force"), maxAttempts: 2,
        eventKeys: onlyKey ? [onlyKey] : undefined,
        save: !flag("no-save"),
      });
      totals.generated += res.generated;
      totals.published += res.published;
      totals.skipped += res.skipped;
      totals.failed += res.failed;
    }
    summary.push(totals);
  }
  return { event: onlyKey, by_model: summary };
}

async function main(): Promise<unknown> {
  if (flag("list")) {
    return listNarrations().map((r) => ({
      id: r.id, run_id: r.run_id, created_at: r.created_at, model: r.model,
      breakouts: r.input.breakouts.length, saved: true,
    }));
  }
  const id = arg("id");
  if (id) {
    const record = loadNarration(id);
    if (!record) throw new Error(`no narration record ${id}`);
    return record;
  }

  const k = Math.min(100, Math.max(1, Number(arg("k") ?? 20)));
  const days = Math.min(1000, Math.max(30, Number(arg("days") ?? 730)));
  const runs = readRuns();
  if (present("events") || arg("event") !== undefined) {
    const onlyKey = arg("event")?.trim() || null;
    if (onlyKey && !runs.some((r) => r.breakouts.some((b) => narrationEventKey(b) === onlyKey))) {
      throw new Error(`no breakout event ${onlyKey}`);
    }
    const models = (arg("models") ?? process.env.NARRATION_MODEL ?? "")
      .split(",").map((m) => m.trim()).filter(Boolean);
    if (flag("template")) models.unshift(TEMPLATE_MODEL);
    if (!models.length) throw new Error("--events needs --models=<id> or --template");
    return eventNotes(runs, k, days, [...new Set(models)], onlyKey);
  }
  if (present("event-runs")) {
    const models = (arg("models") ?? process.env.NARRATION_MODEL ?? "")
      .split(",").map((m) => m.trim()).filter(Boolean);
    if (flag("template")) models.unshift(TEMPLATE_MODEL);
    if (!models.length) throw new Error("--event-runs needs --models=<id> or --template");
    return bakeoff(runs, k, days, [...new Set(models)]);
  }
  const run = pickRun(runs, arg("run") ?? "latest");
  const { results, errors } = await loadAnaloguesForRun(run, k, days);
  const input = buildNarrationInput(run, results, { k, analogueErrors: errors });
  const useModel = (arg("model") ?? process.env.NARRATION_MODEL ?? "").trim();
  const tryModel = !flag("template") && Boolean(useModel);

  let model = TEMPLATE_MODEL;
  let output = templateNarration(input);
  let error: string | null = null;
  if (tryModel) {
    const cfg = narrationConfig();
    if (!cfg) throw new Error("NVIDIA_API_KEY is not set; add it to .env or pass --template");
    model = useModel;
    try {
      const res = await modelNarration(input, { ...cfg, model: useModel });
      output = res.text;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      output = "";
    }
  }

  const groundedness = groundednessWarnings(input, output);
  const promptVersion = model === TEMPLATE_MODEL ? TEMPLATE_PROMPT_VERSION : NARRATION_PROMPT_VERSION;
  const record: NarrationRecord = {
    id: narrationId(input.run_id, model, promptVersion),
    run_id: input.run_id,
    created_at: new Date().toISOString(),
    model,
    prompt_version: promptVersion,
    input,
    output,
    groundedness,
    error,
  };
  const file = flag("no-save") ? null : saveNarration(record);
  if (error) process.exitCode = 1;
  return flag("full") ? { ...record, file } : {
    id: record.id, run_id: record.run_id, created_at: record.created_at,
    model: record.model, breakouts: input.breakouts.length,
    analogue_errors: Object.fromEntries(errors), error, groundedness, saved: Boolean(file), file, output,
  };
}

main()
  .then((res) => { process.stdout.write(JSON.stringify(res, null, 2) + "\n"); })
  .catch((err) => { process.stderr.write(`narration failed: ${err instanceof Error ? err.message : String(err)}\n`); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined); process.exit(process.exitCode ?? 0); });
