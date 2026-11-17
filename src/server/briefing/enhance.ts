import { aiChat, type AiConfig } from "../ai/client";
import {
  buildBriefingPrompt,
  buildFallbackSections,
  parseBriefingSections,
} from "./build";
import { buildBriefingSnapshot } from "./snapshot";
import {
  claimBriefingEnhancement,
  findBriefing,
  getBriefingPreference,
  saveBriefing,
} from "./store";
import type { BriefingFocusSession, BriefingRecord } from "./types";

const ENHANCE_LEASE_MS = 120_000;
const inFlight = new Map<string, Promise<void>>();

async function currentGeneration(
  userId: string,
  dateKey: string,
  generatedAt: string
): Promise<BriefingRecord | null> {
  const current = await findBriefing(userId, dateKey);
  return current && current.generatedAt === generatedAt ? current : null;
}

async function runEnhancement(params: {
  userId: string;
  dateKey: string;
  generatedAt: string;
  config: AiConfig;
  focusSessions?: BriefingFocusSession[];
  retry?: boolean;
}): Promise<void> {
  let claimed: BriefingRecord | null;
  try {
    claimed = await claimBriefingEnhancement({
      userId: params.userId,
      dateKey: params.dateKey,
      generatedAt: params.generatedAt,
      retry: params.retry,
      leaseMs: ENHANCE_LEASE_MS,
    });
  } catch {
    return;
  }
  if (!claimed) return;

  try {
    const focusSessions =
      params.focusSessions ?? (await getBriefingPreference(params.userId)).focusSessions;
    const { snapshot, brandName } = await buildBriefingSnapshot(
      params.userId,
      new Date(claimed.generatedAt),
      focusSessions,
      { fast: false }
    );
    const beforeAi = await currentGeneration(
      params.userId,
      params.dateKey,
      claimed.generatedAt
    );
    if (!beforeAi) return;
    await saveBriefing({
      userId: params.userId,
      record: {
        ...beforeAi,
        sections: buildFallbackSections(snapshot),
        model: null,
        error: null,
        status: "enhancing",
        source: "deterministic",
        snapshot,
      },
    });

    const messages = buildBriefingPrompt(snapshot, brandName);
    let reply = await aiChat(params.config, messages, {
      maxTokens: 3000,
      temperature: 0.3,
      timeoutMs: 45_000,
    });
    let parsed = parseBriefingSections(reply.text, snapshot);

    if (parsed.error) {
      try {
        reply = await aiChat(
          params.config,
          [
            ...messages,
            {
              role: "user",
              content:
                "Return the briefing again as one valid JSON object only. No markdown, no code fence and no text outside the JSON. Keep every sentence short.",
            },
          ],
          { maxTokens: 3600, temperature: 0.1, timeoutMs: 45_000 }
        );
        parsed = parseBriefingSections(reply.text, snapshot);
      } catch {}
    }

    const finalRecord = await currentGeneration(
      params.userId,
      params.dateKey,
      claimed.generatedAt
    );
    if (!finalRecord) return;
    await saveBriefing({
      userId: params.userId,
      record: {
        ...finalRecord,
        sections: parsed.sections,
        model: reply.model,
        error: parsed.error,
        status: parsed.error ? "failed" : "ready",
        source: parsed.error ? "deterministic" : "ai",
        snapshot,
      },
    });
  } catch (err) {
    const current = await currentGeneration(
      params.userId,
      params.dateKey,
      claimed.generatedAt
    ).catch(() => null);
    if (!current) return;
    await saveBriefing({
      userId: params.userId,
      record: {
        ...current,
        sections: current.sections ?? buildFallbackSections(current.snapshot),
        model: null,
        error: err instanceof Error ? err.message : "The AI provider could not write the brief.",
        status: "failed",
        source: "deterministic",
      },
    }).catch(() => undefined);
  }
}

export function enqueueBriefingEnhancement(params: {
  userId: string;
  dateKey: string;
  generatedAt: string;
  config: AiConfig;
  focusSessions?: BriefingFocusSession[];
  retry?: boolean;
}): void {
  const key = `${params.userId}:${params.dateKey}:${params.generatedAt}`;
  if (inFlight.has(key)) return;
  const promise = runEnhancement(params).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  void promise;
}
