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

import os
import pathlib
import sqlite3

_DATA_DIR_ENV = "PHOTOS_VIEWER_DATA_DIR"

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
    # 3: split login-failure rows by whether the attempted username existed
    # at insert time, so a flood of guesses against a not-yet-created name
    # can never carry over and lock out a real account later created with
    # that name (see session_auth.py's `record_login_failure`/`is_locked_out`).
    [
        "ALTER TABLE login_failures ADD COLUMN user_exists INTEGER NOT NULL DEFAULT 1",
    ],
    # 4: `audit_log.user_id` identifies who an entry is *about* (the user who
    # logged in, downloaded, ...). An admin action like unlocking another
    # user's account has a second party -- who performed it -- that doesn't
    # fit that column, and for the CLI (issue #12 H) isn't a `users` row at
    # all. `actor` is free text (an admin's username, or "cli") for that
    # second party; `detail` is free text for anything else worth recording
    # (e.g. whether an unlock also cleared the shared per-IP counters).
    [
        "ALTER TABLE audit_log ADD COLUMN actor TEXT",
        "ALTER TABLE audit_log ADD COLUMN detail TEXT",
    ],
    # 5: `is_locked_out` filters on (username, user_exists, occurred_at);
    # the migration-3 index only covers (username, occurred_at), so SQLite
    # still scans every row for a username to apply the `user_exists` filter.
    [
        "DROP INDEX idx_login_failures_username",
        "CREATE INDEX idx_login_failures_username ON login_failures(username, user_exists, occurred_at)",
    ],
    # 6: `peer_ip` is the direct TCP peer that made the request -- the same
    # value for every `client_ip` bucket sharing one trusted proxy, whether
    # that bucket is a `Tailscale-User-Login` header value or the peer-IP
    # fallback. It backs the coarse per-peer ceiling in `is_ip_locked_out`
    # (issue #20 A): rotating the header from a trusted peer changes
    # `client_ip` but not `peer_ip`, so it can't buy an unlimited number of
    # fresh buckets. Existing rows get '' -- they age out of the 15-minute
    # window long before this migration ships, so backfilling them is not
    # worth a second pass over the table.
    [
        "ALTER TABLE ip_login_failures ADD COLUMN peer_ip TEXT NOT NULL DEFAULT ''",
        "CREATE INDEX idx_ip_login_failures_peer_ip ON ip_login_failures(peer_ip, occurred_at)",
    ],
    # 7: admin-configurable settings (P1.4's tailnet allow-list is the first
    # one), outside every `.photoslibrary` and outside the environment, so
    # P1.10's admin UI has somewhere durable to write them.
    [
        """
        CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """,
    ],
    # 8: the P1.6 asset index. `assets` gains the rest of the fields
    # `docs/PRIOR_ART.md` lists for `PhotoInfo` (migration 1's columns were
    # only ever a placeholder -- status counts stayed null until this
    # landed); `place`, already there, becomes that place's display name,
    # alongside the two new columns for the rest of `PlaceInfo`. `people`
    # (library-wide, from `PhotosDB.person_info`) and `albums` (from
    # `PhotosDB.album_info`) are their own tables because both are shared by
    # many assets; `asset_people`/`asset_albums` are the join tables.
    # `libraries.last_indexed_at`/`last_indexed_signature` (see
    # `indexer.sqlite_signature`) are how `indexer.index_library` tells an
    # unchanged library apart from one that needs re-walking.
    [
        "ALTER TABLE assets ADD COLUMN title TEXT",
        "ALTER TABLE assets ADD COLUMN description TEXT",
        "ALTER TABLE assets ADD COLUMN original_filename TEXT",
        "ALTER TABLE assets ADD COLUMN date_added TEXT",
        "ALTER TABLE assets ADD COLUMN date_modified TEXT",
        "ALTER TABLE assets ADD COLUMN is_screenshot INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE assets ADD COLUMN is_selfie INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE assets ADD COLUMN is_portrait INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE assets ADD COLUMN is_panorama INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE assets ADD COLUMN is_hdr INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE assets ADD COLUMN is_slow_mo INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE assets ADD COLUMN is_burst INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE assets ADD COLUMN width INTEGER",
        "ALTER TABLE assets ADD COLUMN height INTEGER",
        "ALTER TABLE assets ADD COLUMN original_filesize INTEGER",
        "ALTER TABLE assets ADD COLUMN uti TEXT",
        "ALTER TABLE assets ADD COLUMN uti_original TEXT",
        "ALTER TABLE assets ADD COLUMN path_raw TEXT",
        "ALTER TABLE assets ADD COLUMN path_live_photo TEXT",
        "ALTER TABLE assets ADD COLUMN path_edited_live_photo TEXT",
        "ALTER TABLE assets ADD COLUMN place_country_code TEXT",
        "ALTER TABLE assets ADD COLUMN place_address TEXT",
        "ALTER TABLE libraries ADD COLUMN last_indexed_at TEXT",
        "ALTER TABLE libraries ADD COLUMN last_indexed_signature TEXT",
        """
        CREATE TABLE people (
            id INTEGER PRIMARY KEY,
            library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
            uuid TEXT NOT NULL,
            name TEXT,
            display_name TEXT,
            face_count INTEGER NOT NULL DEFAULT 0,
            UNIQUE (library_id, uuid)
        )
        """,
        "CREATE INDEX idx_people_library_id ON people(library_id)",
        """
        CREATE TABLE asset_people (
            asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
            PRIMARY KEY (asset_id, person_id)
        )
        """,
        "CREATE INDEX idx_asset_people_person_id ON asset_people(person_id)",
        """
        CREATE TABLE albums (
            id INTEGER PRIMARY KEY,
            library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
            uuid TEXT NOT NULL,
            title TEXT,
            folder_names TEXT,
            UNIQUE (library_id, uuid)
        )
        """,
        "CREATE INDEX idx_albums_library_id ON albums(library_id)",
        """
        CREATE TABLE asset_albums (
            asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (asset_id, album_id)
        )
        """,
        "CREATE INDEX idx_asset_albums_album_id ON asset_albums(album_id)",
    ],
    # 9: one-time invite links (P1.10 admin UI). `id` is the sha256 hash of
    # the invite code, the same scheme `sessions.id` uses for the cookie --
    # the raw code is shown to the admin once, at creation, and never
    # stored. `used_at` is what makes accepting it a one-time action.
    [
        """
        CREATE TABLE invites (
            id TEXT PRIMARY KEY,
            role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL,
            used_at TEXT
        )
        """,
    ],
    # 10 (P1.12A): `date_created`/`date_added`/`date_modified` move to a
    # single documented format (UTC ISO-8601) -- see `indexer.py`'s
    # `_to_utc_isoformat`. `date_created_local_day` keeps the photo's own
    # capture-location calendar day (osxphotos' `photo.date` carries the
    # photo's own tzoffset; UTC alone would push a late-evening photo onto
    # the next day) for `library_assets.py`'s summary buckets and from/to
    # filters. `index_state`/`index_error` let an indexing job that now runs
    # in the background (P1.12A) report progress instead of failing the
    # request that happened to trigger it.
    [
        "ALTER TABLE assets ADD COLUMN date_created_local_day TEXT",
        "ALTER TABLE libraries ADD COLUMN index_state TEXT NOT NULL DEFAULT 'idle'",
        "ALTER TABLE libraries ADD COLUMN index_error TEXT",
    ],
    # 11 (P1.12B): `sessions.public_id` is an opaque, random id -- what the
    # admin's Sessions screen shows and revokes by -- distinct from
    # `sessions.id`, the sha256 hash used to look a session up from its
    # cookie. Backfilling it for already-existing rows keeps a session
    # created before this migration revocable too. `users.layout_override`
    # is that user's chosen layout (desktop vs. mobile), stored server-side
    # so it follows them across devices; the browser's localStorage copy is
    # only a fast default while this loads.
    [
        "ALTER TABLE sessions ADD COLUMN public_id TEXT",
        "UPDATE sessions SET public_id = lower(hex(randomblob(16))) WHERE public_id IS NULL",
        "CREATE UNIQUE INDEX idx_sessions_public_id ON sessions(public_id)",
        "ALTER TABLE users ADD COLUMN layout_override TEXT",
    ],
    # 12 (P1.15): video duration, in seconds, for the desktop Library grid's
    # hover overlay. Comes from `photo.exif_info.duration` (the Photos
    # database's own `ZDURATION`, already loaded with the rest of the
    # library's metadata -- no extra query, no file read).
    [
        "ALTER TABLE assets ADD COLUMN duration REAL",
    ],
]


