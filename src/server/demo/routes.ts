import { Router, type Request, type Response } from "express";

import { getSiteSettings } from "../settings/store";
import { ensureDemoUser, issueDemoToken } from "./store";

export const demoRouter = Router();

const buckets = new Map<string, { count: number; resetAt: number }>();

function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size >= 512) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

demoRouter.post("/enter", async (req: Request, res: Response) => {
  try {
    const settings = await getSiteSettings();
    if (!settings.demo.enabled) {
      res.status(403).json({ error: "Demo mode is disabled" });
      return;
    }
    if (!allow(`demo-enter:${req.ip}`, 12, 60_000)) {
      res.status(429).json({ error: "Too many demo requests. Try again shortly." });
      return;
    }
    await ensureDemoUser();
    const session = await issueDemoToken();
    res.json({ ...session, label: settings.demo.label });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to start demo" });
  }
});
