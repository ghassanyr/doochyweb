import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";
import type { OrderRow, PositionRow } from "./api";
import type { ViewMode } from "./Dashboard";
import { Card, Chip } from "./components/ui";

export type SortKey =
  | "symbol"
  | "side"
  | "lots"
  | "entryPrice"
  | "price"
  | "netUsd"
  | "stopLoss"
  | "takeProfit"
  | "openTimestamp"
  | "expirationTimestamp"
  | "orderType"
  | "account";

export type NetState = "any" | "profit" | "loss";

export interface FilterState {
  search: string;
  symbolsSel: string[];
  sides: string[];
  orderTypesSel: string[];
  netState: NetState;
  netMin: number | null;
  netMax: number | null;
  distMin: number | null;
  distMax: number | null;
  sortKey: SortKey;
  sortAsc: boolean;
}

export type FilterPatch = Partial<FilterState>;

export const DEFAULT_FILTER: FilterState = {
  search: "",
  symbolsSel: [],
  sides: [],
  orderTypesSel: [],
  netState: "any",
  netMin: null,
  netMax: null,
  distMin: null,
  distMax: null,
  sortKey: "openTimestamp",
  sortAsc: false,
};

function toggleIn(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function netMatches(p: PositionRow, st: FilterState): boolean {
  if (st.netState === "any") return true;
  if (p.netUsd == null) return false;
  const okState = st.netState === "profit" ? p.netUsd > 0 : p.netUsd < 0;
  if (!okState) return false;
  if (st.netMin != null && p.netUsd < st.netMin) return false;
  if (st.netMax != null && p.netUsd > st.netMax) return false;
  return true;
}

function distFromMarket(o: OrderRow): number | null {
  if (o.price == null) return null;
  const other = o.takeProfit ?? o.stopLoss;
  if (other == null) return null;
  return Math.abs(o.price - other);
}

// Combined-mode account label used for the Account sort (nickname when set,
// otherwise the login number). Rows without an account sort as empty.
function accountLabel(r: PositionRow | OrderRow): string {
  const acct = r.account;
  if (!acct) return "";
  return acct.nickname ? String(acct.nickname) : String(acct.login);
}

export function applyFilter<T extends PositionRow | OrderRow>(
  rows: readonly T[],
  st: FilterState
): T[] {
  const q = st.search.trim().toLowerCase();
  const syms = new Set(st.symbolsSel);
  const sides = new Set(st.sides);
  const types = new Set(st.orderTypesSel);

  return rows.filter((r) => {
    if (syms.size > 0 && !syms.has(r.symbol)) return false;
    if (sides.size > 0 && !sides.has(r.side)) return false;
    if ("positionId" in r) {
      if (!netMatches(r as PositionRow, st)) return false;
    } else {
      if (types.size > 0 && !types.has((r as OrderRow).orderType)) return false;
      const d = distFromMarket(r as OrderRow);
      if (st.distMin != null && (d == null || d < st.distMin)) return false;
      if (st.distMax != null && (d == null || d > st.distMax)) return false;
    }
    if (!q) return true;
    const symLower = r.symbol.toLowerCase();
    return (
      symLower.includes(q) ||
      r.side.toLowerCase().includes(q) ||
      ("positionId" in r
        ? String((r as PositionRow).positionId).includes(q)
        : String((r as OrderRow).orderId).includes(q))
    );
  });
}

function cmpVal(a: number | null | undefined, b: number | null | undefined): number {
  const A = a ?? Number.NEGATIVE_INFINITY;
  const B = b ?? Number.NEGATIVE_INFINITY;
  return A === B ? 0 : A < B ? -1 : 1;
}

export function sortRows<T extends PositionRow | OrderRow>(
  rows: readonly T[],
  key: SortKey,
  asc: boolean
): T[] {
  const dir = asc ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    let c = 0;
    switch (key) {
      case "symbol":
        c = a.symbol.localeCompare(b.symbol);
        break;
      case "side":
        c = a.side.localeCompare(b.side);
        break;
      case "lots":
        c = cmpVal(a.lots, b.lots);
        break;
      case "entryPrice":
        c = cmpVal("entryPrice" in a ? a.entryPrice : null, "entryPrice" in b ? b.entryPrice : null);
        break;
      case "price":
        c = cmpVal("price" in a ? (a as OrderRow).price : null, "price" in b ? (b as OrderRow).price : null);
        break;
      case "netUsd":
        c = cmpVal("netUsd" in a ? a.netUsd : null, "netUsd" in b ? b.netUsd : null);
        break;
      case "stopLoss":
        c = cmpVal(a.stopLoss, b.stopLoss);
        break;
      case "takeProfit":
        c = cmpVal(a.takeProfit, b.takeProfit);
        break;
      case "openTimestamp":
        c = cmpVal("openTimestamp" in a ? a.openTimestamp : null, "openTimestamp" in b ? b.openTimestamp : null);
        break;
      case "expirationTimestamp":
        c = cmpVal("expirationTimestamp" in a ? a.expirationTimestamp : null, "expirationTimestamp" in b ? b.expirationTimestamp : null);
        break;
      case "orderType":
        c = ("orderType" in a ? a.orderType : "").localeCompare("orderType" in b ? b.orderType : "");
        break;
      case "account":
        c = accountLabel(a).localeCompare(accountLabel(b));
        break;
      default:
        c = 0;
    }
    return c * dir || (a.symbol.localeCompare(b.symbol) || 0);
  });
  return sorted;
}

