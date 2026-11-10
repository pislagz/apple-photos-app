"""P3.2: `POST /api/libraries/{library_id}/zip` -- selected originals as one
streamed zip.

Nothing is written to disk: the archive is generated chunk by chunk into the
response (stdlib `zipfile` on an unseekable sink, ZIP_STORED because photos
and videos are already compressed), so there is no temp file to clean up and
nothing is ever written into the `.photoslibrary` package. Every id is
resolved with the same checks as the single-original route *before* the first
byte is sent, so a foreign/unknown/locked-hidden id is a 404 and an over-limit
selection is a 413 with an empty body of bytes.
"""

from __future__ import annotations

import pathlib
import secrets
import sqlite3
import threading
import time
import zipfile
from collections.abc import Iterator
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import app_db, library_assets, media, session_auth

DEFAULT_ZIP_SIZE_LIMIT_BYTES = 2 * 1024**3
MAX_ZIP_ASSETS = 5000
CHUNK = 1024 * 1024
_CONVERTIBLE_SUFFIXES = {".heic", ".heif"}

router = APIRouter()


class ZipRequest(BaseModel):
    asset_ids: list[str] = Field(min_length=1, max_length=MAX_ZIP_ASSETS)
    version: Literal["original", "edited"] = "original"
    # "jpeg" converts HEIC/HEIF stills with the thumbnail converter (media.to_jpeg
    # via the cache); everything else is stored as-is.
    format: Literal["native", "jpeg"] = "native"


class _Sink:
    """Unseekable write target: zipfile appends, the generator drains."""

    def __init__(self) -> None:
        self._chunks: list[bytes] = []
        self._pos = 0

    def write(self, data: bytes) -> int:
        self._chunks.append(bytes(data))
        self._pos += len(data)
        return len(data)

    def tell(self) -> int:
        return self._pos

    def flush(self) -> None:
        pass

    def drain(self) -> bytes:
        data = b"".join(self._chunks)
        self._chunks.clear()
        return data


def _unique_name(name: str, used: set[str]) -> str:
    # Case-insensitive: the zip is usually unpacked on macOS/Windows.
    safe = name.replace("/", "_").replace("\\", "_") or "file"
    candidate, stem, suffix, n = (
        safe,
        pathlib.PurePath(safe).stem,
        pathlib.PurePath(safe).suffix,
        1,
    )
    while candidate.lower() in used:
        n += 1
        candidate = f"{stem} ({n}){suffix}"
    used.add(candidate.lower())
    return candidate


def _resolve_source(
    library: sqlite3.Row, asset: sqlite3.Row, version: str
) -> pathlib.Path:
    """Same source choice as `asset_original`, including the derivative
    fallback for an "Optimize Mac Storage" copy."""
    raw_path = asset["path_edited"] if version == "edited" else asset["path_original"]
    if (
        version == "original"
        and asset["path_derivative"]
        and (
            not raw_path
            or not library_assets._resolve_within_library(
                library["path"], raw_path
            ).exists()
        )
    ):
        raw_path = asset["path_derivative"]
    if not raw_path:
        raise HTTPException(status_code=404, detail="not found")
    path = library_assets._resolve_within_library(library["path"], raw_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="not found")
    return path


def _entries(
    library_id: int,
    assets: list[tuple[sqlite3.Row, pathlib.Path]],
    fmt: str,
    version: str,
    cache_dir: pathlib.Path,
    cache_limit: int,
    job: _Job | None = None,
) -> Iterator[bytes]:
    try:
        yield from _write_entries(
            library_id, assets, fmt, version, cache_dir, cache_limit, job
        )
    finally:
        if job is not None:
            job.finish()


def _write_entries(
    library_id: int,
    assets: list[tuple[sqlite3.Row, pathlib.Path]],
    fmt: str,
    version: str,
    cache_dir: pathlib.Path,
    cache_limit: int,
    job: _Job | None,
) -> Iterator[bytes]:
    sink = _Sink()
    used: set[str] = set()
    with zipfile.ZipFile(sink, "w", zipfile.ZIP_STORED, allowZip64=True) as archive:  # type: ignore[arg-type]
        for asset, path in assets:
            name = asset["original_filename"] or asset["filename"] or path.name
            converted: bytes | None = None
            if (
                fmt == "jpeg"
                and not asset["is_video"]
                and path.suffix.lower() in _CONVERTIBLE_SUFFIXES
            ):
                try:
                    converted = media.get_or_generate_jpeg(
                        cache_dir,
                        library_id=library_id,
                        asset_uuid=f"{asset['uuid']}:{version}",
                        source_path=path,
                        cache_size_limit_bytes=cache_limit,
                    )
                    name = str(pathlib.PurePath(name).with_suffix(".jpg"))
                except media.MediaBackendError:
                    converted = None  # undecodable: ship the original rather than fail mid-stream
                    if job is not None:
                        job.unconverted.append((asset["uuid"], name))
            info = zipfile.ZipInfo(_unique_name(name, used))
            info.compress_type = zipfile.ZIP_STORED
            if converted is not None:
                with archive.open(info, "w", force_zip64=True) as out:
                    out.write(converted)
            else:
                with (
                    path.open("rb") as source,
                    archive.open(info, "w", force_zip64=True) as out,
                ):
                    while block := source.read(CHUNK):
                        out.write(block)
                        yield sink.drain()
            yield sink.drain()
    yield sink.drain()


