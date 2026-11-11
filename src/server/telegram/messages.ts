// Server-side message builders.
//
// The webapp formatter cannot be imported by the server build (tsconfig.server
// only includes src/server), and Telegram's HTML parse mode requires escaping,
// so these are deliberately local and pure.

import type { SignalView } from "../signals/types";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 6;
  return value.toFixed(digits);
}

export function computeRR(
  entry: number | null | undefined,
  target: number | null | undefined,
  stop: number | null | undefined
): number | null {
  if (entry == null || target == null || stop == null) return null;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (!(risk > 0) || !Number.isFinite(reward)) return null;
  return reward / risk;
}

/** Human-readable UTC timestamp, or null for a missing/invalid date. */
export function formatUtc(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
}

function truncate(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function buildPublishedMessage(signal: SignalView): string {
  const lines: string[] = [
    `🔔 <b>New signal</b> · ${escapeHtml(signal.symbol)} <b>${signal.direction.toUpperCase()}</b>`,
  ];

  const prices: string[] = [];
  if (signal.entry != null) prices.push(`Entry <code>${fmtPrice(signal.entry)}</code>`);
  prices.push(`Target <code>${fmtPrice(signal.target)}</code>`);
  prices.push(`Stop <code>${fmtPrice(signal.stop)}</code>`);
  lines.push(prices.join(" · "));

  const meta: string[] = [];
  const rr = computeRR(signal.entry, signal.target, signal.stop);
  if (rr != null) meta.push(`R:R ${rr.toFixed(2)}`);
  if (signal.timeframe) meta.push(escapeHtml(signal.timeframe));
  if (meta.length) lines.push(meta.join(" · "));

  const note = truncate(signal.note ?? "", 280);
  if (note) lines.push(escapeHtml(note));

  const expiry = formatUtc(signal.expiresAt);
  if (expiry) {
    lines.push("");
    lines.push(`Expires ${escapeHtml(expiry)} UTC`);
  }

  return lines.join("\n");
}

export function signalButtonUrl(baseUrl: string, signalId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/signals?signal=${encodeURIComponent(signalId)}`;
}

export function buildTestMessage(): string {
  return "✅ <b>DoochyWeb test</b>\nTelegram notifications are working.";
}

export function buildWelcomeMessage(settingsUrl: string): string {
  const safe = escapeHtml(settingsUrl);
  return [
    "👋 <b>DoochyWeb signals bot</b>",
    "",
    "Open Settings, choose <b>Connect Telegram</b>, then send the code here.",
    `<a href="${safe}">${safe}</a>`,
  ].join("\n");
}

export function buildLinkedMessage(): string {
  return [
    "✅ <b>Linked to DoochyWeb</b>",
    "",
    "You'll get a message here when a new signal is published.",
    "/status · /stop · /unlink",
  ].join("\n");
}

export function buildAlreadyLinkedMessage(): string {
  return [
    "✅ This chat is already linked to DoochyWeb.",
    "",
    "/status · /stop · /unlink",
  ].join("\n");
}

export function buildChatTakenMessage(): string {
  return [
    "⚠️ This Telegram account is already linked to another DoochyWeb user.",
    "",
    "Send /unlink here first, then generate a new code in Settings.",
  ].join("\n");
}

export function buildInvalidCodeMessage(settingsUrl: string): string {
  const safe = escapeHtml(settingsUrl);
  return [
    "⚠️ That code is invalid or has expired.",
    "",
    `Generate a new one in Settings: <a href="${safe}">${safe}</a>`,
  ].join("\n");
}

export function buildNotLinkedMessage(): string {
  return "This chat is not linked. Open Settings on doochy.net to connect it.";
}

export function buildStatusMessage(params: {
  account: string | null;
  notificationsEnabled: boolean;
  linkedAt: string;
}): string {
  const lines = ["📊 <b>DoochyWeb</b>"];
  if (params.account) lines.push(`Account: ${escapeHtml(params.account)}`);
  lines.push(`Notifications: <b>${params.notificationsEnabled ? "on" : "off"}</b>`);
  const at = formatUtc(params.linkedAt);
  if (at) lines.push(`Linked: ${escapeHtml(at)} UTC`);
  return lines.join("\n");
}

export function buildStoppedMessage(): string {
  return "🔕 Notifications paused. Send /resume to turn them back on.";
}

export function buildResumedMessage(): string {
  return "🔔 Notifications resumed.";
}

export function buildUnlinkedMessage(): string {
  return "🔌 Disconnected. Generate a new code in Settings to reconnect.";
}

export function buildHelpMessage(): string {
  return [
    "<b>DoochyWeb bot</b>",
    "",
    "/status — connection and notification state",
    "/stop — pause notifications",
    "/resume — resume notifications",
    "/unlink — disconnect this chat",
    "/help — this message",
  ].join("\n");
}

export function buildUnknownMessage(): string {
  return "Unknown command. Send /help for the list.";
}
