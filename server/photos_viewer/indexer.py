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

import json
import pathlib
import sqlite3

from . import libraries


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
        _file_signature(sqlite_path.with_name(sqlite_path.name + suffix)) for suffix in ("", "-wal", "-shm")
    )


def index_library(
    db: sqlite3.Connection,
    library_id: int,
    package_path: str | pathlib.Path,
    *,
    force: bool = False,
) -> bool:
    """Replace `library_id`'s rows in `app.db` with a fresh osxphotos walk
    of `package_path`.

    Returns `False` without opening the library at all when its sqlite
    signature matches the last successful index and `force` is not set --
    the idempotency P1.6 requires. Returns `True` after a completed
    (re-)index, whether or not it changed any row.
    """
    row = db.execute("SELECT last_indexed_signature FROM libraries WHERE id = ?", (library_id,)).fetchone()
    signature = sqlite_signature(package_path)
    if not force and row is not None and row["last_indexed_signature"] == signature:
        return False

    opened = libraries.open_library_readonly(package_path)
    try:
        _write_index_and_update_signature(db, library_id, opened.db, signature)
    finally:
        opened.close()
    return True


def _write_index_and_update_signature(
    db: sqlite3.Connection, library_id: int, photosdb, signature: str
) -> None:
    # `add_library` may already have an implicit transaction open (its own
    # `INSERT INTO libraries`, not yet committed) by the time it calls here,
    # and sqlite3 rejects a nested `BEGIN`. Only start one if we're not
    # already in one, so both callers -- mid-transaction or standalone --
    # end up with the walk and the signature update committed together.
    own_transaction = not db.in_transaction
    if own_transaction:
        db.execute("BEGIN IMMEDIATE")
    try:
        _write_index(db, library_id, photosdb)
        db.execute(
            "UPDATE libraries SET last_indexed_signature = ?, last_indexed_at = datetime('now') WHERE id = ?",
            (signature, library_id),
        )
    except BaseException:
        db.rollback()
        raise
    else:
        db.commit()


def _write_index(db: sqlite3.Connection, library_id: int, photosdb) -> None:
    # Deleting `assets`/`people`/`albums` cascades to the join tables
    # (`ON DELETE CASCADE`), so a re-index is a clean replace, not a
    # merge -- the fixture's single asset, inserted twice across two
    # index runs, must end up as one row, not two.
    db.execute("DELETE FROM assets WHERE library_id = ?", (library_id,))
    db.execute("DELETE FROM people WHERE library_id = ?", (library_id,))
    db.execute("DELETE FROM albums WHERE library_id = ?", (library_id,))

    person_ids: dict[str, int] = {}
    for person in photosdb.person_info:
        cursor = db.execute(
            "INSERT INTO people (library_id, uuid, name, display_name, face_count) VALUES (?, ?, ?, ?, ?)",
            (library_id, person.uuid, person.name, person.display_name, person.facecount),
        )
        person_ids[person.uuid] = cursor.lastrowid

    album_ids: dict[str, int] = {}
    for album in photosdb.album_info:
        cursor = db.execute(
            "INSERT INTO albums (library_id, uuid, title, folder_names) VALUES (?, ?, ?, ?)",
            (library_id, album.uuid, album.title, json.dumps(album.folder_names)),
        )
        album_ids[album.uuid] = cursor.lastrowid

    for photo in photosdb.photos():
        place = photo.place
        latitude, longitude = photo.location
        derivatives = photo.path_derivatives
        cursor = db.execute(
            """
            INSERT INTO assets (
                library_id, uuid, filename, original_filename, title, description,
                date_created, date_added, date_modified, favorite, hidden,
                is_video, is_live_photo, is_screenshot, is_selfie, is_portrait,
                is_panorama, is_hdr, is_slow_mo, is_burst, width, height,
                original_filesize, uti, uti_original, latitude, longitude,
                place, place_country_code, place_address,
                path_original, path_edited, path_derivative, path_raw,
                path_live_photo, path_edited_live_photo
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            """,
            (
                library_id,
                photo.uuid,
                photo.filename,
                photo.original_filename,
                photo.title,
                photo.description,
                photo.date.isoformat(),
                photo.date_added.isoformat() if photo.date_added else None,
                photo.date_modified.isoformat() if photo.date_modified else None,
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
            ),
        )
        asset_id = cursor.lastrowid

        for person in photo.person_info:
            person_id = person_ids.get(person.uuid)
            if person_id is not None:
                db.execute(
                    "INSERT OR IGNORE INTO asset_people (asset_id, person_id) VALUES (?, ?)",
                    (asset_id, person_id),
                )

        for album in photo.album_info:
            album_id = album_ids.get(album.uuid)
            if album_id is not None:
                db.execute(
                    "INSERT OR IGNORE INTO asset_albums (asset_id, album_id) VALUES (?, ?)",
                    (asset_id, album_id),
                )
