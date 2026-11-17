// Express router for AI Coach.
//
// Mounted at /api/coach behind authRequired and the Coach module gate. Every
// route is scoped to the session user. Reads never call the AI provider; only
// the explicit POST review routes do.

import { Router, type Response } from "express";

import { AiError } from "../ai/client";
import { authRequired, type AuthedRequest } from "../auth";
import { demoCoachTrade, demoCoachTrades, demoCoachWeekly } from "../demo/fixtures";
import {
  CoachError,
  generateTradeReview,
  generateWeeklyReview,
  getRecentTrades,
  getTradeReview,
  getWeeklyReview,
} from "./service";

export const coachRouter = Router();

coachRouter.use(authRequired);

function fail(res: Response, err: unknown): void {
  if (err instanceof CoachError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof AiError) {
    res.status(502).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : "unexpected error" });
}

coachRouter.get("/weekly", async (req: AuthedRequest, res) => {
  try {
    if (req.demo) {
      res.json(demoCoachWeekly());
      return;
    }
    const week = typeof req.query.week === "string" ? req.query.week : undefined;
    res.json(await getWeeklyReview(req.userId!, week));
  } catch (err) {
    fail(res, err);
  }
});

coachRouter.post("/weekly/:weekKey/review", async (req: AuthedRequest, res) => {
  try {
    res.json(await generateWeeklyReview(req.userId!, req.params.weekKey));
  } catch (err) {
    fail(res, err);
  }
});

coachRouter.get("/trades", async (req: AuthedRequest, res) => {
  try {
    res.json(req.demo ? demoCoachTrades() : await getRecentTrades(req.userId!));
  } catch (err) {
    fail(res, err);
  }
});

coachRouter.get("/trades/:id", async (req: AuthedRequest, res) => {
  try {
    if (req.demo) {
      const report = demoCoachTrade(req.params.id);
      if (!report) {
        res.status(404).json({ error: "trade not found" });
        return;
      }
      res.json(report);
      return;
    }
    res.json(await getTradeReview(req.userId!, req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

coachRouter.post("/trades/:id/review", async (req: AuthedRequest, res) => {
  try {
    res.json(await generateTradeReview(req.userId!, req.params.id));
  } catch (err) {
    fail(res, err);
  }
});
