"""Walks one library with osxphotos and writes the result into `app.db`
(P1.6). This is the only other module, besides `libraries.py` itself, that
opens a `.photoslibrary` path -- and it only ever does so through
`libraries.open_library_readonly`.

A `PhotosDB` instance holds the whole library's metadata in memory (see
`docs/PRIOR_ART.md`); `index_library` builds one for the life of a single
index run and drops it (via `OpenLibrary.close()`) before returning. It is
never kept as a process-wide singleton, and nothing on the request path
calls `PhotosDB.query` -- every read after indexing goes through `app.db`.
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import pathlib
import sqlite3

from . import libraries, media

logger = logging.getLogger(__name__)

# osxphotos' placeholder name for an unnamed face cluster. Kept local rather
# than importing the private osxphotos._constants; a test pins the value.
_UNKNOWN_PERSON = "_UNKNOWN_"

# `assets` columns written by `_write_index`, excluding `id` (assigned by
# sqlite) and `library_id`/`uuid` (the upsert's conflict key, set once).
_ASSET_COLUMNS = (
    "filename",
    "original_filename",
    "title",
    "description",
    "date_created",
    "date_created_local_day",
    "date_added",
    "date_modified",
    "favorite",
    "hidden",
    "is_video",
    "is_live_photo",
    "is_screenshot",
    "is_selfie",
    "is_portrait",
    "is_panorama",
    "is_hdr",
    "is_slow_mo",
    "is_burst",
    "width",
    "height",
    "original_filesize",
    "uti",
    "uti_original",
    "latitude",
    "longitude",
    "place",
    "place_country_code",
    "place_address",
    "path_original",
    "path_edited",
    "path_derivative",
    "path_raw",
    "path_live_photo",
    "path_edited_live_photo",
    "duration",
    "camera_make",
    "camera_model",
    "score",
    "original_missing",
)


def _to_utc_isoformat(value: datetime.datetime | None) -> str | None:
    """One documented date format for `date_created`/`date_added`/
    `date_modified`: UTC ISO-8601 with a literal `Z`.

    osxphotos' `photo.date` carries the photo's own capture-location
    tzoffset, while `photo.date_added`/`photo.date_modified` carry the
    *indexing machine's* local tzoffset (`photos_datetime_local` in
    osxphotos' `photosdb.py`) -- three columns in different reference
    frames unless all three are converted to the same one here.
    """
    if value is None:
        return None
    return value.astimezone(datetime.UTC).isoformat().replace("+00:00", "Z")


def _local_day(value: datetime.datetime | None) -> str | None:
    """The photo's own capture-location calendar day, captured before the
    UTC conversion above so a late-evening photo buckets on the day its
    photographer saw, not the next day in UTC."""
    if value is None:
        return None
    return value.strftime("%Y-%m-%d")


def _file_signature(path: pathlib.Path) -> str:
    try:
        stat = path.stat()
    except OSError:
        return "absent"
    return f"{stat.st_mtime_ns}:{stat.st_size}"


def sqlite_signature(package_path: str | pathlib.Path) -> str:
    """A cheap fingerprint of `database/Photos.sqlite` plus its `-wal` and
    `-shm` sidecars, so a change still sitting in the WAL and not yet
    checkpointed into the main file still changes the signature."""
    sqlite_path = pathlib.Path(package_path) / "database" / "Photos.sqlite"
    return "|".join(
        _file_signature(sqlite_path.with_name(sqlite_path.name + suffix))
        for suffix in ("", "-wal", "-shm")
    )


def read_store_uuid(sqlite_path: pathlib.Path) -> str | None:
    """`Z_METADATA.Z_UUID`, the Core Data store UUID. A plain read on the
    temp copy (never the package); `None` when the column is absent."""
    try:
        conn = sqlite3.connect(f"{sqlite_path.resolve().as_uri()}?mode=ro", uri=True)
    except sqlite3.Error:
        return None
    try:
        row = conn.execute("SELECT Z_UUID FROM Z_METADATA LIMIT 1").fetchone()
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    return row[0] if row and row[0] else None


def _now_iso() -> str:
    return (
        datetime.datetime.now(datetime.UTC)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def index_library(
    db: sqlite3.Connection,
    library_id: int,
    package_path: str | pathlib.Path,
    *,
    force: bool = False,
    trigger: str = "admin",
    opened: libraries.OpenLibrary | None = None,
    cache_dir: str | pathlib.Path | None = None,
) -> bool:
    """Replace `library_id`'s rows in `app.db` with a fresh osxphotos walk
    of `package_path`.

    Returns `False` without opening the library at all when its sqlite
    signature matches the last successful index and `force` is not set --
    the idempotency P1.6 requires. Returns `True` after a completed
    (re-)index, whether or not it changed any row. A caller that already
    opened the library for readiness checks passes it as `opened`; this
    function closes it either way. After the commit, cache files of removed and
    changed assets are deleted from `cache_dir` (default: `media_cache/` next
    to `app.db`).
    """
    row = db.execute(
        "SELECT last_indexed_signature FROM libraries WHERE id = ?", (library_id,)
    ).fetchone()
    signature = sqlite_signature(package_path)
    if not force and row is not None and row["last_indexed_signature"] == signature:
        if opened is not None:
            opened.close()
        return False

    started_at = _now_iso()
    if opened is None:
        opened = libraries.open_library_readonly(package_path)
    try:
        purge, changed = _write_index_and_update_signature(
            db, library_id, opened, signature, trigger, started_at
        )
    finally:
        opened.close()
    _purge_cache(db, library_id, purge, cache_dir)
    if changed:
        _restart_prewarm(db, library_id)
    return True


def _restart_prewarm(db: sqlite3.Connection, library_id: int) -> None:
    """D54: a pre-warm that had finished starts again for what the update
    brought in. Best effort, like the cache purge: the index already applied."""
    from . import library_prewarm  # library_prewarm imports the asset routes

    try:
        library_prewarm.restart_finished_job(db, library_id)
    except Exception:
        logger.warning(
            "restarting pre-warm for library %s failed", library_id, exc_info=True
        )


def _purge_cache(
    db: sqlite3.Connection,
    library_id: int,
    uuids: list[str],
    cache_dir: str | pathlib.Path | None,
) -> None:
    """Best effort, after the commit: a leftover thumbnail is harmless (the
    LRU takes it), a failed purge must not fail an index that applied."""
    if not uuids:
        return
    if cache_dir is None:
        main = next(
            (
                r["file"]
                for r in db.execute("PRAGMA database_list")
                if r["name"] == "main"
            ),
            "",
        )
        if not main:
            return
        cache_dir = pathlib.Path(main).parent / "media_cache"
    for uuid in uuids:
        media.purge_asset_cache(pathlib.Path(cache_dir), library_id, uuid)


def _write_index_and_update_signature(
    db: sqlite3.Connection,
    library_id: int,
    opened: libraries.OpenLibrary,
    signature: str,
    trigger: str,
    started_at: str,
) -> tuple[list[str], bool]:
    """Returns the cache files to purge and whether the run changed anything."""
    # `add_library` may already have an implicit transaction open (its own
    # `INSERT INTO libraries`, not yet committed) by the time it calls here,
    # and sqlite3 rejects a nested `BEGIN`. Only start one if we're not
    # already in one, so both callers -- mid-transaction or standalone --
    # end up with the walk and the signature update committed together.
    own_transaction = not db.in_transaction
    if own_transaction:
        db.execute("BEGIN IMMEDIATE")
    try:
        counts, purge = _write_index(
            db,
            library_id,
            opened.db,
            batch_size=INDEX_BATCH_SIZE if own_transaction else None,
        )
        store_uuid = read_store_uuid(opened.sqlite_path) if opened.sqlite_path else None
        asset_count = db.execute(
            "SELECT COUNT(*) FROM assets WHERE library_id = ?", (library_id,)
        ).fetchone()[0]
        # Applying a valid copy also ends any "Being updated" state, in the
        # same commit as the new index.
        db.execute(
            "UPDATE libraries SET last_indexed_signature = ?, last_indexed_at = datetime('now'), "
            "store_uuid = ?, pending_signature = NULL, pending_since = NULL, pending_reason = NULL, "
            "missing_since = NULL, reindex_needed = 0 WHERE id = ?",
            (signature, store_uuid, library_id),
        )
        db.execute(
            "INSERT INTO library_index_runs (library_id, trigger, started_at, finished_at, outcome, signature, "
            "store_uuid, asset_count, added, removed, changed, hidden_changed, originals_missing, "
            "added_visible, removed_visible) "
            "VALUES (?, ?, ?, ?, 'applied', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                library_id,
                trigger,
                started_at,
                _now_iso(),
                signature,
                store_uuid,
                asset_count,
                counts["added"],
                counts["removed"],
                counts["changed"],
                counts["hidden_changed"],
                counts["originals_missing"],
                counts["added_visible"],
                counts["removed_visible"],
            ),
        )
    except BaseException:
        db.rollback()
        raise
    else:
        db.commit()
    changed = any(
        counts[key] for key in ("added", "removed", "changed", "hidden_changed")
    )
    return purge, changed


_UPSERT_ASSET_SQL = (
    "INSERT INTO assets (library_id, uuid, " + ", ".join(_ASSET_COLUMNS) + ") "
    "VALUES (?, ?, " + ", ".join(["?"] * len(_ASSET_COLUMNS)) + ") "
    "ON CONFLICT (library_id, uuid) DO UPDATE SET "
    + ", ".join(f"{column} = excluded.{column}" for column in _ASSET_COLUMNS)
)


# #69: assets per write transaction. The write lock is released between batches
# so logins and other writes get in during a multi-million-asset walk.
INDEX_BATCH_SIZE = 5000


_FACE_ERRORS = (
    KeyError,
    IndexError,
    TypeError,
    ValueError,
    AttributeError,
    ZeroDivisionError,
)


def _write_faces(
    db: sqlite3.Connection, asset_id: int, photo, person_ids: dict[str, int]
) -> None:
    """Face rectangles for the People cover crop. Photos stores a face in a
    bottom-left-origin frame of the unrotated image; `mwg_rs_area` is
    osxphotos' conversion to the displayed frame (centre x/y, size w/h)."""
    db.execute("DELETE FROM faces WHERE asset_id = ?", (asset_id,))
    try:
        faces = photo.face_info
    except _FACE_ERRORS:  # a malformed face row must not abort the whole index
        return
    for face in faces:
        face._photo = photo  # skips a per-face get_photo lookup
        try:
            person_id = person_ids.get(face.person_info.uuid)
            area = face.mwg_rs_area
        except _FACE_ERRORS:  # face without a person, or unreadable geometry
            continue
        if person_id is None or face.intrash or not (area.w > 0 and area.h > 0):
            continue
        db.execute(
            "INSERT INTO faces (person_id, asset_id, x, y, w, h, quality) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (person_id, asset_id, area.x, area.y, area.w, area.h, face.quality or 0),
        )


