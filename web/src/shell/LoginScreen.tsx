import { useEffect, useState } from "react";
import { readCredentials } from "./readCredentials";
import InfoButton from "../help/InfoButton";
import { passkeyConnectionNote, passkeysSupported } from "../passkeys";
import type { KeepSignedInMode } from "../api";
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
  keepSignedIn = "default_on",
  onSubmit,
  onPasskey,
}: {
  layout: Layout;
  error: LoginError | null;
  keepSignedIn?: KeepSignedInMode;
  onSubmit: (username: string, password: string, rememberMe: boolean) => void;
  // Shown only when the browser has WebAuthn; sign-in needs no username.
  onPasskey?: (rememberMe: boolean) => void;
}) {
  const offered = keepSignedIn !== "disabled";
  const [keep, setKeep] = useState(keepSignedIn === "default_on");
  // The admin setting arrives after the first render; follow it until the user touches the box.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setKeep(keepSignedIn === "default_on");
  }, [keepSignedIn, touched]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // AutoFill sets values without key events, so read the live fields, not React state.
    const { username, password } = readCredentials(event.currentTarget);
    onSubmit(username, password, offered && keep);
  }

  return (
    <main className={layout === "mobile" ? "login-screen login-screen--mobile" : "login-screen login-screen--desktop"}>
      <div className="login-card">
        <h1>Sign in</h1>
        {error && <p role="alert">{errorText(error)}</p>}
        <form method="post" action="" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label>
            Password
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
            />
          </label>
          {offered && (
            <label className="login-card__keep">
              <input
                type="checkbox"
                checked={keep}
                onChange={(event) => {
                  setTouched(true);
                  setKeep(event.target.checked);
                }}
              />
              Keep me signed in
            </label>
          )}
          <button type="submit">Sign in</button>
        </form>
        {onPasskey && passkeyConnectionNote() && (
          <p className="login-card__passkey-note">
            <InfoButton helpKey="passkeyLogin" name="logging in with passkeys" label="How to log in using passkeys?" />
          </p>
        )}
        {onPasskey && !passkeyConnectionNote() && passkeysSupported() && (
          <button type="button" className="login-card__passkey" onClick={() => onPasskey(offered && keep)}>
            Sign in with a passkey
          </button>
        )}
      </div>
    </main>
  );
}
