// Pure parsing helpers for the daily AI market analysis email.
//
// The email is HTML built from repeated market cards. Each card starts with a
// heading such as "BTCUSD | Target Level 63564.0977" and then lists the target
// period, interval, pattern, identification time, a reason paragraph, a
// "Supported by ..." line and an optional support/resistance line.
//
// The parser deliberately works on a line rendering rather than the raw markup:
// it survives the extra wrapper Yahoo adds when the message is forwarded and it
// is straightforward to test with captured text.

import type { ParsedImage, ParsedMarket, ParsedSession, SessionLevelType } from "./types";

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

const HEADING = /^(.{1,40}?)\s*\|\s*Target Level\s+([0-9][0-9.,]*)\s*$/i;
const FIELD = /^(Target Period|Interval|Pattern|Identified)\s*:\s*(.*)$/i;
const SUPPORTED = /^Supported by\b/i;
const LEVEL = /^(Support|Resistance)\s*:\s*(.*)$/i;
const NOISE = [
  /^Trade Now$/i,
  /^AI Market Analysis\b/i,
  /^https?:\/\//i,
  /^\d+ of \d+$/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/,
  /^(Disclaimer|Facebook \| Instagram|Leveraged$|Omonoias Avenue)/i,
];

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith("#")) {
      const hex = code[1]?.toLowerCase() === "x";
      const digits = code.slice(hex ? 2 : 1);
      const parsed = Number.parseInt(digits, hex ? 16 : 10);
      if (Number.isFinite(parsed)) {
        try {
          return String.fromCodePoint(parsed);
        } catch {
          return " ";
        }
      }
      return " ";
    }
    return named[code.toLowerCase()] ?? match;
  });
}

/** Turn an HTML body into readable text with block-level line breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(
        /<\/?(?:p|div|tr|td|th|table|tbody|thead|tfoot|li|ul|ol|h[1-6]|section|article|header|footer|blockquote|center)\b[^>]*>/gi,
        "\n"
      )
      .replace(/<[^>]+>/g, " ")
  );
}

/** Split text into trimmed lines with internal whitespace collapsed. */
export function textToLines(text: string): string[] {
  return text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

/**
 * Join label/value pairs and wrapped values that the PDF or HTML rendering may
 * have split across lines. This keeps the field parser line-oriented.
 */
function mergeContinuationLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;

    // "Target Period" followed by ": 2 days".
    while (i + 1 < lines.length && /^:/.test(lines[i + 1]!)) {
      line = `${line} ${lines[i + 1]!.trim()}`.replace(/\s+/g, " ").trim();
      i++;
    }
    // "Target Period :" followed by its value.
    while (i + 1 < lines.length && line.endsWith(":")) {
      line = `${line} ${lines[i + 1]!.trim()}`.replace(/\s+/g, " ").trim();
      i++;
    }
    // "(A" and ") 27011.0000 ..." from the PDF text extraction.
    if (line.endsWith("(A") && i + 1 < lines.length && lines[i + 1]!.startsWith(")")) {
      line = `${line} ${lines[i + 1]!.trim()}`.replace(/\s+/g, " ").trim();
      i++;
    }
    // A wrapped hyphenated value such as "17-" + "Nov-06:00".
    while (i + 1 < lines.length && /-$/.test(line) && !/^[-\u2013\u2014]$/.test(line)) {
      line = `${line}${lines[i + 1]!.trim()}`;
      i++;
    }
    out.push(line);
  }
  return out;
}

/** Put a heading that was split across table cells back on one line. */
function normalizeHeadings(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.includes("|") && /Target Level/i.test(line)) {
      let combined = line;
      while (!/[0-9][0-9.,]*\s*$/.test(combined) && i + 1 < lines.length) {
        combined = `${combined} ${lines[++i]!.trim()}`;
      }
      out.push(combined.replace(/\s+/g, " ").trim());
      continue;
    }

    if (/^[A-Z][A-Z0-9 ._/-]{0,39}$/.test(line)) {
      let j = i + 1;
      let combined = line;
      let sawPipe = false;
      while (j < lines.length && j <= i + 4) {
        const next = lines[j]!;
        if (/^\|/.test(next)) {
          sawPipe = true;
          combined = `${combined} ${next}`;
          j++;
          continue;
        }
        if (/^Target Level\b/i.test(next)) {
          combined = `${combined} ${next}`;
          j++;
          continue;
        }
        if (sawPipe && /^[0-9][0-9.,]*$/.test(next)) {
          combined = `${combined} ${next}`;
          j++;
          break;
        }
        break;
      }
      if (sawPipe && /Target Level/i.test(combined)) {
        out.push(combined.replace(/\s+/g, " ").trim());
        i = j - 1;
        continue;
      }
    }

    if (line.endsWith("|")) {
      let combined = line;
      let j = i + 1;
      while (j < lines.length && j <= i + 2) {
        combined = `${combined} ${lines[j]!.trim()}`;
        if (/Target Level\s+[0-9][0-9.,]*\s*$/i.test(combined)) {
          j++;
          break;
        }
        j++;
      }
      if (/Target Level\s+[0-9][0-9.,]*\s*$/i.test(combined)) {
        out.push(combined.replace(/\s+/g, " ").trim());
        i = j - 1;
        continue;
      }
    }

    out.push(line);
  }
  return out;
}

