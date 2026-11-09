import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "../api";
import {
  advanceDailyProgress,
  createDailyProgress,
  isDailyProgress,
  localDayKey,
  recordDailyResult,
  scoreAnswer,
  shouldResetDailyProgress,
  summarizeResults,
  type DailyProgress,
} from "./scoring";
import {
  trainerApi,
  type AnonymizedItem,
  type RevealedItem,
  type TradeChoice,
} from "./trainerApi";

const SESSION_KEY = "doochyweb_trainer_session";
const PROGRESS_KEY = "doochyweb_trainer_daily_v1";
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DAILY_ITEMS = 10;

export type DrillStatus =
  | "loading"
  | "preparing"
  | "empty"
  | "ready"
  | "complete"
  | "error";

function makeSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    const id = crypto.randomUUID();
    if (SESSION_ID_RE.test(id)) return id;
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function getSessionId(): string {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored && SESSION_ID_RE.test(stored)) return stored;
    const id = makeSessionId();
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return makeSessionId();
  }
}

function readProgress(): DailyProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDailyProgress(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeProgress(progress: DailyProgress | null): void {
  try {
    if (progress) localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    else localStorage.removeItem(PROGRESS_KEY);
  } catch {
    /* private mode / storage full: the in-memory drill still works */
  }
}

function isNoBatch(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

function isStale(err: unknown): boolean {
  return (
    err instanceof ApiError && (err.status === 404 || err.status === 409)
  );
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) {
      return "The trainer is being prepared. Please try again shortly.";
    }
    if (err.status === 0) {
      return "Could not reach the trainer. Check your connection and try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function useDrill() {
  const [status, setStatus] = useState<DrillStatus>("loading");
  const [progress, setProgress] = useState<DailyProgress | null>(null);
  const [item, setItem] = useState<AnonymizedItem | null>(null);
  const [reveal, setReveal] = useState<RevealedItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingItem, setLoadingItem] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const generation = useRef(0);

  const commitProgress = useCallback((next: DailyProgress | null) => {
    setProgress(next);
    writeProgress(next);
  }, []);

  const restartForStale = useCallback(() => {
    generation.current += 1;
    writeProgress(null);
    setProgress(null);
    setItem(null);
    setReveal(null);
    setError(null);
    setLoadingItem(false);
    setSubmitting(false);
    setStatus("loading");
    setReloadKey((key) => key + 1);
  }, []);

  // Bootstrap once per mount/reload: read the published batch metadata, then
  // reuse today's saved queue or fetch a fresh 10-item session.
  useEffect(() => {
    const gen = ++generation.current;
    let alive = true;
    const current = () => alive && gen === generation.current;

    setStatus("loading");
    setProgress(null);
    setItem(null);
    setReveal(null);
    setError(null);
    setLoadingItem(false);
    setSubmitting(false);

    async function run() {
      const sessionId = getSessionId();

      let batch;
      try {
        batch = await trainerApi.batch();
      } catch (err) {
        if (!current()) return;
        if (isNoBatch(err)) {
          setStatus("preparing");
          return;
        }
        setError(messageFor(err));
        setStatus("error");
        return;
      }

      const date = localDayKey();
      const saved = readProgress();
      let next =
        saved && !shouldResetDailyProgress(saved, date, batch.version)
          ? saved
          : null;

      if (!next) {
        try {
          const session = await trainerApi.session(sessionId, DAILY_ITEMS);
          if (!current()) return;
          if (session.items.length === 0) {
            setStatus("empty");
            return;
          }
          next = createDailyProgress(
            date,
            batch.version,
            session.items.map((entry) => entry.itemId)
          );
        } catch (err) {
          if (!current()) return;
          if (isNoBatch(err)) {
            setStatus("preparing");
            return;
          }
          setError(messageFor(err));
          setStatus("error");
          return;
        }
      }

      if (!current()) return;
      // A reveal can be recorded at the current slot before "Next" is pressed.
      // On a reload there is no reveal to restore, so resume at the next
      // unanswered item instead of showing the same setup again.
      next = {
        ...next,
        index: Math.max(next.index, next.results.length),
      };
      writeProgress(next);
      setProgress(next);
      setStatus(next.index >= next.itemIds.length ? "complete" : "ready");
    }

    void run();
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Fetch only the current item's anonymized context. The session endpoint
  // intentionally returns ids, not the whole queue, so each card is a fresh
  // read and stale ids can be recovered cleanly.
  useEffect(() => {
    if (status !== "ready" || !progress) return;
    const index = progress.index;
    if (index >= progress.itemIds.length) return;
    const itemId = progress.itemIds[index];
    if (item?.itemId === itemId) return;

    let alive = true;
    setLoadingItem(true);
    trainerApi
      .item(itemId)
      .then((response) => {
        if (!alive) return;
        setItem(response.item);
        setReveal(null);
      })
      .catch((err) => {
        if (!alive) return;
        if (isStale(err)) {
          restartForStale();
          return;
        }
        setError(messageFor(err));
        setStatus(isNoBatch(err) ? "preparing" : "error");
      })
      .finally(() => {
        if (alive) setLoadingItem(false);
      });

    return () => {
      alive = false;
    };
  }, [status, progress, item?.itemId, restartForStale]);

  const submitAnswer = useCallback(
    async (probability: number, trade: TradeChoice) => {
      if (!progress || !item || status !== "ready" || submitting) return;

      setSubmitting(true);
      setError(null);
      try {
        const sessionId = getSessionId();
        await trainerApi.answer(
          sessionId,
          item.itemId,
          probability,
          trade
        );
        const response = await trainerApi.reveal(sessionId, item.itemId);
        setReveal(response.reveal);
        commitProgress(
          recordDailyResult(
            progress,
            scoreAnswer(probability, trade, response.reveal.outcome)
          )
        );
      } catch (err) {
        if (isStale(err)) {
          restartForStale();
          return;
        }
        if (isNoBatch(err)) {
          setStatus("preparing");
          return;
        }
        setError(messageFor(err));
      } finally {
        setSubmitting(false);
      }
    },
    [progress, item, status, submitting, commitProgress, restartForStale]
  );

  const nextItem = useCallback(() => {
    if (!progress) return;
    const next = advanceDailyProgress(progress);
    commitProgress(next);
    setItem(null);
    setReveal(null);
    setError(null);
    if (next.index >= next.itemIds.length) setStatus("complete");
  }, [progress, commitProgress]);

  const retry = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  const summary = useMemo(
    () => summarizeResults(progress?.results ?? []),
    [progress?.results]
  );

  const total = progress?.itemIds.length ?? 0;
  const currentNumber =
    progress && total > 0 ? Math.min(progress.index + 1, total) : 0;
  const completed = status === "complete";

  return {
    status,
    item,
    reveal,
    progress,
    error,
    loadingItem,
    submitting,
    summary,
    total,
    currentNumber,
    completed,
    submitAnswer,
    nextItem,
    retry,
  };
}
