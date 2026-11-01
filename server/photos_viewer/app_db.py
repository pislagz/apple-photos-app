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

# Each migration is a list of complete, individually-executed statements,
# not one `executescript` blob: `executescript` issues an implicit COMMIT
# before it runs, which would end the transaction `migrate()` holds open for
# the whole migration plus its `PRAGMA user_version` bump.
_MIGRATIONS: list[list[str]] = [
    # 1: users, sessions, libraries, assignments, asset index, thumbnail
    # cache, audit log, login-failure tracking (for the P1.3 lockout).
    [
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
            disabled INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """,
        # id: sha256 of the cookie value. The cookie itself is never stored.
        """
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL,
            remember_me INTEGER NOT NULL DEFAULT 0
        )
        """,
        "CREATE INDEX idx_sessions_user_id ON sessions(user_id)",
        """
        CREATE TABLE login_failures (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """,
        "CREATE INDEX idx_login_failures_username ON login_failures(username, occurred_at)",
        """
        CREATE TABLE libraries (
            id INTEGER PRIMARY KEY,
            display_name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """,
        """
        CREATE TABLE library_assignments (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
            PRIMARY KEY (user_id, library_id)
        )
        """,
        """
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
        )
        """,
        "CREATE INDEX idx_assets_library_id ON assets(library_id, date_created)",
        """
        CREATE TABLE thumbnail_cache (
            id INTEGER PRIMARY KEY,
            asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            size TEXT NOT NULL,
            cache_path TEXT NOT NULL,
            generated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (asset_id, size)
        )
        """,
        """
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
            asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
            action TEXT NOT NULL,
            occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """,
        "CREATE INDEX idx_audit_log_user_id ON audit_log(user_id, occurred_at)",
    ],
    # 2: per-client-IP login-failure tracking, looser than the per-username
    # lockout (see session_auth.py).
    [
        """
        CREATE TABLE ip_login_failures (
            id INTEGER PRIMARY KEY,
            client_ip TEXT NOT NULL,
            occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """,
        "CREATE INDEX idx_ip_login_failures_client_ip ON ip_login_failures(client_ip, occurred_at)",
    ],
]


def db_path(data_dir: str | pathlib.Path) -> pathlib.Path:
    return pathlib.Path(data_dir) / "app.db"


def connect(data_dir: str | pathlib.Path) -> sqlite3.Connection:
    """Open `app.db` under `data_dir`, migrating it first if needed."""
    data_dir = pathlib.Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False: FastAPI runs sync routes in a threadpool, so a
    # single logical request -- or, in tests, a single connection reused
    # across TestClient calls -- can be handed to a different OS thread than
    # the one that opened the connection. That is still one caller at a time,
    # never two threads touching the connection concurrently, so sqlite3's
    # same-thread check is only in the way; it is not a claim that this
    # connection is safe to share across *concurrent* threads.
    conn = sqlite3.connect(db_path(data_dir), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # Let a second connection's BEGIN IMMEDIATE (ours, or another process's)
    # block for a bit instead of failing immediately with "database is
    # locked" while this connection (or migrate(), below) holds the write lock.
    conn.execute("PRAGMA busy_timeout = 5000")
    migrate(conn)
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    """Apply any migration in `_MIGRATIONS` not yet applied to `conn`.

    The whole run -- every pending migration plus the final `PRAGMA
    user_version` -- is one `BEGIN IMMEDIATE` transaction, so a crash or
    error partway through leaves both the schema and the recorded version
    exactly as they were. `user_version` is re-read only after the write
    lock is held, in case another connection migrated the file between an
    earlier, lock-free read and this one.
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        current = conn.execute("PRAGMA user_version").fetchone()[0]
        for version, statements in enumerate(_MIGRATIONS, start=1):
            if version <= current:
                continue
            for statement in statements:
                conn.execute(statement)
            conn.execute(f"PRAGMA user_version = {version}")
    except BaseException:
        conn.rollback()
        raise
    else:
        conn.commit()
