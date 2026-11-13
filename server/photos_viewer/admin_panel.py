"""Admin-only API for the P1.10 admin UI: users, invites, the user x
library access matrix, sessions, the audit log, and app-wide settings.

Reuses `library_admin.py`'s `LibraryResponse`/`_to_response` for the access
matrix, and `session_auth.py`'s session/cross-site/admin-role machinery --
this module adds no new auth primitives of its own.
"""

from __future__ import annotations

import csv
import io
import secrets
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import (
    app_db,
    library_admin,
    library_watch,
    media,
    place_names,
    session_auth,
)

router = APIRouter()

_INVITE_LIFETIME_SECONDS = 7 * 24 * 3600


# --------------------------------------------------------------------------
# Users
# --------------------------------------------------------------------------


class UserCreateRequest(BaseModel):
    username: session_auth.Username
    password: session_auth.Password
    role: Literal["admin", "user"] = "user"


class UserUpdateRequest(BaseModel):
    role: Literal["admin", "user"] | None = None
    disabled: bool | None = None
    password: session_auth.Password | None = None


class UserResponse(BaseModel):
    id: int
    username: str
    role: Literal["admin", "user"]
    disabled: bool
    created_at: str
    # True while the login lockout (too many wrong passwords) is active.
    locked: bool = False


def _to_user_response(
    row: sqlite3.Row, db: sqlite3.Connection | None = None
) -> UserResponse:
    return UserResponse(
        locked=(
            session_auth.is_locked_out(db, row["username"], user_exists=True)
            if db is not None
            else False
        ),
        id=row["id"],
        username=row["username"],
        role=row["role"],
        disabled=bool(row["disabled"]),
        created_at=row["created_at"],
    )


def _get_user_by_username_or_404(db: sqlite3.Connection, username: str) -> sqlite3.Row:
    row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


def _would_leave_no_enabled_admin(
    db: sqlite3.Connection,
    target: sqlite3.Row,
    *,
    new_role: str | None = None,
    new_disabled: bool | None = None,
    deleting: bool = False,
) -> bool:
    """True if applying this change to `target` would leave zero enabled
    admin accounts. Looks only at whether another enabled admin exists --
    if one does, the change is always safe regardless of what it does to
    `target`."""
    target_is_enabled_admin = target["role"] == "admin" and not target["disabled"]
    if not target_is_enabled_admin:
        return False
    (other_enabled_admins,) = db.execute(
        "SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?",
        (target["id"],),
    ).fetchone()
    if other_enabled_admins > 0:
        return False
    if deleting:
        return True
    final_role = new_role if new_role is not None else target["role"]
    final_disabled = (
        new_disabled if new_disabled is not None else bool(target["disabled"])
    )
    return not (final_role == "admin" and not final_disabled)


@router.post(
    "/api/admin/users",
    response_model=UserResponse,
    status_code=201,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def create_user(
    payload: UserCreateRequest,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> UserResponse:
    password_hash = session_auth.hash_password(payload.password)
    try:
        cursor = db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (payload.username, password_hash, payload.role),
        )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="username already taken") from exc
    db.commit()
    app_db.write_audit_log(
        db,
        "create_user",
        user_id=cursor.lastrowid,
        actor=admin["username"],
        detail=f"role={payload.role}",
    )
    return _to_user_response(_get_user_by_username_or_404(db, payload.username), db)


