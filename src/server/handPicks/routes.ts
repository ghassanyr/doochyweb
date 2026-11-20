// Public reads for Hand Picks plus admin create, edit and delete.
//
// Hand Picks sit inside Analysis, so the mount point applies the Analysis
// module gate and these routes only add the admin guard to writes.

import { Router, type Request, type Response } from "express";

import { adminRequired } from "../auth";
import { enqueueHandPickChanged } from "../telegram/notify";
import {
  HandPickInputError,
  cleanHandPickInput,
  createHandPick,
  deleteHandPick,
  handPickStats,
  listHandPicks,
  updateHandPick,
} from "./store";
import type { HandPick } from "./types";

export const handPicksRouter = Router();

async function notifyPick(pick: HandPick, action: "created" | "updated"): Promise<void> {
  try {
    await enqueueHandPickChanged(pick, action);
  } catch (err) {
    console.error(
      `[telegram] failed to enqueue hand pick notification: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

function failure(res: Response, err: unknown, fallback: string): void {
  if (err instanceof HandPickInputError) {
    res.status(400).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : fallback;
  res.status(500).json({ error: message });
}

handPicksRouter.get("/stats", async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await handPickStats());
  } catch (err) {
    failure(res, err, "failed to read hand pick stats");
  }
});

handPicksRouter.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ picks: await listHandPicks() });
  } catch (err) {
    failure(res, err, "failed to read hand picks");
  }
});

handPicksRouter.post(
  "/",
  adminRequired,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pick = await createHandPick(cleanHandPickInput(req.body));
      await notifyPick(pick, "created");
      res.status(201).json({ pick });
    } catch (err) {
      failure(res, err, "failed to create hand pick");
    }
  }
);

handPicksRouter.patch(
  "/:id",
  adminRequired,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pick = await updateHandPick(
        String(req.params.id ?? ""),
        cleanHandPickInput(req.body)
      );
      if (!pick) {
        res.status(404).json({ error: "hand pick not found" });
        return;
      }
      await notifyPick(pick, "updated");
      res.json({ pick });
    } catch (err) {
      failure(res, err, "failed to update hand pick");
    }
  }
);

handPicksRouter.delete(
  "/:id",
  adminRequired,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const removed = await deleteHandPick(String(req.params.id ?? ""));
      if (!removed) {
        res.status(404).json({ error: "hand pick not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      failure(res, err, "failed to delete hand pick");
    }
  }
);
