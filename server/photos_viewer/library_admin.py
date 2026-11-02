"""Admin-only API for the library registry (P1.5): add, list, rename, remove,
and report status for each registered `.photoslibrary`. API only -- P1.10
builds the admin UI against these routes.

Only `libraries.py` touches a `.photoslibrary` path; this module calls its
public functions (`open_library_readonly`, `library_is_locked`) rather than
opening anything itself. `total_size_bytes` is the one exception -- it walks
the package directory for file sizes, not its database.

Asset/video/people counts and last-index time come from the P1.6 index in
`app.db`, via `indexer.index_library`; pre-warm progress depends on P3.3 and
is always `null` until that lands.

A status check also re-indexes a library whose underlying sqlite file has
changed since the last index -- the "re-index when the sqlite file changes"
half of P1.6. `indexer.index_library` makes that cheap: it's a handful of
`stat()` calls, not a walk, whenever nothing has actually changed. The
"re-index when an admin asks" half is `POST .../reindex` below.
"""

from __future__ import annotations

import logging
import os
import pathlib
import sqlite3
import threading

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from . import app_db, indexer, libraries, session_auth
from .libraries import UnsupportedPhotosVersionError, open_library_readonly

logger = logging.getLogger(__name__)

router = APIRouter()

# One `threading.Lock` per library id, so at most one indexing job -- the
# backgrounded one from `add_library`/a status-triggered re-index, or the
# synchronous one from `POST .../reindex` -- runs for a given library at a
# time. `_library_locks_guard` only protects the dict's own get-or-create;
# the per-library lock itself serializes the indexing work.
_library_locks: dict[int, threading.Lock] = {}
_library_locks_guard = threading.Lock()


def _lock_for(library_id: int) -> threading.Lock:
    with _library_locks_guard:
        lock = _library_locks.get(library_id)
        if lock is None:
            lock = threading.Lock()
            _library_locks[library_id] = lock
        return lock


class LibraryAddRequest(BaseModel):
    path: str
    display_name: str | None = Field(default=None, min_length=1, max_length=255)


class LibraryRenameRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=255)


class LibraryResponse(BaseModel):
    id: int
    display_name: str
    path: str
    created_at: str


class LibraryWarning(BaseModel):
    code: str
    message: str


class LibraryStatusResponse(BaseModel):
    id: int
    display_name: str
    path: str
    asset_count: int | None = None
    video_count: int | None = None
    people_count: int | None = None
    total_size_bytes: int | None = None
    last_indexed_at: str | None = None
    index_state: str | None = None
    index_error: str | None = None
    prewarm_progress: float | None = None
    warnings: list[LibraryWarning]


def _validate_library_path(path: pathlib.Path) -> None:
    """Raise a 400 with an admin-facing message for a bad path, a missing
    mount, an unsupported Photos version, or an unreadable library. Returns
    normally only when `path` is a readable, supported `.photoslibrary`."""
    if not path.exists():
        if not path.parent.exists():
            raise HTTPException(
                status_code=400,
                detail=f"{path.parent} does not exist -- is the drive mounted?",
            )
        raise HTTPException(status_code=400, detail=f"{path} does not exist")
    if path.suffix != ".photoslibrary":
        raise HTTPException(status_code=400, detail=f"{path} does not end in .photoslibrary")
    if not path.is_dir():
        raise HTTPException(status_code=400, detail=f"{path} is not a .photoslibrary package")
    if not os.access(path, os.R_OK | os.X_OK):
        raise HTTPException(status_code=400, detail=f"{path} is not readable")
    try:
        opened = open_library_readonly(path)
    except UnsupportedPhotosVersionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"could not open {path} as a Photos library: {exc}") from exc
    else:
        opened.close()


def _default_display_name(path: pathlib.Path) -> str:
    return path.stem


def _to_response(row: sqlite3.Row) -> LibraryResponse:
    return LibraryResponse(id=row["id"], display_name=row["display_name"], path=row["path"], created_at=row["created_at"])


