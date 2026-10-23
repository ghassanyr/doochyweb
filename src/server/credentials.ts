// Credential input rules for reconnecting cTrader.
//
// The OpenAPI app (client id and secret) is created once and then left alone, so
// the common case is "my tokens expired, let me paste fresh ones". Requiring all
// four fields every time made people retype the secret they had no reason to
// change. The rule is therefore: the app fields are optional once they have been
// saved, and only new tokens are required.

export interface StoredCredentials {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
}

export interface ConnectPayload {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
}

/** Trimmed string, or "" for anything missing. */
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export type ConnectResolution =
  | { ok: true; value: ConnectPayload }
  | { ok: false; error: string };

/**
 * Merge what was sent with what is already stored.
 *
 * Sent app fields always win when present, so recreating the app still works.
 * Missing ones fall back to storage, and only fail if neither exists.
 */
export function resolveConnectInput(
  body: Record<string, unknown> | undefined | null,
  existing: Pick<StoredCredentials, "clientId" | "clientSecret"> | null | undefined
): ConnectResolution {
  const clientId = str(body?.clientId) || existing?.clientId || "";
  const clientSecret = str(body?.clientSecret) || existing?.clientSecret || "";
  const accessToken = str(body?.accessToken);
  const refreshToken = str(body?.refreshToken);

  if (!accessToken || !refreshToken) {
    return { ok: false, error: "accessToken and refreshToken are required" };
  }
  if (!clientId || !clientSecret) {
    return { ok: false, error: "clientId and clientSecret have not been saved yet" };
  }
  return { ok: true, value: { clientId, clientSecret, accessToken, refreshToken } };
}

/**
 * Show enough of a client id to recognise which app is connected, without
 * handing the whole value to the browser. It is an identifier rather than a
 * secret, but there is no reason to send all 56 characters.
 */
export function maskClientId(clientId: string): string {
  const id = (clientId || "").trim();
  if (id.length <= 8) return "*".repeat(id.length);
  return `${id.slice(0, 4)}${"*".repeat(Math.min(8, id.length - 8))}${id.slice(-4)}`;
}