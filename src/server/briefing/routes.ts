// Express router for the daily briefing.
//
// Mounted at /api/briefing behind authRequired and the Briefing module gate.
// GET returns today's brief (generating it on first open); POST /refresh
// rebuilds it. PATCH /preferences changes the member's focus sessions and
// clears today's brief. All routes are per user.

import { Router, type Response } from "express";

import { authRequired, type AuthedRequest } from "../auth";
import { AiError } from "../ai/client";
import { briefingDateKey } from "./build";
import { getBriefing } from "./service";
import { parseFocusSessions } from "./sessions";
import { clearBriefing, saveBriefingPreference } from "./store";

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

briefingRouter.patch("/preferences", async (req: AuthedRequest, res) => {
  try {
    const focusSessions = parseFocusSessions(req.body?.focusSessions);
    if (!focusSessions) {
      res.status(400).json({ error: "Choose at least one focus session." });
      return;
    }
    const preferences = await saveBriefingPreference(req.userId!, focusSessions);
    await clearBriefing(req.userId!, briefingDateKey(new Date()));
    res.json({ preferences });
  } catch (err) {
    fail(res, err);
  }
});
