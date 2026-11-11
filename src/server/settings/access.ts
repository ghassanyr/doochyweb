// Access gates for maintenance mode and per-module visibility.
//
// The client hides locked tabs and shows a sign-in prompt, but these gates are
// the real boundary: a direct API call must not bypass a signed-in-only module
// or an active maintenance window.

import type { NextFunction, Response } from "express";

import { isAdminUser, tokenUserId, type AuthedRequest } from "../auth";
import { getSiteSettings } from "./store";
import type { ModuleKey } from "./types";

function signInRequired(res: Response): void {
  res.status(401).json({ error: "sign in to use this module" });
}

/** Reject anonymous callers when `key` is configured as signed-in only. */
export function moduleGate(key: ModuleKey) {
  return async function gate(
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const settings = await getSiteSettings();
      const module = settings.navigation.modules.find((item) => item.key === key);
      if (!module || module.access === "public") {
        next();
        return;
      }
      if (!tokenUserId(req)) {
        signInRequired(res);
        return;
      }
      next();
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "failed to read site access rules" });
    }
  };
}

/**
 * The market router serves both Analysis and Breakouts, so it only requires a
 * session when both tabs are signed-in only.
 */
export async function marketGate(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const settings = await getSiteSettings();
    const access = (key: ModuleKey) =>
      settings.navigation.modules.find((item) => item.key === key)?.access ?? "public";
    if (
      access("analysis") === "signed-in" &&
      access("breakouts") === "signed-in" &&
      !tokenUserId(req)
    ) {
      signInRequired(res);
      return;
    }
    next();
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to read site access rules" });
  }
}

/** 503 every non-admin request while maintenance is on. */
export async function maintenanceGate(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const settings = await getSiteSettings();
    if (!settings.maintenance.enabled) {
      next();
      return;
    }
    if (settings.maintenance.allowAdmins && (await isAdminUser(tokenUserId(req)))) {
      next();
      return;
    }
    res.status(503).json({
      error: "maintenance",
      maintenance: { message: settings.maintenance.message },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to read maintenance settings" });
  }
}