# `search_info` fields indexed besides the scene/object labels (Photos 8+
# fields are `[]` on older libraries). Detected text is deliberately not here:
# see docs/MANUAL_MAC_TESTS.md. `PhotoInfo.detected_text()` is never called.
_EXTRA_SEARCH_FIELDS = (
    "activities",
    "venues",
    "venue_types",
    "holidays",
    "season",
    "bodies_of_water",
    "pets",
    "landmarks",
)


def _write_labels(db: sqlite3.Connection, asset_id: int, photo) -> None:
    """Replace this asset's rows in `asset_labels`, so a label Photos no longer
    lists disappears on the next index."""
    db.execute("DELETE FROM asset_labels WHERE asset_id = ?", (asset_id,))
    found: dict[str, str] = {}
    try:
        for label, normalized in zip(
            photo.labels, photo.labels_normalized, strict=False
        ):
            found.setdefault(normalized, label)
        info = photo.search_info
        for field in _EXTRA_SEARCH_FIELDS:
            values = getattr(info, field, None) or []
            for value in [values] if isinstance(values, str) else values:
                if value:
                    found.setdefault(value.lower(), value)
    except (NotImplementedError, KeyError, AttributeError, TypeError):
        pass  # no search index (Photos 4, or none found): no labels
    db.executemany(
        "INSERT OR IGNORE INTO asset_labels (asset_id, label, label_normalized) VALUES (?, ?, ?)",
        [(asset_id, label, normalized) for normalized, label in found.items()],
    )


