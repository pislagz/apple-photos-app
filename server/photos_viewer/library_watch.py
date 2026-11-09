"""Detects a replaced or still-copying `.photoslibrary` and applies it once
it looks complete (P1.22).

Detection is `stat()`-only (`fingerprint`): no database is opened until a
changed package has been unchanged for the stability window. Opening happens
only on `libraries.open_library_readonly`'s temp copy, so the package itself
is never written. A missing or incomplete package never deletes anything
from `app.db` -- it only sets `pending_*` / `missing_since`, which makes the
library's users see "Being updated" (`availability`) until a valid copy has
been indexed in one commit (`indexer._write_index_and_update_signature`
clears those columns in that same commit).
"""

from __future__ import annotations

import datetime
import logging
import os
import pathlib
import random
import sqlite3
import threading
from collections.abc import Callable

from . import app_db, indexer, libraries

logger = logging.getLogger(__name__)

DEFAULT_CHECK_INTERVAL_MINUTES = 15
DEFAULT_STABLE_MINUTES = 10
DEFAULT_SHOW_UPDATED_NOTE = 1

SAMPLE_SIZE = 200
# A sampled asset with no file at all (original, edited, raw or derivative)
# means the copy is still arriving. A small fraction is tolerated so one
# genuinely missing file in a finished library cannot keep it "Being
# updated" forever.
MAX_MISSING_SAMPLE_FRACTION = 0.10
STALE_PENDING_HOURS = 24
KEEP_RUNS = 50
SYSTEM_ACTOR = "system"

# One lock per library id: at most one indexing job per library at a time.
_library_locks: dict[int, threading.Lock] = {}
_library_locks_guard = threading.Lock()


def _lock_for(library_id: int) -> threading.Lock:
    with _library_locks_guard:
        lock = _library_locks.get(library_id)
        if lock is None:
            lock = threading.Lock()
            _library_locks[library_id] = lock
        return lock


def mark_indexing(db: sqlite3.Connection, library_id: int) -> None:
    db.execute("UPDATE libraries SET index_state = 'indexing', index_error = NULL WHERE id = ?", (library_id,))
    db.commit()


def mark_indexed(db: sqlite3.Connection, library_id: int) -> None:
    db.execute("UPDATE libraries SET index_state = 'idle', index_error = NULL WHERE id = ?", (library_id,))
    db.commit()


def mark_index_error(db: sqlite3.Connection, library_id: int, error: str) -> None:
    db.execute("UPDATE libraries SET index_state = 'error', index_error = ? WHERE id = ?", (error, library_id))
    db.commit()


