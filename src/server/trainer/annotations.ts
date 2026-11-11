import type { Candle } from "../market/types";
import { readTrend, thresholdAt } from "./detectors";
import type { ReviewRow } from "./types";

export type AnnotationMarkerKind =
  | "anchor"
  | "swing"
  | "sweep"
  | "close"
  | "break"
  | "retest";

export interface AnnotationMarker {
  index: number;
  price: number;
  kind: AnnotationMarkerKind;
  label: string;
}

export interface AnnotationLine {
  fromIndex: number;
  fromPrice: number;
  toIndex: number;
  toPrice: number;
  kind: "level" | "trend" | "reference" | "arrow";
  label?: string;
  highlight?: boolean;
  dashed?: boolean;
}

export interface PreviewAnnotations {
  markers: AnnotationMarker[];
  lines: AnnotationLine[];
  highlightBars: number[];
  anchors: number[];
}

function clampIndex(value: number, row: ReviewRow, bars: readonly Candle[]): number {
  return Math.max(0, Math.min(value, row.cutIndex, bars.length - 1));
}

function levelFor(row: ReviewRow, direction: "up" | "down"): number | null {
  if (direction === "up") return row.levelUpper ?? row.levelLower ?? row.neckline;
  return row.levelLower ?? row.levelUpper ?? row.neckline;
}

function firstBreak(
  bars: readonly Candle[],
  row: ReviewRow,
  level: number
): number | null {
  for (let k = row.startIndex + 1; k <= row.endIndex; k++) {
    const thr = thresholdAt(bars, k);
    if (thr === null) continue;
    const broke =
      row.direction === "up"
        ? bars[k].close > level + thr
        : bars[k].close < level - thr;
    if (broke) return k;
  }
  return null;
}

function emptyAnnotations(row: ReviewRow, bars: readonly Candle[]): PreviewAnnotations {
  return {
    markers: [],
    lines: [],
    highlightBars: [],
    anchors: [
      clampIndex(row.startIndex, row, bars),
      clampIndex(row.endIndex, row, bars),
    ],
  };
}

function engulfingAnnotations(
  row: ReviewRow,
  bars: readonly Candle[]
): PreviewAnnotations {
  const start = clampIndex(row.startIndex, row, bars);
  const end = clampIndex(row.endIndex, row, bars);
  return {
    markers: [],
    lines: [],
    highlightBars: [start, end],
    anchors: [start, end],
  };
}

function sweepAnnotations(row: ReviewRow, bars: readonly Candle[]): PreviewAnnotations {
  const start = clampIndex(row.startIndex, row, bars);
  const end = clampIndex(row.endIndex, row, bars);
  const swing = bars[start];
  const sweep = bars[end];
  const up = row.tag === "sweep_up";
  const level = up ? row.levelUpper ?? swing.high : row.levelLower ?? swing.low;
  const wick = up ? sweep.high : sweep.low;
  return {
    markers: [
      {
        index: start,
        price: up ? swing.high : swing.low,
        kind: "swing",
        label: up ? "swept high" : "swept low",
      },
      { index: end, price: wick, kind: "sweep", label: "sweep wick" },
      { index: end, price: sweep.close, kind: "close", label: "close" },
    ],
    lines: [
      {
        fromIndex: start,
        fromPrice: level,
        toIndex: end,
        toPrice: level,
        kind: "level",
        label: "liquidity",
        highlight: true,
      },
      {
        fromIndex: end,
        fromPrice: wick,
        toIndex: end,
        toPrice: sweep.close,
        kind: "arrow",
        label: "rejection",
      },
    ],
    highlightBars: [end],
    anchors: [start, end],
  };
}

