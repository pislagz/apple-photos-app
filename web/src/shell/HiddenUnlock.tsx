import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ApiError, lockHidden, reconfirmPassword } from "../api";
import { Icon } from "./icons";

// #130: Apple locks Hidden behind Face ID / Touch ID or the password. A PWA
// has neither biometric, so we re-ask for the account password. The server
// enforces it too (the Hidden list 403s until a reconfirm succeeds).
export function HiddenUnlock({
  variant,
  onUnlocked,
  onCancel,
}: {
  variant: "mobile" | "desktop";
  onUnlocked: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || password === "") return;
    setBusy(true);
    setError(null);
    try {
      await reconfirmPassword(password);
      onUnlocked();
    } catch (err) {
      setPassword("");
      if (err instanceof ApiError && err.status === 429) {
        setError("Too many attempts. Try again later.");
      } else if (err instanceof ApiError && err.status === 401) {
        setError("Incorrect password.");
      } else {
        setError("Couldn’t verify your password. Try again.");
      }
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div
      className={`hidden-unlock hidden-unlock--${variant}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hidden-unlock-title"
    >
      <form className="hidden-unlock__card" onSubmit={submit}>
        <Icon name="hidden" size={36} className="hidden-unlock__icon" />
        <h2 id="hidden-unlock-title">Hidden is locked</h2>
        <p>Enter your password to view hidden photos.</p>
        <input
          ref={inputRef}
          type="password"
          autoComplete="current-password"
          aria-label="Password"
          className="hidden-unlock__input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <p role="alert" className="hidden-unlock__error">
            {error}
          </p>
        )}
        <div className="hidden-unlock__actions">
          <button type="button" className="hidden-unlock__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="hidden-unlock__submit" disabled={busy || password === ""}>
            Unlock
          </button>
        </div>
      </form>
    </div>
  );
}

// Mounted only while Hidden is open: unmounting (leaving the screen, route
// change, browser back) re-locks it on the server so the next visit asks again.
// The lock is deferred one tick and cancelled if the effect re-runs: React
// StrictMode (dev) simulates mount/unmount/mount, and an immediate lock there
// would land between unlock and the first list load (#149). The ref survives
// that simulated remount; a real unmount never re-runs the effect, so it locks.
export function HiddenSession({ children }: { children: ReactNode }) {
  const pendingLock = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pendingLock.current !== null) {
      clearTimeout(pendingLock.current);
      pendingLock.current = null;
    }
    return () => {
      pendingLock.current = setTimeout(() => {
        pendingLock.current = null;
        lockHidden().catch(() => {});
      }, 0);
    };
  }, []);
  return <>{children}</>;
}
