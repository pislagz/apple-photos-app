"""P3.3: resumable background thumbnail pre-warm, one job per library.

The job generates the `grid` and `grid2x` thumbnails (the two sizes the
grids request; `preview` is only for the viewer and costs far more) through
`media.get_or_generate()`, so files land in the normal cache under the data
dir with the same keys the thumb route computes. A cache hit is a skip, which
is also what makes a killed process resumable: the job's cursor (last asset
uuid handled, in `prewarm_jobs`) only saves the walk, never correctness.

It reads originals/derivatives of the package through the same path checks
as the thumb route and writes nothing into it. One asset at a time, no list of
assets or image bytes held; one worker thread at low priority, so only one
job ever runs.
"""

from __future__ import annotations

import logging
import os
import pathlib
import sqlite3
import threading
import time
from collections.abc import Callable
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from . import app_db, media, session_auth
from .library_assets import _media_settings, _resolve_within_library

logger = logging.getLogger(__name__)
router = APIRouter()

PREWARM_SIZES = ("grid", "grid2x")
# Stop (state `paused`, with a note) once the cache holds this fraction of its
# limit: past that, every new thumb would evict an older one and the job would
# just churn the cache.
FULL_FRACTION = 0.9
_YIELD_SECONDS = 0.005
_IDLE_SECONDS = 5.0


class PrewarmStatus(BaseModel):
    state: Literal["idle", "running", "paused", "done"]
    total: int
    done: int
    failed: int
    note: str | None = None


def _eligible_clause() -> str:
    return "library_id = ? AND hidden = 0 AND (path_original IS NOT NULL OR path_edited IS NOT NULL OR path_derivative IS NOT NULL)"


def count_eligible(db: sqlite3.Connection, library_id: int) -> int:
    return db.execute(
        f"SELECT COUNT(*) FROM assets WHERE {_eligible_clause()}", (library_id,)
    ).fetchone()[0]


def job_status(db: sqlite3.Connection, library_id: int) -> PrewarmStatus:
    row = db.execute(
        "SELECT * FROM prewarm_jobs WHERE library_id = ?", (library_id,)
    ).fetchone()
    if row is None:
        return PrewarmStatus(state="idle", total=0, done=0, failed=0)
    total = row["total"]
    if row["state"] == "done":
        done = total
    elif row["cursor_uuid"] is None:
        done = 0
    else:
        done = db.execute(
            f"SELECT COUNT(*) FROM assets WHERE {_eligible_clause()} AND uuid <= ?",
            (library_id, row["cursor_uuid"]),
        ).fetchone()[0]
    return PrewarmStatus(
        state=row["state"],
        total=total,
        done=min(done, total),
        failed=row["failed"],
        note=row["note"],
    )


def progress(status: PrewarmStatus) -> float | None:
    if status.state == "idle":
        return None
    return 1.0 if status.total == 0 else min(1.0, status.done / status.total)


def _set_state(
    db: sqlite3.Connection, library_id: int, state: str, note: str | None = None
) -> None:
    db.execute(
        "UPDATE prewarm_jobs SET state = ?, note = ?, updated_at = datetime('now') WHERE library_id = ?",
        (state, note, library_id),
    )
    db.commit()


def _current_state(db: sqlite3.Connection, library_id: int) -> str | None:
    row = db.execute(
        "SELECT state FROM prewarm_jobs WHERE library_id = ?", (library_id,)
    ).fetchone()
    return row["state"] if row else None


def _warm_asset(
    db: sqlite3.Connection,
    cache_dir: pathlib.Path,
    library: sqlite3.Row,
    asset: sqlite3.Row,
) -> bool:
    """Make sure both sizes are cached. False when the asset could not be
    decoded or its path is unusable (counted, not fatal)."""
    edited, original, derivative = (
        asset["path_edited"],
        asset["path_original"],
        asset["path_derivative"],
    )
    main_path = edited or original or derivative
    sizes, quality, cache_limit = _media_settings(db)
    try:
        source = _resolve_within_library(library["path"], main_path)
        derivatives = (
            [_resolve_within_library(library["path"], derivative)]
            if derivative and derivative != main_path
            else []
        )
        for size in PREWARM_SIZES:
            media.get_or_generate(
                cache_dir,
                library_id=library["id"],
                asset_uuid=asset["uuid"],
                size=size,
                source_path=source,
                derivatives=derivatives,
                is_video=bool(asset["is_video"]),
                size_px=sizes[size],
                quality=quality,
                cache_size_limit_bytes=cache_limit,
            )
    except (media.MediaBackendError, HTTPException, OSError, ValueError):
        return False
    return True