# D50: the stream stays a stream, so a HEIC that cannot be converted is shipped
# as the original and the zip itself cannot say so. Each `format=jpeg` zip gets
# a job id (header `X-Zip-Job` on the POST route, `job` in the ticket answer),
# and `GET .../zip/report?job=` lists the files that stayed HEIC once the
# stream has finished (`done`). A navigation download cannot read response
# headers, which is why the id also comes with the ticket. Reports are in
# memory (single process), bound to the user and library, and expire.
REPORT_TTL_SECONDS = 600
_PENDING_JOB_TTL_SECONDS = 120
_MAX_JOBS = 200


class _Job:
    def __init__(self, user_id: int, library_id: int) -> None:
        self.user_id = user_id
        self.library_id = library_id
        self.done = False
        self.expires = time.monotonic() + _PENDING_JOB_TTL_SECONDS
        self.unconverted: list[tuple[str, str]] = []

    def start(self) -> None:
        # A long stream keeps its entry alive; `finish` starts the real TTL.
        self.expires = time.monotonic() + 24 * 3600

    def finish(self) -> None:
        self.done = True
        self.expires = time.monotonic() + REPORT_TTL_SECONDS


_jobs: dict[str, _Job] = {}
_jobs_lock = threading.Lock()


def _new_job(user_id: int, library_id: int) -> tuple[str, _Job]:
    now = time.monotonic()
    with _jobs_lock:
        for key in [k for k, v in _jobs.items() if v.expires <= now]:
            del _jobs[key]
        while len(_jobs) >= _MAX_JOBS:
            del _jobs[next(iter(_jobs))]
        job_id = secrets.token_urlsafe(12)
        job = _Job(user_id, library_id)
        _jobs[job_id] = job
    return job_id, job


class UnconvertedFile(BaseModel):
    id: str
    name: str


class ZipReportResponse(BaseModel):
    done: bool
    unconverted: list[UnconvertedFile]


def _prepare(
    payload: ZipRequest,
    library: sqlite3.Row,
    session: sqlite3.Row,
    db: sqlite3.Connection,
) -> tuple[list[tuple[sqlite3.Row, pathlib.Path]], int]:
    """Resolve every id with the single-original route's checks and enforce
    the size limit, before any byte (or ticket) is produced."""
    resolved: list[tuple[sqlite3.Row, pathlib.Path]] = []
    total = 0
    for asset_id in dict.fromkeys(payload.asset_ids):
        asset = library_assets._get_media_asset_or_404(
            db, library["id"], asset_id, session
        )
        path = _resolve_source(library, asset, payload.version)
        total += path.stat().st_size
        resolved.append((asset, path))

    stored = app_db.get_setting(db, "zip_size_limit_bytes")
    limit = DEFAULT_ZIP_SIZE_LIMIT_BYTES if stored is None else int(stored)
    if total > limit:
        raise HTTPException(
            status_code=413,
            detail=f"Selection is {total} bytes; the zip limit is {limit} bytes. Select fewer items.",
        )
    return resolved, total


def _stream(
    payload: ZipRequest,
    library: sqlite3.Row,
    session: sqlite3.Row,
    db: sqlite3.Connection,
    cache_dir: pathlib.Path,
    job_id: str | None = None,
) -> StreamingResponse:
    resolved, total = _prepare(payload, library, session, db)
    job = None
    if payload.format == "jpeg":
        if job_id is None:
            job_id, job = _new_job(session["user_id"], library["id"])
        else:
            with _jobs_lock:
                job = _jobs.get(job_id)
        if job is not None:
            job.start()
    app_db.write_audit_log(
        db,
        "zip",
        user_id=session["user_id"],
        library_id=library["id"],
        detail=f"count={len(resolved)} bytes={total} version={payload.version} format={payload.format}",
    )
    _, _, cache_limit = library_assets._media_settings(db)
    return StreamingResponse(
        _entries(
            library["id"],
            resolved,
            payload.format,
            payload.version,
            cache_dir,
            cache_limit,
            job,
        ),
        media_type="application/zip",
        headers={
            **({"X-Zip-Job": job_id} if job is not None and job_id else {}),
            "Content-Disposition": 'attachment; filename="photos.zip"',
            # Sum of the stored sizes (zip overhead excluded): lets the client show progress.
            "X-Zip-Total-Bytes": str(total),
            "Cache-Control": "private, no-store",
        },
    )


