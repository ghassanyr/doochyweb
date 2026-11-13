import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Check, Search } from "lucide-react";
import { api, AccountView, OrderKind, OrderPreview, Side, SymbolQuote } from "../api";
import { fmtMoney } from "../Dashboard";
import { accountColorHex, Button, Metric } from "../components/ui";
import { ConfirmModal, ModalShell, Seg, TicketField, posNum } from "./ui";

const PREVIEW_MS = 300;

function fmtLots(n: number | null | undefined, digits?: number): string {
  if (n == null) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits ?? 4 });
}

// New-order ticket. The server's preview endpoint is the authority: it resolves
// the symbol, validates the levels and snaps the size to the broker's grid, and
// the order is placed with the exact snapped size so what you confirm is what
// goes out. The ticket can target one or several accounts; each account gets its
// own preview (symbol availability and lot grids can differ) and the order is
// placed on every selected account in turn.
export default function OrderTicket({
  open,
  onClose,
  onDone,
  accounts,
  defaultCtids,
  symbols,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  accounts: AccountView[];
  /** Accounts ticked when the ticket opens: the current account, or all in combined mode. */
  defaultCtids: number[];
  symbols: string[];
}) {
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderKind>("MARKET");
  const [price, setPrice] = useState("");
  const [lots, setLots] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [selectedCtids, setSelectedCtids] = useState<number[]>([]);
  // "All accounts" is its own mode: while it is on, the individual account
  // options render unselected, but the order still targets every account.
  const [allSelected, setAllSelected] = useState(false);
  const [previews, setPreviews] = useState<Record<number, OrderPreview>>({});
  const [previewErrs, setPreviewErrs] = useState<Record<number, string>>({});
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const debounce = useRef<number | null>(null);
  // Previews can overlap now that a market quote may take a moment to arrive;
  // only the newest response may update the panel.
  const previewSeq = useRef(0);
  // The accounts' full tradable universes come from the brokers. The `symbols`
  // prop only covers symbols already held as positions/orders, so on a fresh
  // account it is empty and cannot drive the ticket.
  const [accountSymbols, setAccountSymbols] = useState<Record<number, string[]>>({});
  const [symbolsLoading, setSymbolsLoading] = useState<Record<number, boolean>>({});
  const [symbolsErr, setSymbolsErr] = useState<Record<number, string>>({});
  // Latest bid/ask per selected account for the chosen symbol. Quotes can differ
  // between brokers (and live vs demo), so they are kept per account and polled.
  const [quotes, setQuotes] = useState<Record<number, SymbolQuote | null>>({});

  const selectedKey = selectedCtids.join(",");

  const selectedSymbolLists = selectedCtids
    .map((id) => accountSymbols[id])
    .filter((list): list is string[] => list != null);

  // In combined mode (or when several accounts are ticked) only offer symbols
  // every selected account can trade, so one click can't half-fail by design.
  const availableSymbols = useMemo(() => {
    if (selectedCtids.length === 0) return [];
    if (selectedCtids.length === 1) {
      const list = accountSymbols[selectedCtids[0]];
      // Keep held/resting symbols too, in case one is no longer in the broker's
      // current list (archived but still open).
      if (list && list.length > 0) return [...new Set([...list, ...symbols])].sort((a, b) => a.localeCompare(b));
      return symbols;
    }
    if (selectedSymbolLists.length !== selectedCtids.length) return [];
    const sets = selectedSymbolLists.map((list) => new Set(list));
    return selectedSymbolLists[0]
      .filter((s) => sets.every((set) => set.has(s)))
      .sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, accountSymbols, symbols]);

  const symbolsPending = selectedCtids.some(
    (id) => symbolsLoading[id] || (accountSymbols[id] == null && !symbolsErr[id])
  );
  const symbolsErrorText = selectedCtids
    .map((id) => (symbolsErr[id] ? `${accountName(accounts, id)}: ${symbolsErr[id]}` : null))
    .filter(Boolean)
    .join(" · ");

  const symbolsRef = useRef(availableSymbols);
  symbolsRef.current = availableSymbols;

  const [symOpen, setSymOpen] = useState(false);
  const [symQuery, setSymQuery] = useState("");
  const [activeSym, setActiveSym] = useState(-1);
  const symRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(ev: MouseEvent) {
      if (symRef.current && !symRef.current.contains(ev.target as Node)) setSymOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const symMatches = useMemo(() => {
    const q = symQuery.trim().toUpperCase();
    return (q ? availableSymbols.filter((s) => s.toUpperCase().includes(q)) : availableSymbols).slice(0, 50);
  }, [availableSymbols, symQuery]);

  function pickSymbol(s: string): void {
    setSymbol(s);
    setSymQuery("");
    setSymOpen(false);
    setActiveSym(-1);
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
      if (pick) pickSymbol(pick);
    }
  }

  useEffect(() => {
    if (open) {
      const initial = defaultCtids.filter((id) => accounts.some((a) => a.ctid === id));
      setSelectedCtids(initial);
      setAllSelected(accounts.length > 0 && initial.length === accounts.length);
      setAccountSymbols({});
      setSymbolsLoading({});
      setSymbolsErr({});
      setSymbol((cur) => (symbolsRef.current.includes(cur) ? cur : symbolsRef.current[0] ?? ""));
      setSide("BUY");
      setOrderType("MARKET");
      setPrice("");
      setLots("");
      setSl("");
      setTp("");
      setPreviews({});
      setPreviewErrs({});
      setQuotes({});
      setStatus(null);
      setConfirm(false);
      setSymQuery("");
      setSymOpen(false);
      setActiveSym(-1);
    }
    // Only reset when the ticket opens; account ticks and typing must survive
    // the polling/refresh renders around it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load every selected account's broker symbol list. The server caches it per
  // account, so reopening or re-ticks are cheap.
  useEffect(() => {
    if (!open || selectedCtids.length === 0) return;
    let alive = true;
    const ctids = [...selectedCtids];

    setSymbolsLoading((prev) => {
      const next = { ...prev };
      for (const id of ctids) next[id] = true;
      return next;
    });

    for (const id of ctids) {
      api
        .accountSymbols(id)
        .then(({ symbols: list }) => {
          if (!alive) return;
          setAccountSymbols((prev) => ({ ...prev, [id]: list }));
          setSymbolsErr((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
        })
        .catch((e: any) => {
          if (!alive) return;
          setSymbolsErr((prev) => ({ ...prev, [id]: e?.message || "Could not load symbols" }));
        })
        .finally(() => {
          if (!alive) return;
          setSymbolsLoading((prev) => ({ ...prev, [id]: false }));
        });
    }
    return () => {
      alive = false;
    };
    // Re-run only when the ticket opens or the account selection changes; state
    // written by this effect must not tear down its own in-flight requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedKey]);

  // Once the lists arrive (or the selection changes), keep the symbol valid.
  // While lists are loading they are briefly empty; don't clear the user's pick
  // in that window.
  useEffect(() => {
    if (!open || availableSymbols.length === 0) return;
    setSymbol((cur) => (availableSymbols.includes(cur) ? cur : availableSymbols[0] ?? ""));
  }, [open, availableSymbols]);

  // Poll the live price for the chosen symbol(s) while the ticket is open. The
  // spot stream is cached server-side, so a poll is a cheap read once the symbol
  // has been subscribed; the first call waits briefly for the opening tick.
  useEffect(() => {
    if (!open || !symbol || selectedCtids.length === 0) {
      setQuotes({});
      return;
    }
    let alive = true;
    let inflight = false;
    const ctids = [...selectedCtids];
    setQuotes({});

    async function tick() {
      if (inflight) return;
      inflight = true;
      const settled = await Promise.allSettled(ctids.map((id) => api.accountQuote(id, symbol)));
      inflight = false;
      if (!alive) return;
      const next: Record<number, SymbolQuote | null> = {};
      settled.forEach((result, i) => {
        next[ctids[i]] = result.status === "fulfilled" ? result.value.quote : null;
      });
      setQuotes(next);
    }

    void tick();
    const timer = window.setInterval(() => void tick(), 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
    // Only the chosen symbol and account set restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, symbol, selectedKey]);

  useEffect(() => {
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, []);

  const priceNum = orderType === "MARKET" ? null : posNum(price);
  const lotsNum = posNum(lots);
  const slNum = posNum(sl);
  const tpNum = posNum(tp);
  const ready = !!symbol && lotsNum != null && (orderType === "MARKET" || priceNum != null);

  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    const seq = ++previewSeq.current;
    if (!ready || selectedCtids.length === 0) {
      setPreviews({});
      setPreviewErrs({});
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const ctids = [...selectedCtids];
    debounce.current = window.setTimeout(async () => {
      const settled = await Promise.allSettled(
        ctids.map((id) =>
          api.previewOrder(id, {
            symbol,
            side,
            orderType,
            lots: lotsNum ?? 0,
            price: priceNum,
            sl: slNum,
            tp: tpNum,
          })
        )
      );
      if (seq !== previewSeq.current) return;
      const nextPreviews: Record<number, OrderPreview> = {};
      const nextErrs: Record<number, string> = {};
      settled.forEach((result, i) => {
        const id = ctids[i];
        if (result.status === "fulfilled") nextPreviews[id] = result.value.preview;
        else nextErrs[id] = result.reason?.message || "Could not price this order";
      });
      setPreviews(nextPreviews);
      setPreviewErrs(nextErrs);
      setPreviewing(false);
    }, PREVIEW_MS);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, orderType, symbol, side, ready, lotsNum, priceNum, slNum, tpNum]);

  const previewRows: { id: number; preview: OrderPreview | undefined; error: string | undefined }[] =
    selectedCtids.map((id) => ({
      id,
      preview: previews[id],
      error: previewErrs[id],
    }));
  const readyRows = previewRows.filter(
    (r): r is { id: number; preview: OrderPreview; error: undefined } => r.preview != null
  );
  const allPreviewed = selectedCtids.length > 0 && readyRows.length === selectedCtids.length;
  const previewErrList = previewRows
    .filter((r) => r.error)
    .map((r) => `${accountName(accounts, r.id)}: ${r.error}`);

  const sumOrNull = (values: (number | null)[]): number | null => {
    if (values.length === 0 || values.some((v) => v == null)) return null;
    return values.reduce<number>((total, v) => total + (v as number), 0);
  };
  const riskTotal = sumOrNull(readyRows.map((r) => r.preview.riskUSD));
  const rewardTotal = sumOrNull(readyRows.map((r) => r.preview.rewardUSD));
  const rrTotal = riskTotal != null && riskTotal > 0 && rewardTotal != null ? rewardTotal / riskTotal : null;
  const packedLots = readyRows.map((r) => r.preview.lots);
  const snapped = readyRows.some((r) => r.preview.snapped);
  const warnings = [...new Set(readyRows.flatMap((r) => r.preview.warnings))];

  async function place() {
    if (!allPreviewed || !lotsNum) return;
    setBusy(true);
    setStatus(null);
    let placed = 0;
    const failures: string[] = [];
    // Sequential on purpose: order error events carry no label, so overlapping
    // placements on accounts sharing a socket could mis-attribute a rejection.
    for (const id of selectedCtids) {
      const previewForAccount = previews[id];
      if (!previewForAccount) {
        failures.push(`${accountName(accounts, id)}: missing preview`);
        continue;
      }
      try {
        await api.placeOrder(id, {
          symbol,
          side,
          orderType,
          lots: previewForAccount.lots,
          price: priceNum,
          sl: slNum,
          tp: tpNum,
        });
        placed += 1;
      } catch (e: any) {
        failures.push(`${accountName(accounts, id)}: ${e?.message || "Order failed"}`);
      }
    }
    setConfirm(false);
    onDone();
    if (placed === selectedCtids.length) {
      setStatus({
        ok: true,
        text: placed === 1 ? "Order placed" : `Order placed on ${placed} accounts`,
      });
      setLots("");
      setSl("");
      setTp("");
      setPrice("");
    } else if (placed === 0) {
      setStatus({ ok: false, text: `Order failed · ${failures.join(" · ")}` });
    } else {
      setStatus({
        ok: false,
        text: `Placed on ${placed} of ${selectedCtids.length} accounts. ${failures.join(" · ")}`,
      });
    }
    setBusy(false);
  }

  const canPlace = ready && allPreviewed && !previewing;
  const multiple = selectedCtids.length > 1;
  const singleQuote = selectedCtids.length === 1 ? (quotes[selectedCtids[0]] ?? null) : null;
  const singlePrice =
    singleQuote != null
      ? side === "BUY"
        ? singleQuote.ask || singleQuote.bid
        : singleQuote.bid || singleQuote.ask
      : null;
  const quoteFresh = singleQuote != null && Date.now() - singleQuote.time < 15_000;
  const subtitle = allSelected
    ? "All accounts"
    : selectedCtids.length === 1
      ? accountFullLabel(accounts, selectedCtids[0])
      : `${selectedCtids.length} account${selectedCtids.length === 1 ? "" : "s"} selected`;

  function toggleAccount(id: number) {
    if (allSelected) {
      setAllSelected(false);
      setSelectedCtids([id]);
      return;
    }
    setSelectedCtids((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Never leave the ticket with no account selected.
        if (next.size === 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      // Keep the list in account order so preview/status rows stay stable.
      return accounts.map((a) => a.ctid).filter((ctid) => next.has(ctid));
    });
  }

  return (
    <ModalShell open={open} onClose={onClose} title="New order" subtitle={subtitle}>
      <div className="space-y-4">
        {accounts.length > 1 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-fg-muted">Accounts</span>
              <button
                type="button"
                onClick={() => {
                  setAllSelected(true);
                  setSelectedCtids(accounts.map((a) => a.ctid));
                }}
                aria-pressed={allSelected}
                className={
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition " +
                  (allSelected
                    ? "border-accent/30 bg-accent-soft text-accent"
                    : "border-hairline-strong bg-soft text-fg-muted hover:bg-surface-hover hover:text-fg")
                }
              >
                All accounts
              </button>
            </div>
            <div className="grid max-h-44 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {accounts.map((a) => {
                const on = !allSelected && selectedCtids.includes(a.ctid);
                const hex = accountColorHex(a.color);
                return (
                  <button
                    key={a.ctid}
                    type="button"
                    onClick={() => toggleAccount(a.ctid)}
                    aria-pressed={on}
                    title={accountFullLabel(accounts, a.ctid)}
                    className={
                      "flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition " +
                      (on
                        ? "border-accent/50 bg-accent-soft text-fg"
                        : "border-hairline bg-soft text-fg-muted hover:border-hairline-strong hover:text-fg")
                    }
                  >
                    <span
                      className={
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border " +
                        (on ? "border-accent bg-accent text-accent-fg" : "border-hairline-strong")
                      }
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    {hex && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: hex }} />}
                    <span className="min-w-0 flex-1 truncate">
                      {a.nickname?.trim() || a.login}
                      <span className="text-fg-faint"> · {a.broker}</span>
                    </span>
                    <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-wide text-fg-faint">
                      {a.isLive ? "Live" : "Demo"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] leading-relaxed text-fg-faint">
              All accounts trades every account. Otherwise the order goes to every ticked account.
            </p>
          </div>
        )}

        {selectedCtids.length === 0 ? (
          <div className="text-sm text-fg-muted">Select at least one account to trade from.</div>
        ) : availableSymbols.length === 0 ? (
          <div className="text-sm text-fg-muted">
            {symbolsPending
              ? "Loading the selected accounts' symbols…"
              : symbolsErrorText
                ? `Could not load symbols: ${symbolsErrorText}`
                : "The selected accounts have no tradable symbols in common."}
          </div>
        ) : (
          <div className="space-y-4">
            {symbolsErrorText && <FlashInputError text={`Could not load symbols: ${symbolsErrorText}`} />}

            {/* Symbol */}
            <div>
              <span className="mb-2 block text-sm font-medium text-fg-muted">Symbol</span>
              <div ref={symRef} className="relative">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
                  <input
                    type="text"
                    role="combobox"
                    aria-expanded={symOpen}
                    aria-label="Symbol"
                    value={symOpen ? symQuery : symbol}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Search symbol…"
                    onChange={(e) => {
                      setSymQuery(e.target.value);
                      setActiveSym(-1);
                      setSymOpen(true);
                    }}
                    onFocus={() => setSymOpen(true)}
                    onKeyDown={onSymKey}
                    className="w-full appearance-none rounded-lg border border-hairline-strong bg-soft py-2 pl-9 pr-3 text-sm font-semibold tracking-tight text-fg placeholder:font-normal placeholder:tracking-normal placeholder:text-fg-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
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
                          onClick={() => pickSymbol(s)}
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
            </div>

            {/* Live price for the chosen symbol */}
            <div className="rounded-md border border-hairline bg-canvas/60 px-3 py-2">
              {multiple ? (
                <>
                  <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-fg-muted">
                    <span>Live price</span>
                    <span className="text-fg-faint">Bid / Ask</span>
                  </div>
                  <div className="space-y-1">
                    {selectedCtids.map((id) => {
                      const q = quotes[id];
                      return (
                        <div key={id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate text-fg-muted">{accountName(accounts, id)}</span>
                          {q ? (
                            <span className="shrink-0 tabular-nums text-fg">
                              {fmtQuote(q.bid, q.digits)} / {fmtQuote(q.ask, q.digits)}
                            </span>
                          ) : (
                            <span className="shrink-0 text-fg-faint">waiting…</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-fg-muted">
                    <span
                      className={"h-1.5 w-1.5 rounded-full " + (quoteFresh ? "bg-success" : "bg-fg-faint")}
                      title={quoteFresh ? "Live" : "Last tick"}
                    />
                    {side === "BUY" ? "Buy at" : "Sell at"}
                  </span>
                  {singleQuote && singlePrice != null ? (
                    <span className="flex items-baseline gap-3 tabular-nums">
                      <span className="text-sm font-semibold text-fg">{fmtQuote(singlePrice, singleQuote.digits)}</span>
                      <span className="text-[11px] text-fg-faint">
                        Bid {fmtQuote(singleQuote.bid, singleQuote.digits)} · Ask{" "}
                        {fmtQuote(singleQuote.ask, singleQuote.digits)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-fg-faint">waiting for a live quote…</span>
                  )}
                </div>
              )}
            </div>

            {/* Direction + order type */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <span className="block text-sm font-medium text-fg-muted">Side</span>
                <Seg
                  value={side}
                  onChange={setSide}
                  tone
                  options={[
                    { value: "BUY", label: "Buy" },
                    { value: "SELL", label: "Sell" },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <span className="block text-sm font-medium text-fg-muted">Order type</span>
                <Seg
                  value={orderType}
                  onChange={setOrderType}
                  options={[
                    { value: "MARKET", label: "Market" },
                    { value: "LIMIT", label: "Limit" },
                  ]}
                />
              </div>
            </div>

            {orderType !== "MARKET" && (
              <TicketField label="Level price" value={price} onChange={setPrice} placeholder="0.00" />
            )}
            <TicketField label="Lots" value={lots} onChange={setLots} placeholder="0.01" suffix="lots" />
            <div className="grid grid-cols-2 gap-2">
              <TicketField label="Take profit" value={tp} onChange={setTp} placeholder="0.00" />
              <TicketField label="Stop loss" value={sl} onChange={setSl} placeholder="0.00" />
            </div>

            {/* Risk preview: always visible before placing */}
            {readyRows.length > 0 ? (
              <div className="rounded-md border border-hairline bg-canvas/60 p-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Metric
                    label="If SL hits"
                    value={riskTotal != null ? `-${fmtMoney(riskTotal)}` : "-"}
                    tone="danger"
                  />
                  <Metric
                    label="At TP"
                    value={rewardTotal != null ? `+${fmtMoney(rewardTotal)}` : "-"}
                    tone="success"
                  />
                  <Metric label="R:R" value={rrTotal != null ? `1:${rrTotal.toFixed(2)}` : "-"} />
                </div>
                <div className="mt-3 border-t border-hairline pt-2 text-center text-xs tabular-nums text-fg-muted">
                  Risking <span className="font-semibold text-fg">{riskTotal != null ? fmtMoney(riskTotal) : "-"}</span>
                  {multiple ? (
                    <> total across <span className="font-semibold text-fg">{selectedCtids.length}</span> accounts</>
                  ) : (
                    <>
                      {" "}on <span className="font-semibold text-fg">{fmtLots(packedLots[0])}</span> lots
                    </>
                  )}
                  {snapped && <span className="text-fg-faint"> · adjusted to the broker's size grid</span>}
                </div>
                {multiple && (
                  <div className="mt-2 space-y-1 border-t border-hairline pt-2 text-xs">
                    {previewRows.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-fg-muted">{accountName(accounts, r.id)}</span>
                        {r.preview ? (
                          <span className="shrink-0 tabular-nums text-fg-faint">
                            {fmtLots(r.preview.lots)} lots ·{" "}
                            {r.preview.riskUSD != null ? `${fmtMoney(r.preview.riskUSD)} risk` : "risk -"}
                          </span>
                        ) : (
                          <span className="min-w-0 truncate text-danger">{r.error}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {warnings.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs text-fg-faint">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : previewErrList.length > 0 ? (
              <FlashInputError text={previewErrList.join(" · ")} />
            ) : null}

            {status && (
              <div
                className={
                  status.ok
                    ? "flex items-start gap-2 rounded-md border border-success/30 bg-success-soft px-3 py-2 text-xs text-success"
                    : "flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
                }
              >
                {status.text}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-hairline pt-4">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button
                variant="primary"
                className="min-w-[180px]"
                disabled={!canPlace || busy}
                onClick={() => setConfirm(true)}
              >
                {previewing
                  ? "Pricing…"
                  : multiple
                    ? `Place on ${selectedCtids.length} accounts`
                    : `Place ${side.toLowerCase()} order`}
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirm}
        title={`${side} ${symbol}?`}
        body={
          <span>
            {orderType === "MARKET" ? "Market order at the live price" : `${orderType.toLowerCase()} order at ${priceNum}`} on{" "}
            <strong className="text-fg">
              {selectedCtids.length === 1
                ? accountName(accounts, selectedCtids[0])
                : `${selectedCtids.length} accounts`}
            </strong>
            {selectedCtids.length === 1 ? (
              <>
                {" "}for <strong className="text-fg">{fmtLots(packedLots[0])} lots</strong>
              </>
            ) : (
              <> with sizes snapped per account</>
            )}
            , TP <strong className="text-fg">{fmtPrice(tpNum)}</strong>, SL{" "}
            <strong className="text-fg">{fmtPrice(slNum)}</strong>.
            {riskTotal != null && (
              <>
                {" "}
                You lose about <strong className="text-danger">{fmtMoney(riskTotal)}</strong> if the
                {selectedCtids.length === 1 ? " stop is" : " stops are"} hit.
              </>
            )}
            <br />
            <br />
            <span className="text-fg-faint">Manual orders skip bot cooldowns, max positions and daily limits.</span>
          </span>
        }
        confirmLabel={
          busy
            ? "Placing…"
            : multiple
              ? `Place on ${selectedCtids.length} accounts`
              : `Place ${side.toLowerCase()} order`
        }
        danger={side === "SELL"}
        onConfirm={place}
        onClose={() => setConfirm(false)}
      />
    </ModalShell>
  );
}

function accountName(accounts: AccountView[], ctid: number): string {
  const a = accounts.find((x) => x.ctid === ctid);
  return a ? a.nickname?.trim() || String(a.login) : `#${ctid}`;
}

function accountFullLabel(accounts: AccountView[], ctid: number): string {
  const a = accounts.find((x) => x.ctid === ctid);
  return a ? `${a.nickname?.trim() || a.login} · ${a.broker}` : `Account #${ctid}`;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return String(n);
}

function fmtQuote(n: number | null | undefined, digits: number): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return n.toFixed(Math.max(0, Math.min(8, digits)));
}

function FlashInputError({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
      <span>{text}</span>
    </div>
  );
}