import { useState } from "react";
import { ArrowLeft, KeyRound, MailCheck } from "lucide-react";

import { api, ApiError } from "./api";
import { Button, Card, Flash, inputCls } from "./components/ui";
import { useSiteConfig } from "./siteConfig";

export type AuthActionView =
  | "forgot-password"
  | "reset-password"
  | "verify-email"
  | "accept-invite";

function tokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

export default function AuthActionPage({
  view,
  onSignIn,
  onAuthed,
}: {
  view: AuthActionView;
  onSignIn: () => void;
  onAuthed: (token: string) => void;
}) {
  const { config } = useSiteConfig();
  const brand = config?.branding.name || "Doochy";
  const token = tokenFromUrl();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const title =
    view === "forgot-password"
      ? "Reset your password"
      : view === "reset-password"
        ? "Choose a new password"
        : view === "verify-email"
          ? "Verify your email"
          : "Accept your invite";

  async function submit() {
    if (busy) return;
    setError(null);
    setDone(null);
    if (view !== "forgot-password" && view !== "verify-email" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if ((view === "reset-password" || view === "accept-invite") && password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (view === "forgot-password") {
        await api.forgotPassword(email.trim());
        setDone("If that email is registered, a reset link is on its way.");
      } else if (view === "reset-password") {
        await api.resetPassword(token, password);
        setDone("Password updated. You can sign in with your new password.");
        setPassword("");
        setConfirm("");
      } else if (view === "verify-email") {
        await api.verifyEmail(token);
        setDone("Email verified. You can sign in now.");
      } else {
        const res = await api.acceptInvite(token, password);
        onAuthed(res.token);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const needsToken = view === "reset-password" || view === "verify-email" || view === "accept-invite";
  const shownError = needsToken && !token ? "This link is missing its token. Request a new email." : error;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
      <Card className="w-full max-w-md p-7 shadow-overlay">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
          {view === "forgot-password" ? <KeyRound className="h-5 w-5" /> : <MailCheck className="h-5 w-5" />}
        </div>
        <h1 className="mt-4 text-center text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-center text-sm text-fg-muted">
          {view === "forgot-password"
            ? `Enter the email on your ${brand} account.`
            : view === "accept-invite"
              ? `Set a password to join ${brand}.`
              : "This link is valid for 45 minutes."}
        </p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {view === "forgot-password" && (
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-fg-muted">
                Email
              </label>
              <input
                id="email"
                type="email"
                className={inputCls}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                autoFocus
              />
            </div>
          )}

          {(view === "reset-password" || view === "accept-invite") && (
            <>
              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-medium text-fg-muted">
                  New password
                </label>
                <input
                  id="password"
                  type="password"
                  className={inputCls}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="confirm" className="mb-2 block text-sm font-medium text-fg-muted">
                  Confirm password
                </label>
                <input
                  id="confirm"
                  type="password"
                  className={inputCls}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </>
          )}

          {shownError && <Flash tone="danger">{shownError}</Flash>}
          {done && <Flash tone="success">{done}</Flash>}

          {!done &&
            (view === "verify-email" ? (
              <Button type="submit" className="w-full" disabled={!token || busy}>
                {busy ? "Verifying…" : "Verify email"}
              </Button>
            ) : (
              <Button type="submit" className="w-full" disabled={busy || (needsToken && !token)}>
                {busy ? "Working…" : view === "forgot-password" ? "Send reset link" : "Save password"}
              </Button>
            ))}
        </form>

        <div className="mt-5 flex justify-center">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm text-fg-muted transition hover:text-fg"
            onClick={onSignIn}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </button>
        </div>
      </Card>
    </main>
  );
}
