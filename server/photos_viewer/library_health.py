"""Why a library can't be read right now, in plain words (#461).

A connected drive can still fail in ways that look alike from `Path.exists()`:
macOS remounting the volume as `/Volumes/Name 1`, Full Disk Access (TCC)
being withdrawn after an update (EPERM/EACCES, which `Path.exists()` raises
instead of returning False on Python 3.12), a drive that is asleep or failing
(EIO, ETIMEDOUT), Photos on the Mac rewriting `Photos.sqlite` while we copy it,
or a full temp disk. This module tells those apart, so the admin page names
the real cause and the watcher knows which failures are worth a retry.

`probe_path` only uses `stat`, `scandir` and an `O_RDONLY` open that is closed
without reading, so it never writes to (or even reads the bytes of) a package.
"""

from __future__ import annotations

import dataclasses
import errno as errno_mod
import logging
import os
import pathlib
import sqlite3

logger = logging.getLogger("photos_viewer.library_health")

# Codes, shared with the admin UI (`web/src/admin/libraryStatus.ts`).
NOT_MOUNTED = "drive_not_mounted"
VOLUME_RENAMED = "volume_renamed"
LIBRARY_MISSING = "library_missing"
NO_PERMISSION = "no_permission"
DRIVE_ERROR = "drive_error"
PHOTOS_BUSY = "photos_busy"
TEMP_FULL = "temp_full"
UNSUPPORTED_VERSION = "unsupported_version"
UNREADABLE = "unreadable"
INCOMPLETE = "incomplete"

# Failures that clear up by themselves: keep serving the last good index and
# retry with backoff. Anything else is a problem with the library's contents.
TRANSIENT = frozenset(
    {NOT_MOUNTED, VOLUME_RENAMED, LIBRARY_MISSING, NO_PERMISSION, DRIVE_ERROR}
    | {PHOTOS_BUSY, TEMP_FULL}
)

MESSAGES = {
    NOT_MOUNTED: "The drive with this library isn't connected. Connect it, and the "
    "library comes back by itself.",
    VOLUME_RENAMED: "The drive is connected, but the Mac now shows it as {renamed}. "
    "That usually happens after the drive was unplugged without ejecting. Eject "
    "and reconnect the drive, or point this library at the new location.",
    LIBRARY_MISSING: "The drive is connected, but the library isn't where it used "
    "to be. It may have been moved or renamed.",
    NO_PERMISSION: "This app lost permission to read the drive. On the Mac, open "
    "System Settings > Privacy & Security > Full Disk Access and allow the app "
    "that runs this server (or Terminal / Python). The library comes back by "
    "itself afterwards.",
    DRIVE_ERROR: "The drive is connected but isn't answering. It may be asleep or "
    "busy. The app keeps showing the last copy it read and tries again.",
    PHOTOS_BUSY: "Photos on the Mac is updating this library. It will refresh when "
    "Photos is done. Until then everyone keeps seeing the photos as they were.",
    TEMP_FULL: "The server's disk is too full to read this library. Free up space "
    "on the disk that holds its temporary files.",
    UNSUPPORTED_VERSION: "This library was made by a version of Photos this app "
    "can't read yet.",
    UNREADABLE: "This library's database can't be read. Open it once in Photos on "
    "the Mac, quit Photos, and check again.",
    INCOMPLETE: "This copy of the library doesn't look complete yet.",
}


def message(code: str, **kwargs: str) -> str:
    return MESSAGES.get(code, MESSAGES[UNREADABLE]).format(**kwargs)


class LibraryBusyError(Exception):
    """`Photos.sqlite` changed while it was being copied, every time we tried:
    Photos (or `photolibraryd`) is writing to the library right now."""


@dataclasses.dataclass(frozen=True)
class PathProbe:
    code: str | None  # None = reachable and readable
    errno: int | None = None
    detail: str | None = None
    # VOLUME_RENAMED: where the same library is now.
    renamed_to: pathlib.Path | None = None

    @property
    def ok(self) -> bool:
        return self.code is None


_GONE = (errno_mod.ENOENT, errno_mod.ENOTDIR)
_DENIED = (errno_mod.EPERM, errno_mod.EACCES)


