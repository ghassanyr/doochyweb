import { Router, type Request, type Response } from "express";

import { adminRequired } from "../auth";
import { syncSessionAnalysis } from "../sessionAnalysis/ingest";
import { listEconomicNews } from "./store";
import type { EconomicNewsResponse } from "./types";

export const economicNewsRouter = Router();

economicNewsRouter.get(
  "/",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const events = await listEconomicNews();
      const latestReceivedAt = events.reduce<string | null>((latest, event) => {
        if (!event.receivedAt) return latest;
        return !latest || event.receivedAt > latest ? event.receivedAt : latest;
      }, null);
      const body: EconomicNewsResponse = { events, latestReceivedAt };
      res.json(body);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "failed to read economic news" });
    }
  }
);

economicNewsRouter.post(
  "/sync",
  adminRequired,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await syncSessionAnalysis();
      res.status(result.ok ? 200 : 502).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "news sync failed" });
    }
  }
);
