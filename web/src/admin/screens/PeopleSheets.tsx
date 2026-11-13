import { useState } from "react";
import { createInvite, createUser, deleteUser, type Role, updateUser, type UserResponse } from "../api";
import { describeError } from "../sharing";
import Sheet from "../ui/Sheet";

export const MIN_PASSWORD = 12;

function SheetError({ message }: { message: string | null }) {
  return message === null ? null : (
    <p role="alert" className="admin-sheet__error">
      {message}
    </p>
  );
}

/** Both fields must match and be long enough. Returns the reason to show, or null. */
export function passwordProblem(next: string, again: string): string | null {
  if (next === "") return null;
  if (next.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (again !== "" && again !== next) return "The two passwords are not the same.";
  return null;
}

export function ChangePasswordSheet({
  user,
  onClose,
  onDone,
}: {
  user: UserResponse;
  onClose: () => void;
  onDone: () => void;
}) {
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = passwordProblem(next, again);
  const ready = next.length >= MIN_PASSWORD && next === again && !busy;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateUser(user.username, { password: next });
      onDone();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Change Password for ${user.username}`} onClose={onClose} actions={[{ label: "Change Password", onClick: save, disabled: !ready }]}>
      <div className="admin-form">
        <label className="admin-field">
          New password
          <input
            data-autofocus
            type="password"
            autoComplete="new-password"
            className="admin-input"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label className="admin-field">
          Type it again
          <input
            type="password"
            autoComplete="new-password"
            className="admin-input"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </label>
        <p className={problem ? "admin-hint admin-hint--error" : "admin-hint"} role={problem ? "alert" : undefined}>
          {problem ?? `At least ${MIN_PASSWORD} characters. ${user.username} is signed out on other devices.`}
        </p>
        <SheetError message={error} />
      </div>
    </Sheet>
  );
}

export function RoleSheet({
  user,
  isSelf,
  onClose,
  onDone,
}: {
  user: UserResponse;
  isSelf: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [role, setRole] = useState<Role>(user.role);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateUser(user.username, { role });
      onDone();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Role for ${user.username}`}
      onClose={onClose}
      actions={[{ label: "Save", onClick: save, disabled: busy || role === user.role }]}
    >
      <div className="admin-form" role="radiogroup" aria-label="Role">
        <label className="admin-choice">
          <input type="radio" name="role" checked={role === "admin"} onChange={() => setRole("admin")} />
          <span>
            Administrator
            <span className="admin-row__detail">Can change everything in this panel.</span>
          </span>
        </label>
        <label className="admin-choice">
          <input
            type="radio"
            name="role"
            checked={role === "user"}
            disabled={isSelf}
            onChange={() => setRole("user")}
          />
          <span>
            Person
            <span className="admin-row__detail">
              {isSelf
                ? "You can't remove your own administrator access. Ask another administrator."
                : "Can only see the libraries you share with them."}
            </span>
          </span>
        </label>
        <SheetError message={error} />
      </div>
    </Sheet>
  );
}

export function DeleteUserSheet({
  user,
  onClose,
  onDone,
}: {
  user: UserResponse;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteUser(user.username);
      onDone();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Delete "${user.username}"?`}
      onClose={onClose}
      actions={[{ label: "Delete User", kind: "destructive", onClick: remove, disabled: busy }]}
    >
      <p>
        {user.username} will be signed out and the account is removed for good. Photos and libraries are not affected.
      </p>
      <SheetError message={error} />
    </Sheet>
  );
}

export function AddPersonSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = passwordProblem(password, again);
  const ready = username.trim() !== "" && password.length >= MIN_PASSWORD && password === again && !busy;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await createUser(username.trim(), password, role);
      onDone();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <Sheet title="Add Person" onClose={onClose} actions={[{ label: "Add Person", onClick: create, disabled: !ready }]}>
      <div className="admin-form">
        <label className="admin-field">
          Name
          <input
            data-autofocus
            autoComplete="off"
            className="admin-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="admin-field">
          Password
          <input
            type="password"
            autoComplete="new-password"
            className="admin-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="admin-field">
          Type it again
          <input
            type="password"
            autoComplete="new-password"
            className="admin-input"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </label>
        <p className={problem ? "admin-hint admin-hint--error" : "admin-hint"} role={problem ? "alert" : undefined}>
          {problem ?? `At least ${MIN_PASSWORD} characters.`}
        </p>
        <label className="admin-field">
          Role
          <select className="admin-input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="user">Person</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        <SheetError message={error} />
      </div>
    </Sheet>
  );
}

export function InviteSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [role, setRole] = useState<Role>("user");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const invite = await createInvite(role);
      setLink(`${window.location.origin}/invite/${invite.code}`);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (link === null) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // No clipboard permission (plain http, old browser): select the text so Copy works by hand.
      document.querySelector<HTMLInputElement>(".admin-invite-link")?.select();
      setError("Could not copy automatically. The link is selected: copy it by hand.");
    }
  }

  return (
    <Sheet
      title="Invite Someone"
      onClose={onClose}
      cancelLabel={link === null ? "Cancel" : "Done"}
      actions={link === null ? [{ label: "Create Link", onClick: create, disabled: busy }] : []}
    >
      {link === null ? (
        <div className="admin-form">
          <p>They pick their own name and password. The link works once and stops after 7 days.</p>
          <label className="admin-field">
            Role
            <select data-autofocus className="admin-input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="user">Person</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <SheetError message={error} />
        </div>
      ) : (
        <div className="admin-form">
          <label className="admin-field">
            Invitation link
            <input readOnly className="admin-input admin-invite-link" value={link} onFocus={(e) => e.target.select()} />
          </label>
          <button type="button" className="admin-btn admin-btn--primary" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
          <p className="admin-hint">This link is shown only now. Send it to the person you are inviting.</p>
          <SheetError message={error} />
        </div>
      )}
    </Sheet>
  );
}