def _code_for_errno(err: int | None) -> str:
    if err in _GONE:
        return LIBRARY_MISSING
    if err in _DENIED:
        return NO_PERMISSION
    if err in (errno_mod.ENOSPC, errno_mod.EDQUOT):
        return TEMP_FULL
    return DRIVE_ERROR


def _renamed_volume(path: pathlib.Path) -> pathlib.Path | None:
    """macOS mounts a volume as `Name 1` (`Name 2`, ...) when `/Volumes/Name`
    is still taken, e.g. after an unclean unplug. Look for the same package
    under such a sibling of any ancestor."""
    parts = path.parts
    for depth in range(1, len(parts) - 1):
        ancestor = pathlib.Path(*parts[: depth + 1])
        rest = parts[depth + 1 :]
        for n in range(1, 10):
            candidate = ancestor.with_name(f"{ancestor.name} {n}").joinpath(*rest)
            try:
                if candidate.is_dir():
                    return candidate
            except OSError:
                continue
    return None


def _first_missing_ancestor_is_parent(path: pathlib.Path) -> bool:
    """True when the folder holding the package is there (the drive is
    mounted, the package itself is gone)."""
    try:
        os.stat(path.parent)
    except OSError:
        return False
    return True


def probe_path(path: str | pathlib.Path) -> PathProbe:
    """Is the package reachable and readable? Never raises."""
    path = pathlib.Path(path)
    try:
        os.stat(path)
    except OSError as exc:
        if exc.errno in _GONE:
            renamed = _renamed_volume(path)
            if renamed is not None:
                return PathProbe(VOLUME_RENAMED, exc.errno, str(exc), renamed)
            if _first_missing_ancestor_is_parent(path):
                return PathProbe(LIBRARY_MISSING, exc.errno, str(exc))
            return PathProbe(NOT_MOUNTED, exc.errno, str(exc))
        return PathProbe(_code_for_errno(exc.errno), exc.errno, str(exc))
    # macOS privacy (TCC) usually still allows `stat` and only refuses
    # listing or opening, so try both without reading a byte.
    try:
        with os.scandir(path) as entries:
            next(entries, None)
        fd = os.open(path / "database" / "Photos.sqlite", os.O_RDONLY)
        os.close(fd)
    except FileNotFoundError:
        return PathProbe(None)  # not a complete library: readiness checks say so
    except OSError as exc:
        return PathProbe(_code_for_errno(exc.errno), exc.errno, str(exc))
    return PathProbe(None)


def exists(path: str | pathlib.Path) -> bool:
    """`Path.exists()` that returns False instead of raising on EPERM/EIO."""
    try:
        os.stat(path)
    except OSError:
        return False
    return True


def _chain(exc: BaseException):
    seen: set[int] = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        yield exc
        exc = exc.__cause__ or exc.__context__


def error_errno(exc: BaseException) -> int | None:
    for item in _chain(exc):
        if isinstance(item, OSError) and item.errno is not None:
            return item.errno
    return None


def classify(exc: BaseException) -> str:
    """A problem code for an exception from opening or indexing a library."""
    from .libraries import UnsupportedPhotosVersionError

    for item in _chain(exc):
        if isinstance(item, UnsupportedPhotosVersionError):
            return UNSUPPORTED_VERSION
        if isinstance(item, LibraryBusyError):
            return PHOTOS_BUSY
        if isinstance(item, OSError) and item.errno is not None:
            return _code_for_errno(item.errno)
        if isinstance(item, sqlite3.OperationalError):
            text = str(item).lower()
            if "locked" in text or "busy" in text:
                return PHOTOS_BUSY
            if "disk is full" in text:
                return TEMP_FULL
            if "disk i/o error" in text:
                return DRIVE_ERROR
    return UNREADABLE


def log_problem(
    *,
    library_id: int | None,
    phase: str,
    path: str | pathlib.Path,
    code: str,
    err: int | None = None,
    detail: str | None = None,
) -> None:
    """One WARNING line per failure, meant to be grepped out of the server
    log: `library problem: id=3 phase=apply code=photos_busy errno=- ...`."""
    errname = errno_mod.errorcode.get(err, str(err)) if err is not None else "-"
    logger.warning(
        "library problem: id=%s phase=%s code=%s errno=%s path=%s detail=%s",
        library_id if library_id is not None else "-",
        phase,
        code,
        errname,
        path,
        (detail or "-").replace("\n", " ")[:300],
    )
