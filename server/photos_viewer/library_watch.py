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

#461: Photos on the Mac (Photos.app, `photolibraryd`, `photoanalysisd`) writes
to a library it has open, so its sqlite signature keeps changing. That is
not a replacement: when the package and Photos.sqlite are the same files
that were indexed (`indexer.package_identity`) and SQLite's `-wal`/`-shm` show
a live writer, the change is "in place". The last good index keeps serving,
the admin sees "Photos is updating this library", and the new state is
indexed once it settles (or after `IN_PLACE_MAX_WAIT_MINUTES` of constant
changes). Failures are classified by `library_health`; a transient one (drive
asleep, permission lost, Photos busy, temp disk full) never sets
`index_state = 'error'` or drops the index, and retries with backoff.
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

from . import app_db, indexer, libraries, library_health

logger = logging.getLogger(__name__)

DEFAULT_CHECK_INTERVAL_MINUTES = 15
DEFAULT_STABLE_MINUTES = 10
DEFAULT_SHOW_UPDATED_NOTE = 1
MAX_MINUTES = 10080  # 7 days, for both timing settings

SAMPLE_SIZE = 200
# A sampled asset with no file at all (original, edited, raw or derivative)
# means the copy is still arriving. A small fraction is tolerated so one
# genuinely missing file in a finished library cannot keep it "Being
# updated" forever.
MAX_MISSING_SAMPLE_FRACTION = 0.10
STALE_PENDING_HOURS = 24
KEEP_RUNS = 50
SYSTEM_ACTOR = "system"
# Backoff after a failed open or index: 5, 10, 20 ... minutes, at most 6 hours.
RETRY_BASE_MINUTES = 5
RETRY_MAX_MINUTES = 360
# Photos can keep a library busy for hours (analysis after an import). Index
# its state anyway after this long; the copy is checked for consistency.
IN_PLACE_MAX_WAIT_MINUTES = 60
_PATH_CODES = frozenset(
    {
        library_health.NOT_MOUNTED,
        library_health.VOLUME_RENAMED,
        library_health.LIBRARY_MISSING,
        library_health.NO_PERMISSION,
        library_health.DRIVE_ERROR,
    }
)
_MISSING_CODES = frozenset(
    {
        library_health.NOT_MOUNTED,
        library_health.VOLUME_RENAMED,
        library_health.LIBRARY_MISSING,
    }
)

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
    db.execute(
        "UPDATE libraries SET index_state = 'indexing', index_error = NULL WHERE id = ?",
        (library_id,),
    )
    db.commit()


def mark_indexed(db: sqlite3.Connection, library_id: int) -> None:
    db.execute(
        "UPDATE libraries SET index_state = 'idle', index_error = NULL WHERE id = ?",
        (library_id,),
    )
    db.commit()


def mark_index_error(db: sqlite3.Connection, library_id: int, error: str) -> None:
    db.execute(
        "UPDATE libraries SET index_state = 'error', index_error = ? WHERE id = ?",
        (error, library_id),
    )
    db.commit()


