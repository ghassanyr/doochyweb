import { AlertTriangle, Check, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

// Shared primitives, ported from the standalone Gauge project's stylesheet:
// blue-slate surfaces, one restrained teal accent, 10px controls, solid
// borders, and a >=400ms loading floor on every async button so fast
// round-trips never flicker.

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition duration-150 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 " +
  "focus-visible:ring-offset-canvas disabled:opacity-50 disabled:pointer-events-none select-none";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "bg-soft border border-hairline-strong text-fg hover:bg-surface-hover",
  ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
  danger: "text-danger hover:bg-danger-soft",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
};

/** Shared button styling for anchors that should look like buttons. */
export function buttonClass(variant: Variant = "secondary", size: Size = "md", className = ""): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  // When set, the button shows a spinner + disabled state for >=400ms so a fast
  // async action never flickers.
  onClickAsync?: () => Promise<void>;
  // A leading icon rendered in a single fixed slot that becomes the spinner
  // while loading (so the button never grows a second icon / changes width).
  // Prefer this over putting an icon in children when the button can be busy.
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  onClickAsync,
  onClick,
  className = "",
  children,
  disabled,
  icon,
  ...rest
}: ButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handle(e: React.MouseEvent<HTMLButtonElement>) {
    if (onClickAsync) {
      setLoading(true);
      const started = Date.now();
      try {
        await onClickAsync();
      } finally {
        const elapsed = Date.now() - started;
        if (elapsed < 400) await new Promise((r) => setTimeout(r, 400 - elapsed));
        setLoading(false);
      }
    } else {
      onClick?.(e);
    }
  }

  return (
    <button
      className={buttonClass(variant, size, className)}
      onClick={handle}
      disabled={disabled || loading}
      {...rest}
    >
      {icon !== undefined
        ? (loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon)
        : loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({
  children,
  className = "",
  interactive = false,
  flat = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  // Omit the box-shadow. Use for cards that reposition during an animation
  // (accordions/collapses): an outset shadow repaints on every frame a card
  // moves, which stutters. The hairline border alone delineates the card here.
  flat?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border border-hairline bg-gradient-to-b from-surface-hover to-surface " +
        (flat ? "" : "shadow-card ") +
        (interactive
          ? "cursor-pointer transition duration-150 hover:-translate-y-0.5 hover:border-hairline-strong hover:shadow-card-hover "
          : "") +
        className
      }
    >
      {children}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-hover ${className}`} />;
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "success" | "danger" | "accent";
}) {
  const tones: Record<string, string> = {
    muted: "border-hairline-strong bg-soft text-fg-muted",
    success: "border-success/30 bg-success-soft text-success",
    danger: "border-danger/30 bg-danger-soft text-danger",
    accent: "border-accent/30 bg-accent-soft text-accent",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

// Shared input styling for every text/number field in the app. Recessed
// background (darker than a card) with a teal focus ring, matching gauge's
// form controls.
export const inputCls =
  "w-full rounded-lg border border-hairline-strong bg-soft px-3 py-2 text-sm text-fg " +
  "placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 " +
  "disabled:opacity-50 disabled:pointer-events-none";

// Account color palette, used to visually separate accounts (settings swatches
// and the combined-mode identity chip). Rendered as inline-style dots so the
// colours survive Tailwind's class purging. Keys double as the server whitelist.
export const ACCOUNT_COLORS = [
  { key: "blue", hex: "#1E4D8F", label: "Blue" },
  { key: "green", hex: "#30A36C", label: "Green" },
  { key: "red", hex: "#E5484D", label: "Red" },
  { key: "amber", hex: "#D98032", label: "Amber" },
  { key: "violet", hex: "#8B6AD2", label: "Violet" },
  { key: "teal", hex: "#18B8A6", label: "Teal" },
] as const;

export function accountColorHex(key: string | null | undefined): string | null {
  const found = ACCOUNT_COLORS.find((c) => c.key === key);
  return found ? found.hex : null;
}

// Combined-mode row identity: which account a position/order came from. Shows
// the nickname when one is set; un-nicknamed accounts get the login number.
export function AccountChip({
  login,
  nickname,
  color,
}: {
  login: number;
  nickname: string | null;
  color?: string | null;
}) {
  const hex = accountColorHex(color);
  return (
    <Badge tone="muted">
      {hex && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: hex }} />}
      {nickname ?? login}
    </Badge>
  );
}

// A labelled value pair used inside cards (label up top, value below).
export function Field({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <div className="text-xs text-fg-faint">{label}</div>
      <div className={`mt-0.5 text-sm tabular-nums ${valueClassName ?? "text-fg"}`}>{value}</div>
    </div>
  );
}

// A labelled metric used in the order-ticket risk preview.
export function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  const color = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-fg";
  return (
    <div>
      <div className="text-xs text-fg-faint">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

// A compact numeric input with an optional right-hand suffix (lots, $).
export function BareInput({
  value,
  onChange,
  placeholder,
  suffix,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputCls} tabular-nums ${suffix ? "pr-10" : ""} ${className}`}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-faint">
          {suffix}
        </span>
      )}
    </div>
  );
}

// A selectable/removable symbol or filter chip.
export function Chip({
  children,
  onRemove,
}: {
  children: ReactNode;
  onRemove?: () => void;
}) {
  if (!onRemove) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong bg-soft px-2 py-1 text-xs font-medium text-fg-muted">
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong bg-soft px-2 py-1 text-xs font-medium text-fg-muted transition hover:border-danger/40 hover:text-danger"
    >
      {children}
      <span className="text-fg-faint">×</span>
    </button>
  );
}

// A save-state flash: brief success/error tint, auto-shown alongside results.
export function Flash({
  tone,
  children,
}: {
  tone: "success" | "warning" | "danger";
  children: ReactNode;
}) {
  const cls =
    tone === "success"
      ? "border-success/30 bg-success-soft text-success"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border-danger/30 bg-danger-soft text-danger";
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${cls}`}>
      {tone === "success" && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      {tone === "warning" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function Chevron({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <ChevronDown
      className={`h-4 w-4 shrink-0 text-fg-muted transition duration-300 ${open ? "rotate-180" : ""} ${className}`}
    />
  );
}

// A height collapse animated by interpolating a CSS grid row (0fr -> 1fr) plus
// an opacity fade. Both are compositor-friendly; the child stays mounted while
// collapsed, so no remount cost on toggle. The global prefers-reduced-motion
// rule shortens the transition to ~instant.
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className={"overflow-hidden transition-opacity duration-300 " + (open ? "opacity-100" : "opacity-0")}>
        {children}
      </div>
    </div>
  );
}

// A boolean setting rendered as a switch. The whole row is the hit target; the
// async commit shows a small spinner in place of the knob transition.
export function Toggle({
  label,
  ariaLabel,
  checked,
  onToggle,
}: {
  label: string;
  // When the visible label is empty (or the meaning is only in surrounding
  // copy), supply an accessible name so the control is still announced.
  ariaLabel?: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!checked)}
      aria-pressed={checked}
      aria-label={ariaLabel || label || undefined}
      className="flex items-center gap-2 text-left select-none"
    >
      <span
        className={
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition " +
          (checked ? "bg-accent" : "bg-surface-active")
        }
      >
        <span
          className={
            "inline-flex h-4 w-4 items-center justify-center rounded-full bg-white transition " +
            (checked ? "translate-x-4" : "translate-x-0.5")
          }
        />
      </span>
      {label && <span className="text-xs font-medium text-fg-muted">{label}</span>}
    </button>
  );
}