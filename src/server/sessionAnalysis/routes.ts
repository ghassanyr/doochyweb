// Public reads for Session Analysis plus the admin mailbox sync.
//
// Session Analysis copies the daily AI market analysis email, so it follows the
// Analysis module's access rule and is public by default. Chart images are
// served from their own router because an <img> request cannot carry the bearer
// token the JSON routes may require when an admin makes Analysis signed-in only.

import { Router, type Request, type Response } from "express";

import { adminRequired } from "../auth";
import { syncSessionAnalysis } from "./ingest";
import {
  imageById,
  latestSession,
  listSessionDays,
  sessionByKey,
} from "./store";
import type { SessionDay, SessionLatestResponse } from "./types";

export const sessionAnalysisRouter = Router();
export const sessionAnalysisChartRouter = Router();

sessionAnalysisChartRouter.get(
  "/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const image = await imageById(String(req.params.id ?? ""));
      if (!image) {
        res.status(404).json({ error: "chart not found" });
        return;
      }
      res.setHeader("Content-Type", image.contentType);
      res.setHeader("Content-Length", String(image.data.length));
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(image.data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "failed to read chart" });
    }
  }
);

sessionAnalysisRouter.get(
  "/latest",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const [day, days] = await Promise.all([latestSession(), listSessionDays()]);
      const body: SessionLatestResponse = { day, days };
      res.json(body);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "failed to read sessions" });
    }
  }
);

sessionAnalysisRouter.get(
  "/days",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json({ days: await listSessionDays() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "failed to list sessions" });
    }
  }
);

sessionAnalysisRouter.get(
  "/days/:key",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const day: SessionDay | null = await sessionByKey(String(req.params.key ?? ""));
      if (!day) {
        res.status(404).json({ error: "session not found" });
        return;
      }
      res.json({ day });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "failed to read session" });
    }
  }
);

sessionAnalysisRouter.post(
  "/sync",
  adminRequired,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await syncSessionAnalysis();
      res.status(result.ok ? 200 : 502).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "sync failed" });
    }
  }
);
