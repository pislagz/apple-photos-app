import { useCallback, useEffect, useState } from "react";
import InfoButton from "../../help/InfoButton";
import {
  type AccessMatrixResponse,
  cancelInvite,
  type InviteResponse,
  listInvites,
  readAccessMatrix,
  unlockUser,
  updateUser,
  type UserResponse,
} from "../api";
import { describeError, switchLabel, useAccessToggle } from "../sharing";
import { Footer, GroupedList, Row } from "../ui/GroupedList";
import SavedStatus, { useSaveStatus } from "../ui/SavedStatus";
import SkeletonRow from "../ui/SkeletonRow";
import Switch from "../ui/Switch";
import { formatWhen } from "../ui/format";
import { AddPersonSheet, ChangePasswordSheet, DeleteUserSheet, InviteSheet, RoleSheet } from "./PeopleSheets";

type SheetState =
  | { kind: "add" }
  | { kind: "invite" }
  | { kind: "role" | "password" | "delete"; username: string }
  | null;

const ROLE_NAME = { admin: "Administrator", user: "Person" } as const;

function libraryCount(matrix: AccessMatrixResponse, user: UserResponse): number {
  return (matrix.assignments[String(user.id)] ?? []).length;
}

function roleSummary(matrix: AccessMatrixResponse, user: UserResponse): string {
  if (user.disabled) return "Turned off";
  const n = libraryCount(matrix, user);
  const libraries = n === 1 ? "1 library" : `${n} libraries`;
  return user.role === "admin" ? `Administrator · ${libraries}` : `Can see ${libraries}`;
}

// The server sends UTC without a zone marker ("2026-11-12 10:00:00").
function isOpen(invite: InviteResponse): boolean {
  const raw = invite.expires_at.replace(" ", "T");
  const expires = new Date(/(?:Z|[+-]\d\d:?\d\d)$/i.test(raw) ? raw : `${raw}Z`);
  return invite.used_at === null && expires.getTime() > Date.now();
}

export default function PeopleScreen({
  currentUsername,
  selected: controlled,
  onSelect: onControlledSelect,
}: {
  currentUsername: string;
  /** The open person, from the #people/<name> hash. */
  selected?: string | null;
  onSelect?: (username: string | null) => void;
}) {
  const [matrix, setMatrix] = useState<AccessMatrixResponse | null>(null);
  const [invites, setInvites] = useState<InviteResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Driven by the #people/<name> hash inside the admin app; local state when used alone.
  const [local, setLocal] = useState<string | null>(null);
  const selected = controlled === undefined ? local : controlled;
  const onSelect = onControlledSelect ?? setLocal;
  const [sheet, setSheet] = useState<SheetState>(null);

  const refresh = useCallback(() => {
    readAccessMatrix()
      .then((next) => {
        setMatrix(next);
        setError(null);
      })
      .catch((err: unknown) => setError(describeError(err)));
    listInvites()
      .then(setInvites)
      .catch((err: unknown) => setError(describeError(err)));
  }, []);

  useEffect(refresh, [refresh]);

  const access = useAccessToggle(refresh);
  const user = matrix?.users.find((u) => u.username === selected) ?? null;
  const sheetUser = sheet && "username" in sheet ? (matrix?.users.find((u) => u.username === sheet.username) ?? null) : null;
  const closeSheet = () => setSheet(null);
  const done = () => {
    setSheet(null);
    refresh();
  };

  return (
    <section className="admin-people">
      {user === null ? (
        <>
          <h1>People</h1>
          {error && <p role="alert">{error}</p>}
          <ListView
            matrix={matrix}
            invites={invites.filter(isOpen)}
            currentUsername={currentUsername}
            onOpen={onSelect}
            onAdd={() => setSheet({ kind: "add" })}
            onInvite={() => setSheet({ kind: "invite" })}
            onCancelInvite={async (invite) => {
              try {
                await cancelInvite(invite.id);
                refresh();
              } catch (err) {
                setError(describeError(err));
              }
            }}
          />
        </>
      ) : (
        <>
          <button type="button" className="admin-btn admin-back" onClick={() => onSelect(null)}>
            ‹ People
          </button>
          <h1>{user.username}</h1>
          {error && <p role="alert">{error}</p>}
          {access.error && <p role="alert">{access.error}</p>}
          <DetailView
            matrix={matrix!}
            user={user}
            isSelf={user.username === currentUsername}
            access={access}
            onChanged={refresh}
            onSheet={(kind) => setSheet({ kind, username: user.username })}
          />
        </>
      )}

      {sheet?.kind === "add" && <AddPersonSheet onClose={closeSheet} onDone={done} />}
      {sheet?.kind === "invite" && <InviteSheet onClose={() => (closeSheet(), refresh())} onChanged={refresh} />}
      {sheet?.kind === "role" && sheetUser && (
        <RoleSheet user={sheetUser} isSelf={sheetUser.username === currentUsername} onClose={closeSheet} onDone={done} />
      )}
      {sheet?.kind === "password" && sheetUser && <ChangePasswordSheet user={sheetUser} onClose={closeSheet} onDone={done} />}
      {sheet?.kind === "delete" && sheetUser && (
        <DeleteUserSheet
          user={sheetUser}
          onClose={closeSheet}
          onDone={() => {
            setSheet(null);
            onSelect(null);
            refresh();
          }}
        />
      )}
      {access.sheet}
    </section>
  );
}

