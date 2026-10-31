"""Open a `.photoslibrary` package read-only.

This is the only module that may receive a `.photoslibrary` path. It never
writes to, migrates, or repairs the package's database. It opens a copy of
`database/Photos.sqlite` (plus any `-wal`/`-shm`) made outside the package,
or, if that copy cannot be made, opens the file inside the package directly
in SQLite's `mode=ro`. There is no third "immutable=1" tier: osxphotos'
`sqlite_open_ro` (see `osxphotos/sqlite_utils.py`) always resolves `dbfile`
to a path and builds its own `mode=ro` URI from it, so a caller of
`PhotosDB(dbfile=...)` has no way to ask it for `immutable=1`.

osxphotos pin: 0.77.2 (see server/pyproject.toml). Its README support table
claims read support for Photos databases from macOS 10.15 Catalina (Photos
5) through the current macOS Photos (12), keyed by the Core Data model
version recorded in each library's `Z_METADATA` table. `SUPPORTED_PHOTOS_VERSIONS`
below mirrors the keys this installed osxphotos release actually has table
mappings for (`osxphotos._constants._DB_TABLE_NAMES`). Photos 1-4 (the
pre-Core-Data `database/photos.db` layout) are out of scope: this project
only targets libraries already migrated to Photos 5+.

Forbidden osxphotos helpers, all of which perform or exist only to enable
network I/O, and must never be called here or anywhere in this server:
`osxphotos.utils.get_latest_version`, `osxphotos.cli.common.check_version`,
`osxphotos.cli.selfupdate`, `osxphotos.cli.version`, `download_url_to_dir`.
Only `PhotosDB` and `PhotoInfo` are used to read a library.
"""

from __future__ import annotations

import dataclasses
import pathlib
import shutil
import tempfile

from osxphotos import PhotosDB

# Mirrors osxphotos._constants._DB_TABLE_NAMES keys for 0.77.2: the Photos
# database generations this installed osxphotos release has table mappings
# for. 9.6, 9.9, and 11.1 are intermediate model versions osxphotos
# distinguishes within Photos 9/9/11 respectively.
SUPPORTED_PHOTOS_VERSIONS = frozenset({5, 6, 7, 8, 9, 9.6, 9.9, 10, 11, 11.1, 12})


class UnsupportedPhotosVersionError(Exception):
    """A library's Photos database generation isn't one this osxphotos pin supports."""


def unsupported_version_message(photos_version) -> str:
    """Admin-facing text for an unsupported `photos_version`."""
    return (
        f"This library's Photos database version ({photos_version!r}) isn't "
        "one this server can read. Open it with a current version of "
        "Photos.app on a Mac first, or upgrade the server's osxphotos pin."
    )


def check_supported_version(photos_version) -> None:
    """Raise UnsupportedPhotosVersionError if osxphotos can't read this generation."""
    if photos_version not in SUPPORTED_PHOTOS_VERSIONS:
        raise UnsupportedPhotosVersionError(unsupported_version_message(photos_version))


@dataclasses.dataclass(frozen=True)
class OpenLibrary:
    db: PhotosDB
    library_path: pathlib.Path
    open_mode: str  # "copy" or "ro"


def open_library_readonly(package_path: str | pathlib.Path) -> OpenLibrary:
    """Open a `.photoslibrary` package for reading.

    Tries a temp copy of the sqlite files first (works even if Photos.app
    or a WAL checkpoint touches the originals mid-read). Falls back to
    opening the file inside the package directly, still `mode=ro`, if the
    copy can't be made (e.g. a read-only mount with no writable temp dir).
    """
    package_path = pathlib.Path(package_path)
    sqlite_path = package_path / "database" / "Photos.sqlite"

    try:
        tempdir = tempfile.mkdtemp(prefix="photos_viewer_")
        copy_path = pathlib.Path(tempdir) / "Photos.sqlite"
        shutil.copy2(sqlite_path, copy_path)
        for suffix in ("-wal", "-shm"):
            side = sqlite_path.with_name(sqlite_path.name + suffix)
            if side.exists():
                shutil.copy2(side, copy_path.with_name(copy_path.name + suffix))
        db = PhotosDB(dbfile=str(copy_path), library_path=str(package_path))
        open_mode = "copy"
    except OSError:
        db = PhotosDB(dbfile=str(sqlite_path), library_path=str(package_path))
        open_mode = "ro"

    check_supported_version(db.photos_version)
    return OpenLibrary(db=db, library_path=package_path, open_mode=open_mode)
