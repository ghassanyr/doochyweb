import { loadAiConfig, type AiConfig } from "../ai/client";
import { buildFallbackSections, briefingDateKey } from "./build";
import { enqueueBriefingEnhancement } from "./enhance";
import { DEFAULT_FOCUS_SESSIONS } from "./sessions";
import { buildBriefingSnapshot } from "./snapshot";
import { findBriefing, getBriefingPreference, saveBriefing } from "./store";
import {
  BRIEFING_SNAPSHOT_VERSION,
  type BriefingFocusSession,
  type BriefingPreferences,
  type BriefingRecord,
  type BriefingResponse,
} from "./types";

function hasCurrentSnapshot(briefing: BriefingRecord | null): briefing is BriefingRecord {
  return Boolean(
    briefing && briefing.snapshot.version === BRIEFING_SNAPSHOT_VERSION && briefing.sections
  );
}

async function createDeterministicBriefing(
  userId: string,
  now: Date,
  focusSessions: BriefingFocusSession[],
  config: AiConfig | null
): Promise<BriefingRecord> {
  const { snapshot } = await buildBriefingSnapshot(userId, now, focusSessions, {
    fast: true,
  });
  const saved = await saveBriefing({
    userId,
    record: {
      dateKey: snapshot.dateKey,
      generatedAt: snapshot.generatedAt,
      model: null,
      narrative: null,
      sections: buildFallbackSections(snapshot),
      error: null,
      status: config ? "building" : "ready",
      source: "deterministic",
      snapshot,
    },
  });
  if (config) {
    enqueueBriefingEnhancement({
      userId,
      dateKey: saved.dateKey,
      generatedAt: saved.generatedAt,
      config,
      focusSessions,
    });
  }
  return saved;
}

export async function getBriefing(
  userId: string,
  options: { refresh?: boolean; now?: Date } = {}
): Promise<BriefingResponse> {
  const now = options.now ?? new Date();
  const dateKey = briefingDateKey(now);
  const [config, preferences] = await Promise.all([
    loadAiConfig(),
    getBriefingPreference(userId).catch(
      (): BriefingPreferences => ({ focusSessions: [...DEFAULT_FOCUS_SESSIONS] })
    ),
  ]);

  if (!options.refresh) {
    const stored = await findBriefing(userId, dateKey);
    if (hasCurrentSnapshot(stored)) {
      if (config && (stored.status === "building" || stored.status === "enhancing")) {
        enqueueBriefingEnhancement({
          userId,
          dateKey: stored.dateKey,
          generatedAt: stored.generatedAt,
          config,
          focusSessions: preferences.focusSessions,
        });
      }
      return { aiReady: config !== null, briefing: stored, preferences };
    }
  }

  const briefing = await createDeterministicBriefing(
    userId,
    now,
    preferences.focusSessions,
    config
  );
  return { aiReady: config !== null, briefing, preferences };
}

export async function retryBriefingEnhancement(
  userId: string,
  options: { now?: Date } = {}
): Promise<BriefingResponse> {
  const response = await getBriefing(userId, { now: options.now });
  if (response.aiReady && hasCurrentSnapshot(response.briefing)) {
    const config = await loadAiConfig();
    if (config) {
      enqueueBriefingEnhancement({
        userId,
        dateKey: response.briefing.dateKey,
        generatedAt: response.briefing.generatedAt,
        config,
        focusSessions: response.preferences.focusSessions,
        retry: true,
      });
    }
  }
  return response;
}
