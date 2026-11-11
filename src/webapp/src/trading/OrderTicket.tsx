import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { api, OrderKind, OrderPreview, Side } from "../api";
import { fmtMoney } from "../Dashboard";
import { Button, Metric } from "../components/ui";
import { ConfirmModal, ModalShell, Seg, TicketField, posNum } from "./ui";

const PREVIEW_MS = 300;

function fmtLots(n: number | null | undefined, digits?: number): string {
  if (n == null) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits ?? 4 });
}

// New-order ticket. The server's preview endpoint is the authority: it resolves
// the symbol, validates the levels and snaps the size to the broker's grid, and
// the order is placed with the exact snapped size so what you confirm is what
// goes out.
export default function OrderTicket({
  open,
  onClose,
  onDone,
  ctid,
  symbols,
  accountLabel,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  ctid: number;
  symbols: string[];
  accountLabel: string;
}) {
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderKind>("MARKET");
  const [price, setPrice] = useState("");
  const [lots, setLots] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const debounce = useRef<number | null>(null);
  // Previews can overlap now that a market quote may take a moment to arrive;
  // only the newest response may update the panel.
  const previewSeq = useRef(0);
  // The account's full tradable universe comes from the broker. The `symbols`
  // prop only covers symbols already held as positions/orders, so on a fresh
  // account it is empty and cannot drive the ticket.
  const [accountSymbols, setAccountSymbols] = useState<string[] | null>(null);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  const [symbolsErr, setSymbolsErr] = useState<string | null>(null);

  const availableSymbols = useMemo(() => {
    if (accountSymbols && accountSymbols.length > 0) {
      // Keep held/resting symbols too, in case one is no longer in the broker's
      // current list (archived but still open).
      return [...new Set([...accountSymbols, ...symbols])].sort((a, b) => a.localeCompare(b));
    }
    return symbols;
  }, [accountSymbols, symbols]);

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
      setSymbol((cur) => (symbolsRef.current.includes(cur) ? cur : symbolsRef.current[0] ?? ""));
      setSide("BUY");
      setOrderType("MARKET");
      setPrice("");
      setLots("");
      setSl("");
      setTp("");
      setPreview(null);
      setPreviewErr(null);
      setStatus(null);
      setConfirm(false);
      setSymQuery("");
      setSymOpen(false);
      setActiveSym(-1);
    }
  }, [open]);

  // Load the broker's symbol list when the ticket opens. The server caches it
  // per account, so reopen is cheap; the first call may take a socket round-trip.
  useEffect(() => {
    if (!open || ctid <= 0) return;
    let alive = true;
    setAccountSymbols(null);
    setSymbolsLoading(true);
    setSymbolsErr(null);
    api
      .accountSymbols(ctid)
      .then(({ symbols: list }) => {
        if (alive) setAccountSymbols(list);
      })
      .catch((e: any) => {
        if (!alive) return;
        setAccountSymbols(null);
        setSymbolsErr(e?.message || "Could not load symbols");
      })
      .finally(() => {
        if (alive) setSymbolsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, ctid]);

  // Once the list arrives (or changes), keep the selection valid.
  useEffect(() => {
    if (!open) return;
    setSymbol((cur) => (availableSymbols.includes(cur) ? cur : availableSymbols[0] ?? ""));
  }, [open, availableSymbols]);

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
    if (!ready) {
      setPreview(null);
      setPreviewErr(null);
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    debounce.current = window.setTimeout(async () => {
      try {
        const { preview: p } = await api.previewOrder(ctid, {
          symbol,
          side,
          orderType,
          lots: lotsNum ?? 0,
          price: priceNum,
          sl: slNum,
          tp: tpNum,
        });
        if (seq !== previewSeq.current) return;
        setPreview(p);
        setPreviewErr(null);
      } catch (e: any) {
        if (seq !== previewSeq.current) return;
        setPreview(null);
        setPreviewErr(e?.message || "Could not price this order");
      } finally {
        if (seq === previewSeq.current) setPreviewing(false);
      }
    }, PREVIEW_MS);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctid, orderType, symbol, side, ready, lotsNum, priceNum, slNum, tpNum]);

  async function place() {
    if (!preview || !lotsNum) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.placeOrder(ctid, {
        symbol,
        side,
        orderType,
        lots: preview.lots,
        price: priceNum,
        sl: slNum,
        tp: tpNum,
      });
      setStatus({ ok: true, text: res.note ?? "Order placed" });
      setConfirm(false);
      setLots("");
      setSl("");
      setTp("");
      setPrice("");
      onDone();
    } catch (e: any) {
      setStatus({ ok: false, text: e?.message || "Order failed" });
    } finally {
      setBusy(false);
    }
  }

  const canPlace = ready && preview != null && !previewing;

  return (
    <ModalShell open={open} onClose={onClose} title="New order" subtitle={accountLabel}>
      {availableSymbols.length === 0 ? (
        <div className="text-sm text-fg-muted">
          {symbolsLoading
            ? "Loading this account's symbols…"
            : symbolsErr
              ? `Could not load this account's symbols: ${symbolsErr}`
              : "This account has no tradable symbols."}
        </div>
      ) : (
        <div className="space-y-4">
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
          {preview && (
            <div className="rounded-md border border-hairline bg-canvas/60 p-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Metric label="If SL hits" value={preview.riskUSD != null ? `-${fmtMoney(preview.riskUSD)}` : "-"} tone="danger" />
                <Metric label="At TP" value={preview.rewardUSD != null ? `+${fmtMoney(preview.rewardUSD)}` : "-"} tone="success" />
                <Metric label="R:R" value={preview.rr != null ? `1:${preview.rr.toFixed(2)}` : "-"} />
              </div>
              <div className="mt-3 border-t border-hairline pt-2 text-center text-xs tabular-nums text-fg-muted">
                Risking <span className="font-semibold text-fg">{preview.riskUSD != null ? fmtMoney(preview.riskUSD) : "-"}</span>{" "}
                on <span className="font-semibold text-fg">{fmtLots(preview.lots)}</span> lots
                {preview.snapped && <span className="text-fg-faint"> · adjusted to the broker's size grid</span>}
              </div>
              {preview.warnings.length > 0 && (
                <div className="mt-2 space-y-1">
                  {preview.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-fg-faint">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {previewErr && <FlashInputError text={previewErr} />}
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
              {previewing ? "Pricing…" : `Place ${side.toLowerCase()} order`}
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirm}
        title={`${side} ${symbol}?`}
        body={
          <span>
            {orderType === "MARKET" ? "Market order at the live price" : `${orderType.toLowerCase()} order at ${priceNum}`} for{" "}
            <strong className="text-fg">{fmtLots(preview?.lots)} lots</strong>, TP{" "}
            <strong className="text-fg">{fmtPrice(tpNum)}</strong>, SL{" "}
            <strong className="text-fg">{fmtPrice(slNum)}</strong>.
            {preview?.riskUSD != null && (
              <>
                {" "}
                You lose about <strong className="text-danger">{fmtMoney(preview.riskUSD)}</strong> if the stop is hit.
              </>
            )}
            <br />
            <br />
            <span className="text-fg-faint">Manual orders skip bot cooldowns, max positions and daily limits.</span>
          </span>
        }
        confirmLabel={busy ? "Placing…" : `Place ${side.toLowerCase()} order`}
        danger={side === "SELL"}
        onConfirm={place}
        onClose={() => setConfirm(false)}
      />
    </ModalShell>
  );
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return String(n);
}

function FlashInputError({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
      <span>{text}</span>
    </div>
  );
}