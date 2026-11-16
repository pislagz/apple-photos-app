"""Open a `.photoslibrary` package read-only.

This is the only module that may receive a `.photoslibrary` path. It never
writes to, migrates, or repairs the package's database. It opens a copy of
`database/Photos.sqlite` (plus any `-wal`/`-shm` and the search index) made
outside the package, or, only if making that copy itself fails, opens the
file inside the package directly in SQLite's `mode=ro`. There is no third
"immutable=1" tier: osxphotos' `sqlite_open_ro` (see
`osxphotos/sqlite_utils.py`) always resolves `dbfile` to a path and builds
its own `mode=ro` URI from it, so a caller of `PhotosDB(dbfile=...)` has no
way to ask it for `immutable=1`. An error raised by `PhotosDB` itself (e.g.
an unsupported version, or a corrupt copy) is not a copy failure and
propagates rather than triggering the in-place fallback.

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
import errno
import logging
import os
import pathlib
import shutil
import sqlite3
import tempfile
import time
from typing import Literal, Self

from osxphotos import PhotosDB

from . import library_health
from .library_health import LibraryBusyError

logger = logging.getLogger(__name__)

TEMPDIR_PREFIX = "photos_viewer_"
# #461: Photos (photolibraryd, photoanalysisd) checkpoints its WAL into
# Photos.sqlite while the library is open. A copy taken across a checkpoint
# can be torn, so the main file's stat is compared before and after each copy.
COPY_ATTEMPTS = 3
COPY_RETRY_SECONDS = 2.0
# Free space wanted in the temp dir on top of the files' own size.
TEMP_SPACE_MARGIN_BYTES = 64 * 1024 * 1024

# Mirrors osxphotos._constants._DB_TABLE_NAMES keys for 0.77.2: the Photos
# database generations this installed osxphotos release has table mappings
# for. osxphotos represents `photos_version` as the int it parses the Core
# Data model version into (see `get_photos_version_from_model`); 9.6, 9.9,
# and 11.1 are the exceptions, used as float sub-versions to distinguish
# intermediate model versions osxphotos treats differently within Photos
# 9/9/11 respectively. Keep this set, the dependency comment above, and the
# docstring on this module in sync -- they describe the same support table.
SUPPORTED_PHOTOS_VERSIONS = frozenset({5, 6, 7, 8, 9, 9.6, 9.9, 10, 11, 11.1, 12})


class UnsupportedPhotosVersionError(Exception):
    """A library's Photos database generation isn't one this osxphotos pin supports."""


def unsupported_version_message(photos_version: float) -> str:
    """Admin-facing text for an unsupported `photos_version`."""
    return (
        f"This library's Photos database version ({photos_version!r}) isn't "
        "one this server can read. Open it with a current version of "
        "Photos.app on a Mac first, or upgrade the server's osxphotos pin."
    )


def check_supported_version(photos_version: float) -> None:
    """Raise UnsupportedPhotosVersionError if osxphotos can't read this generation."""
    if photos_version not in SUPPORTED_PHOTOS_VERSIONS:
        raise UnsupportedPhotosVersionError(unsupported_version_message(photos_version))


class TempSpaceError(OSError):
    """Not enough free space in the temp dir for a copy of the sqlite files."""


def _stat_key(path: pathlib.Path) -> tuple[int, int, int]:
    st = os.stat(path)
    return (st.st_ino, st.st_mtime_ns, st.st_size)


def _size_or_zero(path: pathlib.Path) -> int:
    try:
        return os.stat(path).st_size
    except FileNotFoundError:
        return 0


def _copy_size(sqlite_path: pathlib.Path) -> int:
    names = [sqlite_path.name, sqlite_path.name + "-wal", sqlite_path.name + "-shm"]
    total = sum(_size_or_zero(sqlite_path.with_name(n)) for n in names)
    search = sqlite_path.parent / "search"
    return total + sum(_size_or_zero(search / n) for n in ("psi.sqlite", "leo.sqlite"))


def _free_bytes(directory: str) -> int:
    return shutil.disk_usage(directory).free


