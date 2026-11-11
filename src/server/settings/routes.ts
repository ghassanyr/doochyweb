// Public site configuration. Mounted at /api/config by index.ts.
//
// Every visitor needs the branding and theme before they sign in, so this
// endpoint is deliberately unauthenticated. It only returns the presentation
// subset: no user data, no integration secrets, no audit fields.

import { Router } from "express";

import { getSiteSettings, publicSiteConfig } from "./store";

export const siteConfigRouter = Router();

siteConfigRouter.get("/", async (_req, res) => {
  try {
    const settings = await getSiteSettings();
    // Admin saves must be visible on the next request, including through a
    // proxy cache, so do not store the response.
    res.set("Cache-Control", "no-store");
    res.json(publicSiteConfig(settings));
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to load site config" });
  }
});