function ListView({
  matrix,
  invites,
  currentUsername,
  onOpen,
  onAdd,
  onInvite,
  onCancelInvite,
}: {
  matrix: AccessMatrixResponse | null;
  invites: InviteResponse[];
  currentUsername: string;
  onOpen: (username: string) => void;
  onAdd: () => void;
  onInvite: () => void;
  onCancelInvite: (invite: InviteResponse) => void;
}) {
  return (
    <>
      <GroupedList
        heading="People"
        footer="Administrators can manage libraries and people. Everyone else can only look at the libraries you share with them."
      >
        {matrix === null ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : (
          matrix.users.map((u) => (
            <Row
              key={u.id}
              label={
                <>
                  {u.username}
                  {u.username === currentUsername && <span className="admin-tag">You</span>}
                </>
              }
              value={roleSummary(matrix, u)}
              onClick={() => onOpen(u.username)}
            />
          ))
        )}
      </GroupedList>

      <GroupedList>
        <Row label="Add Person…" onClick={onAdd} />
        <Row label="Invite Someone…" onClick={onInvite} />
      </GroupedList>

      <GroupedList
        heading="Invitations"
        footer={
          <>
            An invitation is a one-time link. Send it to the person; they pick their own name and password. It stops working
            after 7 days or once used. <InfoButton helpKey="invitation" name="invitations" />
          </>
        }
      >
        {invites.length === 0 ? (
          <Row label="No open invitations." />
        ) : (
          invites.map((invite) => (
            <Row
              key={invite.id}
              label={`For: ${ROLE_NAME[invite.role]}`}
              detail={`Created by ${invite.created_by} · Expires ${formatWhen(invite.expires_at)}`}
              control={
                <button
                  type="button"
                  className="admin-btn admin-btn--danger"
                  aria-label={`Cancel the invitation for ${ROLE_NAME[invite.role]} created ${formatWhen(invite.created_at)}`}
                  onClick={() => onCancelInvite(invite)}
                >
                  Cancel
                </button>
              }
            />
          ))
        )}
      </GroupedList>
    </>
  );
}

function SignInRow({ user, isSelf, onChanged }: { user: UserResponse; isSelf: boolean; onChanged: () => void }) {
  const { state, error, run } = useSaveStatus();
  return (
    <Row
      label="Allowed to sign in"
      detail={isSelf ? "You can't turn off your own account. Ask another administrator." : undefined}
      control={
        <>
          <Switch
            checked={!user.disabled}
            disabled={isSelf}
            label={`${user.username} is allowed to sign in`}
            onChange={async (next) => {
              if (await run(() => updateUser(user.username, { disabled: !next }))) onChanged();
            }}
          />
          <SavedStatus state={state} message={error} />
          <InfoButton helpKey="personSignIn" name="allowed to sign in" />
        </>
      }
    />
  );
}

function DetailView({
  matrix,
  user,
  isSelf,
  access,
  onChanged,
  onSheet,
}: {
  matrix: AccessMatrixResponse;
  user: UserResponse;
  isSelf: boolean;
  access: ReturnType<typeof useAccessToggle>;
  onChanged: () => void;
  onSheet: (kind: "role" | "password" | "delete") => void;
}) {
  const assigned = matrix.assignments[String(user.id)] ?? [];
  const [unlocked, setUnlocked] = useState(false);
  const unlock = useSaveStatus();
  const showUnlock = user.locked === true && !unlocked;

  return (
    <>
      <GroupedList
        footer="An administrator can change everything in this panel. An administrator still has to share a library with themselves to see its photos."
      >
        <Row label="Name" value={user.username} />
        <Row
          label={
            <>
              Role <InfoButton helpKey="personRole" name="role" />
            </>
          }
          value={ROLE_NAME[user.role]}
          onClick={() => onSheet("role")}
        />
        <SignInRow user={user} isSelf={isSelf} onChanged={onChanged} />
      </GroupedList>

      <GroupedList heading="Libraries" footer="Turn a library on to let this person see its photos. Turning it off asks first.">
        {matrix.libraries.length === 0 ? (
          <Row label="Add a library first." detail="Libraries you add appear here." />
        ) : (
          matrix.libraries.map((library) => {
            const on = assigned.includes(library.id);
            const key = `${user.id}:${library.id}`;
            return (
              <Row
                key={library.id}
                label={library.display_name}
                control={
                  <>
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
          })
        )}
      </GroupedList>

      <GroupedList>
        <Row
          label={
            <>
              Change Password… <InfoButton helpKey="personPassword" name="change password" />
            </>
          }
          onClick={() => onSheet("password")}
        />
        {showUnlock && (
          <Row
            label={
              <>
                Unlock Account <InfoButton helpKey="personUnlock" name="unlock account" />
              </>
            }
            detail="This account is locked after too many wrong passwords."
            control={
              <>
                <button
                  type="button"
                  className="admin-btn"
                  onClick={async () => {
                    if (await unlock.run(() => unlockUser(user.username))) {
                      setUnlocked(true);
                      onChanged();
                    }
                  }}
                >
                  Unlock
                </button>
                <SavedStatus state={unlock.state} message={unlock.error} />
              </>
            }
          />
        )}
      </GroupedList>

      <GroupedList>
        {isSelf ? (
          <Row label="Delete User…" detail="You can't delete your own account. Ask another administrator." />
        ) : (
          <Row
            destructive
            label={
              <>
                Delete User… <InfoButton helpKey="personDelete" name="delete user" />
              </>
            }
            onClick={() => onSheet("delete")}
          />
        )}
      </GroupedList>
      <Footer>People you remove can no longer sign in. Photos and libraries are never deleted.</Footer>
    </>
  );
}