def run_library(
    data_dir: pathlib.Path,
    library_id: int,
    *,
    should_stop: Callable[[], bool] = lambda: False,
    max_assets: int | None = None,
    pause_s: float = _YIELD_SECONDS,
) -> str:
    """Process `library_id`'s job until it finishes, is paused, `should_stop()`
    turns true or `max_assets` assets were handled (tests use this to stop
    mid-job). Returns the resulting state. Its own `app.db` connection."""
    db = app_db.connect(data_dir)
    cache_dir = app_db.media_cache_dir(data_dir)
    handled = 0
    try:
        while True:
            if _current_state(db, library_id) != "running":
                return _current_state(db, library_id) or "idle"
            if should_stop() or (max_assets is not None and handled >= max_assets):
                return "running"
            library = db.execute(
                "SELECT * FROM libraries WHERE id = ?", (library_id,)
            ).fetchone()
            job = db.execute(
                "SELECT cursor_uuid FROM prewarm_jobs WHERE library_id = ?",
                (library_id,),
            ).fetchone()
            if library is None or job is None:
                return "idle"
            if library["index_state"] == "indexing":
                # A re-index started mid-job: leave the job running at its
                # cursor; the worker picks it up again once indexing is done.
                return "running"
            asset = db.execute(
                f"SELECT uuid, is_video, path_original, path_edited, path_derivative FROM assets "
                f"WHERE {_eligible_clause()} AND uuid > ? ORDER BY uuid LIMIT 1",
                (library_id, job["cursor_uuid"] or ""),
            ).fetchone()
            if asset is None:
                _set_state(db, library_id, "done")
                return "done"
            ok = _warm_asset(db, cache_dir, library, asset)
            if not ok and not pathlib.Path(library["path"]).exists():
                # The drive went away mid-job: keep the cursor and the job
                # running so the worker retries once it is mounted again,
                # instead of counting every remaining asset as failed.
                return "running"
            # Re-check: a pause/clear that landed during the decode wins, so
            # the cursor does not move over a stale state.
            if _current_state(db, library_id) != "running":
                return _current_state(db, library_id) or "idle"
            db.execute(
                "UPDATE prewarm_jobs SET cursor_uuid = ?, failed = failed + ?, updated_at = datetime('now') "
                "WHERE library_id = ?",
                (asset["uuid"], 0 if ok else 1, library_id),
            )
            db.commit()
            handled += 1
            _, _, limit = _media_settings(db)
            total = media.cache_total_bytes(cache_dir)
            if limit and total is not None and total >= limit * FULL_FRACTION:
                _set_state(
                    db,
                    library_id,
                    "paused",
                    "Thumbnail cache is nearly full. Raise the cache size limit or clear the cache, then resume.",
                )
                return "paused"
            if pause_s:
                time.sleep(pause_s)
    finally:
        db.close()


class PrewarmWorker(threading.Thread):
    """The single background thread: picks the lowest-id library whose job is
    `running` (also after a restart, since state lives in `app.db`) and works
    through it. Low priority so serving requests wins."""

    def __init__(self, data_dir_getter: Callable[[], pathlib.Path]) -> None:
        super().__init__(name="prewarm", daemon=True)
        self._data_dir_getter = data_dir_getter
        self._stop_event = threading.Event()
        self._wake = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()
        self._wake.set()

    def wake(self) -> None:
        self._wake.set()

    def run(self) -> None:
        try:
            os.setpriority(os.PRIO_PROCESS, threading.get_native_id(), 10)
        except (AttributeError, OSError):
            pass
        while not self._stop_event.is_set():
            worked = False
            try:
                data_dir = self._data_dir_getter()
                if app_db.db_path(data_dir).exists():
                    worked = self._run_one(data_dir)
            except Exception:
                logger.warning("pre-warm pass failed", exc_info=True)
            if not worked:
                self._wake.wait(_IDLE_SECONDS)
                self._wake.clear()

    def _run_one(self, data_dir: pathlib.Path) -> bool:
        db = app_db.connect(data_dir)
        try:
            candidates = db.execute(
                "SELECT j.library_id, l.path FROM prewarm_jobs j JOIN libraries l ON l.id = j.library_id "
                "WHERE j.state = 'running' AND l.index_state IS NOT 'indexing' ORDER BY j.library_id"
            ).fetchall()
        finally:
            db.close()
        # Lowest id first, but a library whose drive is not mounted is left
        # running (it resumes when mounted) without blocking the others.
        for candidate in candidates:
            if pathlib.Path(candidate["path"]).exists():
                run_library(
                    data_dir,
                    candidate["library_id"],
                    should_stop=self._stop_event.is_set,
                )
                return True
        return False


