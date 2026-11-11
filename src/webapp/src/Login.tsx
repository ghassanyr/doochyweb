import { useState } from "react";
import { Lock, LogIn, UserPlus } from "lucide-react";
import { api, ApiError } from "./api";
import { Button, Card, Flash, inputCls } from "./components/ui";
import { FadeRise } from "./components/motion";

export default function Login({
  onAuthed,
  variant = "fullscreen",
  hint,
}: {
  onAuthed: (token: string, mode: "login" | "register") => void;
  // "fullscreen" takes over the viewport (used when nothing is signed in and
  // no shell is rendered); "inline" sits inside the app shell, for the Trading
  // tab when the visitor has no account.
  variant?: "fullscreen" | "inline";
  hint?: string;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function doAuth() {
    setError(null);
    try {
      const res = mode === "login" ? await api.login(username, password) : await api.register(username, password);
      onAuthed(res.token, mode);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    }
  }

  const ready = username.trim() !== "" && password !== "";

  return (
    <div className={variant === "fullscreen" ? "flex min-h-screen items-center justify-center p-6" : ""}>
      <FadeRise className="w-full max-w-sm">
        <Card className="p-8 shadow-overlay">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Sign In</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {hint ??
              (mode === "login"
                ? "Sign in to manage your cTrader accounts"
                : "Create an account to get started")}
          </p>

          <form
            className="mt-6 space-y-4"
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
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>

            {error && <Flash tone="danger">{error}</Flash>}

            <Button
              type="button"
              size="lg"
              variant="primary"
              className="w-full"
              disabled={!ready}
              icon={mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              onClickAsync={doAuth}
            >
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm">
            {mode === "login" ? (
              <button type="button" className="text-fg-muted transition hover:text-fg" onClick={() => setMode("register")}>
                No account? <span className="text-accent">Register</span>
              </button>
            ) : (
              <button type="button" className="text-fg-muted transition hover:text-fg" onClick={() => setMode("login")}>
                Already registered? <span className="text-accent">Sign in</span>
              </button>
            )}
          </p>
        </Card>
      </FadeRise>
    </div>
  );
}