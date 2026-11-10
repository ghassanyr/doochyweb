// Local-time formatting for the Signals tab.
//
// The server stores UTC. Signals are the first surface that renders times in the
// visitor's own zone rather than the fixed UTC+3 used by the older Breakouts and
// Snapshot panels (those migrate in v2).
//
// Detection is one `Intl` call, cached for the page lifetime. Formatting always
// goes through `Intl` with an explicit zone, so DST is handled by the platform.
// Every helper takes an optional `timeZone`/`now` so it stays pure and testable.

let cachedZone: string | null = null;

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function detectTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && isValidTimeZone(zone)) return zone;
  } catch {
    /* Intl unavailable: fall through */
  }
  return "UTC";
}

/** The zone used by the UI, detected once and reused. */
export function detectedTimeZone(): string {
  if (!cachedZone) cachedZone = detectTimeZone();
  return cachedZone;
}

/** Test/embed hook: force re-detection on the next call. */
export function resetDetectedTimeZone(): void {
  cachedZone = null;
}

function toDate(value: string | number | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

interface TimeOptions {
  timeZone?: string;
  locale?: string;
}

function parts(date: Date, opts: Required<Pick<TimeOptions, "timeZone">> & Intl.DateTimeFormatOptions, locale = "en-GB"): Record<string, string> {
  const list = new Intl.DateTimeFormat(locale, { ...opts, timeZone: opts.timeZone }).formatToParts(date);
  const out: Record<string, string> = {};
  for (const p of list) if (p.type !== "literal") out[p.type] = p.value;
  return out;
}

/** "14:32" in the chosen zone. */
export function formatLocalTime(iso: string | number | Date, opts: TimeOptions = {}): string {
  const date = toDate(iso);
  if (!date) return "—";
  const p = parts(date, {
    timeZone: opts.timeZone ?? detectedTimeZone(),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }, opts.locale);
  return `${p.hour}:${p.minute}`;
}

/** "11 Nov 2026" in the chosen zone. */
export function formatLocalDate(iso: string | number | Date, opts: TimeOptions = {}): string {
  const date = toDate(iso);
  if (!date) return "—";
  const p = parts(date, {
    timeZone: opts.timeZone ?? detectedTimeZone(),
    day: "2-digit",
    month: "short",
    year: "numeric",
  }, opts.locale);
  return `${p.day} ${p.month} ${p.year}`;
}

/** "11 Nov 2026, 14:32" in the chosen zone. */
export function formatLocalDateTime(iso: string | number | Date, opts: TimeOptions = {}): string {
  const date = toDate(iso);
  if (!date) return "—";
  const p = parts(date, {
    timeZone: opts.timeZone ?? detectedTimeZone(),
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }, opts.locale);
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

/** A compact zone label such as "GMT+2" (or "UTC"). */
export function timeZoneLabel(opts: TimeOptions & { at?: string | number | Date } = {}): string {
  const date = toDate(opts.at ?? new Date());
  if (!date) return "UTC";
  const zone = opts.timeZone ?? detectedTimeZone();
  if (zone === "UTC" || zone === "Etc/UTC") return "UTC";
  const p = parts(date, { timeZone: zone, timeZoneName: "shortOffset" }, opts.locale);
  const name = p.timeZoneName ?? "UTC";
  return name === "GMT" || name === "GMT+0" ? "UTC" : name;
}

/** "11 Nov 2026, 14:32 GMT+2". */
export function formatLocalTimestamp(iso: string | number | Date, opts: TimeOptions = {}): string {
  const date = toDate(iso);
  if (!date) return "—";
  return `${formatLocalDateTime(date, opts)} ${timeZoneLabel({ ...opts, at: date })}`;
}

/** A stable YYYY-MM-DD key for grouping in the visitor's zone. */
export function localDayKey(iso: string | number | Date, opts: TimeOptions = {}): string {
  const date = toDate(iso);
  if (!date) return "";
  const p = parts(date, {
    timeZone: opts.timeZone ?? detectedTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }, opts.locale);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "Today" / "Yesterday" / "11 Nov 2026", relative to `now`. */
export function localDayLabel(
  iso: string | number | Date,
  { now = new Date(), ...opts }: TimeOptions & { now?: Date } = {}
): string {
  const key = localDayKey(iso, opts);
  if (!key) return "—";
  if (key === localDayKey(now, opts)) return "Today";
  if (key === localDayKey(new Date(now.getTime() - 86_400_000), opts)) return "Yesterday";
  return formatLocalDate(iso, opts);
}

/** Value for an `<input type="datetime-local">`, in the chosen zone. */
export function toLocalInputValue(iso: string | number | Date | null | undefined, opts: TimeOptions = {}): string {
  if (iso == null || iso === "") return "";
  const date = toDate(iso);
  if (!date) return "";
  const p = parts(date, {
    timeZone: opts.timeZone ?? detectedTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }, opts.locale);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