const STORAGE_POS = "doochyweb_pos_filters";
const STORAGE_ORD = "doochyweb_ord_filters";

export function loadFilter(orders: boolean): FilterState {
  const key = orders ? STORAGE_ORD : STORAGE_POS;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...DEFAULT_FILTER };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_FILTER, ...parsed };
  } catch {
    return { ...DEFAULT_FILTER };
  }
}

export function saveFilter(orders: boolean, st: FilterState): void {
  try {
    localStorage.setItem(orders ? STORAGE_ORD : STORAGE_POS, JSON.stringify(st));
  } catch {
    /* ignore */
  }
}

export function uniqueSymbols(rows: readonly (PositionRow | OrderRow)[]): string[] {
  return Array.from(new Set(rows.map((r) => r.symbol))).sort((a, b) => a.localeCompare(b));
}

function sortOptionsFor(positions: boolean): Array<[SortKey, string]> {
  return positions
    ? [
        ["symbol", "Symbol"],
        ["side", "Side"],
        ["lots", "Lots"],
        ["entryPrice", "Entry"],
        ["stopLoss", "SL"],
        ["takeProfit", "TP"],
        ["netUsd", "Net USD"],
        ["openTimestamp", "Opened"],
        ["account", "Account"],
      ]
    : [
        ["symbol", "Symbol"],
        ["side", "Side"],
        ["lots", "Lots"],
        ["orderType", "Type"],
        ["price", "Level"],
        ["stopLoss", "SL"],
        ["takeProfit", "TP"],
        ["account", "Account"],
      ];
}

// A pill toggle used for Side / Type filters.
function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-md border px-2.5 py-1 text-xs font-medium transition " +
        (active
          ? "border-accent/20 bg-accent-soft text-accent"
          : "border-hairline bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg")
      }
    >
      {children}
    </button>
  );
}

