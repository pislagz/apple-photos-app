import { useCallback, useEffect, useState } from "react";
import { listSessions, revokeSession, type SessionResponse } from "../api";
import { describeError } from "../sharing";
import { deviceName } from "../ui/deviceName";
import { formatWhen } from "../ui/format";
import { Footer, GroupedList, Row } from "../ui/GroupedList";
import Sheet from "../ui/Sheet";
import SkeletonRow from "../ui/SkeletonRow";

const FOOTER =
  "Signing a device out ends its session right away. The person can sign in again with their password.";

const ACTIVE_NOW_SECONDS = 120;

function fullDate(iso: string): string {
  const d = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

function lastSeen(iso: string): string {
  const d = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso.replace(" ", "T")}Z`);
  if (!Number.isNaN(d.getTime()) && Math.abs(Date.now() - d.getTime()) / 1000 < ACTIVE_NOW_SECONDS) return "Active now";
  const text = formatWhen(iso);
  return text === "just now" ? "Active now" : text[0].toUpperCase() + text.slice(1);
}

function staysUntil(session: SessionResponse): string {
  const when = formatWhen(session.expires_at);
  const phrase = when.startsWith("in ") ? when : `on ${when}`;
  return `${session.remember_me ? "Stays signed in on this device" : "Signs out by itself"} ${phrase}`;
}

/** Newest activity first within each person; people ordered by their most recent device. */
export function groupByPerson(sessions: SessionResponse[]): Array<{ username: string; sessions: SessionResponse[] }> {
  const groups = new Map<string, SessionResponse[]>();
  for (const s of [...sessions].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))) {
    groups.set(s.username, [...(groups.get(s.username) ?? []), s]);
  }
  return [...groups].map(([username, list]) => ({ username, sessions: list }));
}

export default function DevicesScreen() {
  const [sessions, setSessions] = useState<SessionResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<SessionResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listSessions()
      .then((next) => {
        setSessions(next);
        setError(null);
      })
      .catch((err: unknown) => setError(describeError(err)));
  }, []);
  useEffect(refresh, [refresh]);

  async function signOut(session: SessionResponse) {
    setBusy(true);
    try {
      await revokeSession(session.id);
      setPending(null);
      refresh();
    } catch (err) {
      setPending(null);
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (sessions === null) {
    body = (
      <GroupedList>
        <SkeletonRow />
        <SkeletonRow />
      </GroupedList>
    );
  } else if (sessions.length === 0) {
    body = (
      <GroupedList>
        <Row label="No devices are signed in." />
      </GroupedList>
    );
  } else {
    body = groupByPerson(sessions).map((group) => (
      <GroupedList key={group.username} heading={group.username}>
        {group.sessions.map((session) => {
          const name = deviceName(session.device);
          const current = session.is_current === true;
          return (
            <Row
              key={session.id}
              size="touch"
              label={
                <span title={session.device ?? undefined}>
                  {name}
                  {current && <span className="admin-badge"> This device</span>}
                </span>
              }
              detail={
                current
                  ? "You're using this device now, so it can't be signed out here."
                  : `Signed in ${formatWhen(session.created_at)} · ${staysUntil(session)}`
              }
              value={<span title={fullDate(session.last_seen_at)}>{lastSeen(session.last_seen_at)}</span>}
              control={
                current ? undefined : (
                  <button
                    type="button"
                    className="admin-btn admin-btn--danger"
                    aria-label={`Sign out ${name} for ${session.username}`}
                    onClick={() => setPending(session)}
                  >
                    Sign Out
                  </button>
                )
              }
            />
          );
        })}
      </GroupedList>
    ));
  }

  return (
    <section className="admin-devices">
      <h1>Devices</h1>
      {error && <p role="alert">{error}</p>}
      {body}
      <Footer>{FOOTER}</Footer>
      {pending && (
        <Sheet
          title={`Sign out ${deviceName(pending.device)} for ${pending.username}?`}
          onClose={() => setPending(null)}
          actions={[{ label: "Sign Out", kind: "destructive", disabled: busy, onClick: () => void signOut(pending) }]}
        >
          <p>
            {pending.username} will be signed out on this device right away and can sign in again with their password.
            Their photos and libraries are not touched.
          </p>
        </Sheet>
      )}
    </section>
  );
}