def _write_index(
    db: sqlite3.Connection, library_id: int, photosdb, *, batch_size: int | None = None
) -> tuple[dict[str, int], list[str]]:
    """`batch_size` commits (and re-opens the write transaction) every that
    many assets; None keeps everything in the caller's transaction. Deletion of
    vanished assets only happens after the whole walk, in the last batch with
    the signature update, so an interrupted pass never deletes anything and
    simply re-runs (the signature is unchanged until the end)."""
    # People/albums have no stability requirement of their own (nothing
    # outside this module keeps a foreign key to them across index runs),
    # so a clean replace -- cascading to `asset_people`/`asset_albums` via
    # `ON DELETE CASCADE` -- is simplest; the join rows are rebuilt below
    # against the (possibly pre-existing) stable asset ids.
    db.execute("DELETE FROM people WHERE library_id = ?", (library_id,))
    db.execute("DELETE FROM albums WHERE library_id = ?", (library_id,))
    db.execute("DELETE FROM folders WHERE library_id = ?", (library_id,))

    person_ids: dict[str, int] = {}
    for person in photosdb.person_info:
        cursor = db.execute(
            "INSERT INTO people (library_id, uuid, name, display_name, face_count) VALUES (?, ?, ?, ?, ?)",
            (
                library_id,
                person.uuid,
                # osxphotos spells "no name" as "_UNKNOWN_"; People omits those.
                None if person.name == _UNKNOWN_PERSON else person.name,
                person.display_name,
                person.facecount,
            ),
        )
        person_ids[person.uuid] = cursor.lastrowid

    # Folders nest; walk down from the top-level ones. `seen` guards against
    # a corrupt library whose parent links loop.
    seen_folders: set[str] = set()
    pending = [(folder, None) for folder in photosdb.folder_info]
    while pending:
        folder, parent_uuid = pending.pop()
        if folder.uuid in seen_folders:
            continue
        seen_folders.add(folder.uuid)
        db.execute(
            "INSERT INTO folders (library_id, uuid, title, parent_uuid, list_order) VALUES (?, ?, ?, ?, ?)",
            (
                library_id,
                folder.uuid,
                folder.title,
                parent_uuid,
                folder.library_list_order[-1],
            ),
        )
        pending.extend((child, folder.uuid) for child in folder.subfolders)

    album_ids: dict[str, int] = {}
    for album in photosdb.album_info:
        cursor = db.execute(
            "INSERT INTO albums (library_id, uuid, title, folder_names, parent_uuid, list_order) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                library_id,
                album.uuid,
                album.title,
                json.dumps(album.folder_names),
                album.parent.uuid if album.parent else None,
                album.library_list_order[-1],
            ),
        )
        album_ids[album.uuid] = cursor.lastrowid

    # Assets keep their `id` across a re-index (upsert by the library's
    # natural key, `(library_id, uuid)`, instead of delete + reinsert) so
    # `thumbnail_cache` rows, `audit_log.asset_id`, and the P1.9 keyset
    # cursor -- all of which carry `assets.id` -- stay valid. A temp table
    # of the uuids seen this walk lets the final cleanup delete only the
    # assets actually gone from the library, in one statement, without
    # building a giant `NOT IN (...)` parameter list.
    old_rows = {
        row["uuid"]: (
            row["path_edited"],
            row["date_modified"],
            row["original_filesize"],
            row["hidden"],
        )
        for row in db.execute(
            "SELECT uuid, path_edited, date_modified, original_filesize, hidden FROM assets WHERE library_id = ?",
            (library_id,),
        )
    }
    counts = {
        "added": 0,
        "removed": 0,
        "changed": 0,
        "hidden_changed": 0,
        "originals_missing": 0,
        "added_visible": 0,
        "removed_visible": 0,
    }
    purge: list[str] = []
    db.execute("CREATE TEMP TABLE _seen_asset_uuids (uuid TEXT PRIMARY KEY)")
    try:
        for walked, photo in enumerate(photosdb.photos(), start=1):
            if batch_size is not None and walked % batch_size == 0:
                db.commit()
                db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT INTO _seen_asset_uuids (uuid) VALUES (?)", (photo.uuid,))

            place = photo.place
            latitude, longitude = photo.location
            derivatives = photo.path_derivatives
            exif_info = photo.exif_info
            date_modified = _to_utc_isoformat(photo.date_modified)
            old = old_rows.get(photo.uuid)
            if old is None:
                counts["added"] += 1
                if not photo.hidden:
                    counts["added_visible"] += 1
            else:
                if old[:3] != (
                    photo.path_edited,
                    date_modified,
                    photo.original_filesize,
                ):
                    counts["changed"] += 1
                    purge.append(photo.uuid)
                if old[3] != int(photo.hidden):
                    counts["hidden_changed"] += 1
            # Optimize Mac Storage: no full-size original on disk, but a
            # derivative to fall back to.
            original_missing = bool(
                derivatives and not (photo.path and os.path.exists(photo.path))
            )
            counts["originals_missing"] += original_missing
            db.execute(
                _UPSERT_ASSET_SQL,
                (
                    library_id,
                    photo.uuid,
                    photo.filename,
                    photo.original_filename,
                    photo.title,
                    photo.description,
                    _to_utc_isoformat(photo.date),
                    _local_day(photo.date),
                    _to_utc_isoformat(photo.date_added),
                    date_modified,
                    int(photo.favorite),
                    int(photo.hidden),
                    int(photo.ismovie),
                    int(photo.live_photo),
                    int(photo.screenshot),
                    int(photo.selfie),
                    int(photo.portrait),
                    int(photo.panorama),
                    int(photo.hdr),
                    int(photo.slow_mo),
                    int(photo.burst),
                    photo.width,
                    photo.height,
                    photo.original_filesize,
                    photo.uti,
                    photo.uti_original,
                    latitude,
                    longitude,
                    place.name if place else None,
                    place.country_code if place else None,
                    place.address_str if place else None,
                    photo.path,
                    photo.path_edited,
                    derivatives[0] if derivatives else None,
                    photo.path_raw,
                    photo.path_live_photo,
                    photo.path_edited_live_photo,
                    exif_info.duration if exif_info else None,
                    exif_info.camera_make if exif_info else None,
                    exif_info.camera_model if exif_info else None,
                    photo.score.overall if photo.score else None,
                    int(original_missing),
                ),
            )
            asset_id = db.execute(
                "SELECT id FROM assets WHERE library_id = ? AND uuid = ?",
                (library_id, photo.uuid),
            ).fetchone()["id"]

            for person in photo.person_info:
                person_id = person_ids.get(person.uuid)
                if person_id is not None:
                    db.execute(
                        "INSERT OR IGNORE INTO asset_people (asset_id, person_id) VALUES (?, ?)",
                        (asset_id, person_id),
                    )
            _write_faces(db, asset_id, photo, person_ids)
            _write_labels(db, asset_id, photo)

            for album in photo.album_info:
                album_id = album_ids.get(album.uuid)
                if album_id is not None:
                    db.execute(
                        "INSERT OR IGNORE INTO asset_albums (asset_id, album_id) VALUES (?, ?)",
                        (asset_id, album_id),
                    )

        purge.extend(
            row["uuid"]
            for row in db.execute(
                "SELECT uuid FROM assets WHERE library_id = ? AND uuid NOT IN (SELECT uuid FROM _seen_asset_uuids)",
                (library_id,),
            )
        )
        counts["removed_visible"] = db.execute(
            "SELECT COUNT(*) FROM assets WHERE library_id = ? AND hidden = 0 "
            "AND uuid NOT IN (SELECT uuid FROM _seen_asset_uuids)",
            (library_id,),
        ).fetchone()[0]
        removed = db.execute(
            "DELETE FROM assets WHERE library_id = ? AND uuid NOT IN (SELECT uuid FROM _seen_asset_uuids)",
            (library_id,),
        )
        counts["removed"] = removed.rowcount
    finally:
        db.execute("DROP TABLE _seen_asset_uuids")
    return counts, purge