@router.post(
    "/api/libraries/{library_id}/zip",
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def download_zip(
    payload: ZipRequest,
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    cache_dir: pathlib.Path = Depends(session_auth.get_media_cache_dir),
):
    return _stream(payload, library, session, db, cache_dir)


# D47: a download the browser itself streams to disk (iPhone/iPad, or a big
# selection) is a plain navigation, which cannot be a JSON POST: the CSRF guard
# above only accepts application/json, and a form POST is exactly what that
# rule exists to refuse. So the selection is POSTed as JSON first (guarded,
# validated, 404/413 answered as JSON) and only buys a short-lived, single-use
# ticket; the navigation is then `GET .../zip/download?ticket=`. The ticket is
# an unguessable random string held in this process's memory (the server is a
# single uvicorn process; a restart just invalidates pending tickets), bound to
# the user and library that asked, and the GET still needs the session cookie
# (SameSite=Strict), so a leaked URL is useless to anyone else and after 60 s.
TICKET_TTL_SECONDS = 60
_MAX_TICKETS = 200
_tickets: dict[str, tuple[float, int, int, ZipRequest, str | None]] = {}
_tickets_lock = threading.Lock()


def _issue_ticket(
    user_id: int, library_id: int, payload: ZipRequest, job_id: str | None
) -> str:
    now = time.monotonic()
    with _tickets_lock:
        for key in [k for k, v in _tickets.items() if v[0] <= now]:
            del _tickets[key]
        while len(_tickets) >= _MAX_TICKETS:
            del _tickets[next(iter(_tickets))]
        ticket = secrets.token_urlsafe(24)
        _tickets[ticket] = (
            now + TICKET_TTL_SECONDS,
            user_id,
            library_id,
            payload,
            job_id,
        )
    return ticket


def _redeem_ticket(
    ticket: str, user_id: int, library_id: int
) -> tuple[ZipRequest, str | None]:
    with _tickets_lock:
        entry = _tickets.pop(ticket, None)
    if entry is None or entry[0] <= time.monotonic():
        raise HTTPException(status_code=404, detail="not found")
    if entry[1] != user_id or entry[2] != library_id:
        raise HTTPException(status_code=404, detail="not found")
    return entry[3], entry[4]


class ZipTicketResponse(BaseModel):
    ticket: str
    total_bytes: int
    expires_in: int
    # Set for `format=jpeg`: pass to `GET .../zip/report?job=` after the download.
    job: str | None = None


@router.post(
    "/api/libraries/{library_id}/zip/ticket",
    response_model=ZipTicketResponse,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def zip_ticket(
    payload: ZipRequest,
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> ZipTicketResponse:
    _, total = _prepare(payload, library, session, db)
    job_id = (
        _new_job(session["user_id"], library["id"])[0]
        if payload.format == "jpeg"
        else None
    )
    ticket = _issue_ticket(session["user_id"], library["id"], payload, job_id)
    return ZipTicketResponse(
        ticket=ticket, total_bytes=total, expires_in=TICKET_TTL_SECONDS, job=job_id
    )


@router.get("/api/libraries/{library_id}/zip/download")
def zip_download(
    ticket: str = Query(default=""),
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    cache_dir: pathlib.Path = Depends(session_auth.get_media_cache_dir),
):
    payload, job_id = _redeem_ticket(ticket, session["user_id"], library["id"])
    return _stream(payload, library, session, db, cache_dir, job_id)


@router.get("/api/libraries/{library_id}/zip/report", response_model=ZipReportResponse)
def zip_report(
    job: str = Query(default=""),
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    session: sqlite3.Row = Depends(session_auth.require_session),
) -> ZipReportResponse:
    with _jobs_lock:
        entry = _jobs.get(job)
    if (
        entry is None
        or entry.expires <= time.monotonic()
        or entry.user_id != session["user_id"]
        or entry.library_id != library["id"]
    ):
        raise HTTPException(status_code=404, detail="not found")
    return ZipReportResponse(
        done=entry.done,
        unconverted=[UnconvertedFile(id=i, name=n) for i, n in entry.unconverted],
    )
