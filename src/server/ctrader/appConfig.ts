// Platform cTrader app credentials.
//
// Kept separate from oauth.ts because the socket layer needs the client id and
// secret but must not import the OAuth router (oauth.ts imports connection.ts).
// Manual connections may still carry their own app pair on the credentials
// document; this module is only the platform fallback.

import { resolveIntegration } from "../integrations/store";

export interface CtraderAppCredentials {
  clientId: string;
  clientSecret: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Pure mapping from resolved integration values to an app pair. */
export function ctraderAppCredentialsFrom(
  values: Record<string, unknown>
): CtraderAppCredentials | null {
  const clientId = text(values.clientId);
  const clientSecret = text(values.clientSecret);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * The platform-owned app, or null when the admin has not configured one.
 * Throws when stored values cannot be decrypted; callers that must fail closed
 * should catch.
 */
export async function ctraderAppCredentials(
  env: NodeJS.ProcessEnv = process.env
): Promise<CtraderAppCredentials | null> {
  const resolved = await resolveIntegration("ctrader", env);
  return ctraderAppCredentialsFrom(resolved.values);
}
