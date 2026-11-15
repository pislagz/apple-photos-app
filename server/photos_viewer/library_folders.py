"""Folders that hold `.photoslibrary` packages, and the picker listing.

The admin keeps an editable list of folders. The server only ever lists the
direct children of those folders (depth 1), so the picker can never be used to
browse the rest of the filesystem. Reading is `iterdir()` and `stat()` on the
parent directories; no database inside a package is opened here.
"""

from __future__ import annotations

import difflib
import json
import os
import pathlib
import sqlite3
import threading

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import app_db, session_auth

router = APIRouter()

FOLDERS_KEY = "library_folders"
LIBRARIES_DIR_ENV = "PHOTOS_VIEWER_LIBRARIES_DIR"
DOCKER_MOUNT = pathlib.Path("/libraries")
MAX_CANDIDATES = 200


def _seed_from_environment() -> list[str]:
    raw = os.environ.get(LIBRARIES_DIR_ENV, "")
    folders = [p for p in raw.split(os.pathsep) if p.strip()]
    if not folders and DOCKER_MOUNT.is_dir():
        folders = [str(DOCKER_MOUNT)]
    return folders


def _normalize(path: str) -> str | None:
    try:
        return str(pathlib.Path(path).expanduser().resolve())
    except (OSError, RuntimeError, ValueError):
        return None


def get_folders(db: sqlite3.Connection) -> list[str]:
    """The configured folders. The first read seeds the list from the
    environment (or the Docker mount) so existing setups keep working."""
    stored = app_db.get_setting(db, FOLDERS_KEY)
    if stored is None:
        seeded: list[str] = []
        for raw in _seed_from_environment():
            norm = _normalize(raw)
            if norm and norm not in seeded:
                seeded.append(norm)
        app_db.set_setting(db, FOLDERS_KEY, json.dumps(seeded))
        return seeded
    try:
        value = json.loads(stored)
    except ValueError:
        return []
    return [v for v in value if isinstance(v, str)]


def _save(db: sqlite3.Connection, folders: list[str]) -> None:
    app_db.set_setting(db, FOLDERS_KEY, json.dumps(folders))


def _list_folder(folder: str) -> tuple[bool, list[pathlib.Path]]:
    """Packages directly inside `folder`. A symlink that leads outside the
    folder is skipped. Returns (reachable, packages)."""
    try:
        root = pathlib.Path(folder).resolve()
        entries = sorted(root.iterdir(), key=lambda p: p.name.casefold())
    except OSError:
        return False, []
    found: list[pathlib.Path] = []
    for entry in entries:
        if entry.name.startswith(".") or entry.suffix != ".photoslibrary":
            continue
        try:
            resolved = entry.resolve()
            if not resolved.is_relative_to(root) or not resolved.is_dir():
                continue
        except (OSError, RuntimeError):
            continue
        found.append(resolved)
    return True, found


def found_packages(db: sqlite3.Connection) -> list[pathlib.Path]:
    seen: dict[pathlib.Path, None] = {}
    for folder in get_folders(db):
        for package in _list_folder(folder)[1]:
            seen.setdefault(package)
    return list(seen)[:MAX_CANDIDATES]


def nearby_hint(db: sqlite3.Connection, missing: pathlib.Path) -> str:
    """Plain-language sentence about what exists in the configured folders,
    for a typed path that does not exist. Never lists anything outside them."""
    packages = found_packages(db)
    if not packages:
        return "No libraries found. Add a folder that contains your Photos libraries."
    names = {p.name: p for p in packages}
    # Compare names without the shared ".photoslibrary" ending, which would
    # make every pair look similar.
    stems = {n.removesuffix(".photoslibrary").casefold(): n for n in names}
    wanted = missing.name.removesuffix(".photoslibrary").casefold()
    close = [
        stems[m]
        for m in difflib.get_close_matches(wanted, list(stems), n=3, cutoff=0.6)
    ]
    if close:
        return "Did you mean " + " or ".join(close) + "?"
    shown = ", ".join(sorted(names)[:5])
    more = "" if len(names) <= 5 else f" and {len(names) - 5} more"
    return f"Libraries that were found: {shown}{more}."


class FolderResponse(BaseModel):
    path: str
    reachable: bool


class FolderAddRequest(BaseModel):
    path: str


class CandidateResponse(BaseModel):
    name: str
    path: str
    folder: str
    registered: bool
    library_id: int | None = None
    library_name: str | None = None
    status: str  # "ready" | "not_added" | "cannot_open"
    asset_count: int | None = None
    # Filled lazily by GET /api/admin/library-candidates/size.
    size_bytes: int | None = None


