// Anonymous in-memory attempt store for the trainer (Phase 5).
//
// Sessions are keyed by an opaque client id; there are no accounts. Only the
// first answer for an item is kept. Later submissions are accepted but never
// overwrite it, so a client cannot reveal the outcome and then "improve" its
// answer. Expired attempts are swept opportunistically and the number of live
// sessions is capped so an anonymous endpoint cannot grow memory forever.

export type Trade = "take" | "pass";

export interface AttemptInput {
  sessionId: string;
  itemId: string;
  probability: number | null;
  trade: Trade | null;
  /** Override the clock, used by tests. */
  answeredAt?: number;
}

export interface Attempt {
  sessionId: string;
  itemId: string;
  probability: number | null;
  trade: Trade | null;
  answeredAt: number;
}

export interface RecordAttemptResult {
  /** The stored first answer, even when the new submission differs. */
  attempt: Attempt;
  /** True when the submission differed from the stored first answer. */
  conflict: boolean;
}

export interface AttemptStore {
  get(sessionId: string, itemId: string): Attempt | undefined;
  record(input: AttemptInput): RecordAttemptResult;
  answeredIds(sessionId: string): Set<string>;
  /** Drop expired attempts; returns how many were removed. */
  sweep(now?: number): number;
}

/** Attempts expire after six hours of inactivity by default. */
export const ATTEMPT_TTL_MS = 6 * 60 * 60 * 1000;

/** Upper bound on live sessions held in memory. */
export const MAX_ATTEMPT_SESSIONS = 5_000;

export interface AttemptStoreOptions {
  ttlMs?: number;
  maxSessions?: number;
  now?: () => number;
}

interface SessionEntry {
  attempts: Map<string, Attempt>;
  lastSeen: number;
}

export function createAttemptStore(options: AttemptStoreOptions = {}): AttemptStore {
  const ttlMs = Math.max(1, options.ttlMs ?? ATTEMPT_TTL_MS);
  const maxSessions = Math.max(1, options.maxSessions ?? MAX_ATTEMPT_SESSIONS);
  const now = options.now ?? Date.now;
  const sessions = new Map<string, SessionEntry>();

  function sweep(at: number): number {
    let removed = 0;
    for (const [sessionId, session] of sessions) {
      for (const [itemId, attempt] of session.attempts) {
        if (at - attempt.answeredAt >= ttlMs) {
          session.attempts.delete(itemId);
          removed++;
        }
      }
      if (session.attempts.size === 0) sessions.delete(sessionId);
    }
    return removed;
  }

  function touch(sessionId: string, at: number): SessionEntry {
    const existing = sessions.get(sessionId);
    if (existing) {
      existing.lastSeen = at;
      return existing;
    }

    while (sessions.size >= maxSessions) {
      let oldestId: string | null = null;
      let oldestAt = Infinity;
      for (const [id, entry] of sessions) {
        if (entry.lastSeen < oldestAt) {
          oldestAt = entry.lastSeen;
          oldestId = id;
        }
      }
      if (oldestId === null) break;
      sessions.delete(oldestId);
    }

    const session: SessionEntry = { attempts: new Map(), lastSeen: at };
    sessions.set(sessionId, session);
    return session;
  }

  return {
    get(sessionId, itemId) {
      const at = now();
      sweep(at);
      return sessions.get(sessionId)?.attempts.get(itemId);
    },

    record(input) {
      const at = input.answeredAt ?? now();
      sweep(at);
      const session = touch(input.sessionId, at);

      const existing = session.attempts.get(input.itemId);
      if (existing) {
        return {
          attempt: existing,
          conflict:
            existing.probability !== input.probability ||
            existing.trade !== input.trade,
        };
      }

      const attempt: Attempt = {
        sessionId: input.sessionId,
        itemId: input.itemId,
        probability: input.probability,
        trade: input.trade,
        answeredAt: at,
      };
      session.attempts.set(input.itemId, attempt);
      return { attempt, conflict: false };
    },

    answeredIds(sessionId) {
      const at = now();
      sweep(at);
      const session = sessions.get(sessionId);
      if (!session) return new Set();
      session.lastSeen = at;
      return new Set(session.attempts.keys());
    },

    sweep(at = now()) {
      return sweep(at);
    },
  };
}