@router.get("/api/admin/users", response_model=list[UserResponse])
def list_users(
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> list[UserResponse]:
    rows = db.execute("SELECT * FROM users ORDER BY username").fetchall()
    return [_to_user_response(row, db) for row in rows]


@router.patch(
    "/api/admin/users/{username}",
    response_model=UserResponse,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def update_user(
    username: str,
    payload: UserUpdateRequest,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> UserResponse:
    normalized = session_auth._normalize_username(username)
    target = _get_user_by_username_or_404(db, normalized)
    if _would_leave_no_enabled_admin(
        db, target, new_role=payload.role, new_disabled=payload.disabled
    ):
        raise HTTPException(
            status_code=400, detail="this would leave no enabled admin account"
        )

    if target["id"] == admin["user_id"]:
        if payload.role == "user":
            raise HTTPException(
                status_code=400,
                detail="You can't remove your own admin access. Ask another admin to do it.",
            )
        if payload.disabled:
            raise HTTPException(
                status_code=400,
                detail="You can't disable your own account. Ask another admin to do it.",
            )

    changed_fields: list[str] = []
    if payload.role is not None:
        db.execute(
            "UPDATE users SET role = ? WHERE id = ?", (payload.role, target["id"])
        )
        changed_fields.append("role")
    if payload.disabled is not None:
        db.execute(
            "UPDATE users SET disabled = ? WHERE id = ?",
            (int(payload.disabled), target["id"]),
        )
        changed_fields.append("disabled")
    if payload.password is not None:
        db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (session_auth.hash_password(payload.password), target["id"]),
        )
        changed_fields.append("password")
        # A reset or self-change must invalidate every cookie issued under
        # the old password -- otherwise a stolen or shared session keeps
        # working right through the "fix".
        # An admin changing their own password keeps the session they are
        # using (#72); every other session of theirs is still revoked.
        own = target["id"] == admin["user_id"]
        session_auth.revoke_sessions_for_user(
            db, target["id"], keep_session_id=admin["id"] if own else None
        )
    db.commit()
    if changed_fields:
        app_db.write_audit_log(
            db,
            "update_user",
            user_id=target["id"],
            actor=admin["username"],
            detail=f"changed={','.join(changed_fields)}",
        )
    return _to_user_response(_get_user_by_username_or_404(db, normalized), db)


@router.delete(
    "/api/admin/users/{username}",
    status_code=204,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def delete_user(
    username: str,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> None:
    normalized = session_auth._normalize_username(username)
    target = _get_user_by_username_or_404(db, normalized)
    if _would_leave_no_enabled_admin(db, target, deleting=True):
        raise HTTPException(
            status_code=400, detail="cannot delete the last admin account"
        )
    db.execute("DELETE FROM users WHERE id = ?", (target["id"],))
    db.commit()
    app_db.write_audit_log(
        db, "delete_user", actor=admin["username"], detail=f"username={normalized}"
    )


# --------------------------------------------------------------------------
# Invites -- one-time account-creation links. Named "invites", not
# "tokens"/"credentials": this repo's runner cannot read a file with either
# word in its name.
# --------------------------------------------------------------------------


class InviteCreateRequest(BaseModel):
    role: Literal["admin", "user"] = "user"


class InviteCreateResponse(BaseModel):
    code: str
    role: Literal["admin", "user"]
    expires_at: str


class InviteResponse(BaseModel):
    id: str
    role: Literal["admin", "user"]
    created_by: str
    created_at: str
    expires_at: str
    used_at: str | None


class InviteInfoResponse(BaseModel):
    role: Literal["admin", "user"]


class InviteAcceptRequest(BaseModel):
    username: session_auth.Username
    password: session_auth.Password


class InviteAcceptResponse(BaseModel):
    username: str
    role: Literal["admin", "user"]


def _get_open_invite_or_404(db: sqlite3.Connection, code: str) -> sqlite3.Row:
    """A single query covers "no such code", "already used", and
    "expired" -- all become one 404, so a guess can't distinguish them."""
    invite_id = session_auth._hash_token(code)
    row = db.execute(
        "SELECT * FROM invites WHERE id = ? AND used_at IS NULL AND expires_at > datetime('now')",
        (invite_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


@router.post(
    "/api/admin/invites",
    response_model=InviteCreateResponse,
    status_code=201,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def create_invite(
    payload: InviteCreateRequest,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> InviteCreateResponse:
    raw_code = secrets.token_urlsafe(32)
    invite_id = session_auth._hash_token(raw_code)
    row = db.execute(
        "INSERT INTO invites (id, role, created_by, expires_at) "
        "VALUES (?, ?, ?, datetime('now', ?)) RETURNING expires_at",
        (
            invite_id,
            payload.role,
            admin["username"],
            f"+{_INVITE_LIFETIME_SECONDS} seconds",
        ),
    ).fetchone()
    db.commit()
    app_db.write_audit_log(
        db, "create_invite", actor=admin["username"], detail=f"role={payload.role}"
    )
    return InviteCreateResponse(
        code=raw_code, role=payload.role, expires_at=row["expires_at"]
    )


@router.get("/api/admin/invites", response_model=list[InviteResponse])
def list_invites(
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> list[InviteResponse]:
    rows = db.execute("SELECT * FROM invites ORDER BY created_at DESC").fetchall()
    return [
        InviteResponse(
            id=row["id"],
            role=row["role"],
            created_by=row["created_by"],
            created_at=row["created_at"],
            expires_at=row["expires_at"],
            used_at=row["used_at"],
        )
        for row in rows
    ]


@router.delete(
    "/api/admin/invites/{invite_id}",
    status_code=204,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def cancel_invite(
    invite_id: str,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> None:
    """Cancel an invite nobody has used yet. A used invite is history (the
    account exists), so it stays and answers 409."""
    row = db.execute("SELECT * FROM invites WHERE id = ?", (invite_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if row["used_at"] is not None:
        raise HTTPException(
            status_code=409,
            detail="this invite was already used and can't be cancelled",
        )
    db.execute("DELETE FROM invites WHERE id = ?", (invite_id,))
    db.commit()
    app_db.write_audit_log(
        db, "cancel_invite", actor=admin["username"], detail=f"role={row['role']}"
    )


@router.get(
    "/api/invites/{code}",
    response_model=InviteInfoResponse,
    dependencies=[Depends(session_auth._enforce_tailnet_allowlist)],
)
def read_invite(
    code: str, db: sqlite3.Connection = Depends(session_auth.get_db)
) -> InviteInfoResponse:
    row = _get_open_invite_or_404(db, code)
    return InviteInfoResponse(role=row["role"])


@router.post(
    "/api/invites/{code}/accept",
    response_model=InviteAcceptResponse,
    dependencies=[
        Depends(session_auth.reject_cross_site_requests),
        Depends(session_auth._enforce_tailnet_allowlist),
    ],
)
def accept_invite(
    code: str,
    payload: InviteAcceptRequest,
    response: Response,
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> InviteAcceptResponse:
    password_hash = session_auth.hash_password(
        payload.password
    )  # hash before taking the write lock
    db.execute("BEGIN IMMEDIATE")
    try:
        invite = _get_open_invite_or_404(db, code)
        existing = db.execute(
            "SELECT id FROM users WHERE username = ?", (payload.username,)
        ).fetchone()
        if existing is not None:
            raise HTTPException(status_code=409, detail="username already taken")
        cursor = db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (payload.username, password_hash, invite["role"]),
        )
        user_id = cursor.lastrowid
        db.execute(
            "UPDATE invites SET used_at = datetime('now') WHERE id = ?", (invite["id"],)
        )
    except BaseException:
        db.rollback()
        raise
    else:
        db.commit()

    app_db.write_audit_log(
        db,
        "accept_invite",
        user_id=user_id,
        actor=payload.username,
        detail=f"role={invite['role']}",
    )
    raw_token, max_age = session_auth.create_session(db, user_id)
    response.set_cookie(
        key=session_auth.COOKIE_NAME,
        value=raw_token,
        max_age=max_age,
        httponly=True,
        secure=session_auth._cookie_secure(),
        samesite="strict",
        path="/",
    )
    return InviteAcceptResponse(username=payload.username, role=invite["role"])


# --------------------------------------------------------------------------
# Access matrix -- user x library, backed by the same `library_assignments`
# table `require_library_assignment` (P1.8) reads on every request, so a
# checkbox change here takes effect immediately with nothing to invalidate.
# --------------------------------------------------------------------------


class AccessMatrixResponse(BaseModel):
    users: list[UserResponse]
    libraries: list[library_admin.LibraryResponse]
    assignments: dict[str, list[int]]


def _get_user_row_or_404(db: sqlite3.Connection, user_id: int) -> sqlite3.Row:
    row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


def _get_library_row_or_404(db: sqlite3.Connection, library_id: int) -> sqlite3.Row:
    row = db.execute("SELECT * FROM libraries WHERE id = ?", (library_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


@router.get("/api/admin/access-matrix", response_model=AccessMatrixResponse)
def read_access_matrix(
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> AccessMatrixResponse:
    users = [
        _to_user_response(row, db)
        for row in db.execute("SELECT * FROM users ORDER BY username").fetchall()
    ]
    libraries = [
        library_admin._to_response(row)
        for row in db.execute("SELECT * FROM libraries ORDER BY id").fetchall()
    ]
    assignments: dict[str, list[int]] = {str(user.id): [] for user in users}
    for row in db.execute(
        "SELECT user_id, library_id FROM library_assignments"
    ).fetchall():
        assignments.setdefault(str(row["user_id"]), []).append(row["library_id"])
    return AccessMatrixResponse(
        users=users, libraries=libraries, assignments=assignments
    )


@router.put(
    "/api/admin/users/{user_id}/libraries/{library_id}",
    status_code=204,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def assign_library(
    user_id: int,
    library_id: int,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> None:
    _get_user_row_or_404(db, user_id)
    _get_library_row_or_404(db, library_id)
    db.execute(
        "INSERT OR IGNORE INTO library_assignments (user_id, library_id) VALUES (?, ?)",
        (user_id, library_id),
    )
    db.commit()
    app_db.write_audit_log(
        db,
        "assign_library",
        user_id=user_id,
        library_id=library_id,
        actor=admin["username"],
    )


@router.delete(
    "/api/admin/users/{user_id}/libraries/{library_id}",
    status_code=204,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def unassign_library(
    user_id: int,
    library_id: int,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> None:
    _get_user_row_or_404(db, user_id)
    _get_library_row_or_404(db, library_id)
    db.execute(
        "DELETE FROM library_assignments WHERE user_id = ? AND library_id = ?",
        (user_id, library_id),
    )
    db.commit()
    app_db.write_audit_log(
        db,
        "unassign_library",
        user_id=user_id,
        library_id=library_id,
        actor=admin["username"],
    )


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------


class SessionResponse(BaseModel):
    id: str
    username: str
    device: str | None
    created_at: str
    last_seen_at: str
    expires_at: str
    remember_me: bool
    # The session making this request, so the UI can label "This device".
    is_current: bool = False


@router.get("/api/admin/sessions", response_model=list[SessionResponse])
def list_sessions(
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> list[SessionResponse]:
    rows = db.execute(
        "SELECT sessions.*, users.username AS username FROM sessions "
        "JOIN users ON users.id = sessions.user_id "
        "ORDER BY sessions.last_seen_at DESC"
    ).fetchall()
    return [
        SessionResponse(
            id=row["public_id"],
            username=row["username"],
            device=row["device"],
            created_at=row["created_at"],
            last_seen_at=row["last_seen_at"],
            expires_at=row["expires_at"],
            remember_me=bool(row["remember_me"]),
            is_current=row["id"] == admin["id"],
        )
        for row in rows
    ]


@router.delete(
    "/api/admin/sessions/{session_id}",
    status_code=204,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def revoke_session(
    session_id: str,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> None:
    row = db.execute(
        "SELECT user_id FROM sessions WHERE public_id = ?", (session_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if session_id == admin["public_id"]:
        raise HTTPException(
            status_code=400,
            detail="You can't sign out the device you're using here. Use Sign out instead.",
        )
    session_auth.revoke_session_by_public_id(db, session_id)
    app_db.write_audit_log(
        db, "revoke_session", user_id=row["user_id"], actor=admin["username"]
    )


# --------------------------------------------------------------------------
# Audit log
# --------------------------------------------------------------------------


class AuditLogEntryResponse(BaseModel):
    id: int
    occurred_at: str
    action: str
    actor: str | None
    user_id: int | None
    username: str | None
    library_id: int | None
    library_display_name: str | None
    asset_id: int | None
    detail: str | None


_AUDIT_LOG_SELECT = (
    "SELECT audit_log.*, users.username AS username, libraries.display_name AS library_display_name "
    "FROM audit_log "
    "LEFT JOIN users ON users.id = audit_log.user_id "
    "LEFT JOIN libraries ON libraries.id = audit_log.library_id"
)

_AUDIT_LOG_CSV_MAX_ROWS = 100_000

# Spreadsheet formula injection: a cell that opens with one of these
# characters is interpreted as a formula by Excel/Sheets/LibreOffice when
# the CSV is opened, not displayed as text. `detail` and `actor` are
# admin-controlled but round-trip values we don't otherwise sanitize, so
# guard every exported cell rather than tracking which columns are "safe".
_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe_cell(value: object) -> object:
    if isinstance(value, str) and value.startswith(_CSV_FORMULA_PREFIXES):
        return "'" + value
    return value


def _audit_log_filters(
    user_id: int | None,
    library_id: int | None,
    date_from: str | None,
    date_to: str | None,
    username: str | None = None,
    library_name: str | None = None,
) -> tuple[str, list[object]]:
    clauses = []
    params: list[object] = []
    if username:
        clauses.append("users.username = ?")
        params.append(session_auth._normalize_username(username))
    if library_name:
        clauses.append("libraries.display_name = ?")
        params.append(library_name)
    if user_id is not None:
        clauses.append("audit_log.user_id = ?")
        params.append(user_id)
    if library_id is not None:
        clauses.append("audit_log.library_id = ?")
        params.append(library_id)
    if date_from is not None:
        clauses.append("audit_log.occurred_at >= ?")
        params.append(date_from)
    if date_to is not None:
        # `date_to` is a plain YYYY-MM-DD day, not a timestamp -- a
        # straight `<=` comparison against it would exclude every entry
        # from later that same day. Compare against the start of the next
        # day instead so the whole end day is included.
        clauses.append("audit_log.occurred_at < date(?, '+1 day')")
        params.append(date_to)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    return where, params


def _to_audit_entry(row: sqlite3.Row) -> AuditLogEntryResponse:
    return AuditLogEntryResponse(
        id=row["id"],
        occurred_at=row["occurred_at"],
        action=row["action"],
        actor=row["actor"],
        user_id=row["user_id"],
        username=row["username"],
        library_id=row["library_id"],
        library_display_name=row["library_display_name"],
        asset_id=row["asset_id"],
        detail=row["detail"],
    )


class AuditLogResponse(BaseModel):
    entries: list[AuditLogEntryResponse]


@router.get("/api/admin/audit-log", response_model=AuditLogResponse)
def read_audit_log(
    user_id: int | None = None,
    library_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    username: str | None = None,
    library_name: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> AuditLogResponse:
    where, params = _audit_log_filters(
        user_id, library_id, date_from, date_to, username, library_name
    )
    rows = db.execute(
        f"{_AUDIT_LOG_SELECT}{where} ORDER BY audit_log.occurred_at DESC, audit_log.id DESC LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    return AuditLogResponse(entries=[_to_audit_entry(row) for row in rows])


@router.get("/api/admin/audit-log.csv")
def read_audit_log_csv(
    user_id: int | None = None,
    library_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    username: str | None = None,
    library_name: str | None = None,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> Response:
    where, params = _audit_log_filters(
        user_id, library_id, date_from, date_to, username, library_name
    )
    rows = db.execute(
        f"{_AUDIT_LOG_SELECT}{where} ORDER BY audit_log.occurred_at DESC, audit_log.id DESC LIMIT ?",
        (*params, _AUDIT_LOG_CSV_MAX_ROWS + 1),
    ).fetchall()
    truncated = len(rows) > _AUDIT_LOG_CSV_MAX_ROWS
    rows = rows[:_AUDIT_LOG_CSV_MAX_ROWS]

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "id",
            "occurred_at",
            "action",
            "actor",
            "user_id",
            "username",
            "library_id",
            "library_display_name",
            "asset_id",
            "detail",
        ]
    )
    for row in rows:
        entry = _to_audit_entry(row)
        writer.writerow(
            _csv_safe_cell(value)
            for value in (
                entry.id,
                entry.occurred_at,
                entry.action,
                entry.actor,
                entry.user_id,
                entry.username,
                entry.library_id,
                entry.library_display_name,
                entry.asset_id,
                entry.detail,
            )
        )
    headers = {"Content-Disposition": "attachment; filename=audit-log.csv"}
    if truncated:
        headers["X-Audit-Log-Truncated"] = "true"
    return Response(content=buffer.getvalue(), media_type="text/csv", headers=headers)


# --------------------------------------------------------------------------
# Settings -- session lifetimes are read live by session_auth.py's
# session_lifetime_seconds; thumb size/quality, the zip limit, and map
# tiles are stored here now and read by their own features later
# (Phase 3 and P2.3, per docs/TASKS.md).
# --------------------------------------------------------------------------

_SETTINGS_DEFAULTS: dict[str, int | str | None] = {
    "session_lifetime_desktop_seconds": session_auth._DEFAULT_DESKTOP_LIFETIME_SECONDS,
    "session_lifetime_pwa_seconds": session_auth._DEFAULT_PWA_LIFETIME_SECONDS,
    "session_lifetime_remember_me_seconds": session_auth._DEFAULT_REMEMBER_ME_LIFETIME_SECONDS,
    "thumb_size_grid": media.SIZES["grid"],
    "thumb_size_grid2x": media.SIZES["grid2x"],
    "thumb_size_preview": media.SIZES["preview"],
    "thumb_quality": media.DEFAULT_QUALITY,
    "media_cache_size_limit_bytes": media.DEFAULT_CACHE_SIZE_LIMIT_BYTES,
    "zip_size_limit_bytes": 2 * 1024**3,
    "osm_consent": False,
    "map_tiles_pmtiles_path": None,
    "library_check_interval_minutes": library_watch.DEFAULT_CHECK_INTERVAL_MINUTES,
    "library_stable_minutes": library_watch.DEFAULT_STABLE_MINUTES,
    "show_library_updated_note": library_watch.DEFAULT_SHOW_UPDATED_NOTE,
}


class SettingsResponse(BaseModel):
    session_lifetime_desktop_seconds: int
    session_lifetime_pwa_seconds: int
    session_lifetime_remember_me_seconds: int
    thumb_size_grid: int
    thumb_size_grid2x: int
    thumb_size_preview: int
    thumb_quality: int
    media_cache_size_limit_bytes: int
    zip_size_limit_bytes: int
    map_tiles_mode: Literal["online", "local_file", "off"]
    map_tiles_pmtiles_path: str | None
    osm_consent: bool
    library_check_interval_minutes: int
    library_stable_minutes: int
    show_library_updated_note: bool


class SettingsUpdateRequest(BaseModel):
    session_lifetime_desktop_seconds: int = Field(ge=60)
    session_lifetime_pwa_seconds: int = Field(ge=60)
    session_lifetime_remember_me_seconds: int = Field(ge=60)
    thumb_size_grid: int = Field(ge=32, le=4096)
    thumb_size_grid2x: int = Field(ge=32, le=4096)
    thumb_size_preview: int = Field(ge=32, le=8192)
    thumb_quality: int = Field(ge=1, le=100)
    media_cache_size_limit_bytes: int = Field(ge=0)
    zip_size_limit_bytes: int = Field(ge=1)
    # "Map & place names": one consent for OpenStreetMap tiles and the GeoNames
    # place-name download. The map mode is derived from it and the PMTiles path.
    osm_consent: bool = False
    map_tiles_pmtiles_path: str | None = None
    # 0 is "Manual only": the background checker is off, "Check now" still works.
    library_check_interval_minutes: int = Field(
        default=library_watch.DEFAULT_CHECK_INTERVAL_MINUTES,
        ge=0,
        le=library_watch.MAX_MINUTES,
    )
    library_stable_minutes: int = Field(
        default=library_watch.DEFAULT_STABLE_MINUTES,
        ge=0,
        le=library_watch.MAX_MINUTES,
    )
    show_library_updated_note: bool = True


class SettingsPatchRequest(BaseModel):
    """Partial update: only the fields sent change. Same bounds as the PUT
    body; an unknown field is a 422, and null is allowed only where the
    stored value can be empty (the PMTiles path)."""

    model_config = ConfigDict(extra="forbid")

    session_lifetime_desktop_seconds: int | None = Field(default=None, ge=60)
    session_lifetime_pwa_seconds: int | None = Field(default=None, ge=60)
    session_lifetime_remember_me_seconds: int | None = Field(default=None, ge=60)
    thumb_size_grid: int | None = Field(default=None, ge=32, le=4096)
    thumb_size_grid2x: int | None = Field(default=None, ge=32, le=4096)
    thumb_size_preview: int | None = Field(default=None, ge=32, le=8192)
    thumb_quality: int | None = Field(default=None, ge=1, le=100)
    media_cache_size_limit_bytes: int | None = Field(default=None, ge=0)
    zip_size_limit_bytes: int | None = Field(default=None, ge=1)
    osm_consent: bool | None = None
    map_tiles_pmtiles_path: str | None = None
    library_check_interval_minutes: int | None = Field(
        default=None, ge=0, le=library_watch.MAX_MINUTES
    )
    library_stable_minutes: int | None = Field(
        default=None, ge=0, le=library_watch.MAX_MINUTES
    )
    show_library_updated_note: bool | None = None

    @model_validator(mode="after")
    def _no_null_except_path(self) -> SettingsPatchRequest:
        for name in self.model_fields_set:
            if name != "map_tiles_pmtiles_path" and getattr(self, name) is None:
                raise ValueError(f"{name} can't be null")
        return self


def _read_settings(db: sqlite3.Connection) -> SettingsResponse:
    values: dict[str, int | str | None] = {
        "map_tiles_mode": app_db.effective_map_mode(db)
    }
    for key, default in _SETTINGS_DEFAULTS.items():
        stored = app_db.get_setting(db, key)
        if stored is None:
            values[key] = default
        elif key == "map_tiles_pmtiles_path":
            values[key] = stored or None
        elif key in ("show_library_updated_note", "osm_consent"):
            values[key] = stored in ("1", "True", "true")
        else:
            values[key] = int(stored)
    return SettingsResponse(**values)


@router.get("/api/admin/settings", response_model=SettingsResponse)
def read_settings(
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> SettingsResponse:
    return _read_settings(db)


@router.put(
    "/api/admin/settings",
    response_model=SettingsResponse,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def write_settings(
    payload: SettingsUpdateRequest,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> SettingsResponse:
    was_agreed = app_db.osm_consent(db)
    values = payload.model_dump()
    path = (values["map_tiles_pmtiles_path"] or "").strip() or None
    values["map_tiles_pmtiles_path"] = path
    # Saving Settings does not answer the notice: the consent row is written
    # only when the checkbox differs from the current answer (no answer = off).
    del values["osm_consent"]
    for key, value in values.items():
        if isinstance(value, bool):
            value = int(value)
        app_db.set_setting(db, key, "" if value is None else str(value))
    app_db.write_audit_log(db, "set_settings", actor=admin["username"])
    if payload.osm_consent != was_agreed:
        _record_consent(db, admin, payload.osm_consent, "Map & place names (Settings)")
    return _read_settings(db)


@router.patch(
    "/api/admin/settings",
    response_model=SettingsResponse,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def patch_settings(
    payload: SettingsPatchRequest,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> SettingsResponse:
    """Save only the fields in the body, so each Settings control can save
    the moment it changes."""
    sent = {name: getattr(payload, name) for name in payload.model_fields_set}
    if not sent:
        return _read_settings(db)
    was_agreed = app_db.osm_consent(db)
    consent = sent.pop("osm_consent", None)
    for key, value in sent.items():
        if key == "map_tiles_pmtiles_path":
            value = (value or "").strip() or None
        if isinstance(value, bool):
            value = int(value)
        app_db.set_setting(db, key, "" if value is None else str(value))
    changed = sorted(sent) + (["osm_consent"] if consent is not None else [])
    app_db.write_audit_log(
        db,
        "set_settings",
        actor=admin["username"],
        detail=f"changed={','.join(changed)}",
    )
    if consent is not None and consent != was_agreed:
        _record_consent(db, admin, consent, "Map & place names (Settings)")
    return _read_settings(db)


def _record_consent(
    db: sqlite3.Connection,
    admin: sqlite3.Row,
    agree: bool,
    detail: str,
    *,
    declined_action: str = "osm_consent_withdrawn",
) -> None:
    """Store the answer, audit it, and refill or blank the offline place names.
    The security-headers middleware drops its cached CSP after this write."""
    was_agreed = app_db.osm_consent(db)
    app_db.set_setting(db, app_db.OSM_CONSENT_KEY, "1" if agree else "0")
    app_db.write_audit_log(
        db,
        "osm_consent_agreed" if agree else declined_action,
        actor=admin["username"],
        detail=detail,
    )
    if agree != was_agreed:
        data_dir = place_names.data_dir_of(db)
        if data_dir is not None:
            place_names.apply_setting(data_dir)


# D41 / Decisions 5: the OSM-data consent and the one-time gazetteer download.
class PlaceNamesStatus(BaseModel):
    dataset: str
    downloaded: bool
    size_bytes: int
    source_url: str
    attribution: str
    license_url: str
    # False until an admin has answered the "Map & place names" question (at
    # first-run setup or in Settings): drives the dashboard notice.
    consent_decided: bool
    consent: bool


def _place_names_status(db: sqlite3.Connection) -> PlaceNamesStatus:
    data_dir = place_names.data_dir_of(db)
    base = place_names.status(data_dir) if data_dir else place_names.status(".")
    return PlaceNamesStatus(
        **base,
        consent_decided=app_db.osm_consent_decided(db),
        consent=app_db.osm_consent(db),
    )


@router.get("/api/admin/place-names", response_model=PlaceNamesStatus)
def read_place_names(
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> PlaceNamesStatus:
    return _place_names_status(db)


class ConsentAnswer(BaseModel):
    agree: bool


@router.put(
    "/api/admin/place-names/consent",
    response_model=PlaceNamesStatus,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def answer_place_names_notice(
    payload: ConsentAnswer,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> PlaceNamesStatus:
    """The notice's "Allow" and "Not now" buttons. "Not now" records the
    answer (audited) so the notice goes away; the consent can still be
    changed in Settings. The client starts the download after "Allow"."""
    _record_consent(
        db,
        admin,
        payload.agree,
        "Map & place names (notice)",
        declined_action=(
            "osm_consent_withdrawn" if app_db.osm_consent(db) else "osm_consent_not_now"
        ),
    )
    return _place_names_status(db)


@router.post(
    "/api/admin/place-names/download",
    response_model=PlaceNamesStatus,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def download_place_names(
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> PlaceNamesStatus:
    """The one request in this server that reaches the internet: fetch the
    GeoNames dump once, on an admin's click. Photo coordinates are not part
    of it; the lookup afterwards is local."""
    if not app_db.osm_consent(db):
        raise HTTPException(
            status_code=403,
            detail='Agree to "Map & place names" in Settings before downloading place names.',
        )
    data_dir = place_names.data_dir_of(db)
    if data_dir is None:
        raise HTTPException(status_code=500, detail="no data directory")
    try:
        rows = place_names.download(data_dir)
    except place_names.DownloadError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    app_db.write_audit_log(
        db,
        "place_names_download",
        actor=admin["username"],
        detail=f"{place_names.DATASET} rows={rows}",
    )
    if place_names.enabled(db):
        place_names.apply_setting(data_dir)
    return _place_names_status(db)
