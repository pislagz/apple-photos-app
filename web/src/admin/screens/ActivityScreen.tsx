import { useCallback, useEffect, useRef, useState } from "react";
import { type AccessMatrixResponse, type AuditLogEntry, auditLogCsvUrl, readAccessMatrix, readAuditLog } from "../api";
import { describeError } from "../sharing";
import { describeActivity } from "../ui/activity";
import { formatWhen } from "../ui/format";
import { Footer, GroupedList, Row } from "../ui/GroupedList";
import SkeletonRow from "../ui/SkeletonRow";

export const PAGE_SIZE = 50;

const FOOTER = "A record of who did what, kept so you can see if something looks wrong.";

function fullDate(iso: string): string {
  const d = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export default function ActivityScreen() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [people, setPeople] = useState<AccessMatrixResponse["users"]>([]);
  const [libraries, setLibraries] = useState<AccessMatrixResponse["libraries"]>([]);
  const [userId, setUserId] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const filters = {
    userId: userId === "" ? undefined : Number(userId),
    libraryId: libraryId === "" ? undefined : Number(libraryId),
    dateFrom: dateFrom === "" ? undefined : dateFrom,
    dateTo: dateTo === "" ? undefined : dateTo,
  };
  const filtered = userId !== "" || libraryId !== "" || dateFrom !== "" || dateTo !== "";

  useEffect(() => {
    // Names for the menus. Without them the menus just stay short.
    readAccessMatrix()
      .then((m) => {
        setPeople(m.users);
        setLibraries(m.libraries);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback((f: typeof filters) => {
    const run = ++latest.current;
    setEntries(null);
    setError(null);
    readAuditLog({ ...f, limit: PAGE_SIZE })
      .then((page) => {
        if (run !== latest.current) return;
        setEntries(page);
        setHasMore(page.length === PAGE_SIZE);
      })
      .catch((err: unknown) => {
        if (run !== latest.current) return;
        setEntries([]);
        setHasMore(false);
        setError(describeError(err));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load({
      userId: userId === "" ? undefined : Number(userId),
      libraryId: libraryId === "" ? undefined : Number(libraryId),
      dateFrom: dateFrom === "" ? undefined : dateFrom,
      dateTo: dateTo === "" ? undefined : dateTo,
    });
  }, [load, userId, libraryId, dateFrom, dateTo]);

  async function loadMore() {
    if (entries === null) return;
    const run = latest.current;
    setLoadingMore(true);
    try {
      const page = await readAuditLog({ ...filters, limit: PAGE_SIZE, offset: entries.length });
      if (run !== latest.current) return;
      setEntries((current) => [...(current ?? []), ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoadingMore(false);
    }
  }

  function clearFilters() {
    setUserId("");
    setLibraryId("");
    setDateFrom("");
    setDateTo("");
  }

  let list;
  if (entries === null) {
    list = (
      <GroupedList>
        <SkeletonRow size="touch" />
        <SkeletonRow size="touch" />
        <SkeletonRow size="touch" />
      </GroupedList>
    );
  } else if (entries.length === 0) {
    list = (
      <GroupedList>
        <Row
          label={filtered ? "Nothing matches these filters." : "Nothing here yet."}
          detail={filtered ? undefined : "Sign-ins, downloads and changes will appear here."}
          control={
            filtered ? (
              <button type="button" className="admin-btn" onClick={clearFilters}>
                Clear Filters
              </button>
            ) : undefined
          }
        />
      </GroupedList>
    );
  } else {
    list = (
      <GroupedList>
        {entries.map((entry) => {
          const line = describeActivity(entry);
          return (
            <Row
              key={entry.id}
              size="touch"
              label={<span className={line.known ? undefined : "admin-activity--unknown"}>{line.sentence}</span>}
              detail={
                entry.detail ? (
                  <details className="admin-activity__details">
                    <summary>Details</summary>
                    <span>{entry.detail}</span>
                  </details>
                ) : undefined
              }
              value={
                <time dateTime={entry.occurred_at} title={fullDate(entry.occurred_at)}>
                  {formatWhen(entry.occurred_at)}
                </time>
              }
            />
          );
        })}
      </GroupedList>
    );
  }

  return (
    <section className="admin-activity">
      <h1>Activity</h1>
      {error && <p role="alert">{error}</p>}

      <GroupedList heading="Show">
        <Row
          size="touch"
          label="Person"
          control={
            <select className="admin-input" aria-label="Person" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Everyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.username}
                </option>
              ))}
            </select>
          }
        />
        <Row
          size="touch"
          label="Library"
          control={
            <select
              className="admin-input"
              aria-label="Library"
              value={libraryId}
              onChange={(e) => setLibraryId(e.target.value)}
            >
              <option value="">All libraries</option>
              {libraries.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.display_name}
                </option>
              ))}
            </select>
          }
        />
        <Row
          size="touch"
          label="From"
          control={
            <input type="date" className="admin-input" aria-label="From date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
          }
        />
        <Row
          size="touch"
          label="To"
          control={
            <input type="date" className="admin-input" aria-label="To date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
          }
        />
      </GroupedList>

      {list}

      {hasMore && (
        <p className="admin-activity__more">
          <button type="button" className="admin-btn" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </p>
      )}

      <GroupedList footer="A spreadsheet of this list, with the filters applied.">
        <Row
          size="touch"
          label="Export as CSV…"
          control={
            <a className="admin-btn" href={auditLogCsvUrl(filters)} download aria-label="Export as CSV">
              Export
            </a>
          }
        />
      </GroupedList>
      <Footer>{FOOTER}</Footer>
    </section>
  );
}
