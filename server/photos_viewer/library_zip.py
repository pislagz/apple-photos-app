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
import sqlite3
import zipfile
from collections.abc import Iterator
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
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
        ),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="photos.zip"',
            # Sum of the stored sizes (zip overhead excluded): lets the client show progress.
            "X-Zip-Total-Bytes": str(total),
            "Cache-Control": "private, no-store",
        },
    )
