import { useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { api, ApiError } from "./api";
import { Button, Flash, inputCls } from "./components/ui";

// Sign-in form. It is rendered inside the auth modal, so the surrounding modal
// owns the card, title and close button; this component only owns the fields
// and the login/register switch.
export default function Login({
  onAuthed,
  mode,
  onModeChange,
}: {
  onAuthed: (token: string, mode: "login" | "register") => void;
  mode: "login" | "register";
  onModeChange: (mode: "login" | "register") => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cleanEmail = email.trim();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
  const emailError = mode === "register" && emailTouched && !emailValid;
  const ready = username.trim() !== "" && password !== "" && (mode === "login" || emailValid);
  const canSubmit =
    username.trim() !== "" && password !== "" && (mode === "login" || cleanEmail !== "");

  async function doAuth() {
    if (busy) return;
    if (!ready) {
      if (mode === "register") setEmailTouched(true);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === "login"
          ? await api.login(username, password)
          : await api.register(username, cleanEmail, password);
      onAuthed(res.token, mode);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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

        {error && <Flash tone="danger">{error}</Flash>}

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
          <button
            type="button"
            className="text-fg-muted transition hover:text-fg"
            onClick={() => onModeChange("register")}
          >
            No account? <span className="text-accent">Register</span>
          </button>
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
