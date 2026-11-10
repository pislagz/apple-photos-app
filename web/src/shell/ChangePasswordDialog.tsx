import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, changePassword } from "../api";

// Mirrors the server's `Password` minimum (session_auth.py).
const MIN_LENGTH = 12;

// #71: self-service password change. The server keeps this session and signs
// the user's other devices out; the message says so.
export default function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape closes, like the viewers; not while the request is in flight.
  const busyRef = useRef(false);
  busyRef.current = busy;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented && !busyRef.current) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (next.length < MIN_LENGTH) {
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("New passwords don’t match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError("Current password is incorrect.");
      else if (err instanceof ApiError && err.status === 429) setError("Too many attempts. Try again later.");
      else setError("Couldn’t change your password. Try again.");
      setCurrent("");
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div
      className="change-password"
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-password-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form className="change-password__card" onSubmit={submit}>
        <h2 id="change-password-title">Change password</h2>
        {done ? (
          <>
            <p role="status">Password changed. Your other devices have been signed out.</p>
            <div className="change-password__actions">
              <button type="button" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              ref={inputRef}
              type="password"
              autoComplete="current-password"
              aria-label="Current password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
            <input
              type="password"
              autoComplete="new-password"
              aria-label="New password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
            <input
              type="password"
              autoComplete="new-password"
              aria-label="Confirm new password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
            {error && (
              <p role="alert" className="change-password__error">
                {error}
              </p>
            )}
            <div className="change-password__actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="change-password__submit" disabled={busy || current === "" || next === ""}>
                Change password
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
