import { useCallback, useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import type {
  AnonymizedItem,
  NormalizedBar,
  RevealedItem,
} from "./trainerApi";

const UP = "#34d399";
const DOWN = "#f87171";
const UPPER = "#14b8a6";
const LOWER = "#f59e0b";
const MUTED = "#94a3b8";

function chartValue(percent: number): number {
  return 100 + percent;
}

function formatPercent(price: number): string {
  const pct = price - 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

// The x-axis is hidden and synthetic: offsets are shifted into positive
// timestamp territory so the chart never interprets a negative time.
const OFFSET_BASE = 1_000_000;

function toTime(offset: number): Time {
  return (offset + OFFSET_BASE) as UTCTimestamp;
}

function toCandles(bars: readonly NormalizedBar[]): CandlestickData<Time>[] {
  return bars.map((bar) => ({
    time: toTime(bar.offset),
    open: chartValue(bar.open),
    high: chartValue(bar.high),
    low: chartValue(bar.low),
    close: chartValue(bar.close),
  }));
}

function toVolume(bars: readonly NormalizedBar[]): HistogramData<Time>[] {
  return bars.map((bar) => ({
    time: toTime(bar.offset),
    value: Math.max(0, bar.volume),
    color:
      bar.close >= bar.open
        ? "rgba(52, 211, 153, 0.32)"
        : "rgba(248, 113, 113, 0.32)",
  }));
}

function outcomeColor(outcome: RevealedItem["outcome"]): string {
  if (outcome === "up") return UP;
  if (outcome === "down") return DOWN;
  return MUTED;
}

export default function LearnChart({
  item,
  reveal,
}: {
  item: AnonymizedItem;
  reveal: RevealedItem | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  // The pane labels for the barriers are drawn by lightweight-charts at the
  // right edge, over the newest bars. Render them ourselves at the left instead
  // and track the prices so they can be re-positioned after resize/data changes.
  const upperLabelRef = useRef<HTMLDivElement>(null);
  const lowerLabelRef = useRef<HTMLDivElement>(null);
  const barrierPricesRef = useRef<{ upper: number; lower: number } | null>(null);

  const positionBarrierLabels = useCallback(() => {
    const candles = candleRef.current;
    const prices = barrierPricesRef.current;
    if (!candles || !prices) return;

    const place = (el: HTMLDivElement | null, price: number) => {
      if (!el) return;
      const y = candles.priceToCoordinate(price);
      if (y == null) {
        el.style.opacity = "0";
        return;
      }
      el.style.opacity = "1";
      el.style.top = `${y}px`;
    };

    place(upperLabelRef.current, prices.upper);
    place(lowerLabelRef.current, prices.lower);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(231, 237, 245, 0.60)",
        fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(27, 38, 53, 0.72)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.18 },
      },
      timeScale: {
        visible: false,
        borderVisible: false,
        rightOffset: 0.5,
        barSpacing: 8,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(148, 174, 214, 0.32)",
          labelVisible: false,
        },
        horzLine: {
          color: "rgba(148, 174, 214, 0.32)",
          labelBackgroundColor: "#141c28",
        },
      },
      handleScroll: false,
      handleScale: false,
      localization: {
        priceFormatter: formatPercent,
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: "rgba(52, 211, 153, 0.72)",
      wickDownColor: "rgba(248, 113, 113, 0.72)",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
    });

    const markers = createSeriesMarkers(candles);

    chartRef.current = chart;
    candleRef.current = candles;
    volumeRef.current = volume;
    markersRef.current = markers;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      chart.resize(
        Math.max(1, Math.floor(rect.width)),
        Math.max(1, Math.floor(rect.height))
      );
      // Re-place the barrier labels once the price scale has the new height.
      window.requestAnimationFrame(positionBarrierLabels);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
      priceLinesRef.current = [];
    };
  }, [positionBarrierLabels]);

  useEffect(() => {
    const chart = chartRef.current;
    const candles = candleRef.current;
    const volume = volumeRef.current;
    const markers = markersRef.current;
    if (!chart || !candles || !volume || !markers) return;

    for (const line of priceLinesRef.current) {
      candles.removePriceLine(line);
    }
    const upper = chartValue(item.question.barrierPct.upperPct);
    const lower = chartValue(item.question.barrierPct.lowerPct);
    barrierPricesRef.current = { upper, lower };
    priceLinesRef.current = [
      candles.createPriceLine({
        price: upper,
        color: UPPER,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "",
      }),
      candles.createPriceLine({
        price: lower,
        color: LOWER,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "",
      }),
    ];
    positionBarrierLabels();
  }, [item, positionBarrierLabels]);

  useEffect(() => {
    const chart = chartRef.current;
    const candles = candleRef.current;
    const volume = volumeRef.current;
    const markers = markersRef.current;
    if (!chart || !candles || !volume || !markers) return;

    const contextCandles = toCandles(item.context);
    const contextVolume = toVolume(item.context);
    const revealBars =
      reveal && reveal.itemId === item.itemId ? reveal.reveal : [];
    const marker: SeriesMarker<Time>[] =
      reveal && reveal.itemId === item.itemId && revealBars.length > 0
        ? [
            {
              time: toTime(
                reveal.outcomeOffset ??
                  revealBars[revealBars.length - 1].offset
              ),
              position: "aboveBar",
              color: outcomeColor(reveal.outcome),
              shape: "circle",
              text: reveal.outcomeOffset === null ? "Window ends" : "Resolves",
            },
          ]
        : [];

    const finish = () => {
      candles.setData([
        ...contextCandles,
        ...toCandles(revealBars),
      ]);
      volume.setData([...contextVolume, ...toVolume(revealBars)]);
      markers.setMarkers(marker);
      chart.timeScale().fitContent();
      positionBarrierLabels();
      window.requestAnimationFrame(positionBarrierLabels);
    };

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (revealBars.length === 0 || reduce) {
      finish();
      return;
    }

    let shown = 0;
    const timer = window.setInterval(() => {
      shown += 1;
      candles.setData([
        ...contextCandles,
        ...toCandles(revealBars.slice(0, shown)),
      ]);
      volume.setData([
        ...contextVolume,
        ...toVolume(revealBars.slice(0, shown)),
      ]);
      chart.timeScale().fitContent();
      positionBarrierLabels();
      window.requestAnimationFrame(positionBarrierLabels);
      if (shown >= revealBars.length) {
        window.clearInterval(timer);
        markers.setMarkers(marker);
      }
    }, 55);

    return () => window.clearInterval(timer);
  }, [item, reveal, positionBarrierLabels]);

  const outcomeLabel =
    reveal && reveal.itemId === item.itemId
      ? reveal.outcome === "up"
        ? "ending above the upper barrier"
        : reveal.outcome === "down"
          ? "ending below the lower barrier"
          : "ending at the time barrier"
      : "ending hidden until you answer";

  return (
    <div
      className="relative h-[340px] w-full sm:h-[400px]"
      role="img"
      aria-label={`Anonymized candlestick chart with upper and lower percent barriers, ${outcomeLabel}.`}
    >
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-y-0 left-0">
        <div
          ref={upperLabelRef}
          className="absolute left-1.5 -translate-y-1/2 rounded border bg-canvas/85 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-0"
          style={{ color: UPPER, borderColor: "rgba(20, 184, 166, 0.45)" }}
        >
          Upper
        </div>
        <div
          ref={lowerLabelRef}
          className="absolute left-1.5 -translate-y-1/2 rounded border bg-canvas/85 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-0"
          style={{ color: LOWER, borderColor: "rgba(245, 158, 11, 0.45)" }}
        >
          Lower
        </div>
      </div>
    </div>
  );
}