function cleanSymbol(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function joinLines(lines: string[]): string | null {
  const value = lines.join(" ").replace(/\s+/g, " ").trim();
  return value.length > 0 ? value : null;
}

function parseLevel(rest: string): {
  value: string | null;
  note: string | null;
} {
  const labelled = rest.match(/^\(?A\s*\)?\s*([0-9][0-9.,]*)\s*(.*)$/i);
  if (labelled) {
    return {
      value: labelled[1] ?? null,
      note: (labelled[2] ?? "").trim() || null,
    };
  }
  const bare = rest.match(/^([0-9][0-9.,]*)\s*(.*)$/);
  if (bare) {
    return {
      value: bare[1] ?? null,
      note: (bare[2] ?? "").trim() || null,
    };
  }
  return { value: null, note: rest.trim() || null };
}

function parseBlock(block: string[]): ParsedMarket | null {
  const heading = block[0]?.match(HEADING);
  if (!heading) return null;

  const symbol = cleanSymbol(heading[1] ?? "");
  if (!symbol) return null;

  const fields: Record<string, string> = {};
  const content: string[] = [];
  let pendingLabel: string | null = null;

  for (const line of block.slice(1)) {
    const field = line.match(FIELD);
    if (field) {
      const key = (field[1] ?? "").toLowerCase();
      const value = (field[2] ?? "").trim();
      if (value) {
        fields[key] = value;
        pendingLabel = null;
      } else {
        pendingLabel = key;
      }
      continue;
    }
    if (pendingLabel) {
      fields[pendingLabel] = line;
      pendingLabel = null;
      continue;
    }
    if (NOISE.some((pattern) => pattern.test(line))) {
      if (/^Trade Now$/i.test(line)) break;
      continue;
    }
    content.push(line);
  }

  let section: "reason" | "supporting" | "level" = "reason";
  const reason: string[] = [];
  const supporting: string[] = [];
  const levelNote: string[] = [];
  let levelType: SessionLevelType | null = null;
  let levelValue: string | null = null;

  for (const line of content) {
    if (SUPPORTED.test(line)) {
      section = "supporting";
      supporting.push(line);
      continue;
    }
    const level = line.match(LEVEL);
    if (level) {
      section = "level";
      levelType = (level[1] ?? "").toLowerCase() === "support" ? "support" : "resistance";
      const parsed = parseLevel((level[2] ?? "").trim());
      levelValue = parsed.value;
      if (parsed.note) levelNote.push(parsed.note);
      continue;
    }
    if (section === "level") {
      levelNote.push(line);
      continue;
    }
    if (section === "supporting") {
      if (supporting.length > 0) {
        supporting[supporting.length - 1] =
          `${supporting[supporting.length - 1]} ${line}`.replace(/\s+/g, " ").trim();
      } else {
        supporting.push(line);
      }
      continue;
    }
    reason.push(line);
  }

  const reasonText = joinLines(reason);
  // Some cards only say "Broke through Support level of 64251.6914" in the
  // reason, with no separate Support or Resistance row.
  if (!levelType && reasonText) {
    const broke = reasonText.match(
      /Broke through (Support|Resistance) level of ([0-9][0-9.,]*)/i
    );
    if (broke) {
      levelType = (broke[1] ?? "").toLowerCase() === "support" ? "support" : "resistance";
      levelValue = broke[2] ?? null;
    }
  }

  return {
    symbol,
    targetLevel: heading[2] ?? null,
    targetPeriod: fields["target period"] ?? null,
    interval: fields.interval ?? null,
    pattern: fields.pattern ?? null,
    identifiedAt: fields.identified ?? null,
    reason: reasonText,
    supporting: supporting.map((line) => line.trim()).filter(Boolean),
    levelType,
    levelValue,
    levelNote: joinLines(levelNote),
  };
}

/** Parse the repeated market cards out of the message text. */
export function parseMarkets(text: string): ParsedMarket[] {
  const lines = normalizeHeadings(mergeContinuationLines(textToLines(text)));
  const blocks: string[][] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (HEADING.test(line)) {
      if (current) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current);

  const seen = new Set<string>();
  const markets: ParsedMarket[] = [];
  for (const block of blocks) {
    const market = parseBlock(block);
    if (!market) continue;
    const key = market.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    markets.push(market);
  }
  return markets;
}

function dateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface GeneratedDate {
  date: string;
  label: string;
}

/** Find the "17-Nov-2026 06:14 EST" stamp the analysis email carries. */
export function parseGeneratedAt(text: string): GeneratedDate | null {
  const match = text.match(
    /\b(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}:\d{2})(?:\s+([A-Z]{2,5}))?/
  );
  if (!match) return null;
  const day = (match[1] ?? "").padStart(2, "0");
  const month = MONTHS[(match[2] ?? "").toLowerCase()];
  const year = match[3] ?? "";
  if (!month || !year) return null;
  const label = `${day}-${match[2]}-${year} ${match[4]}${match[5] ? ` ${match[5]}` : ""}`.trim();
  return { date: `${year}-${month}-${day}`, label };
}

