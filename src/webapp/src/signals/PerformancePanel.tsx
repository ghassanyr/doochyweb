// Verified performance for the Signals feed.
//
// Only signals the automatic resolver has closed are counted, so the numbers
// are the outcome of the published plan rather than a self-reported record. A
// win is scored at its planned R:R, a stop-out at exactly -1R, and the curve
// plots cumulative R in resolution order.

import { useEffect, useState } from "react";
import { Activity, TrendingUp } from "lucide-react";

import { signalsApi } from "../api";
import { FadeRise } from "../components/motion";
import { Badge, Card, Skeleton } from "../components/ui";
import type { PerformanceBucket, SignalPerformance } from "./types";

export default function PerformancePanel() {
  const [data, setData] = useState<SignalPerformance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    signalsApi
      .performance()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch(() => {
        if (alive) setError("Could not load signal performance.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return <Card className="p-6 text-sm text-danger">{error}</Card>;
  }

  const overall = data?.overall;
  if (!overall || overall.resolved === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Activity className="h-4 w-4 text-accent" />
          No resolved signals yet
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
          Performance starts once a published signal reaches its target or its stop. Open and
          expired signals are excluded, so nothing dilutes the hit rate.
        </p>
      </Card>
    );
  }

  return (
    <FadeRise>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Resolved" value={String(overall.resolved)} hint={`${overall.wins}W / ${overall.losses}L`} />
          <Metric label="Hit rate" value={pct(overall.winRate)} hint="target before stop" />
          <Metric
            label="Average R"
            value={rText(overall.avgR)}
            tone={overall.avgR != null && overall.avgR > 0 ? "success" : overall.avgR != null ? "danger" : undefined}
            hint="per resolved signal"
          />
          <Metric
            label="Total R"
            value={rText(overall.totalR)}
            tone={overall.totalR > 0 ? "success" : overall.totalR < 0 ? "danger" : undefined}
            hint="sum of R multiples"
          />
          <Metric label="Profit factor" value={overall.profitFactor == null ? "-" : overall.profitFactor.toFixed(2)} hint="gross win / gross loss" />
        </div>

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <TrendingUp className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-fg">Cumulative R</h3>
            <span className="text-[11px] text-fg-faint">one point per resolved signal, oldest first</span>
            <span className="ml-auto text-[11px] text-fg-faint">
              Updated {new Date(data!.updatedAt).toLocaleString()}
            </span>
          </div>
          <Curve data={data!} />
        </Card>

        <div className="grid gap-3 lg:grid-cols-2">
          <BucketTable title="By symbol" rows={data!.bySymbol} empty="No symbols resolved yet." />
          <BucketTable title="By month" rows={data!.byMonth} empty="No closed months yet." />
        </div>
      </div>
    </FadeRise>
  );
}

function pct(value: number | null): string {
  if (value == null) return "-";
  return `${Math.round(value * 100)}%`;
}

function rText(value: number | null): string {
  if (value == null) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "success" | "danger";
}) {
  const color = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-fg";
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wider text-fg-faint">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-fg-faint">{hint}</div>}
    </Card>
  );
}

function Curve({ data }: { data: SignalPerformance }) {
  const points = data.curve;
  if (points.length < 2) {
    return <p className="mt-3 text-[12.5px] text-fg-muted">At least two resolved signals are needed to draw a curve.</p>;
  }

  const width = 640;
  const height = 140;
  const pad = 8;
  const values = [0, ...points.map((point) => point.cumulativeR)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (index: number) => pad + (index / (points.length - 1)) * (width - pad * 2);
  const y = (value: number) => pad + (1 - (value - min) / span) * (height - pad * 2);
  const path = points.map((point, index) => `${x(index)},${y(point.cumulativeR)}`).join(" ");
  const zeroY = y(0);
  const last = points[points.length - 1].cumulativeR;

  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-36 w-full"
        role="img"
        aria-label={`Cumulative R curve ending at ${last.toFixed(2)}R`}
        preserveAspectRatio="none"
      >
        <line
          x1={pad}
          x2={width - pad}
          y1={zeroY}
          y2={zeroY}
          stroke="currentColor"
          className="text-fg-faint opacity-40"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
        <polyline
          points={`${x(0)},${zeroY} ${path}`}
          fill="none"
          stroke="currentColor"
          className={last >= 0 ? "text-success" : "text-danger"}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-fg-faint">
        <span>{points.length} resolved</span>
        <span className={last >= 0 ? "text-success" : "text-danger"}>{rText(last)}</span>
      </div>
    </div>
  );
}

function BucketTable({ title, rows, empty }: { title: string; rows: PerformanceBucket[]; empty: string }) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-fg-muted">{empty}</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-fg-faint">
                <th className="py-1 font-medium">Name</th>
                <th className="py-1 text-right font-medium">N</th>
                <th className="py-1 text-right font-medium">Hit</th>
                <th className="py-1 text-right font-medium">Avg R</th>
                <th className="py-1 text-right font-medium">Total R</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-hairline">
                  <td className="py-1.5 font-medium text-fg">{row.label}</td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">{row.resolved}</td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">{pct(row.winRate)}</td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">{rText(row.avgR)}</td>
                  <td
                    className={
                      "py-1.5 text-right tabular-nums " +
                      (row.totalR > 0 ? "text-success" : row.totalR < 0 ? "text-danger" : "text-fg-muted")
                    }
                  >
                    {rText(row.totalR)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <div className="mt-2">
          <Badge tone="muted">Verified by the resolver</Badge>
        </div>
      )}
    </Card>
  );
}
