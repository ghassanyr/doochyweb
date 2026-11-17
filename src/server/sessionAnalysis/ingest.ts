// IMAP ingestion for Session Analysis.
//
// The server reads the dedicated mailbox that receives the forwarded daily
// analysis, copies the market text and chart images into Mongo, and never
// writes the raw message to disk. Importing the same analysis date twice is
// safe: the store replaces that day in place.

import { createHash } from "node:crypto";

import {
  simpleParser,
  type AddressObject,
  type Attachment,
  type HeaderValue,
  type ParsedMail,
} from "mailparser";

import { asImapValues, imapClient } from "../integrations/imapSetup";
import { resolveIntegration } from "../integrations/store";
import {
  htmlToText,
  imageRefs,
  imageSize,
  isChartImage,
  pairImages,
  parseSession,
  textToLines,
} from "./parse";
import { saveSession, sessionIsComplete } from "./store";
import type {
  ParsedImage,
  ParsedMarket,
  ParsedSession,
  SessionSyncResult,
} from "./types";

const LOOKBACK_DAYS = 14;
const MAX_MESSAGES = 25;
const MAX_IMAGE_BYTES = 5_000_000;
const MAX_FORWARD_DEPTH = 3;

// The scheduler and the admin "Import now" button share one mailbox read. A
// second caller waits for the in-flight read instead of opening a second IMAP
// connection and importing the same message twice.
let activeSync: Promise<SessionSyncResult> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function result(partial: Partial<SessionSyncResult> & { message: string }): SessionSyncResult {
  return {
    ok: false,
    configured: true,
    imported: false,
    sessionKey: null,
    markets: 0,
    checkedAt: nowIso(),
    ...partial,
  };
}

function normalizeCid(value: string): string {
  return value.replace(/^cid:/i, "").replace(/^<|>$/g, "").trim();
}

function imageHash(buffer: Buffer): string {
  return createHash("md5").update(buffer).digest("hex");
}

function contentLabel(attachment: { filename?: string | null; cid?: string | null }): string | null {
  const value = attachment.filename || attachment.cid || "";
  return value ? value : null;
}

async function fetchRemoteImage(
  url: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
      headers: { Accept: "image/*" },
    });
    if (!response.ok) return null;
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!contentType.startsWith("image/")) return null;
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) return null;
    return { buffer, contentType };
  } catch {
    return null;
  }
}

function decodeDataUri(
  src: string
): { buffer: Buffer; contentType: string } | null {
  const match = src.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  const contentType = match[1] || "image/png";
  if (!contentType.startsWith("image/")) return null;
  try {
    const buffer = match[2]
      ? Buffer.from(match[3] ?? "", "base64")
      : Buffer.from(decodeURIComponent(match[3] ?? ""), "binary");
    return buffer.length > 0 ? { buffer, contentType } : null;
  } catch {
    return null;
  }
}

/** Collect the chart-sized images from the HTML refs and attachments. */
async function collectImages(message: ParsedMail): Promise<ParsedImage[]> {
  const html = typeof message.html === "string" ? message.html : "";
  const refs = html ? imageRefs(html) : [];
  const images: ParsedImage[] = [];
  const seen = new Set<string>();

  function add(
    buffer: Buffer,
    contentType: string,
    label: string | null
  ): void {
    if (!contentType.startsWith("image/")) return;
    const size = imageSize(buffer);
    if (!isChartImage(size)) return;
    const hash = imageHash(buffer);
    if (seen.has(hash)) return;
    seen.add(hash);
    images.push({
      buffer,
      contentType,
      width: size!.width,
      height: size!.height,
      label,
    });
  }

  for (const ref of refs) {
    if (ref.src.startsWith("cid:")) {
      const cid = normalizeCid(ref.src);
      const attachment = message.attachments.find(
        (entry) => entry.cid && normalizeCid(entry.cid) === cid
      );
      if (attachment) {
        add(attachment.content, attachment.contentType, contentLabel(attachment) ?? ref.alt);
      }
      continue;
    }
    if (ref.src.startsWith("data:")) {
      const decoded = decodeDataUri(ref.src);
      if (decoded) add(decoded.buffer, decoded.contentType, ref.alt);
      continue;
    }
    if (/^https?:\/\//i.test(ref.src)) {
      const remote = await fetchRemoteImage(ref.src);
      if (remote) add(remote.buffer, remote.contentType, ref.alt);
    }
  }

  // Some forwards keep the charts as plain attachments without a cid reference.
  for (const attachment of message.attachments) {
    add(attachment.content, attachment.contentType, contentLabel(attachment));
  }

  return images;
}

