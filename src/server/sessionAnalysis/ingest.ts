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
  imageRefs,
  imageSize,
  isChartImage,
  pairImages,
  parseSession,
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
 * analysis address in the embedded message, while the outer From is the
 * mailbox that received the forward, so both are checked.
 */
function senderHaystack(message: ParsedMail): string {
  const headers = message.headers;
  return [
    ...addressValues(message.from),
    ...addressValues(message.replyTo),
    ...headerValues(headers.get("sender")),
    ...headerValues(headers.get("x-original-from")),
    ...headerValues(headers.get("x-forwarded-from")),
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
  return /^message\/(?:rfc822|global)$/i.test(attachment.contentType);
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

      for (const source of candidates) {
        let parsed: ParsedMail;
        try {
          parsed = await simpleParser(source);
        } catch {
          continue;
        }

        const chain = await forwardChain(parsed);
        if (!matchesFilters(chain, values.senderFilter, values.subjectFilter)) continue;

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
            message: `Session ${session.sessionKey} is already up to date.`,
          });
        }

        const images = await collectImages(message);
        await saveSession(session, withCharts(session.markets, images));
        return result({
          ok: true,
          configured: true,
          imported: true,
          sessionKey: session.sessionKey,
          markets: session.markets.length,
          message: `Imported ${session.markets.length} market${session.markets.length === 1 ? "" : "s"} for ${session.sessionKey}.`,
        });
      }

      return result({
        ok: true,
        configured: true,
        imported: false,
        message: "No matching analysis email was found in the mailbox.",
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

