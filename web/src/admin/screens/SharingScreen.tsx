import { useCallback, useEffect, useState } from "react";
import { type AccessMatrixResponse, readAccessMatrix } from "../api";
import { describeError, switchLabel, useAccessToggle, useIsPhone } from "../sharing";
import { Footer, GroupedList, Row } from "../ui/GroupedList";
import SavedStatus from "../ui/SavedStatus";
import SkeletonRow from "../ui/SkeletonRow";
import Switch from "../ui/Switch";

const FOOTER =
  "Turn a library on for someone to let them see its photos. Turn it off to hide it from them again. Administrators also need to turn it on for themselves.";

export default function SharingScreen() {
  const [matrix, setMatrix] = useState<AccessMatrixResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const phone = useIsPhone();

  const refresh = useCallback(() => {
    readAccessMatrix()
      .then((next) => {
        setMatrix(next);
        setError(null);
      })
      .catch((err: unknown) => setError(describeError(err)));
  }, []);
  useEffect(refresh, [refresh]);

  const access = useAccessToggle(refresh);
  const shownError = access.error ?? error;

  let body;
  if (matrix === null) {
    body = (
      <GroupedList>
        <SkeletonRow />
        <SkeletonRow />
      </GroupedList>
    );
  } else if (matrix.libraries.length === 0) {
    body = (
      <GroupedList>
        <Row label="Add a library first." detail="Once a library is added you can share it here. Use Libraries in the sidebar." />
      </GroupedList>
    );
  } else {
    const hasPeople = matrix.users.some((u) => u.role !== "admin");
    const unshared = matrix.libraries.filter((l) => !matrix.users.some((u) => (matrix.assignments[String(u.id)] ?? []).includes(l.id)));
    body = (
      <>
        {phone ? <PhoneList matrix={matrix} access={access} /> : <Matrix matrix={matrix} access={access} />}
        {!hasPeople && (
          <p className="admin-hint">Only administrators exist. Invite someone in People to share a library.</p>
        )}
        {unshared.map((l) => (
          <p key={l.id} className="admin-hint admin-hint--warn" role="note">
            No one can see {l.display_name} now.
          </p>
        ))}
      </>
    );
  }

  return (
    <section className="admin-sharing">
      <h1>Sharing</h1>
      {shownError && <p role="alert">{shownError}</p>}
      {body}
      <Footer>{FOOTER}</Footer>
      {access.sheet}
    </section>
  );
}

type Access = ReturnType<typeof useAccessToggle>;

function Matrix({ matrix, access }: { matrix: AccessMatrixResponse; access: Access }) {
  return (
    <div className="admin-table-wrap admin-sharing-matrix">
      <table>
        <thead>
          <tr>
            <th scope="col" className="admin-sticky-col">
              Person
            </th>
            {matrix.libraries.map((library) => (
              <th scope="col" key={library.id}>
                {library.display_name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.users.map((user) => (
            <tr key={user.id}>
              <th scope="row" className="admin-sticky-col">
                {user.username}
                {user.role === "admin" && <span className="admin-tag">Administrator</span>}
                {user.disabled && <span className="admin-tag">Turned off</span>}
              </th>
              {matrix.libraries.map((library) => {
                const on = (matrix.assignments[String(user.id)] ?? []).includes(library.id);
                const key = `${user.id}:${library.id}`;
                return (
                  <td key={library.id}>
                    <span className="admin-matrix-cell">
                      <Switch
                        checked={on}
                        disabled={access.busyKey === key}
                        label={switchLabel(user, library)}
                        onChange={() => access.toggle(user, library, on)}
                      />
                      <SavedStatus state={access.savedKey === key ? "saved" : "idle"} />
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PhoneList({ matrix, access }: { matrix: AccessMatrixResponse; access: Access }) {
  return (
    <>
      {matrix.users.map((user) => (
        <GroupedList key={user.id} heading={user.role === "admin" ? `${user.username} · Administrator` : user.username}>
          {matrix.libraries.map((library) => {
            const on = (matrix.assignments[String(user.id)] ?? []).includes(library.id);
            const key = `${user.id}:${library.id}`;
            return (
              <Row
                key={library.id}
                size="touch"
                label={library.display_name}
                control={
                  <>
                    <SavedStatus state={access.savedKey === key ? "saved" : "idle"} />
                    <Switch
                      checked={on}
                      disabled={access.busyKey === key}
                      label={switchLabel(user, library)}
                      onChange={() => access.toggle(user, library, on)}
                    />
                  </>
                }
              />
            );
          })}
        </GroupedList>
      ))}
    </>
  );
}