/**
 * Collect charts from the whole forward chain. Gmail can keep the original
 * message as an embedded `message/rfc822` while the inline images stay on the
 * outer message, so the analysis message alone is not always enough.
 */
async function collectChainImages(
  chain: ParsedMail[],
  analysis: ParsedMail
): Promise<ParsedImage[]> {
  const ordered = [analysis, ...chain.filter((message) => message !== analysis)];
  const images: ParsedImage[] = [];
  const seen = new Set<string>();
  for (const message of ordered) {
    for (const image of await collectImages(message)) {
      const hash = imageHash(image.buffer);
      if (seen.has(hash)) continue;
      seen.add(hash);
      images.push(image);
    }
  }
  return images;
}

function addressValues(value: AddressObject | AddressObject[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((entry) =>
    entry.value.flatMap((address) => [address.name ?? "", address.address ?? ""])
  );
}

function headerValues(value: HeaderValue | undefined): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => headerValues(entry));
  if (value instanceof Date) return [];
  if (typeof value === "object" && "value" in value) {
    const inner = (value as { value: unknown }).value;
    if (Array.isArray(inner)) return addressValues(value as AddressObject);
    if (typeof inner === "string") return [inner];
  }
  return [];
}

/**
 * Everything that can identify the original sender. A forward hides the
 * analysis address in the embedded message or, for an inline forward, in a
 * quoted "From:" line in the body, while the outer From is the mailbox that
 * received the forward. All of them are checked.
 */
function senderHaystack(message: ParsedMail): string {
  const headers = message.headers;
  const body = [
    typeof message.text === "string" ? message.text : "",
    typeof message.html === "string" ? htmlToText(message.html) : "",
  ]
    .join(" ")
    .toLowerCase();
  return [
    ...addressValues(message.from),
    ...addressValues(message.replyTo),
    ...headerValues(headers.get("sender")),
    ...headerValues(headers.get("x-original-from")),
    ...headerValues(headers.get("x-forwarded-from")),
    body,
  ]
    .join(" ")
    .toLowerCase();
}

/** Exported for the mailbox tests; not part of the public server API. */
export function matchesFilters(
  chain: ParsedMail[],
  senderFilter: string,
  subjectFilter: string
): boolean {
  const sender = senderFilter.toLowerCase();
  const subject = subjectFilter.toLowerCase();
  if (sender && !chain.some((message) => senderHaystack(message).includes(sender))) {
    return false;
  }
  if (
    subject &&
    !chain.some((message) => (message.subject ?? "").toLowerCase().includes(subject))
  ) {
    return false;
  }
  return true;
}

function isEmbeddedMessage(attachment: Attachment): boolean {
  return (
    /^message\/(?:rfc822|global)$/i.test(attachment.contentType) ||
    /\.eml$/i.test(attachment.filename ?? "")
  );
}

/**
 * Parse a message and every `message/rfc822` forward nested inside it. Gmail
 * attaches the original analysis as an embedded message when the auto-forward
 * rule runs, so the market cards and charts live one level down. Exported for
 * the mailbox tests; not part of the public server API.
 */
export async function forwardChain(
  message: ParsedMail,
  depth = 0
): Promise<ParsedMail[]> {
  const chain = [message];
  if (depth >= MAX_FORWARD_DEPTH) return chain;
  for (const attachment of message.attachments) {
    if (!isEmbeddedMessage(attachment)) continue;
    try {
      const nested = await simpleParser(attachment.content);
      chain.push(...(await forwardChain(nested, depth + 1)));
    } catch {
      // A malformed embedded message must not abort the whole mailbox read.
    }
  }
  return chain;
}

function buildSession(message: ParsedMail): ParsedSession {
  return parseSession({
    subject: message.subject,
    from: message.from?.text,
    receivedAt: message.date,
    html: typeof message.html === "string" ? message.html : null,
    text: message.text,
  });
}

function withCharts(
  markets: ParsedMarket[],
  images: ParsedImage[]
): (ParsedImage | null)[] {
  return pairImages(markets, images);
}

/**
 * Structural summary for the admin when a matched message still has no market
 * card. It names the body sizes and attachment types so a forward that keeps
 * the analysis in an unexpected part is obvious from the import result.
 */
