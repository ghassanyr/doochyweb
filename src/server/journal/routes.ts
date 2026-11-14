// Express router for the personal Trade Journal.
//
// Mounted at /api/journal behind authRequired. Every query is scoped to the
// session user, so one member can never read or change another member's log.
// CSV export uses the same filters as the list and is declared before /:id.

import { Router, type Response } from "express";

import { authRequired, type AuthedRequest } from "../auth";
import { journalCsv } from "./validate";
import {
  createJournalEntry,
  deleteJournalEntry,
  importCtraderHistory,
  JournalError,
  listJournal,
  updateJournalEntry,
} from "./store";
import { validateJournalInput } from "./validate";

export const journalRouter = Router();

journalRouter.use(authRequired);

function fail(res: Response, err: unknown): void {
  if (err instanceof JournalError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : "unexpected error" });
}

function queryFilters(req: AuthedRequest) {
  return {
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    source: typeof req.query.source === "string" ? req.query.source : undefined,
    symbol: typeof req.query.symbol === "string" ? req.query.symbol.trim() : undefined,
  };
}

journalRouter.get("/", async (req: AuthedRequest, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    res.json(await listJournal(req.userId!, { ...queryFilters(req), limit, offset }));
  } catch (err) {
    fail(res, err);
  }
});

journalRouter.get("/export", async (req: AuthedRequest, res) => {
  try {
    const result = await listJournal(req.userId!, {
      ...queryFilters(req),
      limit: 200,
      offset: 0,
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="doochy-journal.csv"');
    res.send(journalCsv(result.entries as unknown as Record<string, unknown>[]));
  } catch (err) {
    fail(res, err);
  }
});

journalRouter.post("/", async (req: AuthedRequest, res) => {
  try {
    const parsed = validateJournalInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    res.status(201).json({ entry: await createJournalEntry(req.userId!, parsed.value) });
  } catch (err) {
    fail(res, err);
  }
});

journalRouter.post("/import", async (req: AuthedRequest, res) => {
  try {
    const ctid = Number(req.body?.ctid);
    if (!Number.isFinite(ctid) || ctid <= 0) {
      res.status(400).json({ error: "invalid account id" });
      return;
    }
    const days = Number(req.body?.days) || 7;
    res.json(await importCtraderHistory(req.userId!, ctid, days));
  } catch (err) {
    if (err instanceof JournalError) {
      fail(res, err);
      return;
    }
    // Broker failures are upstream errors, not journal validation errors.
    res.status(502).json({ error: err instanceof Error ? err.message : "import failed" });
  }
});

journalRouter.patch("/:id", async (req: AuthedRequest, res) => {
  try {
    const parsed = validateJournalInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    res.json({ entry: await updateJournalEntry(req.userId!, req.params.id, parsed.value) });
  } catch (err) {
    fail(res, err);
  }
});

journalRouter.delete("/:id", async (req: AuthedRequest, res) => {
  try {
    await deleteJournalEntry(req.userId!, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});
