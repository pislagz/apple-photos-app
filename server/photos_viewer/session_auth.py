"""Passwords, session cookies, login lockout, and first-run admin creation.

Named `session_auth.py`, not `auth.py` plus a `tokens.py`/`credentials.py`
pair, because this project's tooling cannot read a path containing "token"
or "credential" (see CLAUDE.md, "Filenames the runner can read").

The cookie value is a random, unguessable string (`secrets.token_urlsafe`),
never a bearer secret shared across users (contrast `photokit-api`, see
`docs/PRIOR_ART.md`). Only its SHA-256 is stored in `app.db`'s `sessions`
table, so a leak of that file alone does not hand out working cookies.
"""

from __future__ import annotations

import hashlib
import logging
import os
import pathlib
import secrets
import sqlite3
import time
from collections.abc import Iterator
from typing import Annotated, Literal
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from argon2.low_level import Type
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, BeforeValidator, Field

from . import app_db

logger = logging.getLogger(__name__)

COOKIE_NAME = "session"

# Lifetimes are configurable (CLAUDE.md / docs/SPEC.md: "long lifetime for
# the installed PWA, shorter for desktop by default"). Settings UI (P1.10)
# will eventually write these into app.db; until then, the environment is
# the configuration surface, read fresh on every call so a test can
# monkeypatch os.environ without reimporting this module.
_DESKTOP_LIFETIME_ENV = "PHOTOS_VIEWER_SESSION_LIFETIME_DESKTOP_SECONDS"
_PWA_LIFETIME_ENV = "PHOTOS_VIEWER_SESSION_LIFETIME_PWA_SECONDS"
_REMEMBER_ME_LIFETIME_ENV = "PHOTOS_VIEWER_REMEMBER_ME_LIFETIME_SECONDS"
_COOKIE_SECURE_ENV = "PHOTOS_VIEWER_COOKIE_SECURE"

_DEFAULT_DESKTOP_LIFETIME_SECONDS = 12 * 3600
_DEFAULT_PWA_LIFETIME_SECONDS = 30 * 24 * 3600
_DEFAULT_REMEMBER_ME_LIFETIME_SECONDS = 180 * 24 * 3600

# A session is considered idle-refreshed at most once a minute, so a user
# scrolling the grid doesn't turn every request into a write.
_LAST_SEEN_THROTTLE_SECONDS = 60

# Expired-session cleanup is a DELETE plus commit; throttling it to about
# once a minute (module-level, not per-connection) keeps a server under
# constant request load from turning every single request into a write.
# A session past its `expires_at` is already rejected by `lookup_session`'s
# WHERE clause regardless of whether this has run yet -- this only reclaims
# the row.
_SESSION_PRUNE_INTERVAL_SECONDS = 60
_last_session_prune_at = 0.0

# Login lockout: a sliding window of recent failures per username, not per
# IP, since several users can share one tailnet address behind Tailscale.
MAX_FAILED_LOGIN_ATTEMPTS = 5
LOCKOUT_WINDOW_SECONDS = 15 * 60

# Looser than the per-username limit: a client hammering many different
# usernames from one address should still be slowed down, but one shared
# tailnet address serving several real users must not lock them all out
# together just because they share an IP. Behind `tailscale serve`, every
# request arrives from loopback, so "one address" is otherwise the whole
# server -- see `_ip_lockout_key`.
MAX_FAILED_LOGIN_ATTEMPTS_PER_IP = 30
IP_LOCKOUT_WINDOW_SECONDS = 15 * 60

_TAILSCALE_USER_LOGIN_HEADER = "tailscale-user-login"
_LOOPBACK_HOSTS = {"127.0.0.1", "::1"}

# Pinned explicitly rather than left at argon2-cffi's defaults, so a future
# library upgrade that changes its defaults can't silently weaken (or just
# change, breaking `check_needs_rehash`) every password in `app.db`.
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, type=Type.ID)

