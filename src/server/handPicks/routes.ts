// Public reads for Hand Picks plus admin create, edit and delete.
//
// Hand Picks sit inside Analysis, so the mount point applies the Analysis
// module gate and these routes only add the admin guard to writes.

import { Router, type Request, type Response } from "express";

import { adminRequired } from "../auth";
import {
  HandPickInputError,
  cleanHandPickInput,
  createHandPick,
  deleteHandPick,
  listHandPicks,
  updateHandPick,
} from "./store";

export const handPicksRouter = Router();

function failure(res: Response, err: unknown, fallback: string): void {
  if (err instanceof HandPickInputError) {
    res.status(400).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : fallback;
  res.status(500).json({ error: message });
}

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
