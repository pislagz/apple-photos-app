import { useState } from "react";
import { ApiError, type KeepSignedInMode, type Profile, profileLogin } from "../api";
import Avatar from "./Avatar";
import type { Layout } from "./useLayout";
import { isStandalone } from "./useLayout";

// #519: the "Who's watching?" screen. Tapping a profile first tries it with no
// password; the server answers `password_required` when one is needed, so this
// screen never has to know which profiles have one.
type Step =
  | { kind: "grid" }
  | { kind: "trying"; profile: Profile }
  | { kind: "password"; profile: Profile }
  | { kind: "blocked"; profile: Profile; message: string };

export default function ProfilePicker({
  layout,
  profiles,
  keepSignedIn,
  onSignedIn,
  onOtherUser,
}: {
  layout: Layout;
  profiles: Profile[];
  keepSignedIn: KeepSignedInMode;
  onSignedIn: () => void;
  onOtherUser: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "grid" });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keep, setKeep] = useState(keepSignedIn === "default_on");
  const client = isStandalone() ? "pwa" : "desktop";
  const remember = keepSignedIn !== "disabled" && keep;

  async function attempt(profile: Profile, pass: string) {
    setBusy(true);
    setError(null);
    try {
      await profileLogin(profile.id, pass, remember, client);
      onSignedIn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && err.code === "password_required") {
        setStep({ kind: "password", profile });
      } else if (err instanceof ApiError && err.status === 403 && err.code?.startsWith("passwordless_")) {
        setStep({ kind: "blocked", profile, message: err.message });
      } else if (err instanceof ApiError && err.status === 429) {
        setStep({ kind: "password", profile });
        setError("Too many sign-in attempts. Wait a few minutes and try again.");
      } else if (err instanceof ApiError && err.status === 401) {
        setError("Wrong password. Try again.");
        setStep({ kind: "password", profile });
      } else {
        setStep({ kind: "grid" });
        setError("Sign in failed. Try again.");
      }
      setBusy(false);
    }
  }

  function choose(profile: Profile) {
    setPassword("");
    setStep({ kind: "trying", profile });
    void attempt(profile, "");
  }

  const rootClass = `login-screen login-screen--${layout === "mobile" ? "mobile" : "desktop"} profiles-screen`;

  if (step.kind === "grid" || step.kind === "trying") {
    return (
      <main className={rootClass}>
        <div className="profiles">
          <h1 className="profiles__title">Who’s watching?</h1>
          {error && <p role="alert" className="profiles__error">{error}</p>}
          <ul className="profiles__grid">
            {profiles.map((profile) => (
              <li key={profile.id}>
                <button
                  type="button"
                  className="profile"
                  disabled={step.kind === "trying"}
                  aria-busy={step.kind === "trying" && step.profile.id === profile.id ? true : undefined}
                  onClick={() => choose(profile)}
                >
                  <Avatar username={profile.display_name} src={profile.avatar_url} className="account-menu__avatar profile__avatar" />
                  <span className="profile__name">{profile.display_name}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="profiles__other" onClick={onOtherUser}>
            Other user…
          </button>
        </div>
      </main>
    );
  }

  const { profile } = step;
  return (
    <main className={rootClass}>
      <div className="profiles profiles--step">
        <Avatar username={profile.display_name} src={profile.avatar_url} className="account-menu__avatar profile__avatar profile__avatar--large" />
        <h1 className="profiles__title">{profile.display_name}</h1>
        {step.kind === "blocked" ? (
          <>
            <p role="alert" className="profiles__note">{step.message}</p>
            <button type="button" className="profiles__back" onClick={() => setStep({ kind: "grid" })}>
              Back
            </button>
          </>
        ) : (
          <form
            className="profiles__form"
            onSubmit={(event) => {
              event.preventDefault();
              void attempt(profile, password);
            }}
          >
            {error && <p role="alert" className="profiles__error">{error}</p>}
            <label>
              <span className="profiles__label">Password</span>
              <input
                type="password"
                autoFocus
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {keepSignedIn !== "disabled" && (
              <label className="profiles__keep">
                <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
                Keep me signed in
              </label>
            )}
            <button type="submit" className="profiles__submit" disabled={busy || password === ""}>
              Sign in
            </button>
            <button type="button" className="profiles__back" onClick={() => (setError(null), setStep({ kind: "grid" }))}>
              Back
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
