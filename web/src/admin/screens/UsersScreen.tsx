import { useEffect, useState } from "react";
import {
  ApiError,
  type AccessMatrixResponse,
  createInvite,
  createUser,
  deleteUser,
  type InviteResponse,
  listInvites,
  readAccessMatrix,
  type Role,
  unlockUser,
  updateUser,
  type UserResponse,
} from "../api";

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "something went wrong";
}

export default function UsersScreen() {
  const [matrix, setMatrix] = useState<AccessMatrixResponse | null>(null);
  const [invites, setInvites] = useState<InviteResponse[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [inviteRole, setInviteRole] = useState<Role>("user");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    readAccessMatrix().then(setMatrix).catch((err: unknown) => setError(describeError(err)));
    listInvites().then(setInvites).catch((err: unknown) => setError(describeError(err)));
  }

  useEffect(refresh, []);

  async function handleCreateUser(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createUser(username, password, role);
      setUsername("");
      setPassword("");
      setRole("user");
      refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleRoleChange(user: UserResponse, nextRole: Role) {
    try {
      await updateUser(user.username, { role: nextRole });
      refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleToggleDisabled(user: UserResponse) {
    try {
      await updateUser(user.username, { disabled: !user.disabled });
      refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleSetPassword(user: UserResponse) {
    const next = window.prompt(`New password for ${user.username}`);
    if (next === null || next === "") return;
    try {
      await updateUser(user.username, { password: next });
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleDelete(user: UserResponse) {
    if (!window.confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
    try {
      await deleteUser(user.username);
      refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleUnlock(user: UserResponse) {
    try {
      await unlockUser(user.username);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleCreateInvite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const invite = await createInvite(inviteRole);
      setInviteLink(`${window.location.origin}/invite/${invite.code}`);
      refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <section>
      <h1>Users</h1>
      {error && <p role="alert">{error}</p>}

      <form onSubmit={handleCreateUser}>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button type="submit">Create user</button>
      </form>

      <div className="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {matrix?.users.map((user) => (
              <tr key={user.id}>
                <td>{user.username}</td>
                <td>
                  <select value={user.role} onChange={(event) => handleRoleChange(user, event.target.value as Role)}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td>{user.disabled ? "disabled" : "enabled"}</td>
                <td>
                  <div className="admin-actions">
                    <button type="button" onClick={() => handleToggleDisabled(user)}>
                      {user.disabled ? "Enable" : "Disable"}
                    </button>
                    <button type="button" onClick={() => handleSetPassword(user)}>
                      Set password
                    </button>
                    <button type="button" onClick={() => handleUnlock(user)}>
                      Unlock
                    </button>
                    <button type="button" onClick={() => handleDelete(user)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Invites</h2>
      <form onSubmit={handleCreateInvite}>
        <label>
          Role
          <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Role)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button type="submit">Create invite link</button>
      </form>
      {inviteLink && (
        <p>
          One-time invite link: <code>{inviteLink}</code>
        </p>
      )}
      <ul>
        {invites.map((invite) => (
          <li key={invite.id}>
            {invite.role} -- created by {invite.created_by} -- {invite.used_at ? "used" : `expires ${invite.expires_at}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