# A fixed, valid Argon2 hash with no corresponding real password. Verifying
# against it costs the same as a real verification, so a request for a
# missing or disabled username takes the same time as a wrong password for
# one that exists -- the username can't be inferred from response timing.
_DUMMY_PASSWORD_HASH = _hasher.hash(secrets.token_urlsafe(32))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """True only on an exact match. Never raises -- a malformed stored hash
    or a mismatched password are both just "not authenticated"."""
    try:
        return _hasher.verify(password_hash, password)
    except VerificationError:
        return False


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _env_seconds(name: str, default_seconds: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default_seconds
    try:
        value = int(raw)
    except ValueError:
        logger.warning("%s=%r is not an integer; using default %d seconds", name, raw, default_seconds)
        return default_seconds
    if value < 0:
        logger.warning("%s=%d is negative; using default %d seconds", name, value, default_seconds)
        return default_seconds
    return value


def _cookie_secure() -> bool:
    """Default true: the cookie is only safe to send over HTTPS (Tailscale
    Serve). Set `PHOTOS_VIEWER_COOKIE_SECURE=false` for local plain-HTTP dev
    only -- never inferred from the request, since a reverse proxy can make
    an HTTP request look however it likes."""
    raw = os.environ.get(_COOKIE_SECURE_ENV, "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def session_lifetime_seconds(client: Literal["desktop", "pwa"], remember_me: bool) -> int:
    if remember_me:
        return _env_seconds(_REMEMBER_ME_LIFETIME_ENV, _DEFAULT_REMEMBER_ME_LIFETIME_SECONDS)
    if client == "pwa":
        return _env_seconds(_PWA_LIFETIME_ENV, _DEFAULT_PWA_LIFETIME_SECONDS)
    return _env_seconds(_DESKTOP_LIFETIME_ENV, _DEFAULT_DESKTOP_LIFETIME_SECONDS)


def create_session(
    conn: sqlite3.Connection,
    user_id: int,
    *,
    client: Literal["desktop", "pwa"] = "desktop",
    remember_me: bool = False,
    device: str | None = None,
) -> tuple[str, int]:
    """Create a session row and return `(raw_cookie_value, max_age_seconds)`."""
    raw_token = secrets.token_urlsafe(32)
    lifetime_seconds = session_lifetime_seconds(client, remember_me)
    conn.execute(
        "INSERT INTO sessions (id, user_id, device, expires_at, remember_me) "
        "VALUES (?, ?, ?, datetime('now', ?), ?)",
        (_hash_token(raw_token), user_id, device, f"+{lifetime_seconds} seconds", int(remember_me)),
    )
    conn.commit()
    return raw_token, lifetime_seconds


def _prune_expired_sessions(conn: sqlite3.Connection) -> None:
    global _last_session_prune_at
    now = time.monotonic()
    if now - _last_session_prune_at < _SESSION_PRUNE_INTERVAL_SECONDS:
        return
    _last_session_prune_at = now
    conn.execute("DELETE FROM sessions WHERE expires_at <= datetime('now')")
    conn.commit()


def lookup_session(conn: sqlite3.Connection, raw_token: str) -> sqlite3.Row | None:
    """The session's row, joined with its user, or None if the cookie is
    unknown, expired, or belongs to a now-disabled user."""
    _prune_expired_sessions(conn)
    session_id = _hash_token(raw_token)
    row = conn.execute(
        "SELECT sessions.*, users.username AS username, users.role AS role, users.disabled AS disabled "
        "FROM sessions JOIN users ON users.id = sessions.user_id "
        "WHERE sessions.id = ? AND sessions.expires_at > datetime('now')",
        (session_id,),
    ).fetchone()
    if row is None or row["disabled"]:
        return None
    conn.execute(
        "UPDATE sessions SET last_seen_at = datetime('now') "
        "WHERE id = ? AND last_seen_at <= datetime('now', ?)",
        (session_id, f"-{_LAST_SEEN_THROTTLE_SECONDS} seconds"),
    )
    conn.commit()
    return row


def revoke_session(conn: sqlite3.Connection, raw_token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE id = ?", (_hash_token(raw_token),))
    conn.commit()


def revoke_session_by_id(conn: sqlite3.Connection, session_id: str) -> None:
    """Revoke a session by its stored (already-hashed) id -- what an admin's
    Sessions screen (P1.10) lists and revokes, never the raw cookie value."""
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()


def _prune_old_login_failures(conn: sqlite3.Connection) -> None:
    """Keep both failure tables bounded to their own lockout window. Called
    once per login attempt rather than on a schedule -- cheap, and it means
    an idle server never accumulates rows forever."""
    conn.execute(
        "DELETE FROM login_failures WHERE occurred_at < datetime('now', ?)",
        (f"-{LOCKOUT_WINDOW_SECONDS} seconds",),
    )
    conn.execute(
        "DELETE FROM ip_login_failures WHERE occurred_at < datetime('now', ?)",
        (f"-{IP_LOCKOUT_WINDOW_SECONDS} seconds",),
    )
    conn.commit()


def record_login_failure(conn: sqlite3.Connection, username: str, *, user_exists: bool) -> None:
    """`user_exists` is whether `username` matched a row at the time of this
    attempt, stored alongside the failure so an unknown name's attempts
    never share a counter with a real account's -- see `is_locked_out`."""
    conn.execute(
        "INSERT INTO login_failures (username, user_exists) VALUES (?, ?)",
        (username, int(user_exists)),
    )
    conn.commit()


def clear_login_failures(conn: sqlite3.Connection, username: str) -> None:
    conn.execute("DELETE FROM login_failures WHERE username = ?", (username,))
    conn.commit()


def is_locked_out(conn: sqlite3.Connection, username: str, *, user_exists: bool) -> bool:
    """Trade-off: this lockout is keyed on the username alone, not on who is
    typing it, so someone who merely knows a real username can lock that
    account out for the cool-off window by sending wrong passwords. The
    per-IP limit below is deliberately looser and is not a substitute for
    this -- it exists only to slow down one client guessing many usernames,
    not to protect any one account.

    `user_exists` must match the caller's current knowledge of whether the
    username is real: an unknown name is given the same lockout mechanics
    (so probing it is still slowed down and a 429 doesn't disclose whether
    the account exists), but counted in a separate row set (`user_exists =
    0`), so a flood of guesses against a not-yet-created username can never
    carry over and lock out a real account later created with that name.
    """
    count = conn.execute(
        "SELECT COUNT(*) FROM login_failures "
        "WHERE username = ? AND user_exists = ? AND occurred_at >= datetime('now', ?)",
        (username, int(user_exists), f"-{LOCKOUT_WINDOW_SECONDS} seconds"),
    ).fetchone()[0]
    return count >= MAX_FAILED_LOGIN_ATTEMPTS


def record_ip_login_failure(conn: sqlite3.Connection, client_ip: str) -> None:
    conn.execute("INSERT INTO ip_login_failures (client_ip) VALUES (?)", (client_ip,))
    conn.commit()


def is_ip_locked_out(conn: sqlite3.Connection, client_ip: str) -> bool:
    count = conn.execute(
        "SELECT COUNT(*) FROM ip_login_failures "
        "WHERE client_ip = ? AND occurred_at >= datetime('now', ?)",
        (client_ip, f"-{IP_LOCKOUT_WINDOW_SECONDS} seconds"),
    ).fetchone()[0]
    return count >= MAX_FAILED_LOGIN_ATTEMPTS_PER_IP


def _client_ip(request: Request) -> str:
    client = request.client
    return client.host if client is not None else "unknown"


def _ip_lockout_key(request: Request) -> str | None:
    """Key for the per-client failed-login counter, or None to skip it
    entirely for this request.

    Behind `tailscale serve`, every request arrives from loopback, so the
    connecting address alone can't tell callers apart -- keying on it would
    turn a handful of wrong passwords from one real user into a lockout for
    everyone on the tailnet. When the request is loopback, key on the
    `Tailscale-User-Login` header Tailscale Serve adds instead. With no such
    header there is no way to distinguish loopback callers, so the per-client
    limit is skipped for this request; the per-username lockout above still
    applies regardless.
    """
    host = _client_ip(request)
    if host not in _LOOPBACK_HOSTS:
        return host
    login = request.headers.get(_TAILSCALE_USER_LOGIN_HEADER)
    return f"tailscale-user:{login}" if login else None


_DEFAULT_PORTS = {"http": 80, "https": 443}


def _effective_port(scheme: str, port: int | None) -> int | None:
    return port if port is not None else _DEFAULT_PORTS.get(scheme.lower())


def _is_same_origin(origin: str, request: Request) -> bool:
    try:
        parsed = urlsplit(origin)
    except ValueError:
        return False
    if not parsed.hostname or parsed.hostname.lower() != (request.url.hostname or "").lower():
        return False
    if parsed.scheme.lower() != request.url.scheme.lower():
        return False
    return _effective_port(parsed.scheme, parsed.port) == _effective_port(request.url.scheme, request.url.port)


def _reject_cross_site_requests(request: Request) -> None:
    """CSRF defense for every state-changing (POST) route, including logout.

    A browser form (the classic CSRF vector) cannot set an arbitrary
    `Content-Type`, only a handful of "simple" values that exclude
    `application/json` -- requiring it blocks that vector outright. The
    `Origin` check is a second layer for clients that can set headers (e.g.
    a `fetch` from another site); a same-origin (scheme, host, and port) or
    absent Origin is allowed, since same-origin requests and some
    non-browser clients don't send one.
    """
    content_type = request.headers.get("content-type", "")
    if not content_type.split(";", 1)[0].strip().lower() == "application/json":
        raise HTTPException(status_code=415, detail="Content-Type must be application/json")

    origin = request.headers.get("origin")
    if origin is not None and not _is_same_origin(origin, request):
        raise HTTPException(status_code=403, detail="cross-origin request rejected")


def _data_dir() -> pathlib.Path:
    return app_db.data_dir_from_env()


def get_db() -> Iterator[sqlite3.Connection]:
    """Request-scoped `app.db` connection. Tests override this dependency
    with one pointed at `tmp_path`, so the default (`$PHOTOS_VIEWER_DATA_DIR`,
    or `./data`) is never touched by the test suite."""
    conn = app_db.connect(_data_dir())
    try:
        yield conn
    finally:
        conn.close()


def require_session(request: Request, db: sqlite3.Connection = Depends(get_db)) -> sqlite3.Row:
    """FastAPI dependency: the caller's session row, or 401. Use on every
    route that needs "who is asking" -- the P1.8 per-library assignment
    guard builds on top of this."""
    raw_token = request.cookies.get(COOKIE_NAME)
    session = lookup_session(db, raw_token) if raw_token else None
    if session is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return session


def require_admin(session: sqlite3.Row = Depends(require_session)) -> sqlite3.Row:
    """FastAPI dependency: the caller's session row, or 403 if it is not an
    admin's. Use on every `/api/admin/*` route."""
    if session["role"] != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    return session


router = APIRouter()


def _normalize_username(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


Username = Annotated[str, BeforeValidator(_normalize_username), Field(min_length=1, max_length=64)]
Password = Annotated[str, Field(min_length=12, max_length=1024)]
# Login must not apply the 12-character minimum: a short wrong password has
# to go through the same lockout accounting and Argon2 verify as any other
# wrong password, not get turned away early by validation (which would also
# make a 422-vs-401 split another way to probe password length). The
# minimum still applies at setup and user creation, via `Password` above.
LoginPassword = Annotated[str, Field(max_length=1024)]


class AdminSetupRequest(BaseModel):
    username: Username
    password: Password


class LoginRequest(BaseModel):
    username: Username
    password: LoginPassword
    remember_me: bool = False
    client: Literal["desktop", "pwa"] = "desktop"


class AuthUserResponse(BaseModel):
    username: str
    role: Literal["admin", "user"]


@router.post(
    "/api/setup/admin",
    status_code=201,
    response_model=AuthUserResponse,
    dependencies=[Depends(_reject_cross_site_requests)],
)
def setup_admin(payload: AdminSetupRequest, db: sqlite3.Connection = Depends(get_db)) -> AuthUserResponse:
    """Create the single admin account. Disables itself the moment any user
    row exists, so it cannot be used again to add a second account.

    The count-then-insert is one `BEGIN IMMEDIATE` transaction: IMMEDIATE
    takes SQLite's write lock before the SELECT, so if two first-run
    requests race, the second blocks until the first commits and then sees
    a non-zero count instead of also inserting a second admin.
    """
    password_hash = hash_password(payload.password)  # hash before taking the write lock
    db.execute("BEGIN IMMEDIATE")
    try:
        (existing_users,) = db.execute("SELECT COUNT(*) FROM users").fetchone()
        if existing_users > 0:
            raise HTTPException(status_code=409, detail="first-run setup has already run")
        db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
            (payload.username, password_hash),
        )
    except BaseException:
        db.rollback()
        raise
    else:
        db.commit()
    return AuthUserResponse(username=payload.username, role="admin")


@router.post("/api/auth/login", response_model=AuthUserResponse, dependencies=[Depends(_reject_cross_site_requests)])
def login(payload: LoginRequest, request: Request, response: Response, db: sqlite3.Connection = Depends(get_db)) -> AuthUserResponse:
    _prune_old_login_failures(db)
    ip_key = _ip_lockout_key(request)

    user = db.execute("SELECT * FROM users WHERE username = ?", (payload.username,)).fetchone()
    user_exists = user is not None

    if (ip_key is not None and is_ip_locked_out(db, ip_key)) or is_locked_out(
        db, payload.username, user_exists=user_exists
    ):
        raise HTTPException(status_code=429, detail="too many failed attempts, try again later")

    if user is None or user["disabled"]:
        # Always verify against something, even for a missing or disabled
        # user, so the response takes the same time either way and a
        # username can't be inferred from how fast it failed.
        verify_password(_DUMMY_PASSWORD_HASH, payload.password)
        password_ok = False
    else:
        password_ok = verify_password(user["password_hash"], payload.password)

    if not password_ok:
        record_login_failure(db, payload.username, user_exists=user_exists)
        if ip_key is not None:
            record_ip_login_failure(db, ip_key)
        raise HTTPException(status_code=401, detail="invalid username or password")

    clear_login_failures(db, payload.username)
    if _hasher.check_needs_rehash(user["password_hash"]):
        db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(payload.password), user["id"]),
        )
        db.commit()

    raw_token, max_age = create_session(db, user["id"], client=payload.client, remember_me=payload.remember_me)
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        max_age=max_age,
        httponly=True,
        secure=_cookie_secure(),
        samesite="strict",
        path="/",
    )
    return AuthUserResponse(username=user["username"], role=user["role"])


