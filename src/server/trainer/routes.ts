// Public trainer API (Phase 5).
//
// Mounted at /api/trainer by src/server/index.ts. Item payloads contain only the
// anonymized context ending at the cut; the reveal endpoint returns future bars,
// the outcome and base rates only after an answer has been recorded.

import type { Router } from "express";

/** Build the trainer router. */
export function createTrainerRouter(): Router {
  throw new Error("routes.ts: implemented in Phase 5");
}
