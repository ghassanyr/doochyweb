import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Candle } from "../src/server/market/types";
import {
  escapeHtml,
  previewWindow,
  renderPreviewHtml,
  scalePreviewY,
} from "../src/server/trainer/preview";
import type { ReviewRow } from "../src/server/trainer/types";

function makeRow(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: "BTC:15m:sweep_up:55-60:down",
    symbol: "BTC",
    timeframe: "15m",
    cutIndex: 60,
    tag: "sweep_up",
    family: "liquidity",
    direction: "down",
    startIndex: 55,
    endIndex: 60,
    status: "pending",
    ambiguity: null,
    levelUpper: 101,
    levelLower: 99,
    neckline: null,
    notes: "shortlist row",
    ...overrides,
  };
}

function makeBars(count: number, base = 100): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    time: index * 900,
    open: base + index * 0.1,
    high: base + index * 0.1 + 1,
    low: base + index * 0.1 - 1,
    close: base + index * 0.1 + 0.2,
    volume: 10,
  }));
}

describe("trainer preview", () => {
  test("escapes all CSV text", () => {
    assert.equal(
      escapeHtml(`<script>&"'`),
      "&lt;script&gt;&amp;&quot;&#39;"
    );
    const html = renderPreviewHtml(
      [makeRow({ notes: '<img src=x onerror="alert(1)">' })],
      { "BTC:15m": makeBars(80) },
      { context: 20 }
    );
    assert.equal(html.includes('<img src=x onerror="alert(1)">'), false);
    assert.equal(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), true);
  });

  test("scales and clamps SVG prices", () => {
    assert.equal(scalePreviewY(200, 100, 200, 100, 10), 10);
    assert.equal(scalePreviewY(100, 100, 200, 100, 10), 110);
    assert.equal(scalePreviewY(300, 100, 200, 100, 10), 10);
    assert.equal(scalePreviewY(0, 100, 200, 100, 10), 110);
    assert.equal(scalePreviewY(150, 100, 200, 100, 0), 50);
    assert.equal(scalePreviewY(100, 100, 100, 100, 0), 50);
  });

  test("never renders an index after the cut bar", () => {
    const bars = makeBars(200);
    bars[61] = { ...bars[61], high: 999999, low: 999998 };
    const row = makeRow({ startIndex: 55, endIndex: 60, cutIndex: 60 });
    const html = renderPreviewHtml([row], { "BTC:15m": bars }, { context: 20 });
    const candles = html.match(/class="candle /g) ?? [];

    assert.equal(candles.length, 20);
    assert.equal(html.includes("999999"), false);
  });

  test("includes the bounds and respects the context size", () => {
    const window = previewWindow(55, 60, 200, 20);
    assert.equal(window.startIndex, 41);
    assert.equal(window.endIndex, 60);
    assert.ok(window.startIndex <= 55);
    assert.ok(window.endIndex >= 60);
    assert.equal(previewWindow(3, 60, 200, 20).startIndex, 0);
    assert.equal(previewWindow(55, 60, 50, 20).endIndex, 49);
  });

  test("is deterministic", () => {
    const rows = [
      makeRow(),
      makeRow({
        id: "ETH:1h:bos:20-25:up",
        symbol: "ETH",
        timeframe: "1h",
        tag: "bos",
        family: "structure",
        direction: "up",
        startIndex: 20,
        endIndex: 25,
        cutIndex: 25,
        levelUpper: 2500,
        levelLower: null,
      }),
    ];
    const bars = { "BTC:15m": makeBars(80), "ETH:1h": makeBars(80, 2500) };
    assert.equal(
      renderPreviewHtml(rows, bars, { context: 30 }),
      renderPreviewHtml(rows, bars, { context: 30 })
    );
  });

  test("renders a placeholder when bars are missing", () => {
    const html = renderPreviewHtml([makeRow()], {}, { context: 20 });
    assert.equal(html.includes("No stored bars for BTC:15m."), true);
    assert.equal(html.includes('<svg class="chart"'), false);
  });
});
