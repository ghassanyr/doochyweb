// Crawler and install metadata derived from the admin-edited site settings.
//
// These routes live at the site root so search engines and browsers find them
// without a build step. They stay public and follow the same origin fallback as
// cTrader callbacks and outbound mail.

import { Router, type Request } from "express";

import { publicBaseUrlFor } from "./siteUrl";
import { getSiteSettings } from "./store";
import type { SiteSettings } from "./types";

export const siteMetaRouter = Router();

function requestOrigin(req: Request): string | null {
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : null;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function canonicalBase(settings: SiteSettings, base: string | null): string | null {
  const custom = settings.seo.canonicalUrl.trim();
  if (custom) {
    try {
      return new URL(custom).origin;
    } catch {
      // Fall through to the resolved site origin.
    }
  }
  return base;
}

const PUBLIC_PATHS = [
  "/",
  "/analysis",
  "/signals",
  "/breakouts",
  "/learn",
  "/legal",
  "/terms",
  "/privacy",
  "/cookies",
];

siteMetaRouter.get("/robots.txt", async (req, res) => {
  try {
    const settings = await getSiteSettings();
    const base = canonicalBase(settings, publicBaseUrlFor(settings, process.env, requestOrigin(req)));
    const lines = ["User-agent: *"];
    if (settings.seo.noindex) {
      lines.push("Disallow: /");
    } else {
      lines.push("Allow: /");
      lines.push("Disallow: /api/", "Disallow: /admin", "Disallow: /settings", "Disallow: /trading");
      if (base) lines.push("", `Sitemap: ${base}/sitemap.xml`);
    }
    res.set("Cache-Control", "no-store");
    res.type("text/plain").send(`${lines.join("\n")}\n`);
  } catch {
    res.status(500).type("text/plain").send("User-agent: *\nDisallow: /\n");
  }
});

siteMetaRouter.get("/sitemap.xml", async (req, res) => {
  try {
    const settings = await getSiteSettings();
    const base = canonicalBase(settings, publicBaseUrlFor(settings, process.env, requestOrigin(req)));
    if (!base || settings.seo.noindex) {
      res.status(404).type("text/plain").send("Sitemap disabled\n");
      return;
    }
    const urls = PUBLIC_PATHS.map(
      (path) => `  <url><loc>${escapeXml(new URL(path, base).toString())}</loc></url>`
    );
    res.set("Cache-Control", "no-store");
    res.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`
    );
  } catch {
    res.status(500).type("text/plain").send("Sitemap unavailable\n");
  }
});

siteMetaRouter.get("/manifest.webmanifest", async (req, res) => {
  try {
    const settings = await getSiteSettings();
    const base = canonicalBase(settings, publicBaseUrlFor(settings, process.env, requestOrigin(req)));
    if (!settings.pwa.enabled || !base) {
      res.status(404).json({ error: "manifest disabled" });
      return;
    }
    const name = settings.branding.name.trim() || "Doochy";
    const shortName = settings.pwa.shortName.trim() || name;
    const description =
      settings.seo.description.trim() ||
      settings.branding.description.trim() ||
      settings.branding.tagline.trim();
    const icon = (size: number) => new URL(`/doochy-mark-${size}.png`, base).toString();
    res.set("Cache-Control", "no-store");
    res.type("application/manifest+json").send(
      JSON.stringify({
        name,
        short_name: shortName,
        description,
        start_url: "/",
        scope: "/",
        display: settings.pwa.display,
        background_color: settings.pwa.backgroundColor,
        theme_color: settings.pwa.themeColor,
        icons: [
          { src: icon(192), sizes: "192x192", type: "image/png" },
          { src: icon(512), sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      })
    );
  } catch {
    res.status(500).json({ error: "manifest unavailable" });
  }
});
