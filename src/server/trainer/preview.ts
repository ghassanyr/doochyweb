import type { Candle } from "../market/types";
import type { ReviewRow } from "./types";

export const PREVIEW_CONTEXT_DEFAULT = 120;
export const PREVIEW_PADDING = 10;

export interface PreviewWindow {
  startIndex: number;
  endIndex: number;
}

export interface PreviewOptions {
  context?: number;
}

export type PreviewBarsBySeries = Readonly<
  Record<string, readonly Candle[] | null | undefined>
>;

const SVG_WIDTH = 960;
const SVG_HEIGHT = 300;
const SVG_TOP = 24;
const SVG_BOTTOM = 40;
const SVG_LEFT = 64;
const SVG_RIGHT = 92;

export function escapeHtml(value: unknown): string {
  const text = value == null ? "" : String(value);
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function previewWindow(
  startIndex: number,
  cutIndex: number,
  barCount: number,
  context: number = PREVIEW_CONTEXT_DEFAULT,
  padding: number = PREVIEW_PADDING
): PreviewWindow {
  if (!Number.isInteger(context) || context < 1) {
    throw new Error("context must be a positive integer");
  }
  if (!Number.isInteger(padding) || padding < 0) {
    throw new Error("padding must be a non-negative integer");
  }
  if (barCount <= 0) return { startIndex: 0, endIndex: -1 };

  const safeCut = Math.max(0, Math.min(cutIndex, barCount - 1));
  const contextStart = safeCut - context + 1;
  const paddedStart = Math.max(0, startIndex - padding);
  const start = Math.max(0, Math.min(contextStart, paddedStart));

  return { startIndex: start, endIndex: safeCut };
}

export function scalePreviewY(
  price: number,
  min: number,
  max: number,
  height: number,
  top: number = 0
): number {
  if (!Number.isFinite(height) || !Number.isFinite(top)) return 0;
  const span = max - min;
  if (!Number.isFinite(price) || !Number.isFinite(span) || span <= 0) {
    return top + height / 2;
  }
  const ratio = Math.max(0, Math.min(1, (max - price) / span));
  return top + ratio * height;
}

function seriesKey(row: ReviewRow): string {
  return `${row.symbol}:${row.timeframe}`;
}

function formatPrice(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(4);
  if (abs >= 0.01) return value.toFixed(6);
  return value.toPrecision(4);
}

function formatCell(value: unknown): string {
  return value == null || value === "" ? "—" : `${value}`;
}

function priceRange(
  bars: readonly Candle[],
  row: ReviewRow
): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const bar of bars) {
    if (Number.isFinite(bar.low)) min = Math.min(min, bar.low);
    if (Number.isFinite(bar.high)) max = Math.max(max, bar.high);
  }

  for (const level of [row.levelUpper, row.levelLower, row.neckline]) {
    if (level == null || !Number.isFinite(level)) continue;
    min = Math.min(min, level);
    max = Math.max(max, level);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.01, 1);
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.06;
  return { min: min - pad, max: max + pad };
}

function levelMarkup(row: ReviewRow, min: number, max: number): string {
  const plotHeight = SVG_HEIGHT - SVG_TOP - SVG_BOTTOM;
  const x1 = SVG_LEFT;
  const x2 = SVG_WIDTH - SVG_RIGHT;
  const levels: { label: string; value: number; cls: string }[] = [];
  if (row.levelUpper != null) {
    levels.push({ label: "upper", value: row.levelUpper, cls: "level-upper" });
  }
  if (row.levelLower != null) {
    levels.push({ label: "lower", value: row.levelLower, cls: "level-lower" });
  }
  if (row.neckline != null) {
    levels.push({ label: "neckline", value: row.neckline, cls: "level-neckline" });
  }

  return levels
    .map(({ label, value, cls }) => {
      const y = scalePreviewY(value, min, max, plotHeight, SVG_TOP);
      return (
        `<g class="${cls}">` +
        `<line x1="${x1}" y1="${y.toFixed(2)}" x2="${x2}" y2="${y.toFixed(2)}"/>` +
        `<text x="${x2 + 5}" y="${(y + 3).toFixed(2)}">${label} ${formatPrice(value)}</text>` +
        `</g>`
      );
    })
    .join("");
}