class CandidatesResponse(BaseModel):
    folders: list[FolderResponse]
    candidates: list[CandidateResponse]


class SizeResponse(BaseModel):
    path: str
    size_bytes: int | None


def _folder_responses(db: sqlite3.Connection) -> list[FolderResponse]:
    return [
        FolderResponse(path=f, reachable=_list_folder(f)[0]) for f in get_folders(db)
    ]


@router.get("/api/admin/library-folders", response_model=list[FolderResponse])
def list_folders(
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> list[FolderResponse]:
    return _folder_responses(db)


@router.post(
    "/api/admin/library-folders",
    response_model=list[FolderResponse],
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def add_folder(
    payload: FolderAddRequest,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> list[FolderResponse]:
    norm = _normalize(payload.path) if payload.path.strip() else None
    if norm is None or "\x00" in payload.path:
        raise HTTPException(status_code=400, detail="Enter the path of a folder.")
    path = pathlib.Path(norm)
    if not path.is_dir():
        raise HTTPException(
            status_code=400,
            detail=f"{norm} is not a folder that can be found. Is the drive connected?",
        )
    if path == pathlib.Path(path.anchor):
        raise HTTPException(
            status_code=400,
            detail="Pick the folder that contains your libraries, not the whole drive.",
        )
    folders = get_folders(db)
    if norm not in folders:
        folders.append(norm)
        _save(db, folders)
        app_db.write_audit_log(
            db, "add_library_folder", actor=admin["username"], detail=norm
        )
    return _folder_responses(db)


@router.delete(
    "/api/admin/library-folders",
    response_model=list[FolderResponse],
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def remove_folder(
    path: str,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> list[FolderResponse]:
    folders = get_folders(db)
    if path not in folders:
        raise HTTPException(status_code=404, detail="not found")
    _save(db, [f for f in folders if f != path])
    app_db.write_audit_log(
        db, "remove_library_folder", actor=admin["username"], detail=path
    )
    return _folder_responses(db)


@router.get("/api/admin/library-candidates", response_model=CandidatesResponse)
def list_candidates(
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> CandidatesResponse:
    registered = {
        pathlib.Path(r["path"]).resolve(): r
        for r in db.execute("SELECT id, display_name, path FROM libraries")
    }
    counts = {
        r["library_id"]: r["n"]
        for r in db.execute(
            "SELECT library_id, COUNT(*) AS n FROM assets WHERE hidden = 0 "
            "GROUP BY library_id"
        )
    }
    folders = get_folders(db)
    candidates: list[CandidateResponse] = []
    seen: set[pathlib.Path] = set()
    for folder in folders:
        for package in _list_folder(folder)[1]:
            if package in seen or len(candidates) >= MAX_CANDIDATES:
                continue
            seen.add(package)
            row = registered.get(package)
            readable = (
                os.access(package, os.R_OK | os.X_OK)
                and (package / "database" / "Photos.sqlite").is_file()
            )
            if row is not None:
                status = "ready"
            else:
                status = "not_added" if readable else "cannot_open"
            candidates.append(
                CandidateResponse(
                    name=package.name,
                    path=str(package),
                    folder=folder,
                    registered=row is not None,
                    library_id=row["id"] if row else None,
                    library_name=row["display_name"] if row else None,
                    status=status,
                    asset_count=counts.get(row["id"], 0) if row else None,
                )
            )
    return CandidatesResponse(
        folders=[FolderResponse(path=f, reachable=_list_folder(f)[0]) for f in folders],
        candidates=candidates,
    )


_size_cache: dict[tuple[str, int], int] = {}
_size_lock = threading.Lock()


def _directory_size(root: pathlib.Path) -> int:
    """Bytes on disk below `root`; stat only, symlinks counted but not followed."""
    total = 0
    stack = [str(root)]
    while stack:
        try:
            with os.scandir(stack.pop()) as it:
                for entry in it:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                        else:
                            total += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
        except OSError:
            continue
    return total


@router.get("/api/admin/library-candidates/size", response_model=SizeResponse)
def candidate_size(
    path: str,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> SizeResponse:
    """Size of one listed package. Only paths the listing itself returns are
    accepted, so this can't be used to measure arbitrary directories."""
    package = next((p for p in found_packages(db) if str(p) == path), None)
    if package is None:
        raise HTTPException(status_code=404, detail="not found")
    try:
        key = (str(package), package.stat().st_mtime_ns)
    except OSError:
        raise HTTPException(status_code=404, detail="not found") from None
    with _size_lock:
        cached = _size_cache.get(key)
    if cached is None:
        cached = _directory_size(package)
        with _size_lock:
            _size_cache[key] = cached
    return SizeResponse(path=str(package), size_bytes=cached)