@router.post("/api/auth/logout", status_code=204, dependencies=[Depends(_reject_cross_site_requests)])
def logout(request: Request, response: Response, db: sqlite3.Connection = Depends(get_db)) -> Response:
    raw_token = request.cookies.get(COOKIE_NAME)
    if raw_token:
        revoke_session(db, raw_token)
    # Mutate and return the injected `response`, not a fresh one -- a route
    # that returns a brand-new Response object instead replaces FastAPI's
    # injected one outright, dropping the delete_cookie header set on it.
    response.delete_cookie(COOKIE_NAME, path="/")
    response.status_code = 204
    return response


@router.get("/api/auth/me", response_model=AuthUserResponse)
def read_current_user(session: sqlite3.Row = Depends(require_session)) -> AuthUserResponse:
    return AuthUserResponse(username=session["username"], role=session["role"])


class UnlockResponse(BaseModel):
    username: str


@router.post(
    "/api/admin/users/{username}/unlock",
    response_model=UnlockResponse,
    dependencies=[Depends(_reject_cross_site_requests)],
)
def unlock_user(
    username: str,
    admin: sqlite3.Row = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
) -> UnlockResponse:
    """Clear a username's lockout counter. The P1.10 admin UI doesn't exist
    yet; this is the API it will call for its "Unlock" action."""
    del admin
    normalized = _normalize_username(username)
    user = db.execute("SELECT id FROM users WHERE username = ?", (normalized,)).fetchone()
    if user is None:
        raise HTTPException(status_code=404, detail="not found")
    clear_login_failures(db, normalized)
    return UnlockResponse(username=normalized)
