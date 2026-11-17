import { useCallback, useEffect, useState } from "react";

import { marketApi } from "../api";
import { FadeRise } from "../components/motion";
import { Breakouts } from "./Breakouts";
import { MarketDetail } from "./MarketDetail";
import { MarketSnapshots } from "./MarketSnapshots";
import { DEFAULT_TIMEFRAME, timeframes as staticTimeframes } from "./timeframes";

export default function BreakoutsPage({
  canRefresh,
}: {
  /** Signed-in users can force a broker read; anonymous visitors cannot. */
  canRefresh: boolean;
}) {
  const [timeframe, setTimeframe] = useState(DEFAULT_TIMEFRAME);
  const [timeframes, setTimeframes] = useState(staticTimeframes);
  const [strongRatio, setStrongRatio] = useState(0.25);
  const [canRemove, setCanRemove] = useState(false);
  const [detail, setDetail] = useState<{ symbol: string; timeframe: string } | null>(null);

  useEffect(() => {
    let alive = true;
    marketApi
      .config()
      .then((c) => {
        if (!alive) return;
        setTimeframes(c.timeframes);
        setStrongRatio(c.settings.strongRatio);
        setTimeframe((current) =>
          current === DEFAULT_TIMEFRAME ? c.settings.defaultTimeframe || c.defaultTimeframe : current
        );
      })
      .catch(() => {});
    // Removing a symbol is only valid while the member is on their own list.
    marketApi
      .watchlist()
      .then((view) => {
        if (alive) setCanRemove(view.mode === "mine");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const openSymbol = useCallback(
    (symbol: string) => setDetail({ symbol, timeframe }),
    [timeframe]
  );

  return (
    <FadeRise>
      <div className="space-y-3">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Breakouts</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            Markets pressing through key levels.
          </p>
        </header>

        <Breakouts onOpenSymbol={openSymbol} />
        <MarketSnapshots onOpenSymbol={openSymbol} />
      </div>

      {detail && (
        <MarketDetail
          symbol={detail.symbol}
          timeframe={detail.timeframe}
          strongRatio={strongRatio}
          timeframes={timeframes}
          canRefresh={canRefresh}
          canRemove={canRemove}
          onClose={() => setDetail(null)}
          onRemove={(symbol) => {
            void marketApi.removeSymbol(symbol).catch(() => {});
          }}
          onTimeframeChange={(tf) => {
            setTimeframe(tf);
            setDetail((d) => (d ? { ...d, timeframe: tf } : d));
          }}
        />
      )}
    </FadeRise>
  );
}
