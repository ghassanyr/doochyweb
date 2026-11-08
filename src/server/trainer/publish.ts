// Batch publisher for the trainer (Phase 4).
//
// Builds an immutable, versioned batch from accepted and labelled items, computes
// per-tag and pooled base rates, and writes data/trainer/batches/<version>.json
// plus the Mongo TrainerBatches/TrainerItems collections.

import type { TrainerBatch, TrainerItem } from "./types";

/** Publish one immutable batch and return the stored document. */
export async function publishBatch(
  version: string,
  items: readonly TrainerItem[]
): Promise<TrainerBatch> {
  throw new Error("publish.ts: implemented in Phase 4");
}
