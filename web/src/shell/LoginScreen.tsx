import { useState } from "react";
import { passkeysSupported } from "../passkeys";
import type { Layout } from "./useLayout";

export type LoginErrorKind = "lockout" | "invalid" | "generic";

export interface LoginError {
  kind: LoginErrorKind;
  message: string;
}

function errorText(error: LoginError): string {
  if (error.kind === "lockout") {
    return "Too many sign-in attempts. Wait a few minutes and try again.";
  }
  return error.message;
}

export default function LoginScreen({
  layout,
  error,
  onSubmit,
  onPasskey,
}: {
  layout: Layout;
  error: LoginError | null;
  onSubmit: (username: string, password: string) => void;
  // Shown only when the browser has WebAuthn; sign-in needs no username.
  onPasskey?: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSubmit(username, password);
  }

  return (
    <main className={layout === "mobile" ? "login-screen login-screen--mobile" : "login-screen login-screen--desktop"}>
      <div className="login-card">
        <h1>Sign in</h1>
        {error && <p role="alert">{errorText(error)}</p>}
        <form onSubmit={handleSubmit}>
          <label>
            Username
            <input
              value={username}
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit">Sign in</button>
        </form>
        {onPasskey && passkeysSupported() && (
          <button type="button" className="login-card__passkey" onClick={onPasskey}>
            Sign in with a passkey
          </button>
        )}
      </div>
    </main>
  );
}
