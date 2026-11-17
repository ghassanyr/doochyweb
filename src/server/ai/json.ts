// Recovery helpers for structured model output.
//
// Models occasionally wrap JSON in a code fence, add a sentence before or after
// it, emit raw newlines inside strings, leave a trailing comma, or stop before
// the closing brace. These helpers recover as much valid data as possible so a
// partial reply can still be used instead of discarding the whole call.

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = cleanText(item, maxLength);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function objectList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Escape raw newlines and tabs that some models put inside JSON strings. */
function sanitizeJson(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) {
        out += char;
        escaped = false;
      } else if (char === "\\") {
        out += char;
        escaped = true;
      } else if (char === '"') {
        out += char;
        inString = false;
      } else if (char === "\n") {
        out += "\\n";
      } else if (char === "\r") {
        out += "\\r";
      } else if (char === "\t") {
        out += "\\t";
      } else {
        out += char;
      }
    } else {
      if (char === '"') inString = true;
      out += char;
    }
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

function balancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/** Close a truncated object so complete fields can still be used. */
function closeObject(text: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") stack.pop();
  }
  let out = text;
  if (inString) {
    if (escaped && out.endsWith("\\")) out = out.slice(0, -1);
    out += '"';
  }
  return out + stack.reverse().join("");
}

function repairTruncated(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let candidate = text.slice(start);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const closed = sanitizeJson(closeObject(candidate));
    const parsed = parseObject(closed);
    if (parsed) return parsed;
    const comma = candidate.lastIndexOf(",");
    if (comma <= 0) break;
    candidate = candidate.slice(0, comma);
  }
  return null;
}

/** Best-effort object extraction from a model reply. */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const balanced = balancedObject(trimmed);
  if (balanced) {
    return parseObject(balanced) ?? parseObject(sanitizeJson(balanced)) ?? null;
  }
  return repairTruncated(trimmed);
}