function describeChain(chain: ParsedMail[]): string {
  const details = chain.map((message, index) => {
    const textLength = typeof message.text === "string" ? message.text.trim().length : 0;
    const htmlLength = typeof message.html === "string" ? message.html.length : 0;
    const counts = new Map<string, number>();
    for (const attachment of message.attachments) {
      const type = attachment.contentType || "unknown";
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    const attachments = [...counts]
      .map(([type, count]) => `${type} x${count}`)
      .join(", ");
    return `#${index + 1} text ${textLength}, html ${htmlLength}${attachments ? `, ${attachments}` : ""}`;
  });
  return `Chain ${chain.length}: ${details.join("; ")}.`;
}

/** A short, line-oriented preview of the matched message for diagnostics. */
function previewBody(message: ParsedMail): string {
  const parts: string[] = [];
  if (typeof message.text === "string" && message.text.trim()) parts.push(message.text);
  if (typeof message.html === "string" && message.html.trim()) {
    parts.push(htmlToText(message.html));
  }
  const preview = textToLines(parts.join("\n")).slice(0, 8).join(" / ");
  return preview.slice(0, 240) || "(no text or HTML body)";
}

async function runSync(): Promise<SessionSyncResult> {
  let resolved;
  try {
    resolved = await resolveIntegration("imap");
  } catch (err) {
    return result({
      ok: false,
      configured: false,
      message: err instanceof Error ? err.message : "IMAP is not configured.",
    });
  }

  const values = asImapValues(resolved.values);
  if (resolved.missing.length > 0) {
    return result({
      ok: false,
      configured: false,
      message: `Add the missing IMAP fields: ${resolved.missing.join(", ")}.`,
    });
  }
  if (!values.enabled) {
    return result({
      ok: false,
      configured: false,
      message: "IMAP import is disabled in Admin, Integrations.",
    });
  }

  const client = imapClient(values);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(values.folder);
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const candidates: Buffer[] = [];
      for await (const message of client.fetch(
        { since },
        { source: true, envelope: true, uid: true }
      )) {
        if (message.source) candidates.push(message.source);
        if (candidates.length >= MAX_MESSAGES) break;
      }
      candidates.reverse();

      let matched = 0;
      let newest: { from: string; subject: string } | null = null;
      let firstChain: ParsedMail[] | null = null;
      for (const source of candidates) {
        let parsed: ParsedMail;
        try {
          parsed = await simpleParser(source);
        } catch {
          continue;
        }

        if (!newest) {
          newest = {
            from: parsed.from?.text ?? "",
            subject: parsed.subject ?? "",
          };
        }

        const chain = await forwardChain(parsed);
        if (!matchesFilters(chain, values.senderFilter, values.subjectFilter)) continue;
        if (!firstChain) firstChain = chain;
        matched++;

        // Prefer the message that actually carries the market cards. An outer
        // forward usually only has the subject and no analysis text.
        let analysis: { message: ParsedMail; session: ParsedSession } | null = null;
        for (const message of chain) {
          const session = buildSession(message);
          if (session.markets.length > 0) {
            analysis = { message, session };
            break;
          }
        }
        if (!analysis) continue;
        const { message, session } = analysis;

        if (await sessionIsComplete(session.sessionKey)) {
          return result({
            ok: true,
            configured: true,
            imported: false,
            sessionKey: session.sessionKey,
            markets: session.markets.length,
            message: `${session.sessionName} is already up to date.`,
          });
        }

        const images = await collectChainImages(chain, message);
        await saveSession(session, withCharts(session.markets, images));
        return result({
          ok: true,
          configured: true,
          imported: true,
          sessionKey: session.sessionKey,
          markets: session.markets.length,
          message: `Imported ${session.markets.length} market${session.markets.length === 1 ? "" : "s"} for the ${session.sessionName}.`,
        });
      }

      const newestDetail = newest
        ? ` Newest message: from ${(newest.from || "unknown").slice(0, 120)}, subject "${(newest.subject || "(none)").slice(0, 120)}".`
        : "";
      const chainDetail = firstChain
        ? ` ${describeChain(firstChain)} Preview: "${previewBody(firstChain[0]!)}"`
        : "";
      return result({
        ok: true,
        configured: true,
        imported: false,
        message:
          candidates.length === 0
            ? `No messages in ${values.folder} from the last ${LOOKBACK_DAYS} days.`
            : matched === 0
              ? `Read ${candidates.length} message${candidates.length === 1 ? "" : "s"}, but none matched the sender or subject filter.${newestDetail}`
              : `Matched ${matched} message${matched === 1 ? "" : "s"}, but none contained a market card.${newestDetail}${chainDetail}`,
      });
    } finally {
      lock.release();
    }
  } catch (err) {
    return result({
      ok: false,
      configured: true,
      message: err instanceof Error ? err.message : "Could not read the mailbox.",
    });
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/**
 * Read the mailbox once. The newest matching message with at least one market
 * card wins, so an older complete session is never allowed to overwrite a newer
 * one. Concurrent callers share the same in-flight read.
 */
export function syncSessionAnalysis(): Promise<SessionSyncResult> {
  if (activeSync) return activeSync;
  activeSync = runSync().finally(() => {
    activeSync = null;
  });
  return activeSync;
}

