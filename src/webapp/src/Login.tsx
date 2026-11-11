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
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function doAuth() {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = mode === "login" ? await api.login(username, password) : await api.register(username, password);
      onAuthed(res.token, mode);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const ready = username.trim() !== "" && password !== "";

  return (
    <>
      <form
        className="space-y-4"
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
            className={inputCls}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-2 block text-sm font-medium text-fg-muted">
            Password
          </label>
          <input
            id="password"
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
          disabled={!ready || busy}
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
