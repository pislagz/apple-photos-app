import { useEffect, useState } from "react";
import { ApiError, listSessions, revokeSession, type SessionResponse } from "../api";

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "something went wrong";
}

export default function SessionsScreen() {
  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    listSessions().then(setSessions).catch((err: unknown) => setError(describeError(err)));
  }

  useEffect(refresh, []);

  async function handleRevoke(session: SessionResponse) {
    if (!window.confirm(`Revoke this session for ${session.username}?`)) return;
    try {
      await revokeSession(session.id);
      refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <section>
      <h1>Sessions</h1>
      {error && <p role="alert">{error}</p>}

      <div className="admin-table-wrap">
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Device</th>
            <th>Last seen</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id}>
              <td>{session.username}</td>
              <td>{session.device ?? "unknown"}</td>
              <td>{session.last_seen_at}</td>
              <td>
                <button type="button" onClick={() => handleRevoke(session)}>
                  Revoke
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}