def data_dir_from_env() -> pathlib.Path:
    """`$PHOTOS_VIEWER_DATA_DIR`, or `./data` -- the one place that default
    lives, shared by the server (`session_auth.get_db`) and the `admin` CLI
    so both ever agree on which `app.db` they are looking at."""
    return pathlib.Path(os.environ.get(_DATA_DIR_ENV, "data"))


def db_path(data_dir: str | pathlib.Path) -> pathlib.Path:
    return pathlib.Path(data_dir) / "app.db"


def media_cache_dir(data_dir: str | pathlib.Path) -> pathlib.Path:
    """Where `media.get_or_generate()` writes generated thumbnails -- under
    the data dir, like `app.db` itself, and never inside a `.photoslibrary`."""
    return pathlib.Path(data_dir) / "media_cache"


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

    `PRAGMA user_version` is a plain read with no lock. On the overwhelming
    majority of calls -- every `connect()` after the first on an
    already-current `app.db` -- that read alone shows nothing pending, and
    this returns without ever taking the write lock. Only when a migration
    looks pending does it escalate to `BEGIN IMMEDIATE` and re-read
    `user_version`, in case another connection finished migrating between
    that first lock-free read and this one. The whole run from there --
    every pending migration plus the final `PRAGMA user_version` bump -- is
    one transaction, so a crash or error partway through leaves both the
    schema and the recorded version exactly as they were.
    """
    if conn.execute("PRAGMA user_version").fetchone()[0] >= len(_MIGRATIONS):
        return
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


def get_setting(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()


def write_audit_log(
    conn: sqlite3.Connection,
    action: str,
    *,
    user_id: int | None = None,
    library_id: int | None = None,
    asset_id: int | None = None,
    actor: str | None = None,
    detail: str | None = None,
) -> None:
    """Record one `audit_log` row and commit it.

    `user_id` is the user the action is *about* (whose lockout was cleared,
    who downloaded something); `actor` is who performed it, for the admin
    and CLI actions where that's a different party (see migration 4 above).
    """
    conn.execute(
        "INSERT INTO audit_log (user_id, library_id, asset_id, action, actor, detail) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, library_id, asset_id, action, actor, detail),
    )
    conn.commit()
