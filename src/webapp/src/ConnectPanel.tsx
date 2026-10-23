import { useState } from "react";
import { ArrowLeft, Plug, Eye, EyeOff } from "lucide-react";
import { ApiError, ConnectInput } from "./api";
import { Button, Card, Flash, inputCls } from "./components/ui";
import { FadeRise } from "./components/motion";

const HELPER_TEXT = `Paste the values from your cTrader OpenAPI app.
Client ID and Client Secret: openapi.ctrader.com/apps → your app → "Credentials"
Access and Refresh tokens: openapi.ctrader.com/apps → your app → sandbox → set scope to
Account info and trading and generate tokens`;

const TOKEN_HELPER_TEXT = `Generate new access and refresh tokens at
openapi.ctrader.com/apps → your app → sandbox, with the scope set to
Account info and trading. The saved app credentials are reused.`;

export default function ConnectPanel({
  onConnected,
  onCancel,
  storedClientId,
}: {
  onConnected: (creds: ConnectInput) => Promise<void>;
  onCancel?: () => void;
  /** Masked id of the already-saved app. When set, the client id and secret
   *  are optional: only new tokens are needed. */
  storedClientId?: string | null;
}) {
  const hasStored = Boolean(storedClientId);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAppFields, setShowAppFields] = useState(false);

  const appReady = hasStored || (clientId && clientSecret);
  const ready = appReady && accessToken && refreshToken;

  async function doConnect() {
    setError(null);
    try {
      // Omit the app fields when they are unchanged, so the server reuses the
      // stored pair rather than being handed an empty one.
      const payload: ConnectInput = { accessToken, refreshToken };
      if (!hasStored || showAppFields) {
        payload.clientId = clientId.trim();
        payload.clientSecret = clientSecret.trim();
      }
      await onConnected(payload);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : "Connect failed");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <FadeRise className="w-full max-w-md">
        <Card className="p-8 shadow-overlay">
          {onCancel && (
            <div className="-ml-2 -mt-1 mb-2 flex">
              <Button
                variant="ghost"
                size="sm"
                icon={<ArrowLeft className="h-4 w-4" />}
                onClick={onCancel}
                aria-label="Back"
              />
            </div>
          )}
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Plug className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            {hasStored ? "Refresh cTrader tokens" : "Connect cTrader"}
          </h1>
          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-fg-faint">
            {hasStored && !showAppFields ? TOKEN_HELPER_TEXT : HELPER_TEXT}
          </p>

          <div className="mt-5 space-y-4">
            {hasStored && (
              <div className="rounded-lg border border-hairline bg-soft px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg-muted">App credentials</p>
                    <p className="truncate font-mono text-xs text-fg-faint">
                      {showAppFields ? "Enter the new app details below" : `Saved: ${storedClientId}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setShowAppFields((v) => !v);
                      setClientId("");
                      setClientSecret("");
                    }}
                  >
                    {showAppFields ? "Keep saved" : "Change"}
                  </Button>
                </div>
              </div>
            )}

            {(!hasStored || showAppFields) && (
              <>
            <div>
              <label htmlFor="clientId" className="mb-2 block text-sm font-medium text-fg-muted">
                Client ID
              </label>
              <input id="clientId" className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
            </div>

            <div>
              <label htmlFor="clientSecret" className="mb-2 block text-sm font-medium text-fg-muted">
                Client secret
              </label>
              <div className="relative">
                <input
                  id="clientSecret"
                  className={`${inputCls} pr-10`}
                  type={showSecret ? "text" : "password"}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((s) => !s)}
                  aria-label={showSecret ? "Hide" : "Show"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-faint transition hover:text-fg"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
              </>
            )}

            <div>
              <label htmlFor="accessToken" className="mb-2 block text-sm font-medium text-fg-muted">
                Access token
              </label>
              <div className="relative">
                <input
                  id="accessToken"
                  className={`${inputCls} pr-10`}
                  type={showToken ? "text" : "password"}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((s) => !s)}
                  aria-label={showToken ? "Hide" : "Show"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-faint transition hover:text-fg"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="refreshToken" className="mb-2 block text-sm font-medium text-fg-muted">
                Refresh token
              </label>
              <input id="refreshToken" className={inputCls} value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} autoComplete="off" />
            </div>

            {error && <Flash tone="danger">{error}</Flash>}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="primary" size="lg" className="flex-1" disabled={!ready} onClickAsync={doConnect}>
                <Plug className="h-4 w-4" /> {hasStored ? "Save tokens" : "Connect"}
              </Button>
              {onCancel && (
                <Button type="button" variant="secondary" size="lg" onClick={onCancel}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </Card>
      </FadeRise>
    </div>
  );
}