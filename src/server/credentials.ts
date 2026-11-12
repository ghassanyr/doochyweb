// Credential input rules for reconnecting cTrader.
//
// The OpenAPI app (client id and secret) is created once and then left alone, so
// the common case is "my tokens expired, let me paste fresh ones". Requiring all
// four fields every time made people retype the secret they had no reason to
// change. The rule is therefore: the app fields are optional once they have been
// saved, and only new tokens are required.

export interface StoredCredentials {
  /** Null for OAuth connections, which use the platform app. */
  clientId?: string | null;
  clientSecret?: string | null;
  accessToken: string;
  refreshToken: string;
}

/** Platform app pair, used when the user has not supplied their own. */
export interface PlatformAppCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ConnectPayload {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  /** True when this app pair belongs to the user and must be persisted. */
  storeApp: boolean;
}

/** Trimmed string, or "" for anything missing. */
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export type ConnectResolution =
  | { ok: true; value: ConnectPayload }
  | { ok: false; error: string };

/**
 * Merge what was sent with what is already stored, falling back to the
 * platform app.
 *
 * Sent app fields always win when present, so recreating the app still works.
 * Otherwise a previously saved manual pair is reused. If neither exists, the
 * platform app is used for the socket but not copied onto the user document.
 */
export function resolveConnectInput(
  body: Record<string, unknown> | undefined | null,
  existing: Pick<StoredCredentials, "clientId" | "clientSecret"> | null | undefined,
  platform?: PlatformAppCredentials | null
): ConnectResolution {
  const sentId = str(body?.clientId);
  const sentSecret = str(body?.clientSecret);
  const storedId = str(existing?.clientId);
  const storedSecret = str(existing?.clientSecret);
  const accessToken = str(body?.accessToken);
  const refreshToken = str(body?.refreshToken);

  if (!accessToken || !refreshToken) {
    return { ok: false, error: "accessToken and refreshToken are required" };
  }
  if (!!sentId !== !!sentSecret) {
    return {
      ok: false,
      error: "clientId and clientSecret must be provided together",
    };
  }

  if (sentId && sentSecret) {
    return {
      ok: true,
      value: { clientId: sentId, clientSecret: sentSecret, accessToken, refreshToken, storeApp: true },
    };
  }
  if (storedId && storedSecret) {
    return {
      ok: true,
      value: {
        clientId: storedId,
        clientSecret: storedSecret,
        accessToken,
        refreshToken,
        storeApp: true,
      },
    };
  }
  if (platform?.clientId && platform?.clientSecret) {
    return {
      ok: true,
      value: {
        clientId: platform.clientId,
        clientSecret: platform.clientSecret,
        accessToken,
        refreshToken,
        storeApp: false,
      },
    };
  }
  return { ok: false, error: "clientId and clientSecret have not been saved yet" };
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