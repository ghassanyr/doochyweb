// Express router for paper trading.
//
// Mounted at /api/simulation behind authRequired and the Trading module gate.
// Every row belongs to the session user. Reads re-mark open positions with the
// current price so the table is never stale, and the write routes re-check
// ownership before touching a position.

import { Router, type Response } from "express";

import { authRequired, type AuthedRequest } from "../auth";
import { signalPrices } from "../signals/prices";
import {
  closePaperPosition,
  deletePaperPosition,
  listPaperPositions,
  openPaperPosition,
  PaperError,
  paperPrice,
} from "./store";
import { computePaperAccount, validatePaperInput } from "./validate";

export const simulationRouter = Router();

simulationRouter.use(authRequired);

function fail(res: Response, err: unknown): void {
  if (err instanceof PaperError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : "unexpected error" });
}

simulationRouter.get("/", async (req: AuthedRequest, res) => {
  try {
    const positions = await listPaperPositions(req.userId!);
    const symbols = [
      ...new Set(positions.filter((row) => row.status === "open").map((row) => row.symbol)),
    ];

    let marks: Record<string, number> = {};
    if (symbols.length) {
      const points = await signalPrices(symbols).catch(
        () => ({}) as Record<string, { price: number }>
      );
      marks = Object.fromEntries(
        Object.entries(points)
          .filter(([, point]) => point && Number.isFinite(point.price))
          .map(([symbol, point]) => [symbol, point.price])
      );
    }

    const open = positions
      .filter((row) => row.status === "open")
      .map((row) => ({ ...row, lastPrice: marks[row.symbol] ?? row.lastPrice }));
    const closed = positions.filter((row) => row.status === "closed").slice(0, 100);

    res.json({
      account: computePaperAccount(positions, marks),
      open,
      closed,
    });
  } catch (err) {
    fail(res, err);
  }
});

simulationRouter.post("/", async (req: AuthedRequest, res) => {
  try {
    const parsed = validatePaperInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    res.status(201).json({ position: await openPaperPosition(req.userId!, parsed.value) });
  } catch (err) {
    fail(res, err);
  }
});

simulationRouter.post("/:id/close", async (req: AuthedRequest, res) => {
  try {
    const rows = await listPaperPositions(req.userId!);
    const target = rows.find((row) => row.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: "position not found" });
      return;
    }
    if (target.status !== "open") {
      res.status(400).json({ error: "position is already closed" });
      return;
    }
    const price = await paperPrice(target.symbol);
    if (price == null) {
      res.status(400).json({ error: `No market price for ${target.symbol} right now.` });
      return;
    }
    res.json({ position: await closePaperPosition(req.userId!, target.id, price, "manual") });
  } catch (err) {
    fail(res, err);
  }
});

simulationRouter.delete("/:id", async (req: AuthedRequest, res) => {
  try {
    await deletePaperPosition(req.userId!, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});