function srFlipAnnotations(row: ReviewRow, bars: readonly Candle[]): PreviewAnnotations {
  const start = clampIndex(row.startIndex, row, bars);
  const end = clampIndex(row.endIndex, row, bars);
  const direction = row.direction ?? "up";
  const level = levelFor(row, direction) ?? bars[start].close;
  const breakIndex = firstBreak(bars, row, level);
  const squeezeEnd = Math.min(end, bars.length - 1);
  const retest = bars[squeezeEnd];
  const markers: AnnotationMarker[] = [
    { index: start, price: level, kind: "swing", label: "swing level" },
    {
      index: squeezeEnd,
      price: retest.close,
      kind: "retest",
      label: "retest",
    },
  ];
  const highlightBars = [end];
  const anchors = [start, end];
  if (breakIndex !== null) {
    markers.splice(1, 0, {
      index: breakIndex,
      price: bars[breakIndex].close,
      kind: "break",
      label: "first break",
    });
    highlightBars.unshift(breakIndex);
    anchors.push(breakIndex);
  }
  return {
    markers,
    lines: [
      {
        fromIndex: start,
        fromPrice: level,
        toIndex: end,
        toPrice: level,
        kind: "level",
        label: "flipped level",
        highlight: true,
      },
    ],
    highlightBars,
    anchors,
  };
}

function structureAnnotations(
  row: ReviewRow,
  bars: readonly Candle[]
): PreviewAnnotations {
  const start = clampIndex(row.startIndex, row, bars);
  const end = clampIndex(row.endIndex, row, bars);
  const direction = row.direction ?? "up";
  const trend = end >= 2 && end < bars.length ? readTrend(bars, end) : null;
  const level = levelFor(row, direction);

  if (!trend) {
    if (level === null) return emptyAnnotations(row, bars);
    return {
      markers: [
        { index: end, price: bars[end].close, kind: "break", label: "break" },
      ],
      lines: [
        {
          fromIndex: start,
          fromPrice: level,
          toIndex: end,
          toPrice: level,
          kind: "level",
          label: "broken level",
          highlight: true,
        },
      ],
      highlightBars: [end],
      anchors: [start, end],
    };
  }

  const h1 = { index: trend.h1, price: bars[trend.h1].high };
  const h2 = { index: trend.h2, price: bars[trend.h2].high };
  const l1 = { index: trend.l1, price: bars[trend.l1].low };
  const l2 = { index: trend.l2, price: bars[trend.l2].low };
  const highLine = direction === "up";
  const broken = highLine ? h2 : l2;
  const brokenLevel = level ?? broken.price;
  const brokenLabel = highLine ? "H2" : "L2";

  const anchors = [h1.index, h2.index, l1.index, l2.index, end];
  const markers: AnnotationMarker[] = [
    { index: h1.index, price: h1.price, kind: "anchor", label: "H1" },
    {
      index: h2.index,
      price: h2.price,
      kind: highLine ? "swing" : "anchor",
      label: highLine ? "H2 broken swing" : "H2",
    },
    { index: l1.index, price: l1.price, kind: "anchor", label: "L1" },
    {
      index: l2.index,
      price: l2.price,
      kind: highLine ? "anchor" : "swing",
      label: highLine ? "L2" : "L2 broken swing",
    },
    { index: end, price: bars[end].close, kind: "break", label: "break" },
  ];

  return {
    markers,
    lines: [
      {
        fromIndex: h1.index,
        fromPrice: h1.price,
        toIndex: h2.index,
        toPrice: h2.price,
        kind: "trend",
        label: "H1-H2",
        highlight: highLine,
      },
      {
        fromIndex: l1.index,
        fromPrice: l1.price,
        toIndex: l2.index,
        toPrice: l2.price,
        kind: "trend",
        label: "L1-L2",
        highlight: !highLine,
      },
      {
        fromIndex: broken.index,
        fromPrice: brokenLevel,
        toIndex: end,
        toPrice: brokenLevel,
        kind: "reference",
        label: `${brokenLabel} reference`,
        dashed: true,
      },
    ],
    highlightBars: [end],
    anchors,
  };
}

export function deriveAnnotations(
  row: ReviewRow,
  bars: readonly Candle[]
): PreviewAnnotations {
  if (bars.length === 0 || row.cutIndex < 0 || row.cutIndex >= bars.length) {
    return { markers: [], lines: [], highlightBars: [], anchors: [] };
  }
  if (row.startIndex < 0 || row.endIndex < row.startIndex) {
    return emptyAnnotations(row, bars);
  }

  switch (row.tag) {
    case "bullish_engulfing":
    case "bearish_engulfing":
      return engulfingAnnotations(row, bars);
    case "sweep_up":
    case "sweep_down":
      return sweepAnnotations(row, bars);
    case "sr_flip":
      return srFlipAnnotations(row, bars);
    case "bos":
    case "choch":
      return structureAnnotations(row, bars);
  }
}
