// AI Coach.
//
// Weekly facts use fixed UTC Monday-Sunday periods. Reviews are generated only
// when the member presses Generate or Regenerate. The page never calls the AI
// provider on load; reads and writes are separate endpoints.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import {
  coachApi,
  type CoachBucket,
  type CoachTradeFacts,
  type CoachTradeListItem,
  type CoachTradeResponse,
  type CoachWeeklyResponse,
} from "../api";
import { AnimatedModal } from "../components/Modal";
import { FadeRise } from "../components/motion";
import { Badge, Button, Card, Flash, Skeleton } from "../components/ui";
import { formatNumber } from "../format";
import { formatLocalDate, formatLocalDateTime } from "../time";
import { useSiteConfig } from "../siteConfig";

const MIN_WEEKLY_TRADES = 5;

function pct(value: number | null): string {
  if (value == null) return "n/a";
  return `${Math.round(value * 1000) / 10}%`;
}

function signed(value: number | null, digits = 2): string {
  if (value == null) return "n/a";
  const text = formatNumber(value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return value > 0 ? `+${text}` : text;
}

function rText(value: number | null): string {
  return value == null ? "n/a" : `${signed(value)}R`;
}

function utcDate(iso: string | null): string {
  if (!iso) return "n/a";
  return formatLocalDate(iso, { timeZone: "UTC" });
}

function weekLabel(key: string, start: string, end: string, count?: number): string {
  const range = `${utcDate(start)} to ${utcDate(end)}`;
  return `${key} | ${range}${count == null ? "" : ` | ${count} closed`}`;
}

function outcomeTone(outcome: CoachTradeFacts["outcome"]): "success" | "danger" | "muted" {
  if (outcome === "win") return "success";
  if (outcome === "loss") return "danger";
  return "muted";
}

function exitLabel(value: CoachTradeFacts["exitVsPlan"]): string {
  if (value === "target") return "At target";
  if (value === "stop") return "At stop";
  if (value === "inside_plan") return "Inside plan";
  return "Unknown";
}

export default function CoachPage() {
  const { content } = useSiteConfig();
  const [weekly, setWeekly] = useState<CoachWeeklyResponse | null>(null);
  const [trades, setTrades] = useState<CoachTradeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingWeek, setChangingWeek] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeId, setTradeId] = useState<string | null>(null);
  const [tradeData, setTradeData] = useState<CoachTradeResponse | null>(null);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [weeklyResult, tradesResult] = await Promise.all([
        coachApi.weekly(),
        coachApi.trades(),
      ]);
      setWeekly(weeklyResult);
      setTrades(tradesResult.trades);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not load Coach.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeWeek = useCallback(async (key: string) => {
    setChangingWeek(true);
    try {
      setWeekly(await coachApi.weekly(key));
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not load that week.");
    } finally {
      setChangingWeek(false);
    }
  }, []);

  const generateWeekly = useCallback(async () => {
    if (!weekly) return;
    try {
      setWeekly(await coachApi.reviewWeekly(weekly.week.key));
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not generate the weekly review.");
    }
  }, [weekly]);

  const openTrade = useCallback(async (id: string) => {
    setTradeOpen(true);
    setTradeId(id);
    setTradeData(null);
    setTradeError(null);
    setTradeLoading(true);
    try {
      setTradeData(await coachApi.trade(id));
    } catch (err: any) {
      setTradeError(err?.message || "Could not load this trade.");
    } finally {
      setTradeLoading(false);
    }
  }, []);

  const generateTrade = useCallback(async () => {
    if (!tradeId) return;
    try {
      const result = await coachApi.reviewTrade(tradeId);
      setTradeData(result);
      setTrades((current) =>
        current.map((trade) =>
          trade.id === tradeId ? { ...trade, reviewed: true } : trade
        )
      );
      setTradeError(null);
    } catch (err: any) {
      setTradeError(err?.message || "Could not generate this trade review.");
    }
  }, [tradeId]);

  const facts = weekly?.facts;
  const report = weekly?.report ?? null;
  const sections = report?.sections ?? null;
  const pending = loading && !weekly;
  const canGenerate = Boolean(facts && facts.closedTrades >= MIN_WEEKLY_TRADES);

  return (
    <FadeRise>
      <div className="space-y-3">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-fg">AI coach</h2>
            <span className="text-[11px] text-fg-faint">
              {weekly ? weekLabel(weekly.week.key, weekly.week.periodStart, weekly.week.periodEnd) : "UTC Monday-Sunday"}
            </span>
            {weekly && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="coach-week">
                  Review week
                </label>
                <select
                  id="coach-week"
                  className="h-8 rounded-lg border border-hairline-strong bg-soft px-2 text-xs text-fg focus:border-accent focus:outline-none"
                  value={weekly.week.key}
                  disabled={changingWeek}
                  onChange={(event) => void changeWeek(event.target.value)}
                >
                  {weekly.weeks.map((week) => (
                    <option key={week.key} value={week.key}>
                      {weekLabel(week.key, week.periodStart, week.periodEnd, week.closedTrades)}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!canGenerate}
                  icon={report ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                  onClickAsync={generateWeekly}
                >
                  {report ? "Regenerate" : "Generate review"}
                </Button>
              </div>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
            Reviews use fixed UTC weeks, Monday 00:00 through Sunday 23:59. Your journal is the only
            source of facts. Generate and regenerate are manual, so no AI call runs in the background.
          </p>

          {weekly && !weekly.aiReady && (
            <div className="mt-3">
              <Flash tone="warning">
                No AI provider key is saved. You can still generate a deterministic review from your
                recorded facts. Add a key under Admin, Integrations to turn on written coaching.
              </Flash>
            </div>
          )}
          {error && (
            <div className="mt-3">
              <Flash tone="danger">{error}</Flash>
            </div>
          )}
        </Card>

        {pending ? (
          <Card className="p-4">
            <Skeleton className="h-24 w-full" />
          </Card>
        ) : !facts || !weekly ? (
          <Card className="p-6 text-sm text-fg-muted">
            {content.emptyStates.coach}
          </Card>
        ) : (
          <>
            <FactsStrip weekly={weekly} />

            {facts.closedTrades < MIN_WEEKLY_TRADES && (
              <Flash tone="warning">
                {facts.closedTrades === 0
                  ? "No closed trades were recorded in this UTC week."
                  : `${facts.closedTrades} closed ${facts.closedTrades === 1 ? "trade" : "trades"} in this week.`}{" "}
                At least {MIN_WEEKLY_TRADES} are needed before reviewing weekly patterns.
              </Flash>
            )}

            <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
              <WeeklyReviewCard
                report={report}
                canGenerate={canGenerate}
                aiReady={weekly.aiReady}
                onGenerate={generateWeekly}
              />
              <PlanQualityCard weekly={weekly} />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <BucketTable title="By symbol" rows={facts.bySymbol} empty="No symbols closed this week." />
              <BucketTable title="By side" rows={facts.bySide} empty="No sides closed this week." />
              <BucketTable title="By strategy" rows={facts.byStrategy} empty="No strategies recorded this week." />
              <BucketTable title="By weekday" rows={facts.byWeekday} empty="No weekdays recorded this week." />
              {facts.byTag.length > 0 && (
                <BucketTable title="By tag" rows={facts.byTag} empty="No tags recorded this week." />
              )}
            </div>

            {facts.caveats.length > 0 && (
              <Card className="p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-accent" />
                  <h3 className="text-sm font-semibold text-fg">Data notes</h3>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {facts.caveats.map((caveat) => (
                    <li key={caveat} className="flex gap-2 text-[12px] leading-relaxed text-fg-muted">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fg-faint" />
                      <span>{caveat}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <TradeList trades={trades} onReview={(id) => void openTrade(id)} />
          </>
        )}
      </div>

      <AnimatedModal
        open={tradeOpen}
        onClose={() => setTradeOpen(false)}
        size="lg"
        title={tradeData ? `${tradeData.facts.symbol} trade review` : "Trade review"}
        subtitle={
          tradeData
            ? `${tradeData.facts.side.toUpperCase()} | closed ${
                tradeData.facts.closedAt ? formatLocalDateTime(tradeData.facts.closedAt) : "unknown"
              }`
            : "Loading the recorded trade"
        }
      >
        {tradeLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !tradeData ? (
          <Flash tone="danger">{tradeError || "Could not load this trade."}</Flash>
        ) : (
          <TradeReviewPanel
            data={tradeData}
            error={tradeError}
            onGenerate={generateTrade}
          />
        )}
      </AnimatedModal>
    </FadeRise>
  );
}

function FactsStrip({ weekly }: { weekly: CoachWeeklyResponse }) {
  const facts = weekly.facts;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <FactCard label="Closed" value={String(facts.closedTrades)} hint={`${facts.verifiedTrades} verified / ${facts.manualTrades} self-reported`} />
      <FactCard
        label="Win rate"
        value={pct(facts.winRate)}
        hint={`${facts.wins}W / ${facts.losses}L${facts.breakeven ? ` / ${facts.breakeven}BE` : ""}`}
      />
      <FactCard
        label="Net P&L"
        value={signed(facts.netPnl)}
        hint="as recorded, not converted"
        tone={facts.netPnl > 0 ? "success" : facts.netPnl < 0 ? "danger" : undefined}
      />
      <FactCard
        label="Realized R"
        value={rText(facts.totalR)}
        hint={facts.avgR == null ? "R unavailable" : `${signed(facts.avgR)}R average across ${facts.closedTrades} trades`}
        tone={facts.totalR != null && facts.totalR > 0 ? "success" : facts.totalR != null && facts.totalR < 0 ? "danger" : undefined}
      />
      <FactCard
        label="Profit factor"
        value={facts.profitFactor == null ? "n/a" : facts.profitFactor.toFixed(2)}
        hint={facts.maxDrawdown == null ? "max drawdown n/a" : `${signed(facts.maxDrawdown)} max drawdown`}
      />
    </div>
  );
}

function FactCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "success" | "danger";
}) {
  const color = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-fg";
  return (
    <Card className="p-3">
      <div className="text-[10.5px] uppercase tracking-wider text-fg-faint">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-fg-faint">{hint}</div>
    </Card>
  );
}

function WeeklyReviewCard({
  report,
  canGenerate,
  aiReady,
  onGenerate,
}: {
  report: CoachWeeklyResponse["report"];
  canGenerate: boolean;
  aiReady: boolean;
  onGenerate: () => Promise<void>;
}) {
  if (!report) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-fg">Weekly review</h3>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
          No review has been generated for this week yet. The facts above are deterministic and can
          be reviewed before you generate prose.
        </p>
        <div className="mt-4">
          <Button
            variant="primary"
            size="sm"
            disabled={!canGenerate}
            icon={<Sparkles className="h-3.5 w-3.5" />}
            onClickAsync={onGenerate}
          >
            Generate review
          </Button>
        </div>
        {!aiReady && (
          <p className="mt-2 text-[11px] text-fg-faint">
            Without an AI key, generation stores a deterministic review built from the facts.
          </p>
        )}
      </Card>
    );
  }

  const sections = report.sections;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-fg">Weekly review</h3>
        <span className="text-[11px] text-fg-faint">
          {report.model ? `${report.model} | ` : ""}generated {formatLocalDateTime(report.generatedAt)}
        </span>
      </div>

      {report.error && (
        <div className="mt-3">
          <Flash tone={aiReady ? "danger" : "warning"}>{report.error}</Flash>
        </div>
      )}

      <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-muted">
        {sections.summary}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ReviewList
          title="Strengths"
          items={sections.strengths}
          icon={<CheckCircle2 className="h-3.5 w-3.5 text-success" />}
        />
        <ReviewList
          title="Watchouts"
          items={sections.watchouts}
          icon={<AlertTriangle className="h-3.5 w-3.5 text-danger" />}
        />
        <ReviewList
          title="Patterns"
          items={sections.patterns}
          icon={<ClipboardList className="h-3.5 w-3.5 text-accent" />}
        />
        <ReviewList
          title="Next focus"
          items={sections.focus}
          icon={<Target className="h-3.5 w-3.5 text-accent" />}
        />
      </div>
    </Card>
  );
}

function ReviewList({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-soft p-3">
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-fg-faint">
        {icon}
        {title}
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[12px] leading-relaxed text-fg-muted">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanQualityCard({ weekly }: { weekly: CoachWeeklyResponse }) {
  const facts = weekly.facts;
  const rows = [
    ["Entry", facts.planCompleteness.entry],
    ["Exit", facts.planCompleteness.exit],
    ["Stop", facts.planCompleteness.stop],
    ["Target", facts.planCompleteness.target],
    ["P&L", facts.planCompleteness.pnl],
  ] as const;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-fg">Recorded plan</h3>
      </div>
      <p className="mt-0.5 text-[11px] text-fg-faint">
        How many closed trades had each field recorded.
      </p>
      <div className="mt-3 space-y-2">
        {rows.map(([label, count]) => {
          const ratio = facts.closedTrades ? count / facts.closedTrades : 0;
          return (
            <div key={label}>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-fg-muted">{label}</span>
                <span className="tabular-nums text-fg-faint">
                  {count}/{facts.closedTrades}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round(ratio * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-hairline pt-3 text-[11px] text-fg-faint">
        <span>Active days: {facts.activeDays}</span>
        <span>Avg trades/day: {formatNumber(facts.avgTradesPerActiveDay, { maximumFractionDigits: 2 })}</span>
        <span>Loss streak: {facts.longestLossStreak}</span>
        <span>Planned R:R: {facts.avgPlannedRr == null ? "n/a" : facts.avgPlannedRr.toFixed(2)}</span>
      </div>
    </Card>
  );
}

function BucketTable({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: CoachBucket[];
  empty: string;
}) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-[12px] text-fg-muted">{empty}</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-fg-faint">
                <th className="py-1 font-medium">Name</th>
                <th className="py-1 text-right font-medium">N</th>
                <th className="py-1 text-right font-medium">W/L</th>
                <th className="py-1 text-right font-medium">Win</th>
                <th className="py-1 text-right font-medium">Net</th>
                <th className="py-1 text-right font-medium">R</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-hairline">
                  <td className="py-1.5 font-medium text-fg">{row.label}</td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">{row.trades}</td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">
                    {row.wins}/{row.losses}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">{pct(row.winRate)}</td>
                  <td
                    className={
                      "py-1.5 text-right tabular-nums " +
                      (row.netPnl > 0 ? "text-success" : row.netPnl < 0 ? "text-danger" : "text-fg-muted")
                    }
                  >
                    {signed(row.netPnl)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">{rText(row.totalR)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TradeList({
  trades,
  onReview,
}: {
  trades: CoachTradeListItem[];
  onReview: (id: string) => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardList className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-fg">Recent closed trades</h3>
        <span className="text-[11px] text-fg-faint">Review one trade at a time</span>
      </div>
      {trades.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-fg-muted">
          Close a journal trade to unlock an individual review.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-fg-faint">
                <th className="py-1 font-medium">Closed</th>
                <th className="py-1 font-medium">Symbol</th>
                <th className="py-1 font-medium">Side</th>
                <th className="py-1 font-medium">Source</th>
                <th className="py-1 text-right font-medium">P&L</th>
                <th className="py-1 font-medium">Review</th>
                <th className="py-1 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.id} className="border-t border-hairline">
                  <td className="py-2 text-fg-muted">
                    {trade.closedAt ? formatLocalDateTime(trade.closedAt) : "n/a"}
                  </td>
                  <td className="py-2 font-medium text-fg">{trade.symbol}</td>
                  <td className="py-2">
                    <Badge tone={trade.side === "buy" ? "success" : "danger"}>
                      {trade.side.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="py-2">
                    <Badge tone={trade.verified ? "muted" : "accent"}>
                      {trade.verified ? "Verified" : "Self-reported"}
                    </Badge>
                  </td>
                  <td
                    className={
                      "py-2 text-right tabular-nums " +
                      (trade.pnl == null ? "text-fg-faint" : trade.pnl > 0 ? "text-success" : trade.pnl < 0 ? "text-danger" : "text-fg-muted")
                    }
                  >
                    {signed(trade.pnl)}
                  </td>
                  <td className="py-2">
                    {trade.reviewed ? <Badge tone="accent">Reviewed</Badge> : <span className="text-fg-faint">Not yet</span>}
                  </td>
                  <td className="py-2 text-right">
                    <Button size="sm" variant="secondary" onClick={() => onReview(trade.id)}>
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TradeReviewPanel({
  data,
  error,
  onGenerate,
}: {
  data: CoachTradeResponse;
  error: string | null;
  onGenerate: () => Promise<void>;
}) {
  const facts = data.facts;
  const report = data.report;
  const sections = report?.sections ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={facts.side === "buy" ? "success" : "danger"}>{facts.side.toUpperCase()}</Badge>
        <Badge tone={facts.verified ? "muted" : "accent"}>
          {facts.verified ? "Verified broker record" : "Self-reported"}
        </Badge>
        <Badge tone={outcomeTone(facts.outcome)}>{facts.outcome.toUpperCase()}</Badge>
        <span className="text-[11px] text-fg-faint">
          {facts.closedAt ? `closed ${formatLocalDateTime(facts.closedAt)}` : "close time unavailable"}
        </span>
        <Button
          size="sm"
          variant="primary"
          className="ml-auto"
          icon={report ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
          onClickAsync={onGenerate}
        >
          {report ? "Regenerate" : "Generate review"}
        </Button>
      </div>

      {error && <Flash tone="danger">{error}</Flash>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <TradeMetric label="Entry" value={signed(facts.entryPrice, 5)} />
        <TradeMetric label="Exit" value={signed(facts.exitPrice, 5)} />
        <TradeMetric label="Stop" value={signed(facts.stop, 5)} />
        <TradeMetric label="Target" value={signed(facts.target, 5)} />
        <TradeMetric label="P&L" value={signed(facts.pnl)} />
        <TradeMetric label="Realized R" value={rText(facts.realizedR)} />
        <TradeMetric label="Planned R:R" value={facts.plannedRr == null ? "n/a" : facts.plannedRr.toFixed(2)} />
        <TradeMetric label="Holding" value={facts.holdingHours == null ? "n/a" : `${formatNumber(facts.holdingHours, { maximumFractionDigits: 2 })}h`} />
        <TradeMetric label="Exit vs plan" value={exitLabel(facts.exitVsPlan)} />
        <TradeMetric label="Fees" value={signed(facts.fees)} />
      </div>

      {facts.missing.length > 0 && (
        <Flash tone="warning">Missing fields: {facts.missing.join(", ")}.</Flash>
      )}
      {facts.caveats.length > 0 && (
        <div className="rounded-xl border border-hairline bg-soft p-3">
          <div className="text-[10.5px] font-medium uppercase tracking-wider text-fg-faint">Data notes</div>
          <ul className="mt-1.5 space-y-1">
            {facts.caveats.map((caveat) => (
              <li key={caveat} className="text-[11.5px] leading-relaxed text-fg-muted">
                {caveat}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(facts.strategy || facts.tags.length > 0 || facts.note) && (
        <div className="rounded-xl border border-hairline bg-soft p-3">
          {facts.strategy && (
            <div className="text-[11px] text-fg-faint">
              Strategy: <span className="text-fg-muted">{facts.strategy}</span>
            </div>
          )}
          {facts.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {facts.tags.map((tag) => (
                <Badge key={tag} tone="muted">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          {facts.note && (
            <p className="mt-2 whitespace-pre-wrap border-t border-hairline pt-2 text-[11.5px] leading-relaxed text-fg-muted">
              {facts.note}
            </p>
          )}
        </div>
      )}

      {!report || !sections ? (
        <div className="rounded-xl border border-hairline bg-soft p-4 text-[12.5px] leading-relaxed text-fg-muted">
          No review has been generated for this trade. The recorded facts above are ready to review.
        </div>
      ) : (
        <div className="space-y-3">
          {report.error && <Flash tone={data.aiReady ? "danger" : "warning"}>{report.error}</Flash>}
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg-muted">{sections.summary}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ReviewList
              title="What worked"
              items={sections.worked}
              icon={<TrendingUp className="h-3.5 w-3.5 text-success" />}
            />
            <ReviewList
              title="What to change"
              items={sections.improve}
              icon={<TrendingDown className="h-3.5 w-3.5 text-danger" />}
            />
          </div>
          <div className="rounded-xl border border-accent/30 bg-accent-soft p-3">
            <div className="text-[10.5px] font-medium uppercase tracking-wider text-accent">
              Reflection question
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">{sections.question}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-fg-faint">
            <CalendarDays className="h-3.5 w-3.5" />
            {report.model ? `${report.model} | ` : ""}generated {formatLocalDateTime(report.generatedAt)}
          </div>
        </div>
      )}

      <p className="border-t border-hairline pt-3 text-[10.5px] leading-relaxed text-fg-faint">
        Generating a review sends this trade's recorded journal fields and truncated note to the
        configured AI provider. Coaching focuses on process and record keeping, not market predictions
        or trade instructions.
      </p>
    </div>
  );
}

function TradeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-soft p-2">
      <div className="text-[10px] uppercase tracking-wider text-fg-faint">{label}</div>
      <div className="mt-0.5 text-[12.5px] font-medium tabular-nums text-fg">{value}</div>
    </div>
  );
}
