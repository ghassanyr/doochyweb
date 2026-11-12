import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  GraduationCap,
  LineChart,
  Radio,
  Zap,
} from "lucide-react";

import { signalsApi } from "../api";
import { FadeRise, Stagger, StaggerItem } from "../components/motion";
import { RouteLink } from "../components/RouteLink";
import { Badge, Button, Card, Skeleton, buttonClass } from "../components/ui";
import type { ViewKey } from "../routing";
import { useSiteConfig, FALLBACK_BRANDING } from "../siteConfig";
import {
  SIGNAL_DIRECTION,
  computeRR,
  fmtEntry,
  fmtPrice,
  fmtRR,
  relativeAgo,
} from "../signals/signalFormat";
import type { Signal } from "../signals/types";

const FEATURES: { view: ViewKey; title: string; description: string; icon: ReactNode }[] = [
  {
    view: "analysis",
    title: "Analysis",
    description: "Multi-timeframe structure and confluence across a shared watchlist.",
    icon: <LineChart className="h-4 w-4" />,
  },
  {
    view: "signals",
    title: "Signals",
    description: "Published ideas with entry, target, stop, and lifecycle status.",
    icon: <Radio className="h-4 w-4" />,
  },
  {
    view: "breakouts",
    title: "Breakouts",
    description: "Automated level breaks with research notes and history.",
    icon: <Zap className="h-4 w-4" />,
  },
  {
    view: "learn",
    title: "Learn",
    description: "Anonymous daily drills for pattern recognition.",
    icon: <GraduationCap className="h-4 w-4" />,
  },
];

type LatestSignal =
  | { status: "loading" }
  | { status: "ready"; signal: Signal | null }
  | { status: "error" };

export default function HomePage({
  signedIn,
  onRegister,
  onNavigate,
}: {
  signedIn: boolean;
  onRegister: () => void;
  onNavigate: (view: ViewKey) => void;
}) {
  const [latest, setLatest] = useState<LatestSignal>({ status: "loading" });
  const { branding } = useSiteConfig();

  useEffect(() => {
    let alive = true;
    signalsApi
      .list({ status: "active", limit: 1 })
      .then((res) => {
        if (alive) setLatest({ status: "ready", signal: res.signals[0] ?? null });
      })
      .catch(() => {
        if (alive) setLatest({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <FadeRise>
      <div className="mx-auto w-full max-w-6xl">
        <section className="grid gap-6 py-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)] lg:items-center lg:py-10">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-hairline bg-soft px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Market workspace
            </div>
            <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-[1.08] tracking-tight text-fg sm:text-5xl">
              <span className="block">Read the market.</span>
              <span className="block">Track published setups.</span>
              <span className="block">Practice the pattern.</span>
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-fg-muted">
              {branding.description || FALLBACK_BRANDING.description}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <RouteLink
                view="analysis"
                onNavigate={onNavigate}
                className={buttonClass("primary", "lg")}
              >
                <LineChart className="h-4 w-4" />
                Open Analysis
              </RouteLink>
              {signedIn ? (
                <RouteLink
                  view="signals"
                  onNavigate={onNavigate}
                  className={buttonClass("secondary", "lg")}
                >
                  Open Signals
                </RouteLink>
              ) : (
                <Button variant="secondary" size="lg" onClick={onRegister}>
                  Create account
                </Button>
              )}
            </div>
            <p className="mt-3 text-[11.5px] text-fg-faint">
              Analysis, Signals, Breakouts and Learn are public. Trading unlocks once you connect
              cTrader.
            </p>
          </div>

          <LatestSignalCard latest={latest} onNavigate={onNavigate} />
        </section>

        <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <StaggerItem key={feature.view} className="h-full">
              <RouteLink view={feature.view} onNavigate={onNavigate} className="group block h-full">
                <Card interactive className="h-full p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/20 bg-accent-soft text-accent">
                      {feature.icon}
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-fg-faint opacity-0 transition group-hover:opacity-100" />
                  </div>
                  <div className="mt-3 text-sm font-semibold text-fg">{feature.title}</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
                    {feature.description}
                  </p>
                </Card>
              </RouteLink>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </FadeRise>
  );
}

function LatestSignalCard({
  latest,
  onNavigate,
}: {
  latest: LatestSignal;
  onNavigate: (view: ViewKey) => void;
}) {
  return (
    <Card className="flex min-h-[220px] flex-col p-5">
      <div className="flex items-center justify-between gap-3 border-b border-hairline pb-3">
        <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Latest active signal
        </div>
        <RouteLink
          view="signals"
          onNavigate={onNavigate}
          className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-fg-muted transition hover:text-fg"
        >
          All signals
          <ArrowRight className="h-3.5 w-3.5" />
        </RouteLink>
      </div>

      {latest.status === "loading" ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ) : latest.status === "error" ? (
        <div className="flex flex-1 flex-col justify-center py-4">
          <p className="text-sm text-fg-muted">Could not load the latest signal.</p>
          <RouteLink
            view="signals"
            onNavigate={onNavigate}
            className="mt-3 inline-flex w-fit items-center gap-1 text-xs font-semibold text-accent transition hover:text-accent-hover"
          >
            Open Signals
            <ArrowRight className="h-3.5 w-3.5" />
          </RouteLink>
        </div>
      ) : latest.signal ? (
        <SignalPreview signal={latest.signal} />
      ) : (
        <div className="flex flex-1 flex-col justify-center py-4">
          <p className="text-sm text-fg-muted">No active signals right now.</p>
          <RouteLink
            view="signals"
            onNavigate={onNavigate}
            className="mt-3 inline-flex w-fit items-center gap-1 text-xs font-semibold text-accent transition hover:text-accent-hover"
          >
            Open Signals
            <ArrowRight className="h-3.5 w-3.5" />
          </RouteLink>
        </div>
      )}
    </Card>
  );
}

function SignalPreview({ signal }: { signal: Signal }) {
  const direction = SIGNAL_DIRECTION[signal.direction];
  const rr = computeRR(signal.entry, signal.target, signal.stop, signal.entryMax);

  return (
    <div className="mt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xl font-bold tracking-tight text-fg">{signal.symbol}</span>
          <Badge tone={direction.tone}>{direction.label}</Badge>
        </div>
        <div className="shrink-0 pt-0.5 text-right text-[11px] text-fg-faint">
          {signal.timeframe && <span>{signal.timeframe} · </span>}
          {relativeAgo(signal.createdAt)}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg border border-hairline bg-soft/60 px-2.5 py-2">
        <Price label="Entry" value={fmtEntry(signal.entry, signal.entryMax)} />
        <Price label="Target" value={fmtPrice(signal.target)} tone="text-success" />
        <Price label="Stop" value={fmtPrice(signal.stop)} tone="text-danger" />
        <Price label="R:R" value={fmtRR(rr)} />
      </div>

      {signal.note && (
        <p className="mt-3 line-clamp-3 text-[12.5px] leading-relaxed text-fg-muted">
          {signal.note}
        </p>
      )}
    </div>
  );
}

function Price({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className={`truncate text-[12.5px] font-semibold tabular-nums ${tone ?? "text-fg"}`}>
        {value}
      </div>
    </div>
  );
}
