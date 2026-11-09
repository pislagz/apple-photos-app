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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from . import app_db, indexer, libraries, library_watch, session_auth
from .libraries import UnsupportedPhotosVersionError, open_library_readonly

logger = logging.getLogger(__name__)

router = APIRouter()

_lock_for = library_watch._lock_for


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


class RunSummary(BaseModel):
    id: int
    trigger: str
    started_at: str
    finished_at: str | None
    outcome: str
    asset_count: int | None
    added: int | None
    removed: int | None
    changed: int | None
    hidden_changed: int | None
    originals_missing: int
    originals_missing_pct: float
    error: str | None
    summary: str


OPTIMIZE_STORAGE_WARN_PCT = 5.0


def optimize_storage_message(missing: int, pct: float) -> str:
    return (
        f"{missing:,} photos ({pct:.0f}%) have no full-size original in this copy. "
        "'Optimize Mac Storage' is probably on; downloads will be lower quality."
    )


def _run_summary(row: sqlite3.Row) -> RunSummary:
    count = row["asset_count"] or 0
    missing = row["originals_missing"] or 0
    if row["outcome"] == "applied":
        text = f"Updated {row['finished_at']}: {row['added']} added, {row['removed']} removed, {row['changed']} changed"
    elif row["outcome"] == "failed":
        text = f"Update failed {row['finished_at']}: {row['error']}"
    else:
        text = f"Not ready {row['finished_at']}: {row['error']}"
    return RunSummary(
        id=row["id"],
        trigger=row["trigger"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        outcome=row["outcome"],
        asset_count=row["asset_count"],
        added=row["added"],
        removed=row["removed"],
        changed=row["changed"],
        hidden_changed=row["hidden_changed"],
        originals_missing=missing,
        originals_missing_pct=(100.0 * missing / count) if count else 0.0,
        error=row["error"],
        summary=text,
    )


def _recent_runs(db: sqlite3.Connection, library_id: int, limit: int = 10) -> list[RunSummary]:
    rows = db.execute(
        "SELECT * FROM library_index_runs WHERE library_id = ? ORDER BY id DESC LIMIT ?", (library_id, limit)
    ).fetchall()
    return [_run_summary(row) for row in rows]


class ReplaceSuggestion(BaseModel):
    path: str
    name: str
    message: str


def _suggest_replacement(db: sqlite3.Connection, path: pathlib.Path) -> ReplaceSuggestion | None:
    if path.exists():
        return None
    try:
        candidates = sorted(p for p in path.parent.iterdir() if p.suffix == ".photoslibrary" and p.is_dir())
    except OSError:
        return None
    registered = {pathlib.Path(r["path"]) for r in db.execute("SELECT path FROM libraries")}
    for candidate in candidates:
        if candidate not in registered:
            return ReplaceSuggestion(
                path=str(candidate),
                name=candidate.name,
                message=f"A new library appeared next to this one: {candidate.name}. Replace?",
            )
    return None


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
    updating: bool = False
    updating_reason: str | None = None
    last_update: RunSummary | None = None
    runs: list[RunSummary] = []
    # An unregistered package next to a missing one: the admin UI offers a
    # prefilled Replace. Never applied automatically.
    suggestion: ReplaceSuggestion | None = None


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
    if not (path / "database" / "Photos.sqlite").is_file():
        raise HTTPException(status_code=400, detail=f"{path} is not a Photos library (no database/Photos.sqlite inside)")
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
    """The sum of `assets.original_filesize` of non-hidden assets from the index
    (hidden assets appear in no count or summary), not a fresh
    filesystem walk of a package that can be terabytes. Still `None` when
    the drive is unmounted -- a SQL sum alone would silently keep returning
    the last-good total for a library whose directory just vanished."""
    if not path.exists():
        return None
    total = db.execute(
        "SELECT SUM(original_filesize) FROM assets WHERE library_id = ? AND hidden = 0", (library_id,)
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


_mark_indexing = library_watch.mark_indexing
_mark_indexed = library_watch.mark_indexed
_mark_index_error = library_watch.mark_index_error


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
    on every process start: a live job holds its lock, so this skips it.

    #73: also flags the library `reindex_needed`, so the background checker
    re-runs the index once (and clears the error) without an admin pressing
    Reindex. A library never indexed at all is picked up by the checker's
    normal pending path instead."""
    rows = conn.execute("SELECT id FROM libraries WHERE index_state = 'indexing'").fetchall()
    for row in rows:
        lock = _lock_for(row["id"])
        if lock.acquire(blocking=False):
            try:
                _mark_index_error(conn, row["id"], "indexing was interrupted and did not finish")
                conn.execute("UPDATE libraries SET reindex_needed = 1 WHERE id = ?", (row["id"],))
                conn.commit()
            finally:
                lock.release()


def _maybe_reindex(db: sqlite3.Connection, row: sqlite3.Row) -> None:
    """A status poll goes through the same stat-only pending / stability path
    as the background checker; it never indexes on the spot. A changed copy
    becomes `pending` and is applied by a later check (or "Index now")."""
    library_watch.observe(db, row["id"])


def _index_counts(db: sqlite3.Connection, library_id: int, last_indexed_at: str | None) -> dict:
    if last_indexed_at is None:
        return {"asset_count": None, "video_count": None, "people_count": None}
    return {
        "asset_count": db.execute(
            "SELECT COUNT(*) FROM assets WHERE library_id = ? AND hidden = 0", (library_id,)
        ).fetchone()[0],
        "video_count": db.execute(
            "SELECT COUNT(*) FROM assets WHERE library_id = ? AND is_video = 1 AND hidden = 0", (library_id,)
        ).fetchone()[0],
        "people_count": db.execute("SELECT COUNT(*) FROM people WHERE library_id = ?", (library_id,)).fetchone()[0],
    }


def _build_status(db: sqlite3.Connection, row: sqlite3.Row) -> LibraryStatusResponse:
    path = pathlib.Path(row["path"])
    _maybe_reindex(db, row)
    row = _get_library_or_404(db, row["id"])
    updating, updating_reason = library_watch.availability(row)
    runs = _recent_runs(db, row["id"])
    warnings = _warnings_for(path)
    if library_watch.pending_too_long(row):
        warnings.append(
            LibraryWarning(
                code="update_stuck",
                message=f"Being updated for over {library_watch.STALE_PENDING_HOURS} hours: {updating_reason}",
            )
        )
    last_applied = next((run for run in runs if run.outcome == "applied"), None)
    if last_applied and last_applied.originals_missing_pct >= OPTIMIZE_STORAGE_WARN_PCT:
        warnings.append(
            LibraryWarning(
                code="originals_missing",
                message=optimize_storage_message(last_applied.originals_missing, last_applied.originals_missing_pct),
            )
        )
    return LibraryStatusResponse(
        id=row["id"],
        display_name=row["display_name"],
        path=row["path"],
        total_size_bytes=_total_size_bytes(db, row["id"], path),
        last_indexed_at=row["last_indexed_at"],
        index_state=row["index_state"],
        index_error=row["index_error"],
        warnings=warnings,
        updating=updating,
        updating_reason=updating_reason,
        last_update=last_applied,
        runs=runs,
        suggestion=_suggest_replacement(db, path),
        **_index_counts(db, row["id"], row["last_indexed_at"]),
    )


@router.post(
    "/api/admin/libraries",
    response_model=LibraryResponse,
    status_code=201,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def add_library(
    payload: LibraryAddRequest,
    background_tasks: BackgroundTasks,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    data_dir: pathlib.Path = Depends(session_auth.get_data_dir),
) -> LibraryResponse:
    # Resolve first so `x/../Lib.photoslibrary` and symlinks can't register
    # the same package twice.
    path = pathlib.Path(payload.path).resolve()
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
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
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
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
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
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> LibraryStatusResponse:
    row = _get_library_or_404(db, library_id)
    return _build_status(db, row)


@router.post(
    "/api/admin/libraries/{library_id}/reindex",
    response_model=LibraryStatusResponse,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def reindex_library(
    library_id: int,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> LibraryStatusResponse:
    """"Index now": skips the stability wait and forces a fresh walk even if
    the sqlite signature hasn't changed. Still runs the readiness checks, so
    a half-copied package is refused with the reason. Synchronous because its
    response body reports the fresh counts."""
    row = _get_library_or_404(db, library_id)
    path = pathlib.Path(row["path"])
    if not path.exists():
        raise HTTPException(status_code=400, detail=f"{path} is not reachable -- is the drive mounted?")
    lock = _lock_for(library_id)
    lock.acquire()
    try:
        _mark_indexing(db, library_id)
        opened, reason = library_watch.check_ready(path)
        if opened is None:
            _mark_indexed(db, library_id)
            raise HTTPException(status_code=400, detail=f"could not re-index {path}: {reason}")
        try:
            indexer.index_library(db, library_id, path, force=True, trigger="admin", opened=opened)
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
    return _build_status(db, _get_library_or_404(db, library_id))


class ReplaceRequest(BaseModel):
    path: str
    confirm: bool = False
    # Required to confirm when the preview carries warnings.
    replace_anyway: bool = False


class ReplacePreview(BaseModel):
    path: str
    confirmed: bool
    new_asset_count: int
    would_add: int
    would_remove: int
    overlap: float
    store_uuid_match: bool | None
    originals_missing: int
    originals_missing_pct: float
    warnings: list[LibraryWarning]
    status: LibraryStatusResponse | None = None


LOW_OVERLAP = 0.5


def _preview_replace(db: sqlite3.Connection, row: sqlite3.Row, new_path: pathlib.Path) -> ReplacePreview:
    """Reads the new package on `open_library_readonly`'s temp copy only."""
    _validate_library_path(new_path)
    other = db.execute("SELECT id FROM libraries WHERE path = ? AND id != ?", (str(new_path), row["id"])).fetchone()
    if other is not None:
        raise HTTPException(status_code=409, detail="this path is already registered as another library")
    opened = open_library_readonly(new_path)
    try:
        new_uuids: set[str] = set()
        missing = 0
        for photo in opened.db.photos():
            new_uuids.add(photo.uuid)
            if photo.path_derivatives and not (photo.path and os.path.exists(photo.path)):
                missing += 1
        new_store_uuid = indexer.read_store_uuid(opened.sqlite_path) if opened.sqlite_path else None
    finally:
        opened.close()
    old_uuids = {r["uuid"] for r in db.execute("SELECT uuid FROM assets WHERE library_id = ?", (row["id"],))}
    overlap = len(old_uuids & new_uuids) / len(old_uuids) if old_uuids else 1.0
    old_store_uuid = row["store_uuid"]
    match = None if old_store_uuid is None or new_store_uuid is None else old_store_uuid == new_store_uuid
    pct = 100.0 * missing / len(new_uuids) if new_uuids else 0.0
    warnings: list[LibraryWarning] = []
    if overlap < LOW_OVERLAP:
        warnings.append(
            LibraryWarning(
                code="low_overlap",
                message=f"Only {overlap:.0%} of the current photos are in the new library. "
                "This may be a different person's library.",
            )
        )
    if match is False:
        warnings.append(
            LibraryWarning(code="store_uuid_differs", message="The new package has a different library identity.")
        )
    if pct >= OPTIMIZE_STORAGE_WARN_PCT:
        warnings.append(LibraryWarning(code="originals_missing", message=optimize_storage_message(missing, pct)))
    return ReplacePreview(
        path=str(new_path),
        confirmed=False,
        new_asset_count=len(new_uuids),
        would_add=len(new_uuids - old_uuids),
        would_remove=len(old_uuids - new_uuids),
        overlap=overlap,
        store_uuid_match=match,
        originals_missing=missing,
        originals_missing_pct=pct,
        warnings=warnings,
    )


@router.post(
    "/api/admin/libraries/{library_id}/replace",
    response_model=ReplacePreview,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def replace_library(
    library_id: int,
    payload: ReplaceRequest,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> ReplacePreview:
    """Point a library at a new package path (a renamed or relocated copy)
    while keeping its id, name, assignments and settings. Without `confirm`
    this is a read-only preview; with it, the path is switched and the new
    package indexed. Assets keep their ids: the upsert key is
    `(library_id, uuid)` and Photos keeps asset UUIDs across copies."""
    row = _get_library_or_404(db, library_id)
    new_path = pathlib.Path(payload.path).resolve()
    preview = _preview_replace(db, row, new_path)
    detail = f"old={row['path']} new={new_path} overlap={preview.overlap:.3f} store_uuid_match={preview.store_uuid_match}"
    if not payload.confirm:
        app_db.write_audit_log(
            db, "library.replace.previewed", library_id=library_id, actor=admin["username"], detail=detail
        )
        return preview
    blockers = [w for w in preview.warnings if w.code != "originals_missing"]
    if blockers and not payload.replace_anyway:
        raise HTTPException(status_code=409, detail="; ".join(w.message for w in blockers))
    lock = _lock_for(library_id)
    lock.acquire()
    try:
        opened, reason = library_watch.check_ready(new_path)
        if opened is None:
            raise HTTPException(status_code=400, detail=f"{new_path} is not ready: {reason}")
        old_path = row["path"]
        db.execute("UPDATE libraries SET path = ? WHERE id = ?", (str(new_path), library_id))
        db.commit()
        try:
            _mark_indexing(db, library_id)
            indexer.index_library(db, library_id, new_path, force=True, trigger="replace", opened=opened)
            _mark_indexed(db, library_id)
        except Exception as exc:
            db.execute("UPDATE libraries SET path = ? WHERE id = ?", (old_path, library_id))
            db.commit()
            _mark_index_error(db, library_id, str(exc))
            raise HTTPException(status_code=400, detail=f"could not index {new_path}: {exc}") from exc
    finally:
        lock.release()
    app_db.write_audit_log(
        db, "library.replace.confirmed", library_id=library_id, actor=admin["username"], detail=detail
    )
    preview.confirmed = True
    preview.status = _build_status(db, _get_library_or_404(db, library_id))
    return preview