function renderSvg(
  row: ReviewRow,
  bars: readonly Candle[],
  window: PreviewWindow
): string {
  const visible = bars.slice(window.startIndex, window.endIndex + 1);
  const { min, max } = priceRange(visible, row);
  const plotWidth = SVG_WIDTH - SVG_LEFT - SVG_RIGHT;
  const plotHeight = SVG_HEIGHT - SVG_TOP - SVG_BOTTOM;
  const slot = plotWidth / Math.max(1, visible.length);
  const bodyWidth = Math.max(1.5, Math.min(10, slot * 0.62));
  const barIndex = (index: number): number =>
    SVG_LEFT + (index - window.startIndex + 0.5) * slot;

  const clippedStart = Math.max(window.startIndex, row.startIndex);
  const clippedEnd = Math.min(window.endIndex, row.endIndex);
  let bounds = "";
  if (clippedStart <= clippedEnd) {
    const x = SVG_LEFT + (clippedStart - window.startIndex) * slot;
    const width = Math.max(slot, (clippedEnd - clippedStart + 1) * slot);
    bounds =
      `<rect class="pattern" x="${x.toFixed(2)}" y="${SVG_TOP}" ` +
      `width="${width.toFixed(2)}" height="${plotHeight}"/>` +
      `<text class="pattern-label" x="${(x + 4).toFixed(2)}" ` +
      `y="${SVG_TOP + 13}">pattern</text>`;
  }

  const candles = visible
    .map((bar, offset) => {
      const index = window.startIndex + offset;
      const x = barIndex(index);
      const openY = scalePreviewY(bar.open, min, max, plotHeight, SVG_TOP);
      const closeY = scalePreviewY(bar.close, min, max, plotHeight, SVG_TOP);
      const highY = scalePreviewY(bar.high, min, max, plotHeight, SVG_TOP);
      const lowY = scalePreviewY(bar.low, min, max, plotHeight, SVG_TOP);
      const top = Math.min(openY, closeY);
      const height = Math.max(1, Math.abs(closeY - openY));
      const cls = bar.close >= bar.open ? "up" : "down";
      return (
        `<g class="candle ${cls}">` +
        `<line x1="${x.toFixed(2)}" y1="${highY.toFixed(2)}" ` +
        `x2="${x.toFixed(2)}" y2="${lowY.toFixed(2)}"/>` +
        `<rect x="${(x - bodyWidth / 2).toFixed(2)}" y="${top.toFixed(2)}" ` +
        `width="${bodyWidth.toFixed(2)}" height="${height.toFixed(2)}"/>` +
        `</g>`
      );
    })
    .join("");

  const cutX = barIndex(row.cutIndex);
  const cut =
    row.cutIndex >= window.startIndex && row.cutIndex <= window.endIndex
      ? `<line class="cut-line" x1="${cutX.toFixed(2)}" y1="${SVG_TOP}" ` +
        `x2="${cutX.toFixed(2)}" y2="${SVG_TOP + plotHeight}"/>` +
        `<text class="cut-label" x="${(cutX + 4).toFixed(2)}" ` +
        `y="${SVG_TOP + 27}">cut</text>`
      : "";

  return (
    `<svg class="chart" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" ` +
    `role="img" aria-label="${escapeHtml(`${seriesKey(row)} ${row.tag} preview`)}">` +
    `<rect class="plot" x="${SVG_LEFT}" y="${SVG_TOP}" width="${plotWidth}" ` +
    `height="${plotHeight}"/>` +
    bounds +
    `<line class="axis" x1="${SVG_LEFT}" y1="${SVG_TOP + plotHeight}" ` +
    `x2="${SVG_LEFT + plotWidth}" y2="${SVG_TOP + plotHeight}"/>` +
    `<text class="axis-label" x="${SVG_LEFT - 6}" y="${SVG_TOP + 4}" ` +
    `text-anchor="end">${escapeHtml(formatPrice(max))}</text>` +
    `<text class="axis-label" x="${SVG_LEFT - 6}" y="${SVG_TOP + plotHeight}" ` +
    `text-anchor="end">${escapeHtml(formatPrice(min))}</text>` +
    `<text class="axis-label" x="${SVG_LEFT}" y="${SVG_HEIGHT - 12}">` +
    `${window.startIndex}</text>` +
    `<text class="axis-label" x="${SVG_LEFT + plotWidth}" y="${SVG_HEIGHT - 12}" ` +
    `text-anchor="end">${window.endIndex}</text>` +
    candles +
    cut +
    levelMarkup(row, min, max) +
    `</svg>`
  );
}

