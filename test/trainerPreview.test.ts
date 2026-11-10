import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Candle } from "../src/server/market/types";
import {
  escapeHtml,
  previewWindow,
  renderPreviewHtml,
  scalePreviewY,
  zoomWindow,
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

  test("renders context and zoom charts without an index after the cut bar", () => {
    const bars = makeBars(200);
    bars[61] = { ...bars[61], high: 999999, low: 999998 };
    const row = makeRow({ startIndex: 55, endIndex: 60, cutIndex: 60 });
    const html = renderPreviewHtml([row], { "BTC:15m": bars }, { context: 20 });
    const candles = html.match(/class="candle /g) ?? [];

    assert.equal(candles.length, 32);
    assert.equal(html.match(/<svg class="chart/g)?.length, 2);
    assert.equal(html.includes('class="chart chart-zoom"'), true);
    assert.equal(html.includes("Pattern zoom"), true);
    assert.equal(html.includes("999999"), false);
    assert.equal(html.includes('class="pattern"'), false);
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

  test("zoom keeps every anchor visible and never crosses the cut", () => {
    const window = zoomWindow([10, 22, 30], 30, 200, 12, 3);
    assert.equal(window.startIndex, 7);
    assert.equal(window.endIndex, 30);
    assert.ok(window.startIndex <= 10);
    assert.ok(window.endIndex >= 30);

    const nearCut = zoomWindow([28, 30], 30, 200, 12, 3);
    assert.equal(nearCut.endIndex, 30);
    assert.equal(nearCut.startIndex, 19);
    assert.equal(nearCut.endIndex - nearCut.startIndex + 1, 12);
  });

  test("marks sweep anchors and highlights the pattern bars", () => {
    const html = renderPreviewHtml(
      [makeRow()],
      { "BTC:15m": makeBars(80) },
      { context: 20 }
    );
    assert.match(html, /annotation-marker sweep/);
    assert.match(html, /annotation-marker swing/);
    assert.match(html, /annotation-line level/);
    assert.match(html, /class="candle up highlight"|class="candle down highlight"/);
  });

  test("draws diagonal BOS trend lines from the shared structure read", () => {
    const bars = makeBars(40, 100);
    bars[10] = { ...bars[10], high: 102, low: 99 };
    bars[14] = { ...bars[14], high: 104, low: 100 };
    bars[18] = { ...bars[18], high: 103, low: 101 };
    bars[22] = { ...bars[22], high: 106, low: 102 };
    bars[30] = { ...bars[30], open: 103, high: 110, low: 102, close: 110 };
    const row = makeRow({
      id: "BTC:15m:bos:22-30:up",
      tag: "bos",
      family: "structure",
      direction: "up",
      startIndex: 22,
      endIndex: 30,
      cutIndex: 30,
      levelUpper: 106,
      levelLower: null,
    });
    const html = renderPreviewHtml([row], { "BTC:15m": bars }, { context: 20 });
    const trend = html.match(
      /<g class="annotation-line trend highlight"><line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/
    );

    assert.ok(trend);
    assert.notEqual(trend[2], trend[4]);
    assert.match(html, /annotation-marker break/);
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
