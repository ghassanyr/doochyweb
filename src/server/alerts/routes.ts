// Express router for personal price alerts.
//
// Mounted at /api/alerts behind authRequired. Every read and write is scoped to
// the session user; the checker itself runs outside this router so it can see
// every user's active rows.

import { Router, type Response } from "express";

import { authRequired, type AuthedRequest } from "../auth";
import { demoAlerts } from "../demo/fixtures";
import { AlertError, createAlert, deleteAlert, listAlerts, updateAlert } from "./store";
import { validateAlertInput } from "./validate";

export const alertsRouter = Router();

alertsRouter.use(authRequired);

function fail(res: Response, err: unknown): void {
  if (err instanceof AlertError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : "unexpected error" });
}

alertsRouter.get("/", async (req: AuthedRequest, res) => {
  try {
    if (req.demo) {
      res.json(demoAlerts());
      return;
    }
    res.json(await listAlerts(req.userId!));
  } catch (err) {
    fail(res, err);
  }
});

alertsRouter.post("/", async (req: AuthedRequest, res) => {
  try {
    const parsed = validateAlertInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    res.status(201).json({ alert: await createAlert(req.userId!, parsed.value) });
  } catch (err) {
    fail(res, err);
  }
});

alertsRouter.patch("/:id", async (req: AuthedRequest, res) => {
  try {
    const parsed = validateAlertInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    res.json({ alert: await updateAlert(req.userId!, req.params.id, parsed.value) });
  } catch (err) {
    fail(res, err);
  }
});

alertsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  try {
    await deleteAlert(req.userId!, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});
