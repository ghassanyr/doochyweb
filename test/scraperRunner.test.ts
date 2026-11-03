import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  appendCapture, captureMessage, loadState, nextRunAt, saveState, stateFile, type ScraperState,
} from "../src/server/market/scraperRunner";
import type { CapturePayload, Obs } from "../src/server/market/scraperRules";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "scraper-"));

const capture = (ts: string): CapturePayload => ({
  timestamp_utc: ts, session: "hourly", capture_type: "lightweight", market_count: 0,
  changes: [], true_alignments: { engulf_1h_4h: [], triple: [] }, needles_fired: [],
  summary: { strong_buy: 0, strong_sell: 0, engulf_alignments: 0, triple_alignments: 0 },
  next_check_utc: "2026-11-03T13:00:00Z",
});

describe("scraper runner persistence", () => {
  test("state round-trips", () => {
    const dir = tmp();
    const file = path.join(dir, "state.json");
    const s: ScraperState = {
      version: 1, lastRunUtc: "2026-11-03T11:58:00.000Z", obs: [], firedDate: "2026-11-03", fired: ["XAUUSD:ny:2026-11-03:engulf_1h_4h"],
    };
    saveState(s, file);
    assert.deepEqual(loadState(file), s);
  });

  test("missing state file reads as empty", () => {
    const s = loadState(path.join(tmp(), "nope.json"));
    assert.equal(s.lastRunUtc, null);
    assert.deepEqual(s.obs, []);
    assert.deepEqual(s.fired, []);
  });

  test("stateFile honours the override", () => {
    const prev = process.env.SCRAPER_STATE_FILE;
    process.env.SCRAPER_STATE_FILE = "/tmp/x/state.json";
    try { assert.equal(stateFile(), "/tmp/x/state.json"); }
    finally { if (prev === undefined) delete process.env.SCRAPER_STATE_FILE; else process.env.SCRAPER_STATE_FILE = prev; }
  });

  test("appendCapture separates a file that lacks a trailing newline", () => {
    const file = path.join(tmp(), "caps.json");
    fs.writeFileSync(file, JSON.stringify(capture("2026-11-03T10:00:00.000Z"))); // no newline
    appendCapture(capture("2026-11-03T11:00:00.000Z"), file);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]).timestamp_utc, "2026-11-03T11:00:00.000Z");
  });

  test("appendCapture creates the file and its directory", () => {
    const file = path.join(tmp(), "nested", "caps.json");
    appendCapture(capture("2026-11-03T11:00:00.000Z"), file);
    assert.equal(fs.readFileSync(file, "utf8").trim().split("\n").length, 1);
  });

  test("nextRunAt is HH:02 UTC", () => {
    assert.equal(new Date(nextRunAt(Date.UTC(2026, 10, 3, 11, 58))).toISOString(), "2026-11-03T12:02:00.000Z");
    assert.equal(new Date(nextRunAt(Date.UTC(2026, 10, 3, 12, 1, 30))).toISOString(), "2026-11-03T12:02:00.000Z");
    assert.equal(new Date(nextRunAt(Date.UTC(2026, 10, 3, 12, 2))).toISOString(), "2026-11-03T13:02:00.000Z");
  });

  test("notifications are one message per run", () => {
    const quiet = capture("2026-11-03T11:00:00.000Z");
    assert.equal(captureMessage(quiet, new Map()), null, "quiet hourly capture is silent");

    const full = { ...quiet, capture_type: "full" as const, session: "4h_close" };
    const fullMsg = captureMessage(full, new Map());
    assert.ok(fullMsg?.startsWith("Doochy 4h_close capture 11:00 UTC (full)"));

    const nd = {
      ...full,
      needles_fired: [
        { symbol: "XAUUSD", kind: "triple" as const, level: "Strong Sell", key: "XAUUSD:4h_close:2026-11-03:triple" },
        { symbol: "EURUSD", kind: "engulf_1h_4h" as const, level: "Buy", key: "EURUSD:4h_close:2026-11-03:engulf_1h_4h" },
      ],
    };
    const obs = new Map<string, Obs>([
      ["XAUUSD", { symbol: "XAUUSD", category: "commodity", price: 4012.5 } as Obs],
      ["EURUSD", { symbol: "EURUSD", category: "forex", price: 1.0876 } as Obs],
    ]);
    const msg = captureMessage(nd, obs);
    assert.ok(msg);
    assert.equal((msg.match(/NEEDLES/g) ?? []).length, 1, "needles are bundled");
    assert.ok(msg.includes("XAUUSD triple | Strong Sell | 4012.5"));
    assert.ok(msg.includes("EURUSD 1H+4H engulf | Buy | 1.0876"));
  });
});
