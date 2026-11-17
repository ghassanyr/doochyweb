import { useState } from "react";
import { ChevronDown, LogIn, SlidersHorizontal } from "lucide-react";

import type { WatchlistMode } from "../api";
import { Card } from "../components/ui";
import { ASSET_FILTERS, type AssetFilter } from "./assetClass";
import { SymbolSearch } from "./SymbolSearch";
import type { CatalogEntry } from "./types";

// The Analysis filters used to be a full-width toolbar above the grid. They now
// live in a narrow panel on the right at xl and up. Below that the panel is a
// collapsed card above the grid, so the same controls stay reachable on phones
// without eating the first screen.

const chipClass = (active: boolean) =>
  "rounded-md px-2 py-1 text-[11px] font-medium transition " +
  (active
    ? "border border-accent/20 bg-accent-soft text-accent"
    : "border border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg");

export function AnalysisFilters({
  timeframes,
  timeframe,
  onTimeframeChange,
  assetFilter,
  assetCounts,
  onAssetFilterChange,
  signedIn,
  mode,
  resultCount,
  limit,
  onSwitchMode,
  onSignIn,
  canEdit,
  catalog,
  onAddSymbol,
}: {
  timeframes: { id: string; label: string }[];
  timeframe: string;
  onTimeframeChange: (id: string) => void;
  assetFilter: AssetFilter;
  assetCounts: Record<AssetFilter, number>;
  onAssetFilterChange: (id: AssetFilter) => void;
  signedIn: boolean;
  mode: WatchlistMode;
  resultCount: number;
  limit: number;
  onSwitchMode: (mode: WatchlistMode) => void;
  onSignIn?: () => void;
  canEdit: boolean;
  catalog: CatalogEntry[];
  onAddSymbol: (symbol: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeTimeframe = timeframes.find((t) => t.id === timeframe)?.label ?? timeframe;
  const activeAsset = ASSET_FILTERS.find((f) => f.id === assetFilter)?.label ?? "All";

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="analysis-filter-panel"
        className={
          "flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-surface-hover xl:hidden " +
          (open ? "rounded-t-2xl" : "rounded-2xl")
        }
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0 text-fg-faint" />
        <span className="text-sm font-semibold text-fg">Filters</span>
        <span className="ml-auto truncate text-[11px] text-fg-faint">
          {activeTimeframe} · {activeAsset}
        </span>
        <ChevronDown
          className={
            "h-4 w-4 shrink-0 text-fg-faint transition " + (open ? "rotate-180" : "")
          }
        />
      </button>

      <div
        id="analysis-filter-panel"
        className={
          (open ? "block " : "hidden ") +
          "border-t border-hairline p-3 xl:block xl:border-t-0"
        }
      >
        <div className="hidden items-center gap-2 xl:flex">
          <SlidersHorizontal className="h-4 w-4 text-fg-faint" />
          <h2 className="text-sm font-semibold tracking-tight text-fg">Filters</h2>
        </div>

        <section className="xl:mt-3">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-wide text-fg-faint">
            Timeframe
          </h3>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {timeframes.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={t.id === timeframe}
                onClick={() => onTimeframeChange(t.id)}
                className={chipClass(t.id === timeframe)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-4 border-t border-hairline pt-3">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-wide text-fg-faint">
            Asset class
          </h3>
          <div
            role="group"
            aria-label="Filter by asset class"
            className="mt-1.5 flex flex-wrap gap-1"
          >
            {ASSET_FILTERS.map((f) => {
              const active = f.id === assetFilter;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onAssetFilterChange(f.id)}
                  className={chipClass(active) + " inline-flex items-center gap-1"}
                >
                  {f.label}
                  <span
                    className={
                      "tabular-nums text-[10px] " + (active ? "opacity-70" : "text-fg-faint")
                    }
                  >
                    {assetCounts[f.id]}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-4 border-t border-hairline pt-3">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-wide text-fg-faint">
            Watchlist
          </h3>

          {signedIn ? (
            <>
              <div
                role="group"
                aria-label="Watchlist source"
                className="mt-1.5 grid grid-cols-2 gap-0.5 rounded-lg border border-hairline p-0.5"
              >
                {(
                  [
                    { id: "site" as const, label: "Site list" },
                    { id: "mine" as const, label: "My watchlist" },
                  ]
                ).map((option) => {
                  const active = mode === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onSwitchMode(option.id)}
                      className={
                        "rounded px-2 py-1 text-[11px] font-medium transition " +
                        (active
                          ? "bg-accent-soft text-accent"
                          : "text-fg-muted hover:bg-surface-hover hover:text-fg")
                      }
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              {mode === "mine" && (
                <p className="mt-1.5 tabular-nums text-[11px] text-fg-faint">
                  {resultCount}/{limit} markets
                </p>
              )}

              {canEdit ? (
                <div className="mt-3">
                  <h3 className="text-[10.5px] font-semibold uppercase tracking-wide text-fg-faint">
                    Add market
                  </h3>
                  <div className="mt-1.5">
                    <SymbolSearch catalog={catalog} onAdd={onAddSymbol} />
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
                  The site list is curated by an admin. Switch to{" "}
                  <button
                    type="button"
                    onClick={() => onSwitchMode("mine")}
                    className="font-medium text-accent hover:underline"
                  >
                    My watchlist
                  </button>{" "}
                  to add, remove or reorder markets.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mt-1.5 text-[11px] text-fg-faint">This is the site watchlist.</p>
              {onSignIn && (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Sign in to build your own
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </Card>
  );
}
