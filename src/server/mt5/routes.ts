import { Router, type Request, type Response } from "express";

import { authRequired, type AuthedRequest } from "../auth";
import { mt5BrokerAdapter } from "../broker";
import type { BrokerAccountRef } from "../broker/types";
import {
  addMt5Account,
  findMt5Account,
  getMt5Account,
  listMt5Accounts,
  normalizeMt5AccountInput,
  recordMt5AccountHealth,
  removeMt5Account,
  updateMt5AccountPrefs,
} from "./accounts";

export const mt5Router = Router();

mt5Router.use(authRequired);

function refFor(req: AuthedRequest, accountId: string): BrokerAccountRef {
  return { userId: req.userId!, broker: "mt5", accountId, mode: "demo" };
}

async function read<T>(
  req: AuthedRequest,
  res: Response,
  accountId: string,
  load: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    const value = await load();
    await recordMt5AccountHealth(req.userId!, accountId, { ok: true });
    return { ok: true, value };
  } catch (err: any) {
    const message = err?.message ?? "MT5 bridge read failed";
    await recordMt5AccountHealth(req.userId!, accountId, { ok: false, error: message }).catch(() => {});
    res.status(502).json({ error: message });
    return { ok: false };
  }
}

mt5Router.get("/accounts", async (req: AuthedRequest, res: Response) => {
  try {
    res.json({ accounts: await listMt5Accounts(req.userId!) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to list MT5 accounts" });
  }
});

mt5Router.post("/accounts", async (req: AuthedRequest, res: Response) => {
  const parsed = normalizeMt5AccountInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const account = await addMt5Account(req.userId!, parsed.value);
    res.status(201).json({ account });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to save MT5 account" });
  }
});

mt5Router.put("/accounts/:id/prefs", async (req: AuthedRequest, res: Response) => {
  try {
    const nickname = req.body?.nickname == null ? undefined : String(req.body.nickname);
    const color = req.body?.color === undefined ? undefined : req.body.color == null ? null : String(req.body.color);
    if (nickname !== undefined && nickname.length > 40) {
      res.status(400).json({ error: "nickname must be 40 characters or fewer" });
      return;
    }
    if (color != null && !["blue", "green", "red", "amber", "violet", "teal"].includes(color)) {
      res.status(400).json({ error: "invalid colour" });
      return;
    }
    const account = await updateMt5AccountPrefs(req.userId!, req.params.id, { nickname, color });
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    res.json({ account });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to save account preferences" });
  }
});

mt5Router.delete("/accounts/:id", async (req: AuthedRequest, res: Response) => {
  try {
    const removed = await removeMt5Account(req.userId!, req.params.id);
    if (!removed) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to remove MT5 account" });
  }
});

mt5Router.get("/accounts/:id/positions", async (req: AuthedRequest, res: Response) => {
  const account = await getMt5Account(req.userId!, req.params.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }
  const result = await read(req, res, account.id, () => mt5BrokerAdapter.reconcile(refFor(req, account.id)));
  if (result.ok) res.json({ positions: result.value.positions });
});

mt5Router.get("/accounts/:id/orders", async (req: AuthedRequest, res: Response) => {
  const account = await getMt5Account(req.userId!, req.params.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }
  const result = await read(req, res, account.id, () => mt5BrokerAdapter.reconcile(refFor(req, account.id)));
  if (result.ok) res.json({ orders: result.value.orders });
});

mt5Router.get("/accounts/:id/history", async (req: AuthedRequest, res: Response) => {
  const account = await getMt5Account(req.userId!, req.params.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }
  const result = await read(req, res, account.id, () =>
    mt5BrokerAdapter.fetchHistory(refFor(req, account.id), Number(req.query.days))
  );
  if (result.ok) res.json(result.value);
});

mt5Router.get("/accounts/:id/symbols", async (req: AuthedRequest, res: Response) => {
  const account = await getMt5Account(req.userId!, req.params.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }
  const symbols = await read(req, res, account.id, () =>
    mt5BrokerAdapter.listSymbolNames(refFor(req, account.id))
  );
  if (symbols.ok) res.json({ symbols: [...symbols.value].sort((a, b) => a.localeCompare(b)) });
});

mt5Router.get("/accounts/:id/quote", async (req: AuthedRequest, res: Response) => {
  const account = await getMt5Account(req.userId!, req.params.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }
  const symbol = String(req.query.symbol ?? "").trim();
  if (!symbol) {
    res.status(400).json({ error: "symbol is required" });
    return;
  }
  const quote = await read(req, res, account.id, () =>
    mt5BrokerAdapter.quote(refFor(req, account.id), symbol)
  );
  if (quote.ok) res.json({ quote: quote.value });
});

mt5Router.get("/accounts/:id", async (req: AuthedRequest, res: Response) => {
  try {
    const account = await getMt5Account(req.userId!, req.params.id);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    res.json({ account });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to load MT5 account" });
  }
});

export async function mt5AccountExists(userId: string, accountId: string): Promise<boolean> {
  return (await findMt5Account(userId, accountId)) != null;
}