export default function FilterBar({
  mode,
  orders,
  positions,
  symbols,
  orderTypes,
  state,
  onChange,
  leading,
}: {
  mode: ViewMode;
  orders?: boolean;
  positions?: boolean;
  symbols: string[];
  orderTypes?: string[];
  state: FilterState;
  onChange: (patch: FilterPatch) => void;
  /** Optional content shown at the start of the row, before the search box. */
  leading?: ReactNode;
}) {
  const [symOpen, setSymOpen] = useState(false);
  const [symQuery, setSymQuery] = useState("");
  const [activeSym, setActiveSym] = useState(-1);
  const symRef = useRef<HTMLDivElement>(null);
  const symInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onDoc(ev: MouseEvent) {
      if (symRef.current && !symRef.current.contains(ev.target as Node)) setSymOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const symMatches = useMemo(() => {
    const q = symQuery.trim().toUpperCase();
    const all = q ? symbols.filter((s) => s.toUpperCase().includes(q)) : symbols;
    return all.filter((s) => !state.symbolsSel.includes(s)).slice(0, 50);
  }, [symbols, symQuery, state.symbolsSel]);

  function addSymbol(s: string): void {
    if (!state.symbolsSel.includes(s)) onChange({ symbolsSel: [...state.symbolsSel, s] });
    setSymQuery("");
    setActiveSym(-1);
    setSymOpen(true);
    symInputRef.current?.focus();
  }

  function deleteSymbol(s: string): void {
    onChange({ symbolsSel: state.symbolsSel.filter((x) => x !== s) });
  }

  function onSymKey(ev: KeyboardEvent<HTMLInputElement>): void {
    if (ev.key === "Escape") {
      setSymOpen(false);
      return;
    }
    if (!symOpen || symMatches.length === 0) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActiveSym((i) => (i + 1) % symMatches.length);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActiveSym((i) => (i <= 0 ? symMatches.length - 1 : i - 1));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const pick = symMatches[activeSym >= 0 ? activeSym : 0];
      if (pick) addSymbol(pick);
    }
  }

  const hasActive =
    state.search.trim() !== "" ||
    state.symbolsSel.length > 0 ||
    state.sides.length > 0 ||
    state.orderTypesSel.length > 0 ||
    state.netState !== "any" ||
    state.netMin != null ||
    state.netMax != null ||
    state.distMin != null ||
    state.distMax != null;

  const sortOptions = sortOptionsFor(!!positions);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        {leading}

        {/* free-text search */}
        <div className="relative flex w-full min-w-[170px] items-center sm:w-56 sm:flex-none">
          <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-fg-muted" />
          <input
            type="search"
            placeholder={orders ? "Search pending orders…" : "Search positions…"}
            value={state.search}
            onChange={(e) => onChange({ search: e.target.value })}
            aria-label="Search"
            className="w-full rounded-lg border border-hairline-strong bg-soft py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>

        {/* symbol multi-select combobox */}
        <div className="relative min-w-[150px] flex-none" ref={symRef}>
          <div className="relative">
            <Plus className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
            <input
              ref={symInputRef}
              type="text"
              placeholder="Symbol…"
              value={symQuery}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setSymQuery(e.target.value);
                setActiveSym(-1);
                setSymOpen(true);
              }}
              onFocus={() => setSymOpen(true)}
              onKeyDown={onSymKey}
              aria-label="Add symbol filter"
              className="w-full rounded-lg border border-hairline-strong bg-soft py-2 pl-9 pr-8 text-sm text-fg placeholder:text-fg-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            {state.symbolsSel.length > 0 && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-faint transition hover:text-fg"
                title="Clear all symbol filters"
                onClick={() => onChange({ symbolsSel: [] })}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {symOpen && (
            <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-60 overflow-y-auto rounded-lg border border-hairline bg-surface p-1 shadow-overlay">
              {symMatches.length === 0 ? (
                <div className="px-2.5 py-2 text-xs text-fg-muted">
                  {symQuery ? "No matching symbols" : "No symbols available"}
                </div>
              ) : (
                symMatches.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onMouseEnter={() => setActiveSym(i)}
                    onClick={() => addSymbol(s)}
                    className={
                      "block w-full rounded-md px-2.5 py-1.5 text-left text-sm transition " +
                      (i === activeSym ? "bg-accent-soft text-accent" : "text-fg hover:bg-surface-hover")
                    }
                  >
                    {s}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* side pills */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-fg-muted">Side</span>
          <Pill active={state.sides.length === 0} onClick={() => onChange({ sides: [] })}>
            Any
          </Pill>
          {["BUY", "SELL"].map((sd) => (
            <Pill key={sd} active={state.sides.includes(sd)} onClick={() => onChange({ sides: toggleIn(state.sides, sd) })}>
              {sd}
            </Pill>
          ))}
        </div>

        {/* order type pills */}
        {orders && orderTypes && orderTypes.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Type</span>
            <Pill active={state.orderTypesSel.length === 0} onClick={() => onChange({ orderTypesSel: [] })}>
              Any
            </Pill>
            {orderTypes.map((t) => (
              <Pill
                key={t}
                active={state.orderTypesSel.includes(t)}
                onClick={() => onChange({ orderTypesSel: toggleIn(state.orderTypesSel, t) })}
              >
                {t}
              </Pill>
            ))}
          </div>
        )}

        {/* net P/L range (positions) */}
        {positions && state.netState !== "any" && (
          <div className="flex items-center gap-1.5">
            <select
              value={state.netState}
              onChange={(e) => onChange({ netState: e.target.value as NetState })}
              aria-label="Net P/L"
              className="rounded-lg border border-hairline-strong bg-soft px-2 py-1.5 text-xs text-fg focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              <option value="any">P/L any</option>
              <option value="profit">Profit</option>
              <option value="loss">Loss</option>
            </select>
            <input
              type="number"
              className="w-[64px] rounded-lg border border-hairline-strong bg-soft px-2 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="min $"
              value={state.netMin ?? ""}
              onChange={(e) => onChange({ netMin: e.target.value === "" ? null : Number(e.target.value) })}
            />
            <span className="text-xs text-fg-muted">-</span>
            <input
              type="number"
              className="w-[64px] rounded-lg border border-hairline-strong bg-soft px-2 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="max $"
              value={state.netMax ?? ""}
              onChange={(e) => onChange({ netMax: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </div>
        )}

        {/* distance range (orders) */}
        {orders && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Dist (pts)</span>
            <input
              type="number"
              className="w-[60px] rounded-lg border border-hairline-strong bg-soft px-2 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="min"
              value={state.distMin ?? ""}
              onChange={(e) => onChange({ distMin: e.target.value === "" ? null : Number(e.target.value) })}
            />
            <span className="text-xs text-fg-muted">-</span>
            <input
              type="number"
              className="w-[60px] rounded-lg border border-hairline-strong bg-soft px-2 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="max"
              value={state.distMax ?? ""}
              onChange={(e) => onChange({ distMax: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </div>
        )}

        {/* sort */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-fg-muted">Sort</span>
          <select
            value={state.sortKey}
            onChange={(e) => onChange({ sortKey: e.target.value as SortKey })}
            aria-label="Sort by"
            className="rounded-lg border border-hairline-strong bg-soft px-2 py-1.5 text-xs text-fg focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            {sortOptions.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onChange({ sortAsc: !state.sortAsc })}
            aria-label={state.sortAsc ? "Sorted ascending" : "Sorted descending"}
            title={state.sortAsc ? "Ascending" : "Descending"}
            className="rounded-lg border border-hairline-strong bg-soft px-1.5 py-1.5 text-fg-muted transition hover:bg-surface-hover hover:text-fg"
          >
            {state.sortAsc ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {hasActive && (
          <button
            type="button"
            onClick={() =>
              onChange({
                search: "",
                symbolsSel: [],
                sides: [],
                orderTypesSel: [],
                netState: "any",
                netMin: null,
                netMax: null,
                distMin: null,
                distMax: null,
              })
            }
            className="ml-auto rounded-lg border border-hairline-strong bg-soft px-2.5 py-1.5 text-xs text-fg-muted transition hover:border-danger/40 hover:text-danger"
          >
            Reset
          </button>
        )}
      </div>

      {(state.symbolsSel.length > 0 || state.sides.length > 0 || state.orderTypesSel.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-hairline pt-3">
          {state.symbolsSel.map((s) => (
            <Chip key={s} onRemove={() => deleteSymbol(s)}>
              {s}
            </Chip>
          ))}
          {state.sides.map((s) => (
            <Chip key={s} onRemove={() => onChange({ sides: state.sides.filter((x) => x !== s) })}>
              {s}
            </Chip>
          ))}
          {state.orderTypesSel.map((t) => (
            <Chip key={t} onRemove={() => onChange({ orderTypesSel: state.orderTypesSel.filter((x) => x !== t) })}>
              {t}
            </Chip>
          ))}
        </div>
      )}
    </Card>
  );
}