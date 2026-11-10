import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError } from "../api";
import { isCancelled, listPasskeys, type Passkey, passkeysSupported, registerPasskey, removePasskey } from "../passkeys";

function formatDate(value: string | null): string {
  if (!value) return "never";
  // SQLite's "YYYY-MM-DD HH:MM:SS" is UTC.
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

// P3.1: list, add and remove the signed-in user's passkeys. The password
// keeps working whatever is here.
export default function PasskeysDialog({ onClose }: { onClose: () => void }) {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = passkeysSupported();

  const refresh = useCallback(async () => {
    try {
      setPasskeys(await listPasskeys());
    } catch {
      setError("Couldn’t load your passkeys.");
      setPasskeys([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await registerPasskey(name.trim(), password);
      setName("");
      await refresh();
    } catch (err) {
      if (isCancelled(err)) setError(null);
      else if (err instanceof ApiError && err.status === 401) setError("That password is wrong.");
      else if (err instanceof ApiError && err.status === 429) setError("Too many attempts. Try again later.");
      else if (err instanceof ApiError && err.status === 409) setError(err.message);
      else setError("Couldn’t add a passkey. Try again.");
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  async function remove(passkey: Passkey) {
    setError(null);
    try {
      await removePasskey(passkey.id);
      await refresh();
    } catch {
      setError("Couldn’t remove that passkey.");
    }
  }

  return (
    <div className="change-password" role="dialog" aria-modal="true" aria-labelledby="passkeys-title">
      <div className="change-password__card">
        <h2 id="passkeys-title">Passkeys</h2>
        <p>Sign in with Face ID, Touch ID or a security key instead of typing your password. Your password still works.</p>
        {passkeys !== null && passkeys.length === 0 && <p role="status">No passkeys yet.</p>}
        {passkeys !== null && passkeys.length > 0 && (
          <ul className="passkeys__list">
            {passkeys.map((passkey) => (
              <li key={passkey.id}>
                <span className="passkeys__name">
                  {passkey.name}
                  <small>
                    Added {formatDate(passkey.created_at)} · last used {formatDate(passkey.last_used_at)}
                  </small>
                </span>
                <button type="button" aria-label={`Remove ${passkey.name}`} onClick={() => void remove(passkey)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="change-password__error">
            {error}
          </p>
        )}
        {supported ? (
          <form onSubmit={add} className="passkeys__add">
            <input
              aria-label="Passkey name"
              placeholder="Name, e.g. My iPhone"
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              type="password"
              aria-label="Current password"
              placeholder="Confirm with your password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button type="submit" className="change-password__submit" disabled={busy}>
              Add a passkey
            </button>
          </form>
        ) : (
          <p>This browser can’t create passkeys.</p>
        )}
        <div className="change-password__actions">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
