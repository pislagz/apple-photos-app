"""`app.db`: this server's own SQLite database, kept outside every `.photoslibrary`.

Holds users, sessions, library registrations, user/library assignments, the
asset index (built in Phase 1.6), the thumbnail-cache index, and the audit
log. Nothing here ever opens a `.photoslibrary` path; that is `libraries.py`'s
job alone.

Migrations are a short, ordered list of SQL scripts applied inside a single
transaction, tracked with `PRAGMA user_version` so re-running `migrate()`
against an already-migrated file is a no-op.
"""

from __future__ import annotations

import pathlib
import sqlite3

_MIGRATIONS: list[str] = [
    # 1: users, sessions, libraries, assignments, asset index, thumbnail
    # cache, audit log, login-failure tracking (for the P1.3 lockout).
    """
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE sessions (
        id TEXT PRIMARY KEY, -- sha256 of the cookie value; the cookie itself is never stored
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        remember_me INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_sessions_user_id ON sessions(user_id);

    CREATE TABLE login_failures (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL,
        occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_login_failures_username ON login_failures(username, occurred_at);

    CREATE TABLE libraries (
        id INTEGER PRIMARY KEY,
        display_name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE library_assignments (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, library_id)
    );

    CREATE TABLE assets (
        id INTEGER PRIMARY KEY,
        library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
        uuid TEXT NOT NULL,
        filename TEXT,
        date_created TEXT,
        favorite INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        is_video INTEGER NOT NULL DEFAULT 0,
        is_live_photo INTEGER NOT NULL DEFAULT 0,
        latitude REAL,
        longitude REAL,
        place TEXT,
        path_original TEXT,
        path_edited TEXT,
        path_derivative TEXT,
        UNIQUE (library_id, uuid)
    );
    CREATE INDEX idx_assets_library_id ON assets(library_id, date_created);

    CREATE TABLE thumbnail_cache (
        id INTEGER PRIMARY KEY,
        asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        size TEXT NOT NULL,
        cache_path TEXT NOT NULL,
        generated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (asset_id, size)
    );

    CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
        asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_audit_log_user_id ON audit_log(user_id, occurred_at);
    """,
]


def db_path(data_dir: str | pathlib.Path) -> pathlib.Path:
    return pathlib.Path(data_dir) / "app.db"


def connect(data_dir: str | pathlib.Path) -> sqlite3.Connection:
    """Open `app.db` under `data_dir`, migrating it first if needed."""
    data_dir = pathlib.Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False: FastAPI runs sync routes in a threadpool, which
    # can hand a single logical request -- or, in tests, a single connection
    # reused across TestClient calls -- to a different OS thread than the one
    # that opened the connection. Access is still always serial, never
    # concurrent, so sqlite3's own thread check is only in the way here.
    conn = sqlite3.connect(db_path(data_dir), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    migrate(conn)
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    """Apply any migration in `_MIGRATIONS` not yet applied to `conn`."""
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for version, script in enumerate(_MIGRATIONS, start=1):
        if version <= current:
            continue
        conn.executescript(script)
        conn.execute(f"PRAGMA user_version = {version}")
    conn.commit()