function renderCard(
  row: ReviewRow,
  bars: readonly Candle[] | null | undefined,
  context: number
): string {
  const series = seriesKey(row);
  const body = (() => {
    if (!bars || bars.length === 0) {
      return (
        `<div class="missing"><strong>No stored bars for ${escapeHtml(series)}.</strong>` +
        `<span>Run <code>pnpm trainer:ingest</code> and regenerate the preview.</span></div>`
      );
    }
    if (row.cutIndex < 0 || row.cutIndex >= bars.length) {
      return (
        `<div class="missing"><strong>Cut bar is outside the stored series.</strong>` +
        `<span>cutIndex ${row.cutIndex}; ${bars.length} bars stored for ` +
        `${escapeHtml(series)}.</span></div>`
      );
    }
    const window = previewWindow(
      row.startIndex,
      row.cutIndex,
      bars.length,
      context
    );
    if (window.endIndex < window.startIndex) {
      return `<div class="missing"><strong>The preview window is empty.</strong></div>`;
    }
    return renderSvg(row, bars, window);
  })();

  const metadata: [string, unknown][] = [
    ["Symbol", row.symbol],
    ["Timeframe", row.timeframe],
    ["Tag", row.tag],
    ["Family", row.family],
    ["Direction", formatCell(row.direction)],
    ["Cut index", row.cutIndex],
    ["Bounds", `${row.startIndex}–${row.endIndex}`],
    ["Upper", formatCell(row.levelUpper)],
    ["Lower", formatCell(row.levelLower)],
    ["Neckline", formatCell(row.neckline)],
    ["Status", row.status],
    ["Ambiguity", formatCell(row.ambiguity)],
  ];

  const meta = metadata
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
    )
    .join("");

  return (
    `<article class="card" data-tag="${escapeHtml(row.tag)}" ` +
    `data-series="${escapeHtml(series)}" ` +
    `data-direction="${escapeHtml(row.direction ?? "blank")}">` +
    `<header class="card-head">` +
    `<div class="badges">` +
    `<span class="badge tag">${escapeHtml(row.tag)}</span>` +
    `<span class="badge dir">${escapeHtml(row.direction ?? "—")}</span>` +
    `</div>` +
    `<span class="badge status status-${escapeHtml(row.status)}">` +
    `${escapeHtml(row.status)}</span></header>` +
    `<h2>${escapeHtml(row.id)}</h2>` +
    `<dl class="meta">${meta}</dl>` +
    `<div class="chart-wrap">${body}</div>` +
    `<pre class="notes">${escapeHtml(row.notes || "—")}</pre>` +
    `</article>`
  );
}