export interface ParseSessionInput {
  subject?: string | null;
  from?: string | null;
  receivedAt?: Date | string | null;
  html?: string | null;
  text?: string | null;
}

/**
 * Build a session from a message. The session date comes from the analysis
 * stamp when present, because a forwarded copy can arrive the next day.
 */
export function parseSession(input: ParseSessionInput): ParsedSession {
  const text =
    input.text && input.text.trim()
      ? input.text
      : input.html
        ? htmlToText(input.html)
        : "";
  const markets = parseMarkets(text);
  const generated = parseGeneratedAt(text);
  const received = input.receivedAt ? new Date(input.receivedAt) : new Date();
  const receivedDate = Number.isFinite(received.getTime()) ? received : new Date();
  const sessionDate = generated?.date ?? dateKey(receivedDate);

  return {
    sessionKey: sessionDate,
    sessionDate,
    subject: (input.subject ?? "").trim() || "AI Market Analysis",
    sender: (input.from ?? "").trim(),
    receivedAt: receivedDate.toISOString(),
    generatedAt: generated?.label ?? null,
    markets,
  };
}

export interface ImageRef {
  src: string;
  alt: string | null;
}

function attribute(tag: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const match = tag.match(pattern);
  if (!match) return null;
  return decodeEntities((match[1] ?? match[2] ?? match[3] ?? "").trim());
}

/** Every image source in document order, including VML image data tags. */
export function imageRefs(html: string): ImageRef[] {
  const refs: ImageRef[] = [];
  for (const tag of html.match(/<(?:img|v:imagedata|image)\b[^>]*>/gi) ?? []) {
    const src = attribute(tag, "src");
    if (!src) continue;
    refs.push({ src, alt: attribute(tag, "alt") });
  }
  return refs;
}

export interface ImageSize {
  width: number;
  height: number;
}

/** Read PNG, GIF and JPEG dimensions from the first bytes. */
export function imageSize(buffer: Buffer): ImageSize | null {
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "GIF") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1] ?? 0;
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return null;
}

/**
 * The analysis charts are portrait images around 270x370. Logos, spacers and
 * banners in the same message must not be treated as charts.
 */
export function isChartImage(size: ImageSize | null): boolean {
  if (!size) return false;
  if (size.width < 180 || size.height < 220) return false;
  const ratio = size.width / size.height;
  return ratio >= 0.35 && ratio <= 1.8;
}

/**
 * Pair images with markets. A matching alt text or filename wins; otherwise the
 * remaining images are assigned in document order.
 */
export function pairImages(
  markets: ParsedMarket[],
  images: ParsedImage[]
): (ParsedImage | null)[] {
  const used = new Set<number>();
  const result: (ParsedImage | null)[] = markets.map(() => null);

  for (let i = 0; i < markets.length; i++) {
    const symbol = markets[i]!.symbol.toUpperCase();
    const index = images.findIndex((image, imageIndex) => {
      if (used.has(imageIndex)) return false;
      const label = (image.label ?? "").toUpperCase();
      return label.includes(symbol);
    });
    if (index >= 0) {
      used.add(index);
      result[i] = images[index]!;
    }
  }

  let cursor = 0;
  for (let i = 0; i < markets.length; i++) {
    if (result[i]) continue;
    while (cursor < images.length && used.has(cursor)) cursor++;
    if (cursor >= images.length) break;
    used.add(cursor);
    result[i] = images[cursor]!;
    cursor++;
  }

  return result;
}
