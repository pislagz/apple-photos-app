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
import os
import pathlib
import secrets
import sqlite3
from collections.abc import Iterator
from typing import Literal

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from . import app_db

COOKIE_NAME = "session"

# Lifetimes are configurable (CLAUDE.md / docs/SPEC.md: "long lifetime for
# the installed PWA, shorter for desktop by default"). Settings UI (P1.10)
# will eventually write these into app.db; until then, the environment is
# the configuration surface, read fresh on every call so a test can
# monkeypatch os.environ without reimporting this module.
_DESKTOP_LIFETIME_ENV = "PHOTOS_VIEWER_SESSION_LIFETIME_DESKTOP_SECONDS"
_PWA_LIFETIME_ENV = "PHOTOS_VIEWER_SESSION_LIFETIME_PWA_SECONDS"
_REMEMBER_ME_LIFETIME_ENV = "PHOTOS_VIEWER_REMEMBER_ME_LIFETIME_SECONDS"

_DEFAULT_DESKTOP_LIFETIME_SECONDS = 12 * 3600
_DEFAULT_PWA_LIFETIME_SECONDS = 30 * 24 * 3600
_DEFAULT_REMEMBER_ME_LIFETIME_SECONDS = 180 * 24 * 3600

# Login lockout: a sliding window of recent failures per username, not per
# IP, since several users can share one tailnet address behind Tailscale.
MAX_FAILED_LOGIN_ATTEMPTS = 5
LOCKOUT_WINDOW_SECONDS = 15 * 60

_hasher = PasswordHasher()


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
    return int(os.environ.get(name, default_seconds))


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


def lookup_session(conn: sqlite3.Connection, raw_token: str) -> sqlite3.Row | None:
    """The session row for a cookie value, or None if it is missing or expired."""
    session_id = _hash_token(raw_token)
    row = conn.execute(
        "SELECT * FROM sessions WHERE id = ? AND expires_at > datetime('now')",
        (session_id,),
    ).fetchone()
    if row is None:
        return None
    conn.execute("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?", (session_id,))
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


def record_login_failure(conn: sqlite3.Connection, username: str) -> None:
    conn.execute("INSERT INTO login_failures (username) VALUES (?)", (username,))
    conn.commit()


def clear_login_failures(conn: sqlite3.Connection, username: str) -> None:
    conn.execute("DELETE FROM login_failures WHERE username = ?", (username,))
    conn.commit()


def is_locked_out(conn: sqlite3.Connection, username: str) -> bool:
    count = conn.execute(
        "SELECT COUNT(*) FROM login_failures "
        "WHERE username = ? AND occurred_at >= datetime('now', ?)",
        (username, f"-{LOCKOUT_WINDOW_SECONDS} seconds"),
    ).fetchone()[0]
    return count >= MAX_FAILED_LOGIN_ATTEMPTS


def _data_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("PHOTOS_VIEWER_DATA_DIR", "data"))


def get_db() -> Iterator[sqlite3.Connection]:
    """Request-scoped `app.db` connection. Tests override this dependency
    with one pointed at `tmp_path`, so the default (`$PHOTOS_VIEWER_DATA_DIR`,
    or `./data`) is never touched by the test suite."""
    conn = app_db.connect(_data_dir())
    try:
        yield conn
    finally:
        conn.close()


router = APIRouter()


class AdminSetupRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False
    client: Literal["desktop", "pwa"] = "desktop"


@router.post("/api/setup/admin", status_code=201)
def setup_admin(payload: AdminSetupRequest, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Create the single admin account. Disables itself the moment any user
    row exists, so it cannot be used again to add a second account."""
    (existing_users,) = db.execute("SELECT COUNT(*) FROM users").fetchone()
    if existing_users > 0:
        raise HTTPException(status_code=409, detail="first-run setup has already run")
    db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
        (payload.username, hash_password(payload.password)),
    )
    db.commit()
    return {"username": payload.username, "role": "admin"}


@router.post("/api/auth/login")
def login(payload: LoginRequest, response: Response, db: sqlite3.Connection = Depends(get_db)) -> dict:
    if is_locked_out(db, payload.username):
        raise HTTPException(status_code=429, detail="too many failed attempts, try again later")

    user = db.execute("SELECT * FROM users WHERE username = ?", (payload.username,)).fetchone()
    if user is None or user["disabled"] or not verify_password(user["password_hash"], payload.password):
        record_login_failure(db, payload.username)
        raise HTTPException(status_code=401, detail="invalid username or password")

    clear_login_failures(db, payload.username)
    raw_token, max_age = create_session(db, user["id"], client=payload.client, remember_me=payload.remember_me)
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        max_age=max_age,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )
    return {"username": user["username"], "role": user["role"]}


@router.post("/api/auth/logout", status_code=204)
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