export function renderPreviewHtml(
  rows: readonly ReviewRow[],
  barsBySeries: PreviewBarsBySeries,
  options: PreviewOptions = {}
): string {
  const context = options.context ?? PREVIEW_CONTEXT_DEFAULT;
  if (!Number.isInteger(context) || context < 1) {
    throw new Error("context must be a positive integer");
  }

  const tags = [...new Set(rows.map((row) => row.tag))].sort();
  const series = [...new Set(rows.map((row) => seriesKey(row)))].sort();
  const directions = [...new Set(rows.map((row) => row.direction ?? "blank"))].sort();
  const cards = rows
    .map((row) => renderCard(row, barsBySeries[seriesKey(row)], context))
    .join("\n");

  const tagOptions = tags
    .map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`)
    .join("");
  const seriesOptions = series
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
    )
    .join("");
  const directionOptions = directions
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doochy Learn review preview</title>
<style>
:root { color-scheme: dark; --bg: #0b1016; --panel: #141b24; --line: #293442; --fg: #e7edf5; --muted: #93a1b3; --accent: #14b8a6; --up: #26a69a; --down: #ef5350; --upper: #60a5fa; --lower: #fb923c; --neck: #c084fc; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.top { position: sticky; top: 0; z-index: 5; padding: 18px 22px; background: rgba(11,16,22,.94); border-bottom: 1px solid var(--line); backdrop-filter: blur(10px); }
.top h1 { margin: 0; font-size: 20px; letter-spacing: -.01em; }
.top p { margin: 5px 0 0; color: var(--muted); }
.controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin-top: 14px; }
.controls label { display: grid; gap: 4px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
select, input { min-width: 150px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--fg); font: inherit; }
input[type="search"] { min-width: 260px; }
.count { margin-left: auto; color: var(--muted); font-size: 12px; }
main { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr)); gap: 16px; padding: 18px 22px 40px; }
.card { min-width: 0; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); overflow: hidden; }
.card-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 12px 14px 0; }
.badges { display: flex; flex-wrap: wrap; gap: 6px; }
.badge { display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; font-size: 11px; color: var(--muted); }
.badge.tag { border-color: #1f6f68; color: #7dd3c7; }
.badge.status-pending { color: #fbbf24; border-color: #6b4b12; }
.badge.status-accept { color: #86efac; border-color: #246b3d; }
.badge.status-reject { color: #fca5a5; border-color: #7f2a2a; }
.card h2 { margin: 9px 14px 0; font: 600 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px 10px; margin: 12px 14px; }
.meta div { min-width: 0; }
.meta dt { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
.meta dd { margin: 1px 0 0; overflow-wrap: anywhere; font-size: 12px; }
.chart-wrap { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: #0e151d; }
.chart { display: block; width: 100%; height: auto; }
.plot { fill: #101923; stroke: #1f2a37; }
.axis { stroke: #344154; }
.axis-label { fill: #8492a6; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
.candle.up line, .candle.up rect { stroke: var(--up); fill: var(--up); }
.candle.down line, .candle.down rect { stroke: var(--down); fill: var(--down); }
.candle line { stroke-width: 1; }
.candle rect { stroke-width: 0; opacity: .9; }
.pattern { fill: rgba(20,184,166,.08); stroke: rgba(20,184,166,.55); stroke-dasharray: 5 4; }
.pattern-label, .cut-label { fill: #7dd3c7; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
.cut-line { stroke: #fbbf24; stroke-width: 1.2; stroke-dasharray: 3 3; }
.cut-label { fill: #fbbf24; }
.level-upper line { stroke: var(--upper); stroke-width: 1; stroke-dasharray: 6 3; }
.level-upper text { fill: var(--upper); font: 9px ui-monospace, SFMono-Regular, Menlo, monospace; }
.level-lower line { stroke: var(--lower); stroke-width: 1; stroke-dasharray: 6 3; }
.level-lower text { fill: var(--lower); font: 9px ui-monospace, SFMono-Regular, Menlo, monospace; }
.level-neckline line { stroke: var(--neck); stroke-width: 1; stroke-dasharray: 2 3; }
.level-neckline text { fill: var(--neck); font: 9px ui-monospace, SFMono-Regular, Menlo, monospace; }
.notes { margin: 0; padding: 11px 14px 14px; color: var(--muted); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.missing { display: grid; gap: 5px; padding: 28px 18px; color: var(--muted); text-align: center; }
.missing strong { color: #fca5a5; }
code { color: var(--fg); }
.empty { margin: 30px 22px; color: var(--muted); }
[hidden] { display: none !important; }
@media (max-width: 680px) { .meta { grid-template-columns: repeat(2, minmax(0, 1fr)); } .top { position: static; } }
</style>
</head>
<body>
<header class="top">
  <h1>Doochy Learn review preview</h1>
  <p>Read-only gallery. Edit the shortlist CSV, not this page. Context ends at the cut bar; no future bars are shown.</p>
  <div class="controls">
    <label>Tag<select id="tag-filter"><option value="">All tags</option>${tagOptions}</select></label>
    <label>Series<select id="series-filter"><option value="">All series</option>${seriesOptions}</select></label>
    <label>Direction<select id="direction-filter"><option value="">All directions</option>${directionOptions}</select></label>
    <label>Search<input id="search" type="search" placeholder="id, tag, notes, level…"></label>
    <span class="count" id="visible-count"></span>
  </div>
</header>
<main id="cards">
${cards}
</main>
<p class="empty" id="empty" hidden>No cards match the current filters.</p>
<script>
(function () {
  var tag = document.getElementById('tag-filter');
  var series = document.getElementById('series-filter');
  var direction = document.getElementById('direction-filter');
  var search = document.getElementById('search');
  var empty = document.getElementById('empty');
  var count = document.getElementById('visible-count');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));

  function apply() {
    var query = (search.value || '').toLowerCase();
    var visible = 0;
    cards.forEach(function (card) {
      var show = (!tag.value || card.dataset.tag === tag.value) &&
        (!series.value || card.dataset.series === series.value) &&
        (!direction.value || card.dataset.direction === direction.value) &&
        (!query || (card.textContent || '').toLowerCase().indexOf(query) !== -1);
      card.hidden = !show;
      if (show) visible++;
    });
    empty.hidden = visible !== 0;
    count.textContent = visible + ' of ' + cards.length + ' visible';
  }

  [tag, series, direction, search].forEach(function (element) {
    element.addEventListener('input', apply);
    element.addEventListener('change', apply);
  });
  apply();
})();
</script>
</body>
</html>
`;
}