def _check_temp_space(sqlite_path: pathlib.Path) -> None:
    temp_root = tempfile.gettempdir()
    needed = _copy_size(sqlite_path) + TEMP_SPACE_MARGIN_BYTES
    free = _free_bytes(temp_root)
    if free < needed:
        raise TempSpaceError(
            errno.ENOSPC,
            f"{temp_root} has {free // 2**20} MB free, the copy needs {needed // 2**20} MB",
        )


def _is_inside(filename: object, root: pathlib.Path) -> bool:
    if not isinstance(filename, str | os.PathLike):
        return False
    try:
        return pathlib.Path(filename).is_relative_to(root)
    except (TypeError, ValueError):
        return False


def _copy_once(sqlite_path: pathlib.Path, copy_path: pathlib.Path) -> bool:
    """One copy of the sqlite files; True if Photos.sqlite itself was left
    untouched while it was copied. WAL appends alone are fine: SQLite ignores
    a half-written trailing frame."""
    before = _stat_key(sqlite_path)
    shutil.copy2(sqlite_path, copy_path)
    for suffix in ("-wal", "-shm"):
        side = sqlite_path.with_name(sqlite_path.name + suffix)
        target = copy_path.with_name(copy_path.name + suffix)
        try:
            shutil.copy2(side, target)
        except FileNotFoundError:
            target.unlink(missing_ok=True)
    _copy_search_index(sqlite_path, copy_path)
    return _stat_key(sqlite_path) == before


def _copy_consistent(sqlite_path: pathlib.Path, copy_path: pathlib.Path) -> None:
    for attempt in range(COPY_ATTEMPTS):
        if _copy_once(sqlite_path, copy_path):
            return
        if attempt + 1 < COPY_ATTEMPTS:
            time.sleep(COPY_RETRY_SECONDS * (attempt + 1))
    raise LibraryBusyError(
        f"Photos.sqlite changed while it was being copied ({COPY_ATTEMPTS} tries): "
        "Photos is writing to this library"
    )


def cleanup_stale_tempdirs(max_age_seconds: float = 24 * 3600) -> int:
    """Delete temp copies left behind by a process that was killed mid-index.
    Each one can be gigabytes; enough of them fill the temp disk."""
    root = pathlib.Path(tempfile.gettempdir())
    removed = 0
    cutoff = time.time() - max_age_seconds
    try:
        entries = list(root.glob(TEMPDIR_PREFIX + "*"))
    except OSError:
        return 0
    for entry in entries:
        try:
            if entry.is_dir() and entry.stat().st_mtime < cutoff:
                shutil.rmtree(entry, ignore_errors=True)
                removed += 1
        except OSError:
            continue
    return removed


def _copy_search_index(sqlite_path: pathlib.Path, copy_path: pathlib.Path) -> None:
    """Copy `search/psi.sqlite` and `search/leo.sqlite`, if present, next to
    the copied database.

    osxphotos resolves the search index relative to whatever path it was
    given as `dbfile` (`pathlib.Path(self._dbfile).parent / "search"`), so in
    copy mode that's the temp dir, not the package -- without this, search
    silently finds nothing and osxphotos logs "could not find search db".
    Some library versions keep the index in `leo.sqlite` instead; copied if present.
    """
    search_dir = sqlite_path.parent / "search"
    for name in ("psi.sqlite", "leo.sqlite"):
        source = search_dir / name
        if library_health.exists(source):
            copy_search_dir = copy_path.parent / "search"
            copy_search_dir.mkdir(exist_ok=True)
            shutil.copy2(source, copy_search_dir / name)


@dataclasses.dataclass
class OpenLibrary:
    db: PhotosDB
    library_path: pathlib.Path
    open_mode: Literal["copy", "ro"]
    # The sqlite file `db` actually reads: the temp copy, or (only when the
    # copy failed) the in-package file. Readiness checks run on this path.
    sqlite_path: pathlib.Path | None = None
    _tempdir: str | None = dataclasses.field(default=None, repr=False)

    def close(self) -> None:
        """Delete the temp copy of the sqlite files, if one was made."""
        if self._tempdir is not None:
            shutil.rmtree(self._tempdir, ignore_errors=True)
            self._tempdir = None

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()