def _iso(now: datetime.datetime | None = None) -> str:
    now = now or datetime.datetime.now(datetime.UTC)
    return (
        now.astimezone(datetime.UTC)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def _parse(value: str) -> datetime.datetime:
    return datetime.datetime.fromisoformat(value)


def _int_setting(db: sqlite3.Connection, key: str, default: int) -> int:
    stored = app_db.get_setting(db, key)
    try:
        return int(stored) if stored not in (None, "") else default
    except ValueError:
        return default


def check_interval_minutes(db: sqlite3.Connection) -> int:
    return _int_setting(
        db, "library_check_interval_minutes", DEFAULT_CHECK_INTERVAL_MINUTES
    )


def stable_minutes(db: sqlite3.Connection) -> int:
    return _int_setting(db, "library_stable_minutes", DEFAULT_STABLE_MINUTES)


def show_updated_note(db: sqlite3.Connection) -> bool:
    return bool(
        _int_setting(db, "show_library_updated_note", DEFAULT_SHOW_UPDATED_NOTE)
    )


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


def precheck(package_path: pathlib.Path) -> str | None:
    sqlite_path = package_path / "database" / "Photos.sqlite"
    try:
        if not sqlite_path.is_file() or sqlite_path.stat().st_size == 0:
            return "Photos.sqlite is missing or empty"
    except OSError as exc:
        return f"Photos.sqlite is not readable yet: {exc}"
    if (
        not (package_path / "originals").is_dir()
        and not (package_path / "resources" / "derivatives").is_dir()
    ):
        return "the originals folder has not been copied yet"
    return None


def check_ready(
    package_path: pathlib.Path,
) -> tuple[libraries.OpenLibrary | None, str | None]:
    """Readiness checks, all read-only and on the temp copy. Returns the
    opened library (caller owns and closes it) or a human-readable reason it
    is not ready yet."""
    opened, reason, _code = check_ready_detailed(package_path)
    return opened, reason


def check_ready_detailed(
    package_path: pathlib.Path,
) -> tuple[libraries.OpenLibrary | None, str | None, str | None]:
    """`check_ready` plus a `library_health` code for the failure."""
    probe = library_health.probe_path(package_path)
    if not probe.ok:
        text = library_health.message(probe.code, renamed=str(probe.renamed_to))
        return None, f"{text} ({probe.detail})", probe.code
    reason = precheck(package_path)
    if reason is not None:
        return None, reason, library_health.INCOMPLETE
    try:
        opened = libraries.open_library_readonly(package_path)
    except libraries.UnsupportedPhotosVersionError as exc:
        return None, str(exc), library_health.UNSUPPORTED_VERSION
    except Exception as exc:  # a half-copied database fails in many ways
        code = library_health.classify(exc)
        logger.debug("opening %s failed", package_path, exc_info=True)
        if code in library_health.TRANSIENT:
            return None, f"{library_health.message(code)} ({exc})", code
        return None, f"Photos.sqlite is not readable yet: {exc}", code
    reason = check_opened_ready(opened)
    if reason is not None:
        opened.close()
        return None, reason, library_health.INCOMPLETE
    return opened, None, None


def check_opened_ready(opened: libraries.OpenLibrary) -> str | None:
    """The post-open half of `check_ready` for a caller that already holds an
    open handle (it must still close it when this returns a reason)."""
    try:
        return _check_opened(opened)
    except Exception as exc:  # noqa: BLE001
        return f"copy looks incomplete: {exc}"


def _check_opened(opened: libraries.OpenLibrary) -> str | None:
    if opened.sqlite_path is not None:
        conn = sqlite3.connect(
            f"{opened.sqlite_path.resolve().as_uri()}?mode=ro", uri=True
        )
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
        candidates = [
            photo.path,
            photo.path_edited,
            photo.path_raw,
            *(photo.path_derivatives or []),
        ]
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
    db: sqlite3.Connection,
    library_id: int,
    trigger: str,
    outcome: str,
    started_at: str,
    error: str | None,
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


def _now(now: datetime.datetime | None) -> datetime.datetime:
    return now or datetime.datetime.now(datetime.UTC)


def record_problem(
    db: sqlite3.Connection,
    library_id: int,
    code: str,
    detail: str | None,
    *,
    phase: str,
    err: int | None = None,
    backoff: bool = True,
    now: datetime.datetime | None = None,
) -> None:
    """Store the latest failure (and, with `backoff`, when to try again) and
    log it as one WARNING line."""
    row = _get_row(db, library_id)
    if row is None:
        return
    now_dt = _now(now)
    count = row["retry_count"] or 0
    retry_after = row["retry_after"]
    if backoff:
        count += 1
        delay = min(RETRY_BASE_MINUTES * 2 ** min(count - 1, 16), RETRY_MAX_MINUTES)
        retry_after = _iso(now_dt + datetime.timedelta(minutes=delay))
    since = (
        row["problem_since"]
        if row["problem_code"] == code and row["problem_since"]
        else _iso(now_dt)
    )
    db.execute(
        "UPDATE libraries SET problem_code = ?, problem_detail = ?, problem_since = ?, "
        "retry_count = ?, retry_after = ? WHERE id = ?",
        (code, detail, since, count, retry_after, library_id),
    )
    db.commit()
    library_health.log_problem(
        library_id=library_id,
        phase=phase,
        path=row["path"],
        code=code,
        err=err,
        detail=(detail or "")
        + (f" (next try after {retry_after})" if backoff and retry_after else ""),
    )


def clear_problem(db: sqlite3.Connection, library_id: int) -> None:
    db.execute(
        "UPDATE libraries SET problem_code = NULL, problem_detail = NULL, problem_since = NULL, "
        "retry_count = 0, retry_after = NULL WHERE id = ? AND (problem_code IS NOT NULL "
        "OR retry_after IS NOT NULL OR retry_count != 0)",
        (library_id,),
    )
    db.commit()


def in_backoff(row: sqlite3.Row, *, now: datetime.datetime | None = None) -> bool:
    return bool(row["retry_after"]) and _now(now) < _parse(row["retry_after"])


def _has_live_writer(package_path: pathlib.Path) -> bool:
    sqlite_path = package_path / "database" / "Photos.sqlite"
    return any(
        library_health.exists(sqlite_path.with_name(sqlite_path.name + suffix))
        for suffix in ("-wal", "-shm")
    )


def _changed_in_place(row: sqlite3.Row, path: pathlib.Path) -> bool:
    """Photos writing to the indexed library, as opposed to a new copy."""
    if row["last_indexed_signature"] is None or row["indexed_identity"] is None:
        return False
    if indexer.package_identity(path) != row["indexed_identity"]:
        return False
    return row["in_place_since"] is not None or _has_live_writer(path)


def observe(
    db: sqlite3.Connection, library_id: int, *, now: datetime.datetime | None = None
) -> str:
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
    probe = library_health.probe_path(path)
    if probe.code in _MISSING_CODES:
        if row["missing_since"] is None:
            db.execute(
                "UPDATE libraries SET missing_since = ?, pending_signature = NULL, pending_since = NULL, "
                "pending_reason = NULL, in_place_since = NULL WHERE id = ?",
                (iso, library_id),
            )
            db.commit()
            app_db.write_audit_log(
                db,
                "library.file_missing",
                library_id=library_id,
                actor=SYSTEM_ACTOR,
                detail=str(path),
            )
            record_problem(
                db,
                library_id,
                probe.code,
                probe.detail
                + (f"; found at {probe.renamed_to}" if probe.renamed_to else ""),
                phase="check",
                err=probe.errno,
                backoff=False,
                now=now,
            )
        return "missing"
    if probe.code is not None:
        # Connected but unreadable (permission, a drive that doesn't answer):
        # not "missing". The last good index keeps serving.
        if row["problem_code"] != probe.code:
            record_problem(
                db,
                library_id,
                probe.code,
                probe.detail,
                phase="check",
                err=probe.errno,
                backoff=False,
                now=now,
            )
        return "unavailable"
    if row["missing_since"] is not None:
        db.execute(
            "UPDATE libraries SET missing_since = NULL WHERE id = ?", (library_id,)
        )
        db.commit()
    if row["problem_code"] in _PATH_CODES:
        clear_problem(db, library_id)
        row = _get_row(db, library_id)
    fp = fingerprint(path)
    if fp is None:
        return "unavailable"
    if indexer.sqlite_signature(path) == row["last_indexed_signature"]:
        if row["pending_signature"] is not None or row["in_place_since"] is not None:
            db.execute(
                "UPDATE libraries SET pending_signature = NULL, pending_since = NULL, pending_reason = NULL, "
                "in_place_since = NULL WHERE id = ?",
                (library_id,),
            )
            db.commit()
        if row["indexed_identity"] is None:
            # Indexed before #461: the package on disk is the one indexed.
            db.execute(
                "UPDATE libraries SET indexed_identity = ? WHERE id = ?",
                (indexer.package_identity(path), library_id),
            )
            db.commit()
        if row["problem_code"] is not None and not row["reindex_needed"]:
            clear_problem(db, library_id)
        return "ok"
    in_place = _changed_in_place(row, path)
    if row["pending_signature"] != fp:
        if in_place:
            db.execute(
                "UPDATE libraries SET pending_signature = ?, pending_since = ?, pending_reason = ?, "
                "in_place_since = COALESCE(in_place_since, ?) WHERE id = ?",
                (
                    fp,
                    iso,
                    library_health.message(library_health.PHOTOS_BUSY),
                    iso,
                    library_id,
                ),
            )
        else:
            # A new copy: whatever failed on the old one says nothing about it.
            db.execute(
                "UPDATE libraries SET pending_signature = ?, pending_since = ?, pending_reason = ?, "
                "in_place_since = NULL, retry_count = 0, retry_after = NULL WHERE id = ?",
                (
                    fp,
                    iso,
                    "a new copy of this library was detected and is being checked",
                    library_id,
                ),
            )
        db.commit()
        return "pending"
    now_dt = _now(now)
    waited = (now_dt - _parse(row["pending_since"])).total_seconds()
    if waited >= stable_minutes(db) * 60:
        return "stable"
    if (
        in_place
        and row["in_place_since"] is not None
        and (now_dt - _parse(row["in_place_since"])).total_seconds()
        >= IN_PLACE_MAX_WAIT_MINUTES * 60
    ):
        return "stable"
    return "pending"


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
        opened, reason, code = check_ready_detailed(path)
        if opened is None:
            transient = code in library_health.TRANSIENT
            if row["pending_signature"] is None:
                db.execute(
                    "UPDATE libraries SET pending_signature = ?, pending_since = ? WHERE id = ?",
                    (fingerprint(path) or "", started_at, library_id),
                )
            if not transient and row["in_place_since"] is not None:
                # Not Photos at work after all: the database itself is bad.
                # Treat it like any not-ready copy ("Being updated").
                db.execute(
                    "UPDATE libraries SET in_place_since = NULL WHERE id = ?",
                    (library_id,),
                )
            if reason != row["pending_reason"]:
                _record_run(db, library_id, trigger, "not_ready", started_at, reason)
            db.execute(
                "UPDATE libraries SET pending_reason = ? WHERE id = ?",
                (reason, library_id),
            )
            db.commit()
            record_problem(
                db, library_id, code or library_health.UNREADABLE, reason, phase="apply"
            )
            return "not_ready"
        try:
            mark_indexing(db, library_id)
            indexer.index_library(
                db, library_id, path, force=True, trigger=trigger, opened=opened
            )
            mark_indexed(db, library_id)
        except Exception as exc:
            error = str(exc)
            code = library_health.classify(exc)
            transient = code in library_health.TRANSIENT
            # The walk rolled back, so the previous index survives. A transient
            # failure keeps serving it (no error state); anything else shows
            # "Being updated" until a later check applies a good copy.
            _record_run(db, library_id, trigger, "failed", started_at, error)
            if transient:
                mark_indexed(db, library_id)
                reason = library_health.message(code)
            else:
                mark_index_error(db, library_id, error)
                reason = f"indexing failed: {error}"
                db.execute(
                    "UPDATE libraries SET in_place_since = NULL WHERE id = ?",
                    (library_id,),
                )
            db.execute(
                "UPDATE libraries SET pending_signature = COALESCE(pending_signature, ?), "
                "pending_since = COALESCE(pending_since, ?), pending_reason = ? WHERE id = ?",
                (fingerprint(path) or "", started_at, reason, library_id),
            )
            db.commit()
            app_db.write_audit_log(
                db,
                "library.update.failed",
                library_id=library_id,
                actor=SYSTEM_ACTOR,
                detail=error,
            )
            record_problem(
                db,
                library_id,
                code,
                error,
                phase="index",
                err=library_health.error_errno(exc),
            )
            logger.debug(
                "applying library %s (%s) failed", library_id, path, exc_info=True
            )
            return "failed"
        run = db.execute(
            "SELECT * FROM library_index_runs WHERE library_id = ? ORDER BY id DESC LIMIT 1",
            (library_id,),
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


def check_library(
    db: sqlite3.Connection,
    library_id: int,
    *,
    now: datetime.datetime | None = None,
    ignore_backoff: bool = False,
) -> str:
    state = observe(db, library_id, now=now)
    if state not in ("stable", "ok"):
        return state
    row = _get_row(db, library_id)
    if row is not None and not ignore_backoff and in_backoff(row, now=now):
        return "waiting" if state == "stable" else "ok"
    if state == "stable":
        return try_apply(db, library_id, trigger="auto")
    return reindex_if_needed(db, library_id)


def reindex_if_needed(db: sqlite3.Connection, library_id: int) -> str:
    """#100: one in-place re-index of an unchanged library after a migration
    added asset columns. Unlike `try_apply` it never sets a pending / "Being
    updated" state: the existing index keeps serving, and a failure just
    leaves the flag set for the next check (after a backoff)."""
    row = _get_row(db, library_id)
    if row is None or not row["reindex_needed"]:
        return "ok"
    lock = _lock_for(library_id)
    if not lock.acquire(blocking=False):
        return "ok"
    try:
        indexer.index_library(
            db, library_id, pathlib.Path(row["path"]), force=True, trigger="auto"
        )
        # #73: a startup reset leaves an "interrupted" error behind; a
        # successful re-index supersedes it.
        db.execute(
            "UPDATE libraries SET index_state = 'idle', index_error = NULL WHERE id = ? AND index_state = 'error'",
            (library_id,),
        )
        db.commit()
        return "reindexed"
    except Exception as exc:
        record_problem(
            db,
            library_id,
            library_health.classify(exc),
            str(exc),
            phase="reindex",
            err=library_health.error_errno(exc),
        )
        logger.debug("re-indexing library %s failed", library_id, exc_info=True)
        return "ok"
    finally:
        lock.release()


def check_all(
    db: sqlite3.Connection,
    *,
    now: datetime.datetime | None = None,
    ignore_backoff: bool = False,
) -> dict[int, str]:
    results: dict[int, str] = {}
    for row in db.execute("SELECT id FROM libraries ORDER BY id").fetchall():
        try:
            results[row["id"]] = check_library(
                db, row["id"], now=now, ignore_backoff=ignore_backoff
            )
        except Exception:
            logger.warning("checking library %s failed", row["id"], exc_info=True)
    return results


def availability(row: sqlite3.Row) -> tuple[bool, str | None]:
    """(updating, reason): whether users should see "Being updated"."""
    if row["missing_since"] is not None:
        return True, f"Library file missing since {_display(row['missing_since'])}"
    keys = row.keys()
    if (
        "in_place_since" in keys
        and row["in_place_since"] is not None
        and row["last_indexed_at"] is not None
    ):
        # Photos changing the indexed library: keep serving the last index.
        return False, None
    if row["pending_signature"] is not None:
        return True, row[
            "pending_reason"
        ] or "A new copy of this library is being checked"
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


def pending_too_long(row: sqlite3.Row, *, now: datetime.datetime | None = None) -> bool:
    since = row["pending_since"] or row["missing_since"]
    if since is None:
        return False
    now = now or datetime.datetime.now(datetime.UTC)
    return (now - _parse(since)).total_seconds() > STALE_PENDING_HOURS * 3600


# One whole-registry pass at a time: the background checker and an admin's
# "Check now" share it, so a click during a pass (or two clicks) starts nothing
# new. Per-library locks still guard each library's own indexing job.
_pass_lock = threading.Lock()
_manual_thread: threading.Thread | None = None


def check_all_exclusive(
    db: sqlite3.Connection, *, ignore_backoff: bool = False
) -> dict[int, str] | None:
    """`check_all`, or `None` without doing anything if a pass is running."""
    if not _pass_lock.acquire(blocking=False):
        return None
    try:
        return check_all(db, ignore_backoff=ignore_backoff)
    finally:
        _pass_lock.release()


def start_manual_check(data_dir_getter: Callable[[], pathlib.Path]) -> bool:
    """Admin "Check now": one `check_all` pass in a background thread (an
    index can take minutes), with its own `app.db` connection. Returns `False`
    when a pass is already running. The stability window still applies: a copy
    that changed this minute is marked pending, not indexed half-copied."""
    global _manual_thread
    if _pass_lock.locked():
        return False

    def run() -> None:
        try:
            conn = app_db.connect(data_dir_getter())
            try:
                # The admin asked: try now, whatever the backoff says.
                check_all_exclusive(conn, ignore_backoff=True)
            finally:
                conn.close()
        except Exception:
            logger.warning("manual library check failed", exc_info=True)

    _manual_thread = threading.Thread(target=run, name="library-check-now", daemon=True)
    _manual_thread.start()
    return True


class LibraryChecker(threading.Thread):
    """Background thread: wakes every `library_check_interval_minutes`
    (`0` = "Manual only", re-read each wake) and runs `check_all`. Opens its own
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
                        check_all_exclusive(conn)
                        delay = minutes * 60.0
                finally:
                    conn.close()
            except Exception:
                logger.warning("library check pass failed", exc_info=True)
