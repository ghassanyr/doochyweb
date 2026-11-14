import { useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { api, ApiError } from "./api";
import { Button, Flash, inputCls } from "./components/ui";
import { FALLBACK_LEGAL, FALLBACK_REGISTRATION, useSiteConfig } from "./siteConfig";

// Sign-in form. It is rendered inside the auth modal, so the surrounding modal
// owns the card, title and close button; this component only owns the fields
// and the login/register switch.
export default function Login({
  onAuthed,
  mode,
  onModeChange,
  onForgotPassword,
}: {
  onAuthed: (token: string, mode: "login" | "register") => void;
  mode: "login" | "register";
  onModeChange: (mode: "login" | "register") => void;
  onForgotPassword?: () => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const { config } = useSiteConfig();
  const registration = config?.registration ?? FALLBACK_REGISTRATION;
  const legal = config?.legal ?? FALLBACK_LEGAL;
  const needsLegalAcceptance =
    mode === "register" && Boolean(legal.termsUrl || legal.privacyUrl);

  const cleanEmail = email.trim();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
  const emailError = mode === "register" && emailTouched && !emailValid;
  const needsInvite = mode === "register" && registration.mode === "invite";
  const ready =
    username.trim() !== "" &&
    password !== "" &&
    (mode === "login" || emailValid) &&
    (!needsInvite || inviteCode.trim() !== "") &&
    (!needsLegalAcceptance || acceptedTerms);
  const canSubmit =
    username.trim() !== "" &&
    password !== "" &&
    (mode === "login" || cleanEmail !== "") &&
    (!needsInvite || inviteCode.trim() !== "") &&
    (!needsLegalAcceptance || acceptedTerms);

  async function doAuth() {
    if (busy) return;
    if (!ready) {
      if (mode === "register") setEmailTouched(true);
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "login") {
        const res = await api.login(username, password);
        onAuthed(res.token, mode);
      } else {
        const res = await api.register(
          username,
          cleanEmail,
          password,
          inviteCode,
          acceptedTerms
        );
        if (res.pending) {
          setNotice(
            res.message || "Account created. An admin must approve it before you can sign in."
          );
          setPassword("");
          setInviteCode("");
          onModeChange("login");
        } else if (res.verificationRequired) {
          setNotice(res.message || "Check your inbox to verify your email before signing in.");
          setUnverifiedEmail(res.email || cleanEmail);
          setPassword("");
          setInviteCode("");
          onModeChange("login");
        } else if (res.token) {
          onAuthed(res.token, mode);
        } else {
          setError("Registration did not return a session. Try signing in.");
        }
      }
    } catch (err: any) {
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr?.data?.verificationRequired) {
        setUnverifiedEmail(String(apiErr.data.email || ""));
        setError("Verify your email before signing in.");
      } else {
        setError(err instanceof ApiError ? err.message : "Request failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    if (!unverifiedEmail || resending) return;
    setResending(true);
    setError(null);
    try {
      await api.resendVerification(unverifiedEmail);
      setNotice("A new verification link is on its way. Check your inbox and spam folder.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resend the verification email.");
    } finally {
      setResending(false);
    }
  }

  if (mode === "register" && registration.mode === "closed") {
    return (
      <div className="space-y-4">
        <Flash tone="warning">{registration.message || "Registration is closed."}</Flash>
        <Button variant="secondary" className="w-full" onClick={() => onModeChange("login")}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <>
      {notice && <Flash tone="success">{notice}</Flash>}
      {mode === "login" && unverifiedEmail && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={resending}
          onClick={() => void resendVerification()}
        >
          {resending ? "Sending…" : "Resend verification email"}
        </Button>
      )}
      {mode === "register" && registration.mode === "approval" && (
        <Flash tone="warning">
          {registration.message || "New accounts need admin approval before signing in."}
        </Flash>
      )}
      {mode === "register" && registration.mode === "invite" && (
        <Flash tone="warning">
          {registration.message || "Enter the invite code you were given to register."}
        </Flash>
      )}
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void doAuth();
        }}
      >
        <div>
          <label htmlFor="username" className="mb-2 block text-sm font-medium text-fg-muted">
            Username
          </label>
          <input
            id="username"
            name="username"
            className={inputCls}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </div>
        {mode === "register" && (
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-medium text-fg-muted">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              className={`${inputCls} ${
                emailError ? "border-danger focus:border-danger focus:ring-danger/40" : ""
              }`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              autoComplete="email"
              aria-invalid={emailError}
              aria-describedby={emailError ? "email-error" : undefined}
            />
            {emailError && (
              <p id="email-error" className="mt-1.5 text-xs text-danger">
                Enter a valid email address.
              </p>
            )}
          </div>
        )}
        {needsInvite && (
          <div>
            <label htmlFor="invite-code" className="mb-2 block text-sm font-medium text-fg-muted">
              Invite code
            </label>
            <input
              id="invite-code"
              name="inviteCode"
              className={inputCls}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoComplete="off"
            />
          </div>
        )}
        <div>
          <label htmlFor="password" className="mb-2 block text-sm font-medium text-fg-muted">
            Password
          </label>
          <input
            id="password"
            name="password"
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </div>

        {needsLegalAcceptance && (
          <label className="flex items-start gap-2 text-xs leading-relaxed text-fg-muted">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
            />
            <span>
              I agree to the{" "}
              {legal.termsUrl && (
                <a
                  href={legal.termsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Terms
                </a>
              )}
              {legal.termsUrl && legal.privacyUrl && " and "}
              {legal.privacyUrl && (
                <a
                  href={legal.privacyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Privacy Policy
                </a>
              )}
              .
            </span>
          </label>
        )}

        {error && <Flash tone="danger">{error}</Flash>}

        {mode === "login" && onForgotPassword && (
          <p className="text-right text-sm">
            <button
              type="button"
              className="text-fg-muted transition hover:text-fg"
              onClick={onForgotPassword}
            >
              Forgot password?
            </button>
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          variant="primary"
          className="w-full"
          disabled={!canSubmit || busy}
          icon={mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
        >
          {busy ? (mode === "login" ? "Signing in…" : "Creating account…") : mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm">
        {mode === "login" ? (
          registration.mode === "closed" ? (
            <span className="text-fg-faint">{registration.message || "Registration is closed."}</span>
          ) : (
            <button
              type="button"
              className="text-fg-muted transition hover:text-fg"
              onClick={() => onModeChange("register")}
            >
              No account? <span className="text-accent">Register</span>
            </button>
          )
        ) : (
          <button
            type="button"
            className="text-fg-muted transition hover:text-fg"
            onClick={() => onModeChange("login")}
          >
            Already registered? <span className="text-accent">Sign in</span>
          </button>
        )}
      </p>
    </>
  );
}
