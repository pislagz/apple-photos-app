import { useEffect, useState } from "react";
import { ApiError, auditLogCsvUrl, type AuditLogEntry, readAuditLog } from "../api";

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "something went wrong";
}

export default function AuditLogScreen() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [userId, setUserId] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  function filters() {
    return {
      userId: userId === "" ? undefined : Number(userId),
      libraryId: libraryId === "" ? undefined : Number(libraryId),
      dateFrom: dateFrom === "" ? undefined : dateFrom,
      dateTo: dateTo === "" ? undefined : dateTo,
    };
  }

  function refresh() {
    readAuditLog(filters())
      .then(setEntries)
      .catch((err: unknown) => setError(describeError(err)));
  }

  useEffect(refresh, []);

  function handleFilter(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    refresh();
  }

  return (
    <section>
      <h1>Audit log</h1>
      {error && <p role="alert">{error}</p>}

      <form onSubmit={handleFilter}>
        <label>
          User id
          <input value={userId} onChange={(event) => setUserId(event.target.value)} />
        </label>
        <label>
          Library id
          <input value={libraryId} onChange={(event) => setLibraryId(event.target.value)} />
        </label>
        <label>
          From
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <button type="submit">Filter</button>
        <a href={auditLogCsvUrl(filters())}>Export CSV</a>
      </form>

      <div className="admin-table-wrap">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>Actor</th>
            <th>User</th>
            <th>Library</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.occurred_at}</td>
              <td>{entry.action}</td>
              <td>{entry.actor ?? ""}</td>
              <td>{entry.username ?? ""}</td>
              <td>{entry.library_display_name ?? ""}</td>
              <td>{entry.detail ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}
