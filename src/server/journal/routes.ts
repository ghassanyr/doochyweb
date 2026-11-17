// Express router for the personal Trade Journal.
//
// Mounted at /api/journal behind authRequired. Every query is scoped to the
// session user, so one member can never read or change another member's log.
// CSV export uses the same filters as the list and is declared before /:id.

import { Router, type Response } from "express";

import { authRequired, type AuthedRequest } from "../auth";
import { demoJournalList } from "../demo/fixtures";
import { journalCsv } from "./validate";
import {
  createJournalEntry,
  deleteJournalEntry,
  JournalError,
  listJournal,
  updateJournalEntry,
  updateJournalNote,
} from "./store";
import { syncUserJournal } from "./sync";
import { validateJournalInput } from "./validate";

const MAX_NOTE = 2000;

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
    if (req.demo) {
      res.json(demoJournalList({ ...queryFilters(req), limit, offset }));
      return;
    }
    res.json(await listJournal(req.userId!, { ...queryFilters(req), limit, offset }));
    // Keep the journal current without a button. The sync backs off on its own
    // after a recent run, and the response is already sent, so a slow broker
    // never delays the page.
    void syncUserJournal(req.userId!).catch((err) => {
      console.error(`[journal] sync after read failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  } catch (err) {
    fail(res, err);
  }
});

journalRouter.get("/export", async (req: AuthedRequest, res) => {
  try {
    const result = req.demo
      ? demoJournalList({ ...queryFilters(req), limit: 200, offset: 0 })
      : await listJournal(req.userId!, {
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

journalRouter.patch("/:id/note", async (req: AuthedRequest, res) => {
  try {
    const raw = req.body?.note;
    if (typeof raw !== "string") {
      res.status(400).json({ error: "note must be text" });
      return;
    }
    const note = raw.trim().slice(0, MAX_NOTE);
    res.json({ entry: await updateJournalNote(req.userId!, req.params.id, note) });
  } catch (err) {
    fail(res, err);
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
