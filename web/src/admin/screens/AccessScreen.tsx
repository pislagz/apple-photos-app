import { useEffect, useState } from "react";
import { ApiError, type AccessMatrixResponse, assignLibrary, readAccessMatrix, unassignLibrary } from "../api";

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "something went wrong";
}

export default function AccessScreen() {
  const [matrix, setMatrix] = useState<AccessMatrixResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    readAccessMatrix()
      .then((next) => {
        setMatrix(next);
        setError(null);
      })
      .catch((err: unknown) => setError(describeError(err)));
  }

  useEffect(refresh, []);

  async function handleToggleAssignment(userId: number, libraryId: number, assigned: boolean) {
    try {
      if (assigned) {
        await unassignLibrary(userId, libraryId);
      } else {
        await assignLibrary(userId, libraryId);
      }
      refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <section>
      <h1>Access</h1>
      {error && <p role="alert">{error}</p>}
      <div className="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              {matrix?.libraries.map((library) => <th key={library.id}>{library.display_name}</th>)}
            </tr>
          </thead>
          <tbody>
            {matrix?.users.map((user) => (
              <tr key={user.id}>
                <td>{user.username}</td>
                {matrix.libraries.map((library) => {
                  const assigned = (matrix.assignments[String(user.id)] ?? []).includes(library.id);
                  return (
                    <td key={library.id}>
                      <input
                        type="checkbox"
                        aria-label={`${user.username} × ${library.display_name}`}
                        checked={assigned}
                        onChange={() => handleToggleAssignment(user.id, library.id, assigned)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
