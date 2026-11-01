"""Admin-only API for the library registry (P1.5): add, list, rename, remove,
and report status for each registered `.photoslibrary`. API only -- P1.10
builds the admin UI against these routes.

Only `libraries.py` touches a `.photoslibrary` path; this module calls its
public functions (`open_library_readonly`, `library_is_locked`) rather than
opening anything itself. `total_size_bytes` is the one exception -- it walks
the package directory for file sizes, not its database.

Asset/video/people counts, last-index time, and pre-warm progress all depend
on the asset index (P1.6) and pre-warm (P3.3), neither of which exists yet;
they are always `null` until those land.
"""

from __future__ import annotations

import os
import pathlib
import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import app_db, libraries, session_auth
from .libraries import UnsupportedPhotosVersionError, open_library_readonly

router = APIRouter()


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


def _total_size_bytes(path: pathlib.Path) -> int | None:
    if not path.exists():
        return None
    total = 0
    for entry in path.rglob("*"):
        try:
            if entry.is_file():
                total += entry.stat().st_size
        except OSError:
            continue  # a dangling symlink or a file removed mid-walk
    return total


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


def _build_status(row: sqlite3.Row) -> LibraryStatusResponse:
    path = pathlib.Path(row["path"])
    return LibraryStatusResponse(
        id=row["id"],
        display_name=row["display_name"],
        path=row["path"],
        total_size_bytes=_total_size_bytes(path),
        warnings=_warnings_for(path),
    )


@router.post(
    "/api/admin/libraries",
    response_model=LibraryResponse,
    status_code=201,
    dependencies=[Depends(session_auth._reject_cross_site_requests)],
)
def add_library(
    payload: LibraryAddRequest,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
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
    app_db.write_audit_log(db, "add_library", library_id=library_id, actor=admin["username"], detail=str(path))
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
    library_id: int, admin: sqlite3.Row = Depends(session_auth.require_admin), db: sqlite3.Connection = Depends(session_auth.get_db)
) -> LibraryStatusResponse:
    row = _get_library_or_404(db, library_id)
    return _build_status(row)