def library_is_locked(package_path: str | pathlib.Path) -> bool:
    """True if another process (Photos.app, `photoanalysisd`) currently
    holds `database/Photos.sqlite` open for writing.

    This is a best-effort admin-panel warning, not a safety check -- actual
    reads go through `open_library_readonly`'s temp copy. It cannot reuse
    osxphotos' own `sqlite_db_is_locked`: that opens the file with plain
    `mode=ro`, and on a WAL-mode database that still needs a `-shm`/`-wal`
    pair to exist for the shared-memory WAL index, so SQLite creates them if
    neither is present -- a write into the package on every status check.
    `immutable=1` tells SQLite nobody else will modify the file, so it skips
    the WAL and all locking entirely and reads the main db file directly,
    never touching `-shm`/`-wal`. The tradeoff is this can't detect every
    lock a plain `mode=ro` open would (immutable skips OS-level locking
    too), only a main db file left transiently inconsistent by an in-progress
    write.
    """
    sqlite_path = pathlib.Path(package_path) / "database" / "Photos.sqlite"
    if not library_health.exists(sqlite_path):
        return False
    uri = f"{sqlite_path.resolve().as_uri()}?mode=ro&immutable=1"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=1)
        try:
            conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
            ).fetchall()
        finally:
            conn.close()
    except sqlite3.Error:
        return True
    return False


def open_library_readonly(package_path: str | pathlib.Path) -> OpenLibrary:
    """Open a `.photoslibrary` package for reading.

    Tries a temp copy of the sqlite files first (works even if Photos.app
    or a WAL checkpoint touches the originals mid-read). Falls back to
    opening the file inside the package directly, still `mode=ro`, only if
    making that copy itself fails (e.g. a read-only mount with no writable
    temp dir) -- an error raised by `PhotosDB` on a successfully made copy is
    not a copy failure and must propagate, not be swallowed into a silent
    second open attempt against the original.

    The returned `OpenLibrary` owns the temp copy, if one was made. Call
    `close()` when done with it, or use it as a context manager.
    """
    package_path = pathlib.Path(package_path)
    sqlite_path = package_path / "database" / "Photos.sqlite"

    tempdir: str | None = None
    try:
        _check_temp_space(sqlite_path)
        tempdir = tempfile.mkdtemp(prefix=TEMPDIR_PREFIX)
        copy_path = pathlib.Path(tempdir) / "Photos.sqlite"
        _copy_consistent(sqlite_path, copy_path)
    except BaseException as exc:
        if tempdir is not None:
            shutil.rmtree(tempdir, ignore_errors=True)
            tempdir = None
        if not isinstance(exc, OSError):
            raise
        # A failure reading the package itself (no permission, drive gone or
        # not answering) would fail the in-place open too: report it as is.
        # Only a temp-side failure (full or unwritable temp dir) falls back.
        if exc.errno not in (errno.ENOSPC, errno.EDQUOT) and _is_inside(
            exc.filename, package_path
        ):
            raise
        library_health.log_problem(
            library_id=None,
            phase="copy",
            path=package_path,
            code=library_health.TEMP_FULL
            if exc.errno in (errno.ENOSPC, errno.EDQUOT)
            else "copy_failed",
            err=exc.errno,
            detail=f"{exc}; opening Photos.sqlite in place, read-only",
        )
        db = PhotosDB(dbfile=str(sqlite_path), library_path=str(package_path))
        open_mode = "ro"
        opened_sqlite = sqlite_path
    else:
        try:
            db = PhotosDB(dbfile=str(copy_path), library_path=str(package_path))
        except Exception:
            shutil.rmtree(tempdir, ignore_errors=True)
            raise
        open_mode = "copy"
        opened_sqlite = copy_path

    try:
        check_supported_version(db.photos_version)
    except UnsupportedPhotosVersionError:
        if tempdir is not None:
            shutil.rmtree(tempdir, ignore_errors=True)
        raise
    return OpenLibrary(
        db=db,
        library_path=package_path,
        open_mode=open_mode,
        sqlite_path=opened_sqlite,
        _tempdir=tempdir,
    )
