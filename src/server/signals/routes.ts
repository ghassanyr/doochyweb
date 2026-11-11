// Express router for the public Signals feed.
//
// Mounted at /api/signals by index.ts. Reads are public: signals are curated
// market commentary, like the watchlist and the breakout feed. Every mutation is
// admin-only; `adminRequired` also attaches the acting username, which the store
// records but never exposes.
//
// Expiry is applied lazily on read (see store.expireDue). The automatic
// target/stop resolver is a separate phase and will use the same lifecycle.

import { Router, type Response } from "express";

import { adminRequired, type AuthedRequest } from "../auth";
import { cachedCatalogFull, resolveMeta, unresolvableError } from "../market/catalog";
import {
  createSignal,
  deleteSignal,
  getSignal,
  invalidateSignal,
  listSignals,
  postUpdate,
  restoreSignal,
  signalStats,
  SignalError,
  updateSignal,
} from "./store";
import { signalPrices } from "./prices";
import { validateSignalInput } from "./validate";
import { enqueueSignalPublished } from "../telegram/notify";

export const signalsRouter = Router();

function sendError(res: Response, err: unknown): void {
  if (err instanceof SignalError) {
    res.status(err.status).json({ error: err.message, ...(err.extra ? { existing: err.extra } : {}) });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : "unexpected error" });
}

/** Reject symbols the market catalog cannot serve, with a useful reason. */
async function checkSymbol(symbol: string): Promise<string | null> {
  const { items, brokerError } = await cachedCatalogFull();
  if (!resolveMeta(symbol, items)) return unresolvableError(symbol, brokerError);
  return null;
}

// ---------------------------------------------------------------- public reads

signalsRouter.get("/", async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "active";
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol.trim() : undefined;
    const direction = typeof req.query.direction === "string" ? req.query.direction : undefined;
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    res.json(await listSignals({ status, symbol, direction, limit, offset }));
  } catch (err) {
    sendError(res, err);
  }
});

signalsRouter.get("/stats", async (_req, res) => {
  try {
    res.json(await signalStats());
  } catch (err) {
    sendError(res, err);
  }
});

signalsRouter.get("/prices", async (req, res) => {
  const raw = typeof req.query.symbols === "string" ? req.query.symbols : "";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    res.json({ prices: await signalPrices(symbols) });
  } catch (err) {
    sendError(res, err);
  }
});

signalsRouter.get("/:id", async (req, res) => {
  try {
    const signal = await getSignal(req.params.id);
    if (!signal) {
      res.status(404).json({ error: "signal not found" });
      return;
    }
    res.json({ signal });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------- admin writes

signalsRouter.post("/", adminRequired, async (req: AuthedRequest, res) => {
  try {
    const parsed = validateSignalInput(req.body, { requireFutureExpiry: true });
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const symbolError = await checkSymbol(parsed.value.symbol);
    if (symbolError) {
      res.status(400).json({ error: symbolError });
      return;
    }
    const force = req.body?.force === true;
    const signal = await createSignal(parsed.value, req.username, { force });

    // Publish-only notifications. Queue before responding so a restart right
    // after the publish cannot lose the alert; a notification failure must not
    // fail the publish itself.
    try {
      await enqueueSignalPublished(signal);
    } catch (err) {
      console.error("[telegram] failed to enqueue publish notification:", err);
    }

    res.status(201).json({ signal });
  } catch (err) {
    sendError(res, err);
  }
});

signalsRouter.patch("/:id", adminRequired, async (req: AuthedRequest, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.symbol === "string" && body.symbol.trim()) {
      const symbolError = await checkSymbol(body.symbol);
      if (symbolError) {
        res.status(400).json({ error: symbolError });
        return;
      }
    }
    const signal = await updateSignal(req.params.id, body, req.username);
    res.json({ signal });
  } catch (err) {
    sendError(res, err);
  }
});

signalsRouter.post("/:id/updates", adminRequired, async (req: AuthedRequest, res) => {
  try {
    const note = typeof req.body?.note === "string" ? req.body.note : "";
    const signal = await postUpdate(req.params.id, note, req.username);
    res.status(201).json({ signal });
  } catch (err) {
    sendError(res, err);
  }
});

signalsRouter.post("/:id/invalidate", adminRequired, async (req: AuthedRequest, res) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    const signal = await invalidateSignal(req.params.id, reason, req.username);
    res.json({ signal });
  } catch (err) {
    sendError(res, err);
  }
});

signalsRouter.post("/:id/restore", adminRequired, async (req: AuthedRequest, res) => {
  try {
    const signal = await restoreSignal(req.params.id, req.username);
    res.json({ signal });
  } catch (err) {
    sendError(res, err);
  }
});

signalsRouter.delete("/:id", adminRequired, async (req, res) => {
  try {
    await deleteSignal(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});