def _iso(now: datetime.datetime | None = None) -> str:
    now = now or datetime.datetime.now(datetime.UTC)
    return now.astimezone(datetime.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse(value: str) -> datetime.datetime:
    return datetime.datetime.fromisoformat(value)


def _int_setting(db: sqlite3.Connection, key: str, default: int) -> int:
    stored = app_db.get_setting(db, key)
    try:
        return int(stored) if stored not in (None, "") else default
    except ValueError:
        return default


def check_interval_minutes(db: sqlite3.Connection) -> int:
    return _int_setting(db, "library_check_interval_minutes", DEFAULT_CHECK_INTERVAL_MINUTES)


def stable_minutes(db: sqlite3.Connection) -> int:
    return _int_setting(db, "library_stable_minutes", DEFAULT_STABLE_MINUTES)


def show_updated_note(db: sqlite3.Connection) -> bool:
    return bool(_int_setting(db, "show_library_updated_note", DEFAULT_SHOW_UPDATED_NOTE))


def fingerprint(package_path: str | pathlib.Path) -> str | None:
    """`stat()`-only fingerprint of a package, or `None` when it is gone.

    The sqlite signature, the count and total size of `database/`, and the
    package directory's own mtime, so a copy still writing files keeps
    changing it.
    """
    package_path = pathlib.Path(package_path)
    try:
        package_mtime = package_path.stat().st_mtime_ns
    except OSError:
        return None
    count = 0
    total = 0
    try:
        for root, _dirs, files in os.walk(package_path / "database"):
            for name in files:
                try:
                    total += os.stat(os.path.join(root, name)).st_size
                except OSError:
                    continue
                count += 1
    except OSError:
        pass
    return f"{indexer.sqlite_signature(package_path)}#{count}:{total}#{package_mtime}"


def check_ready(package_path: pathlib.Path) -> tuple[libraries.OpenLibrary | None, str | None]:
    """Readiness checks, all read-only and on the temp copy. Returns the
    opened library (caller owns and closes it) or a human-readable reason it
    is not ready yet."""
    sqlite_path = package_path / "database" / "Photos.sqlite"
    try:
        if not sqlite_path.is_file() or sqlite_path.stat().st_size == 0:
            return None, "Photos.sqlite is missing or empty"
    except OSError as exc:
        return None, f"Photos.sqlite is not readable yet: {exc}"
    if not (package_path / "originals").is_dir() and not (package_path / "resources" / "derivatives").is_dir():
        return None, "the originals folder has not been copied yet"
    try:
        opened = libraries.open_library_readonly(package_path)
    except libraries.UnsupportedPhotosVersionError as exc:
        return None, str(exc)
    except Exception as exc:  # noqa: BLE001 -- a half-copied database fails in many ways
        return None, f"Photos.sqlite is not readable yet: {exc}"
    try:
        reason = _check_opened(opened)
    except Exception as exc:  # noqa: BLE001
        opened.close()
        return None, f"copy looks incomplete: {exc}"
    if reason is not None:
        opened.close()
        return None, reason
    return opened, None


def _check_opened(opened: libraries.OpenLibrary) -> str | None:
    if opened.sqlite_path is not None:
        conn = sqlite3.connect(f"{opened.sqlite_path.resolve().as_uri()}?mode=ro", uri=True)
        try:
            result = conn.execute("PRAGMA quick_check").fetchone()
        finally:
            conn.close()
        if not result or result[0] != "ok":
            return f"Photos.sqlite failed its integrity check: {result[0] if result else 'no result'}"
    photos = list(opened.db.photos())
    sample = random.sample(photos, min(SAMPLE_SIZE, len(photos)))
    missing = 0
    for photo in sample:
        candidates = [photo.path, photo.path_edited, photo.path_raw, *(photo.path_derivatives or [])]
        if not any(candidate and os.path.exists(candidate) for candidate in candidates):
            missing += 1
    if sample and missing / len(sample) > MAX_MISSING_SAMPLE_FRACTION:
        return f"copy looks incomplete: {missing} of {len(sample)} sampled photos have no file yet"
    return None


def _prune_runs(db: sqlite3.Connection, library_id: int) -> None:
    db.execute(
        "DELETE FROM library_index_runs WHERE library_id = ? AND id NOT IN "
        "(SELECT id FROM library_index_runs WHERE library_id = ? ORDER BY id DESC LIMIT ?)",
        (library_id, library_id, KEEP_RUNS),
    )


def _record_run(
    db: sqlite3.Connection, library_id: int, trigger: str, outcome: str, started_at: str, error: str | None
) -> None:
    db.execute(
        "INSERT INTO library_index_runs (library_id, trigger, started_at, finished_at, outcome, error) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (library_id, trigger, started_at, _iso(), outcome, error),
    )
    _prune_runs(db, library_id)
    db.commit()


def _get_row(db: sqlite3.Connection, library_id: int) -> sqlite3.Row | None:
    return db.execute("SELECT * FROM libraries WHERE id = ?", (library_id,)).fetchone()


def observe(db: sqlite3.Connection, library_id: int, *, now: datetime.datetime | None = None) -> str:
    """One stat-only look at a library; updates its pending / missing state.

    Returns `missing`, `ok`, `pending` (fingerprint changed this check, or
    still inside the stability window) or `stable` (changed and unchanged for
    the full window: ready for `try_apply`). Never deletes anything.
    """
    row = _get_row(db, library_id)
    if row is None:
        return "ok"
    path = pathlib.Path(row["path"])
    iso = _iso(now)
    fp = fingerprint(path)
    if fp is None:
        if row["missing_since"] is None:
            db.execute(
                "UPDATE libraries SET missing_since = ?, pending_signature = NULL, pending_since = NULL, "
                "pending_reason = NULL WHERE id = ?",
                (iso, library_id),
            )
            db.commit()
            app_db.write_audit_log(
                db, "library.file_missing", library_id=library_id, actor=SYSTEM_ACTOR, detail=str(path)
            )
        return "missing"
    if row["missing_since"] is not None:
        db.execute("UPDATE libraries SET missing_since = NULL WHERE id = ?", (library_id,))
        db.commit()
    if indexer.sqlite_signature(path) == row["last_indexed_signature"]:
        if row["pending_signature"] is not None:
            db.execute(
                "UPDATE libraries SET pending_signature = NULL, pending_since = NULL, pending_reason = NULL "
                "WHERE id = ?",
                (library_id,),
            )
            db.commit()
        return "ok"
    if row["pending_signature"] != fp:
        db.execute(
            "UPDATE libraries SET pending_signature = ?, pending_since = ?, pending_reason = ? WHERE id = ?",
            (fp, iso, "a new copy of this library was detected and is being checked", library_id),
        )
        db.commit()
        return "pending"
    now_dt = now or datetime.datetime.now(datetime.UTC)
    waited = (now_dt - _parse(row["pending_since"])).total_seconds()
    return "stable" if waited >= stable_minutes(db) * 60 else "pending"


def try_apply(db: sqlite3.Connection, library_id: int, *, trigger: str = "auto") -> str:
    """Readiness checks, then one-commit index. Returns `applied`,
    `not_ready`, `failed` or `busy` (another job holds the library's lock).
    A not-ready copy is not an error: the library stays pending."""
    lock = _lock_for(library_id)
    if not lock.acquire(blocking=False):
        return "busy"
    try:
        row = _get_row(db, library_id)
        if row is None:
            return "failed"
        path = pathlib.Path(row["path"])
        started_at = _iso()
        opened, reason = check_ready(path)
        if opened is None:
            if row["pending_signature"] is None:
                db.execute(
                    "UPDATE libraries SET pending_signature = ?, pending_since = ? WHERE id = ?",
                    (fingerprint(path) or "", started_at, library_id),
                )
            if reason != row["pending_reason"]:
                _record_run(db, library_id, trigger, "not_ready", started_at, reason)
            db.execute("UPDATE libraries SET pending_reason = ? WHERE id = ?", (reason, library_id))
            db.commit()
            return "not_ready"
        try:
            mark_indexing(db, library_id)
            indexer.index_library(db, library_id, path, force=True, trigger=trigger, opened=opened)
            mark_indexed(db, library_id)
        except Exception as exc:
            error = str(exc)
            # The walk rolled back, so the previous index survives; users see
            # "Being updated" until a later check applies a good copy.
            _record_run(db, library_id, trigger, "failed", started_at, error)
            mark_index_error(db, library_id, error)
            db.execute(
                "UPDATE libraries SET pending_signature = COALESCE(pending_signature, ?), "
                "pending_since = COALESCE(pending_since, ?), pending_reason = ? WHERE id = ?",
                (fingerprint(path) or "", started_at, f"indexing failed: {error}", library_id),
            )
            db.commit()
            app_db.write_audit_log(
                db, "library.update.failed", library_id=library_id, actor=SYSTEM_ACTOR, detail=error
            )
            logger.warning("applying library %s (%s) failed", library_id, path, exc_info=True)
            return "failed"
        run = db.execute(
            "SELECT * FROM library_index_runs WHERE library_id = ? ORDER BY id DESC LIMIT 1", (library_id,)
        ).fetchone()
        _prune_runs(db, library_id)
        db.commit()
        app_db.write_audit_log(
            db,
            "library.update.applied",
            library_id=library_id,
            actor=SYSTEM_ACTOR if trigger == "auto" else trigger,
            detail=f"added={run['added']} removed={run['removed']} changed={run['changed']}",
        )
        return "applied"
    finally:
        lock.release()


def check_library(db: sqlite3.Connection, library_id: int, *, now: datetime.datetime | None = None) -> str:
    state = observe(db, library_id, now=now)
    if state == "stable":
        return try_apply(db, library_id, trigger="auto")
    return state


def check_all(db: sqlite3.Connection, *, now: datetime.datetime | None = None) -> dict[int, str]:
    results: dict[int, str] = {}
    for row in db.execute("SELECT id FROM libraries ORDER BY id").fetchall():
        try:
            results[row["id"]] = check_library(db, row["id"], now=now)
        except Exception:
            logger.warning("checking library %s failed", row["id"], exc_info=True)
    return results


def availability(row: sqlite3.Row) -> tuple[bool, str | None]:
    """(updating, reason): whether users should see "Being updated"."""
    if row["missing_since"] is not None:
        return True, f"Library file missing since {_display(row['missing_since'])}"
    if row["pending_signature"] is not None:
        return True, row["pending_reason"] or "A new copy of this library is being checked"
    return False, None


def public_availability(row: sqlite3.Row) -> tuple[bool, str | None]:
    """Like `availability`, but with a fixed, user-safe reason: the detailed
    one (exception text, package paths) is for the admin status only."""
    updating, _reason = availability(row)
    if not updating:
        return False, None
    if row["missing_since"] is not None:
        return True, "The library is temporarily unavailable."
    return True, "A new copy of this library is being checked."


def _display(iso: str) -> str:
    return _parse(iso).strftime("%Y-%m-%d %H:%M UTC")


def within_days(iso: str | None, days: int) -> bool:
    if not iso:
        return False
    return (datetime.datetime.now(datetime.UTC) - _parse(iso)).total_seconds() <= days * 86400


def pending_too_long(row: sqlite3.Row, *, now: datetime.datetime | None = None) -> bool:
    since = row["pending_since"] or row["missing_since"]
    if since is None:
        return False
    now = now or datetime.datetime.now(datetime.UTC)
    return (now - _parse(since)).total_seconds() > STALE_PENDING_HOURS * 3600


class LibraryChecker(threading.Thread):
    """Background thread: wakes every `library_check_interval_minutes`
    (`0` = off, re-read each wake) and runs `check_all`. Opens its own
    `app.db` connection per pass."""

    def __init__(self, data_dir_getter: Callable[[], pathlib.Path]) -> None:
        super().__init__(name="library-checker", daemon=True)
        self._data_dir_getter = data_dir_getter
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        delay = 0.0
        while not self._stop_event.wait(delay):
            delay = 60.0
            try:
                data_dir = self._data_dir_getter()
                if not app_db.db_path(data_dir).exists():
                    continue
                conn = app_db.connect(data_dir)
                try:
                    minutes = check_interval_minutes(conn)
                    if minutes > 0:
                        check_all(conn)
                        delay = minutes * 60.0
                finally:
                    conn.close()
            except Exception:
                logger.warning("library check pass failed", exc_info=True)