# -- admin API --------------------------------------------------------------


def _library_or_404(db: sqlite3.Connection, library_id: int) -> sqlite3.Row:
    row = db.execute("SELECT * FROM libraries WHERE id = ?", (library_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


def _wake(request: Request) -> None:
    worker = getattr(request.app.state, "prewarm_worker", None)
    if worker is not None:
        worker.wake()


@router.post(
    "/api/admin/libraries/{library_id}/prewarm/start",
    response_model=PrewarmStatus,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def start_prewarm(
    library_id: int,
    request: Request,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> PrewarmStatus:
    """Start, or resume a paused job (the cursor is kept). A finished job
    starts over; everything already cached is skipped, not regenerated."""
    library = _library_or_404(db, library_id)
    if not pathlib.Path(library["path"]).exists():
        raise HTTPException(
            status_code=400,
            detail=f"{library['path']} is not reachable -- is the drive mounted?",
        )
    _, _, limit = _media_settings(db)
    if limit == 0:
        raise HTTPException(
            status_code=400,
            detail="The thumbnail cache is turned off (size limit 0), so there is nothing to pre-warm.",
        )
    existing = _current_state(db, library_id)
    if existing == "running":
        return job_status(db, library_id)
    total = count_eligible(db, library_id)
    if existing == "paused":
        db.execute(
            "UPDATE prewarm_jobs SET state = 'running', note = NULL, total = ?, updated_at = datetime('now') "
            "WHERE library_id = ?",
            (total, library_id),
        )
    elif existing == "done":
        db.execute(
            "UPDATE prewarm_jobs SET state = 'running', note = NULL, cursor_uuid = NULL, failed = 0, total = ?, "
            "updated_at = datetime('now') WHERE library_id = ?",
            (total, library_id),
        )
    else:
        db.execute(
            "INSERT INTO prewarm_jobs (library_id, state, total) VALUES (?, 'running', ?)",
            (library_id, total),
        )
    db.commit()
    app_db.write_audit_log(
        db,
        "prewarm.start",
        library_id=library_id,
        actor=admin["username"],
        detail=f"total={total}",
    )
    _wake(request)
    return job_status(db, library_id)


@router.post(
    "/api/admin/libraries/{library_id}/prewarm/pause",
    response_model=PrewarmStatus,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def pause_prewarm(
    library_id: int,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> PrewarmStatus:
    """Takes effect before the next asset starts (at most the one in flight
    finishes)."""
    _library_or_404(db, library_id)
    if _current_state(db, library_id) == "running":
        _set_state(db, library_id, "paused")
        app_db.write_audit_log(
            db, "prewarm.pause", library_id=library_id, actor=admin["username"]
        )
    return job_status(db, library_id)


class ClearCacheResponse(BaseModel):
    freed_bytes: int
    status: PrewarmStatus


@router.post(
    "/api/admin/libraries/{library_id}/thumbnail-cache/clear",
    response_model=ClearCacheResponse,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def clear_thumbnail_cache(
    library_id: int,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    cache_dir: pathlib.Path = Depends(session_auth.get_media_cache_dir),
) -> ClearCacheResponse:
    """Deletes this library's cache files under the data dir and forgets its
    pre-warm job. The package is not touched; thumbs regenerate on demand."""
    _library_or_404(db, library_id)
    # Drop the job first so a worker mid-asset stops instead of refilling.
    db.execute("DELETE FROM prewarm_jobs WHERE library_id = ?", (library_id,))
    db.commit()
    freed = media.purge_library_cache(cache_dir, library_id)
    app_db.write_audit_log(
        db,
        "prewarm.clear_cache",
        library_id=library_id,
        actor=admin["username"],
        detail=f"freed={freed}",
    )
    return ClearCacheResponse(freed_bytes=freed, status=job_status(db, library_id))
