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

from . import search_index

_DATA_DIR_ENV = "PHOTOS_VIEWER_DATA_DIR"

# Each migration is a list of complete, individually-executed statements,
# not one `executescript` blob: `executescript` issues an implicit COMMIT
# before it runs, which would end the transaction `migrate()` holds open for
# the whole migration plus its `PRAGMA user_version` bump.
#
# A migration that adds a column only a fresh library walk can fill must also
# run `UPDATE libraries SET reindex_needed = 1 WHERE last_indexed_signature
# IS NOT NULL` (see 17, #100/#68): the background checker then re-indexes each
# such library once, in place, instead of waiting for the file to change.
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
    # 13 (P1.16): camera make/model for the Viewer's info panel, from
    # `photo.exif_info.camera_make`/`.camera_model` -- the same already-loaded
    # `exif_info` duration (migration 12) reads from.
    [
        "ALTER TABLE assets ADD COLUMN camera_make TEXT",
        "ALTER TABLE assets ADD COLUMN camera_model TEXT",
    ],
    # 14 (#91): osxphotos' overall aesthetic score (`photo.score.overall`),
    # so the mobile Years/Months summary tiles can rank a period's key
    # photos without re-deriving Apple's curation score at request time.
    [
        "ALTER TABLE assets ADD COLUMN score REAL",
    ],
    # 15 (#130): set by a successful password reconfirm, cleared on leaving
    # Hidden. The Hidden list is served only while it is in the future.
    [
        "ALTER TABLE sessions ADD COLUMN hidden_unlocked_until TEXT",
    ],
    # 16 (P1.22): library replacement. `pending_*` is a changed copy waiting
    # out the stability window or failing readiness; `missing_since` is a
    # package that disappeared. Neither ever deletes index rows -- users just
    # see "Being updated" until a valid copy is applied. `store_uuid` is the
    # Core Data store UUID (`Z_METADATA.Z_UUID`) at the last index.
    [
        "ALTER TABLE libraries ADD COLUMN pending_signature TEXT",
        "ALTER TABLE libraries ADD COLUMN pending_since TEXT",
        "ALTER TABLE libraries ADD COLUMN pending_reason TEXT",
        "ALTER TABLE libraries ADD COLUMN missing_since TEXT",
        "ALTER TABLE libraries ADD COLUMN store_uuid TEXT",
        """
        CREATE TABLE library_index_runs (
            id INTEGER PRIMARY KEY,
            library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
            trigger TEXT NOT NULL CHECK (trigger IN ('auto', 'admin', 'replace')),
            started_at TEXT NOT NULL,
            finished_at TEXT,
            outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'failed', 'not_ready', 'unchanged')),
            signature TEXT,
            store_uuid TEXT,
            asset_count INTEGER,
            added INTEGER,
            removed INTEGER,
            changed INTEGER,
            hidden_changed INTEGER,
            originals_missing INTEGER,
            error TEXT
        )
        """,
        "CREATE INDEX idx_library_index_runs_library ON library_index_runs(library_id, id)",
    ],
    # 17 (#100): migrations 12-14 added asset columns (duration, camera,
    # score) that only a fresh walk can fill. Flag every already-indexed
    # library so the background checker re-indexes it once, in place (the
    # library stays served meanwhile), instead of leaving the new columns
    # NULL until the library file next changes.
    [
        "ALTER TABLE libraries ADD COLUMN reindex_needed INTEGER NOT NULL DEFAULT 0",
        "UPDATE libraries SET reindex_needed = 1 WHERE last_indexed_signature IS NOT NULL",
    ],
    # 18 (P2.1): the folder tree. `folders` comes from `PhotosDB.folder_info`
    # (recursive via `subfolders`); `albums` gains its parent folder's uuid
    # (NULL = top level) and Photos' own sidebar order. Nothing here can be
    # derived from rows indexed before, so every indexed library is flagged
    # for the one-time in-place re-index (see the note above `_MIGRATIONS`).
    [
        """
        CREATE TABLE folders (
            id INTEGER PRIMARY KEY,
            library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
            uuid TEXT NOT NULL,
            title TEXT,
            parent_uuid TEXT,
            list_order INTEGER NOT NULL DEFAULT 0,
            UNIQUE (library_id, uuid)
        )
        """,
        "CREATE INDEX idx_folders_library_id ON folders(library_id)",
        "ALTER TABLE albums ADD COLUMN parent_uuid TEXT",
        "ALTER TABLE albums ADD COLUMN list_order INTEGER NOT NULL DEFAULT 0",
        "UPDATE libraries SET reindex_needed = 1 WHERE last_indexed_signature IS NOT NULL",
    ],
    # 19 (P2.2): face rectangles, so People can show a circular crop of a
    # person's best visible face. Coordinates are normalized to the
    # displayed (EXIF-oriented) image, top-left origin: x/y the face centre,
    # w/h its size as a fraction of the image width/height. Not derivable
    # from rows indexed before, so every indexed library is flagged for the
    # one-time in-place re-index.
    [
        """
        CREATE TABLE faces (
            id INTEGER PRIMARY KEY,
            person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
            asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            x REAL NOT NULL,
            y REAL NOT NULL,
            w REAL NOT NULL,
            h REAL NOT NULL,
            quality REAL NOT NULL DEFAULT 0
        )
        """,
        "CREATE INDEX idx_faces_person_id ON faces(person_id)",
        "CREATE INDEX idx_faces_asset_id ON faces(asset_id)",
        "UPDATE libraries SET reindex_needed = 1 WHERE last_indexed_signature IS NOT NULL",
    ],
    # 20 (P2.3): the map's cluster query scans one library's visible, located
    # assets; this lets it do that from the index instead of the whole table.
    [
        "CREATE INDEX IF NOT EXISTS idx_assets_location ON assets(library_id, hidden, latitude, longitude)",
    ],
    # 21 (P2.4): Apple's on-device scene/object labels (and a few other
    # search_info fields) for Search. Rebuilt per asset on every re-index. Not
    # derivable from rows indexed before, so flag every indexed library for
    # the one-time in-place re-index.
    [
        """
        CREATE TABLE asset_labels (
            asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            label_normalized TEXT NOT NULL,
            PRIMARY KEY (asset_id, label_normalized)
        )
        """,
        "UPDATE libraries SET reindex_needed = 1 WHERE last_indexed_signature IS NOT NULL",
    ],
    # 22 (P3.1): WebAuthn passkeys beside the password, and the single-use
    # server-side challenges their ceremonies need. `credential_id` is the
    # authenticator's id (what `navigator.credentials.get` returns); `public_id`
    # is the opaque id the API shows, so the credential id is never a URL.
    [
        """
        CREATE TABLE passkeys (
            id INTEGER PRIMARY KEY,
            public_id TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            credential_id BLOB NOT NULL UNIQUE,
            public_key BLOB NOT NULL,
            sign_count INTEGER NOT NULL DEFAULT 0,
            transports TEXT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_used_at TEXT
        )
        """,
        "CREATE INDEX idx_passkeys_user_id ON passkeys(user_id)",
        """
        CREATE TABLE passkey_challenges (
            id TEXT PRIMARY KEY,
            purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
            challenge BLOB NOT NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL
        )
        """,
    ],
    # 23 (P3.3): one resumable thumbnail pre-warm job per library. The cursor
    # is the last asset uuid handled (uuids sort stably across a re-index,
    # row ids do not); progress is derived from it, so a killed process
    # resumes from here and the cache itself is the "already done" record.
    [
        """
        CREATE TABLE prewarm_jobs (
            library_id INTEGER PRIMARY KEY REFERENCES libraries(id) ON DELETE CASCADE,
            state TEXT NOT NULL CHECK (state IN ('running', 'paused', 'done')),
            cursor_uuid TEXT,
            total INTEGER NOT NULL DEFAULT 0,
            failed INTEGER NOT NULL DEFAULT 0,
            note TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """,
    ],
    # 24 (D4/D5): `added_visible`/`removed_visible` are a run's counts without
    # Hidden photos (they feed the user-facing "Library updated" banner, which
    # must never reveal Hidden); NULL on runs recorded before this. Dismissals
    # are per user and library: everything up to `run_id` is dismissed.
    # `assets.original_missing` is the Optimize Mac Storage flag the indexer
    # already computed per run, now kept per asset; only a fresh walk can
    # fill it, so indexed libraries are flagged for the one-time re-index.
    [
        "ALTER TABLE library_index_runs ADD COLUMN added_visible INTEGER",
        "ALTER TABLE library_index_runs ADD COLUMN removed_visible INTEGER",
        """
        CREATE TABLE library_note_dismissals (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
            run_id INTEGER NOT NULL,
            PRIMARY KEY (user_id, library_id)
        )
        """,
        "ALTER TABLE assets ADD COLUMN original_missing INTEGER NOT NULL DEFAULT 0",
        "UPDATE libraries SET reindex_needed = 1 WHERE last_indexed_signature IS NOT NULL",
    ],
    # 24: D41 offline place names, kept apart from Apple's own `place*` columns.
    [
        "ALTER TABLE assets ADD COLUMN place_offline TEXT",
    ],
    # 25: D36 full-text search index, filled by the indexer (see search_index).
    # Existing indexes get it through the one-time in-place re-index (D11);
    # until then Search scans, as before.
    [
        search_index.TABLE_SQL,
        """
        CREATE TRIGGER assets_fts_delete AFTER DELETE ON assets BEGIN
            DELETE FROM assets_fts WHERE rowid = old.id;
        END
        """,
        "UPDATE libraries SET reindex_needed = 1 WHERE last_indexed_signature IS NOT NULL",
    ],
    # 26 (#256): a user's own avatar. The picture is a small JPEG under the
    # data dir (never in a library); this is its version, NULL = no avatar.
    [
        "ALTER TABLE users ADD COLUMN avatar_version INTEGER",
    ],
    # 27: "Shared with You" (Photos 7+ syndication), for the Filter menu.
    # Filled by the indexer, so existing libraries re-index once.
    [
        "ALTER TABLE assets ADD COLUMN is_syndicated INTEGER NOT NULL DEFAULT 0",
        "UPDATE libraries SET reindex_needed = 1 WHERE last_indexed_signature IS NOT NULL",
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


# D41 / Decisions 5: nothing talks to OpenStreetMap or GeoNames until an admin
# has agreed, once, to "Map & place names". The stored value is "1" (agreed) or
# "0" (answered "Not now" or declined); no row means the question has not been
# answered, which counts as not agreed.
OSM_CONSENT_KEY = "osm_consent"
PMTILES_PATH_KEY = "map_tiles_pmtiles_path"


def get_setting(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()


def osm_consent(conn: sqlite3.Connection) -> bool:
    return get_setting(conn, OSM_CONSENT_KEY) == "1"


def osm_consent_decided(conn: sqlite3.Connection) -> bool:
    return get_setting(conn, OSM_CONSENT_KEY) in ("0", "1")


def map_pmtiles_path(conn: sqlite3.Connection) -> str | None:
    return get_setting(conn, PMTILES_PATH_KEY) or None


def effective_map_mode(conn: sqlite3.Connection) -> str:
    """Derived, never stored. With consent the browser draws OpenStreetMap
    tiles (a configured PMTiles file is only the fallback). Without consent
    a configured PMTiles file is used, since reading it needs no outbound
    connection; with none the map is off."""
    if osm_consent(conn):
        return "online"
    return "local_file" if map_pmtiles_path(conn) else "off"


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
