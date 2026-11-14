// Express router for the daily briefing.
//
// Mounted at /api/briefing behind authRequired and the Briefing module gate.
// GET returns today's brief (generating it on first open); POST /refresh
// rebuilds it. Both are per user: the brief is written from the shared watchlist,
// so two members see the same market summary but their own document.

import { Router, type Response } from "express";

import { authRequired, type AuthedRequest } from "../auth";
import { AiError } from "../ai/client";
import { getBriefing } from "./service";

export const briefingRouter = Router();

briefingRouter.use(authRequired);

function fail(res: Response, err: unknown): void {
  if (err instanceof AiError) {
    res.status(502).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : "unexpected error" });
}

briefingRouter.get("/", async (req: AuthedRequest, res) => {
  try {
    res.json(await getBriefing(req.userId!));
  } catch (err) {
    fail(res, err);
  }
});

briefingRouter.post("/refresh", async (req: AuthedRequest, res) => {
  try {
    res.json(await getBriefing(req.userId!, { refresh: true }));
  } catch (err) {
    fail(res, err);
  }
});
