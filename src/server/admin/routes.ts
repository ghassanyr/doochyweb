// Admin-only user management. Mounted at /api/admin by index.ts.
//
// The watchlist stays under /api/market; this router is for account-level
// administration. Every route reads the role from the database, so a demoted
// admin loses access immediately.

import { Router } from "express";

import { adminRequired, type AuthedRequest } from "../auth";
import { deleteUser, listUsers } from "./users";

export const adminRouter = Router();

adminRouter.get("/users", adminRequired, async (_req, res) => {
  try {
    res.json({ users: await listUsers() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to list users" });
  }
});

adminRouter.delete("/users/:id", adminRequired, async (req: AuthedRequest, res) => {
  try {
    const result = await deleteUser(req.params.id, req.userId!);
    if (result === "missing") {
      res.status(404).json({ error: "user not found" });
      return;
    }
    if (result === "self") {
      res.status(400).json({ error: "you cannot delete your own account" });
      return;
    }
    if (result === "last_admin") {
      res.status(409).json({ error: "cannot delete the last admin" });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to delete user" });
  }
});