def _get_library_or_404(db: sqlite3.Connection, library_id: int) -> sqlite3.Row:
    row = db.execute("SELECT * FROM libraries WHERE id = ?", (library_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


def _total_size_bytes(db: sqlite3.Connection, library_id: int, path: pathlib.Path) -> int | None:
    """The sum of `assets.original_filesize` from the index, not a fresh
    filesystem walk of a package that can be terabytes. Still `None` when
    the drive is unmounted -- a SQL sum alone would silently keep returning
    the last-good total for a library whose directory just vanished."""
    if not path.exists():
        return None
    total = db.execute(
        "SELECT SUM(original_filesize) FROM assets WHERE library_id = ?", (library_id,)
    ).fetchone()[0]
    return total or 0


def _warnings_for(path: pathlib.Path) -> list[LibraryWarning]:
    if not path.exists():
        return [
            LibraryWarning(
                code="drive_not_mounted",
                message=f"{path} is not reachable -- is the drive mounted?",
            )
        ]
    warnings: list[LibraryWarning] = []
    if libraries.library_is_locked(path):
        warnings.append(
            LibraryWarning(
                code="library_open",
                message="Photos.app (or another process) currently has this library open",
            )
        )
    try:
        opened = open_library_readonly(path)
    except UnsupportedPhotosVersionError as exc:
        warnings.append(LibraryWarning(code="unsupported_version", message=str(exc)))
    except Exception as exc:  # noqa: BLE001 -- any open failure becomes a status warning, not a 500
        warnings.append(LibraryWarning(code="unreadable", message=f"{path} could not be opened: {exc}"))
    else:
        opened.close()
    return warnings


def _mark_indexing(db: sqlite3.Connection, library_id: int) -> None:
    db.execute("UPDATE libraries SET index_state = 'indexing', index_error = NULL WHERE id = ?", (library_id,))
    db.commit()


def _mark_indexed(db: sqlite3.Connection, library_id: int) -> None:
    db.execute("UPDATE libraries SET index_state = 'idle', index_error = NULL WHERE id = ?", (library_id,))
    db.commit()


def _mark_index_error(db: sqlite3.Connection, library_id: int, error: str) -> None:
    db.execute("UPDATE libraries SET index_state = 'error', index_error = ? WHERE id = ?", (error, library_id))
    db.commit()


def _run_index_job(data_dir: pathlib.Path, library_id: int, path: pathlib.Path, *, force: bool) -> None:
    """Runs on its own `app.db` connection -- the request's `get_db`
    connection is closed before a `BackgroundTasks` callback runs, and in
    production a fresh connection is handed out per request, so a job that
    outlives the request cannot borrow it.

    Takes the per-library lock itself, once the job actually starts, rather
    than at scheduling time: a `BackgroundTasks` callback that FastAPI never
    ends up running (e.g. the request errored before returning) used to
    leave the lock held forever, wedging every later reindex for that
    library. A non-blocking acquire here is also the "already running, skip
    this trigger" check `_schedule_index_job` used to do."""
    lock = _lock_for(library_id)
    if not lock.acquire(blocking=False):
        return
    conn = app_db.connect(data_dir)
    try:
        _mark_indexing(conn, library_id)
        indexer.index_library(conn, library_id, path, force=force)
        _mark_indexed(conn, library_id)
    except Exception as exc:
        _mark_index_error(conn, library_id, str(exc))
        logger.warning("background index of library %s (%s) failed", library_id, path, exc_info=True)
    finally:
        conn.close()
        lock.release()


def _schedule_index_job(
    background_tasks: BackgroundTasks,
    data_dir: pathlib.Path,
    library_id: int,
    path: pathlib.Path,
    *,
    force: bool,
) -> None:
    background_tasks.add_task(_run_index_job, data_dir, library_id, path, force=force)


def reset_stale_indexing_state(conn: sqlite3.Connection) -> None:
    """Self-heals a library stuck showing `index_state = 'indexing'` because
    the process that was running its job died (crash, kill, restart) without
    reaching `_mark_indexed`/`_mark_index_error`. The per-library lock lives
    only in this process's memory, so after a restart it is never actually
    held; any library whose lock is free but whose stored state still says
    "indexing" was abandoned mid-job, not genuinely in progress. Safe to call
    on every process start: a live job holds its lock, so this skips it."""
    rows = conn.execute("SELECT id FROM libraries WHERE index_state = 'indexing'").fetchall()
    for row in rows:
        lock = _lock_for(row["id"])
        if lock.acquire(blocking=False):
            try:
                _mark_index_error(conn, row["id"], "indexing was interrupted and did not finish")
            finally:
                lock.release()


def _maybe_reindex(
    background_tasks: BackgroundTasks, data_dir: pathlib.Path, row: sqlite3.Row, path: pathlib.Path
) -> None:
    """Schedule a background re-index when the sqlite file changed since the
    last index, so a status poll returns immediately instead of blocking on
    a walk. A no-op, including on a missing/unreadable library, stays silent
    here -- `_warnings_for` already opens the library itself and surfaces any
    "unreadable"/"unsupported_version" problem as a status warning."""
    if not path.exists():
        return
    if indexer.sqlite_signature(path) == row["last_indexed_signature"]:
        return
    _schedule_index_job(background_tasks, data_dir, row["id"], path, force=False)


def _index_counts(db: sqlite3.Connection, library_id: int, last_indexed_at: str | None) -> dict:
    if last_indexed_at is None:
        return {"asset_count": None, "video_count": None, "people_count": None}
    return {
        "asset_count": db.execute("SELECT COUNT(*) FROM assets WHERE library_id = ?", (library_id,)).fetchone()[0],
        "video_count": db.execute(
            "SELECT COUNT(*) FROM assets WHERE library_id = ? AND is_video = 1", (library_id,)
        ).fetchone()[0],
        "people_count": db.execute("SELECT COUNT(*) FROM people WHERE library_id = ?", (library_id,)).fetchone()[0],
    }


def _build_status(
    background_tasks: BackgroundTasks, data_dir: pathlib.Path, db: sqlite3.Connection, row: sqlite3.Row
) -> LibraryStatusResponse:
    path = pathlib.Path(row["path"])
    _maybe_reindex(background_tasks, data_dir, row, path)
    row = _get_library_or_404(db, row["id"])
    return LibraryStatusResponse(
        id=row["id"],
        display_name=row["display_name"],
        path=row["path"],
        total_size_bytes=_total_size_bytes(db, row["id"], path),
        last_indexed_at=row["last_indexed_at"],
        index_state=row["index_state"],
        index_error=row["index_error"],
        warnings=_warnings_for(path),
        **_index_counts(db, row["id"], row["last_indexed_at"]),
    )


@router.post(
    "/api/admin/libraries",
    response_model=LibraryResponse,
    status_code=201,
    dependencies=[Depends(session_auth._reject_cross_site_requests)],
)
def add_library(
    payload: LibraryAddRequest,
    background_tasks: BackgroundTasks,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    data_dir: pathlib.Path = Depends(session_auth.get_data_dir),
) -> LibraryResponse:
    path = pathlib.Path(payload.path)
    _validate_library_path(path)
    display_name = payload.display_name or _default_display_name(path)
    try:
        cursor = db.execute(
            "INSERT INTO libraries (display_name, path) VALUES (?, ?)",
            (display_name, str(path)),
        )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="this path is already registered") from exc
    library_id = cursor.lastrowid
    # The admin who registers a library can see it immediately, without a
    # separate trip to the access matrix; every other user still needs an
    # explicit grant there.
    db.execute(
        "INSERT OR IGNORE INTO library_assignments (user_id, library_id) VALUES (?, ?)",
        (admin["user_id"], library_id),
    )
    # Committed right away, before indexing is even scheduled: the initial
    # walk now runs in the background on its own connection, so a failure in
    # it can never roll back this INSERT and turn a bad library path into a
    # 500 that also loses the row.
    db.commit()
    app_db.write_audit_log(db, "add_library", library_id=library_id, actor=admin["username"], detail=str(path))
    _schedule_index_job(background_tasks, data_dir, library_id, path, force=True)
    return _to_response(_get_library_or_404(db, library_id))


@router.get("/api/admin/libraries", response_model=list[LibraryResponse])
def list_libraries(
    admin: sqlite3.Row = Depends(session_auth.require_admin), db: sqlite3.Connection = Depends(session_auth.get_db)
) -> list[LibraryResponse]:
    rows = db.execute("SELECT * FROM libraries ORDER BY id").fetchall()
    return [_to_response(row) for row in rows]


@router.patch(
    "/api/admin/libraries/{library_id}",
    response_model=LibraryResponse,
    dependencies=[Depends(session_auth._reject_cross_site_requests)],
)
def rename_library(
    library_id: int,
    payload: LibraryRenameRequest,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> LibraryResponse:
    _get_library_or_404(db, library_id)
    db.execute("UPDATE libraries SET display_name = ? WHERE id = ?", (payload.display_name, library_id))
    app_db.write_audit_log(db, "rename_library", library_id=library_id, actor=admin["username"], detail=payload.display_name)
    return _to_response(_get_library_or_404(db, library_id))


@router.delete(
    "/api/admin/libraries/{library_id}",
    status_code=204,
    dependencies=[Depends(session_auth._reject_cross_site_requests)],
)
def remove_library(
    library_id: int,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> None:
    """Drops the `libraries` row (and, via `ON DELETE CASCADE`, its
    assignments, indexed assets, and thumbnail-cache rows) from `app.db`.
    Never touches the `.photoslibrary` package itself."""
    row = _get_library_or_404(db, library_id)
    db.execute("DELETE FROM libraries WHERE id = ?", (library_id,))
    app_db.write_audit_log(
        db,
        "remove_library",
        actor=admin["username"],
        detail=f"id={library_id} display_name={row['display_name']!r} path={row['path']}",
    )


@router.get("/api/admin/libraries/{library_id}/status", response_model=LibraryStatusResponse)
def library_status(
    library_id: int,
    background_tasks: BackgroundTasks,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    data_dir: pathlib.Path = Depends(session_auth.get_data_dir),
) -> LibraryStatusResponse:
    row = _get_library_or_404(db, library_id)
    return _build_status(background_tasks, data_dir, db, row)


@router.post(
    "/api/admin/libraries/{library_id}/reindex",
    response_model=LibraryStatusResponse,
    dependencies=[Depends(session_auth._reject_cross_site_requests)],
)
def reindex_library(
    library_id: int,
    background_tasks: BackgroundTasks,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    data_dir: pathlib.Path = Depends(session_auth.get_data_dir),
) -> LibraryStatusResponse:
    """The "or when an admin asks" half of P1.6 -- forces a fresh walk even
    if the sqlite signature hasn't changed since the last index. Stays
    synchronous (unlike `add_library`/a status-triggered re-index) because
    its response body reports the fresh `asset_count` directly; it still
    takes the per-library lock so it can't run at the same time as a
    backgrounded job for the same library."""
    row = _get_library_or_404(db, library_id)
    path = pathlib.Path(row["path"])
    if not path.exists():
        raise HTTPException(status_code=400, detail=f"{path} is not reachable -- is the drive mounted?")
    lock = _lock_for(library_id)
    lock.acquire()
    try:
        _mark_indexing(db, library_id)
        indexer.index_library(db, library_id, path, force=True)
    except UnsupportedPhotosVersionError as exc:
        _mark_index_error(db, library_id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        _mark_index_error(db, library_id, str(exc))
        raise HTTPException(status_code=400, detail=f"could not re-index {path}: {exc}") from exc
    else:
        _mark_indexed(db, library_id)
    finally:
        lock.release()
    app_db.write_audit_log(db, "reindex_library", library_id=library_id, actor=admin["username"], detail=str(path))
    return _build_status(background_tasks, data_dir, db, _get_library_or_404(db, library_id))
