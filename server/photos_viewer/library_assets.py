"""P1.9: the read API for a library's indexed assets.

Every route here reads only `app.db` (the P1.6 index) -- never a
`.photoslibrary` path at request time -- and depends on
`session_auth.require_library_assignment`, so a foreign `library_id` and a
foreign asset id both 404 the same way `docs/CLAUDE.md` requires. File
routes (`thumb`, `original`, `livephoto`) only ever serve a path already
recorded in `assets` for that library, and that path is checked against the
library's own registered root before it is opened, so a corrupted index row
can't be used to read outside the package.
"""

from __future__ import annotations

import base64
import mimetypes
import pathlib
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from . import app_db, media, session_auth

router = APIRouter()

DEFAULT_LIMIT = 100
MAX_LIMIT = 500

# `date_created_local_day` is only populated by indexer.py from P1.12A on --
# a row written before that migration, or inserted directly by a test, has
# no value there. Falling back to the first 10 chars of the UTC
# `date_created` keeps those rows bucketed (one day off, at worst) instead
# of excluded from every summary bucket and from/to filter.
_LOCAL_DAY_SQL = "COALESCE(date_created_local_day, substr(date_created, 1, 10))"


def _escape_content_disposition_filename(filename: str) -> str:
    """RFC 6266 quoted-string escaping for a `Content-Disposition` header
    built by hand (`FileResponse`'s own `filename=` escapes safely on its
    own and isn't touched here). Without this, a filename containing a
    `"` or a CR/LF -- both of which osxphotos will happily report, since a
    `.photoslibrary` filename is whatever the OS let the user name it --
    could break out of the quoted string or inject a header."""
    sanitized = filename.replace("\r", "").replace("\n", "")
    return sanitized.replace("\\", "\\\\").replace('"', '\\"')


def _media_settings(db: sqlite3.Connection) -> tuple[dict[str, int], int, int]:
    sizes = {
        key: int(app_db.get_setting(db, f"thumb_size_{key}") or default) for key, default in media.SIZES.items()
    }
    quality = int(app_db.get_setting(db, "thumb_quality") or media.DEFAULT_QUALITY)
    cache_limit = int(
        app_db.get_setting(db, "media_cache_size_limit_bytes") or media.DEFAULT_CACHE_SIZE_LIMIT_BYTES
    )
    return sizes, quality, cache_limit


class LibrarySummary(BaseModel):
    id: int
    display_name: str


class MeResponse(BaseModel):
    username: str
    role: Literal["admin", "user"]
    libraries: list[LibrarySummary]
    layout_override: Literal["desktop", "mobile"] | None


@router.get("/api/me", response_model=MeResponse)
def read_me(
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> MeResponse:
    rows = db.execute(
        "SELECT libraries.id, libraries.display_name FROM libraries "
        "JOIN library_assignments ON library_assignments.library_id = libraries.id "
        "WHERE library_assignments.user_id = ? ORDER BY libraries.display_name",
        (session["user_id"],),
    ).fetchall()
    return MeResponse(
        username=session["username"],
        role=session["role"],
        libraries=[LibrarySummary(id=row["id"], display_name=row["display_name"]) for row in rows],
        layout_override=session["layout_override"],
    )


class LayoutOverrideRequest(BaseModel):
    layout_override: Literal["desktop", "mobile"] | None


@router.put("/api/me/layout-override", status_code=204, dependencies=[Depends(session_auth._reject_cross_site_requests)])
def write_layout_override(
    payload: LayoutOverrideRequest,
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> None:
    """Server-side layout choice, so it follows a user across devices.
    The web app's localStorage copy is only a fast default while this
    loads -- this value is authoritative once `/api/me` returns it."""
    db.execute(
        "UPDATE users SET layout_override = ? WHERE id = ?", (payload.layout_override, session["user_id"])
    )
    db.commit()


class AssetListItem(BaseModel):
    id: str
    filename: str | None
    date: str | None
    is_video: bool
    is_live_photo: bool
    favorite: bool
    width: int | None
    height: int | None
    duration: float | None


class AssetListResponse(BaseModel):
    items: list[AssetListItem]
    next_cursor: str | None


def _encode_cursor(date_created: str, asset_row_id: int) -> str:
    raw = f"{date_created}\x00{asset_row_id}".encode()
    return base64.urlsafe_b64encode(raw).decode()


def _decode_cursor(cursor: str) -> tuple[str, int]:
    try:
        date_created, asset_row_id = base64.urlsafe_b64decode(cursor.encode()).decode().split("\x00")
        return date_created, int(asset_row_id)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="invalid cursor") from exc


def _to_list_item(row: sqlite3.Row) -> AssetListItem:
    return AssetListItem(
        id=row["uuid"],
        filename=row["filename"],
        date=row["date_created"],
        is_video=bool(row["is_video"]),
        is_live_photo=bool(row["is_live_photo"]),
        favorite=bool(row["favorite"]),
        width=row["width"],
        height=row["height"],
        duration=row["duration"],
    )


def _list_assets(
    db: sqlite3.Connection,
    library_id: int,
    *,
    hidden: bool,
    cursor: str | None,
    limit: int,
    type_: Literal["photo", "video"] | None,
    from_: str | None,
    to: str | None,
) -> AssetListResponse:
    clauses = ["library_id = ?", "hidden = ?"]
    params: list[object] = [library_id, int(hidden)]
    if type_ == "photo":
        clauses.append("is_video = 0")
    elif type_ == "video":
        clauses.append("is_video = 1")
    if from_:
        clauses.append(f"{_LOCAL_DAY_SQL} >= ?")
        params.append(from_)
    if to:
        clauses.append(f"{_LOCAL_DAY_SQL} <= ?")
        params.append(to)
    if cursor:
        cursor_date, cursor_row_id = _decode_cursor(cursor)
        clauses.append("(date_created < ? OR (date_created = ? AND id < ?))")
        params.extend([cursor_date, cursor_date, cursor_row_id])

    where = " AND ".join(clauses)
    # Fetch one row past `limit`: only when it exists is there a next page,
    # so only then does the response carry a `next_cursor` -- a page that
    # lands exactly on the last asset must not advertise a next page that
    # doesn't exist.
    rows = db.execute(
        f"SELECT * FROM assets WHERE {where} ORDER BY date_created DESC, id DESC LIMIT ?",
        (*params, limit + 1),
    ).fetchall()

    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = _encode_cursor(page[-1]["date_created"], page[-1]["id"]) if has_more else None
    return AssetListResponse(items=[_to_list_item(row) for row in page], next_cursor=next_cursor)


@router.get("/api/libraries/{library_id}/assets", response_model=AssetListResponse)
def list_assets(
    cursor: str | None = None,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    album: str | None = None,
    person: str | None = None,
    type_: Literal["photo", "video"] | None = Query(None, alias="type"),
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> AssetListResponse:
    # Albums and People are Phase 2: accept the filters so the client can
    # already send them, but a request for either comes back empty rather
    # than ignoring the filter and returning the unfiltered library.
    if album or person:
        return AssetListResponse(items=[], next_cursor=None)

    return _list_assets(
        db, library["id"], hidden=False, cursor=cursor, limit=limit, type_=type_, from_=from_, to=to
    )


@router.get("/api/libraries/{library_id}/hidden", response_model=AssetListResponse)
def list_hidden_assets(
    cursor: str | None = None,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    type_: Literal["photo", "video"] | None = Query(None, alias="type"),
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> AssetListResponse:
    """Apple Photos' Hidden album: the one list that returns an asset with
    `hidden = 1` -- every other route in this module excludes it."""
    return _list_assets(
        db, library["id"], hidden=True, cursor=cursor, limit=limit, type_=type_, from_=from_, to=to
    )


class SummaryBucket(BaseModel):
    key: str
    count: int


class SummaryResponse(BaseModel):
    years: list[SummaryBucket]
    months: list[SummaryBucket]
    days: list[SummaryBucket]


def _buckets(db: sqlite3.Connection, library_id: int, length: int) -> list[SummaryBucket]:
    rows = db.execute(
        f"SELECT substr({_LOCAL_DAY_SQL}, 1, ?) AS key, COUNT(*) AS count FROM assets "
        "WHERE library_id = ? AND hidden = 0 AND date_created IS NOT NULL GROUP BY key ORDER BY key",
        (length, library_id),
    ).fetchall()
    return [SummaryBucket(key=row["key"], count=row["count"]) for row in rows]


@router.get("/api/libraries/{library_id}/summary", response_model=SummaryResponse)
def library_summary(
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> SummaryResponse:
    return SummaryResponse(
        years=_buckets(db, library["id"], 4),
        months=_buckets(db, library["id"], 7),
        days=_buckets(db, library["id"], 10),
    )


class AssetDetailResponse(BaseModel):
    id: str
    filename: str | None
    original_filename: str | None
    title: str | None
    description: str | None
    date_created: str | None
    date_added: str | None
    date_modified: str | None
    favorite: bool
    hidden: bool
    is_video: bool
    is_live_photo: bool
    is_screenshot: bool
    is_selfie: bool
    is_portrait: bool
    is_panorama: bool
    is_hdr: bool
    is_slow_mo: bool
    is_burst: bool
    width: int | None
    height: int | None
    original_filesize: int | None
    latitude: float | None
    longitude: float | None
    place: str | None
    place_country_code: str | None
    place_address: str | None
    camera_make: str | None
    camera_model: str | None
    has_edited: bool
    has_live_photo_video: bool
    people: list[str]
    albums: list[str]


def _get_asset_or_404(db: sqlite3.Connection, library_id: int, asset_id: str) -> sqlite3.Row:
    row = db.execute(
        "SELECT * FROM assets WHERE library_id = ? AND uuid = ?", (library_id, asset_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


@router.get("/api/libraries/{library_id}/assets/{asset_id}", response_model=AssetDetailResponse)
def asset_detail(
    asset_id: str,
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> AssetDetailResponse:
    asset = _get_asset_or_404(db, library["id"], asset_id)
    people = [
        row["display_name"] or row["name"]
        for row in db.execute(
            "SELECT people.name, people.display_name FROM asset_people "
            "JOIN people ON people.id = asset_people.person_id WHERE asset_people.asset_id = ? "
            "ORDER BY people.display_name, people.name",
            (asset["id"],),
        ).fetchall()
    ]
    albums = [
        row["title"]
        for row in db.execute(
            "SELECT albums.title FROM asset_albums "
            "JOIN albums ON albums.id = asset_albums.album_id WHERE asset_albums.asset_id = ? "
            "ORDER BY albums.title",
            (asset["id"],),
        ).fetchall()
    ]
    return AssetDetailResponse(
        id=asset["uuid"],
        filename=asset["filename"],
        original_filename=asset["original_filename"],
        title=asset["title"],
        description=asset["description"],
        date_created=asset["date_created"],
        date_added=asset["date_added"],
        date_modified=asset["date_modified"],
        favorite=bool(asset["favorite"]),
        hidden=bool(asset["hidden"]),
        is_video=bool(asset["is_video"]),
        is_live_photo=bool(asset["is_live_photo"]),
        is_screenshot=bool(asset["is_screenshot"]),
        is_selfie=bool(asset["is_selfie"]),
        is_portrait=bool(asset["is_portrait"]),
        is_panorama=bool(asset["is_panorama"]),
        is_hdr=bool(asset["is_hdr"]),
        is_slow_mo=bool(asset["is_slow_mo"]),
        is_burst=bool(asset["is_burst"]),
        width=asset["width"],
        height=asset["height"],
        original_filesize=asset["original_filesize"],
        latitude=asset["latitude"],
        longitude=asset["longitude"],
        place=asset["place"],
        place_country_code=asset["place_country_code"],
        place_address=asset["place_address"],
        camera_make=asset["camera_make"],
        camera_model=asset["camera_model"],
        has_edited=asset["path_edited"] is not None,
        has_live_photo_video=bool(asset["path_live_photo"] or asset["path_edited_live_photo"]),
        people=people,
        albums=albums,
    )


def _resolve_within_library(library_path: str, raw_path: str) -> pathlib.Path:
    """The path `assets` recorded for this asset, checked against the
    library's own registered root. Never takes a path from the request --
    `raw_path` always comes from an `app.db` row already scoped to this
    `library_id` -- this is defense in depth against a corrupted index row,
    not a defense against a malicious caller."""
    library_root = pathlib.Path(library_path).resolve()
    resolved = pathlib.Path(raw_path).resolve()
    if resolved != library_root and not resolved.is_relative_to(library_root):
        raise HTTPException(status_code=404, detail="not found")
    return resolved


@router.get("/api/libraries/{library_id}/thumb/{asset_id}")
def asset_thumb(
    asset_id: str,
    size: Literal["grid", "grid2x", "preview"] = "grid",
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    cache_dir: pathlib.Path = Depends(session_auth.get_media_cache_dir),
) -> Response:
    asset = _get_asset_or_404(db, library["id"], asset_id)
    edited, original, derivative = asset["path_edited"], asset["path_original"], asset["path_derivative"]
    if not edited and not original and not derivative:
        raise HTTPException(status_code=404, detail="not found")
    # Apple Photos always shows the edited render when one exists (P1.17b);
    # a derivative substitutes for a missing original/edit (e.g. an iCloud
    # asset with "Optimize Mac Storage" -- out of scope per CLAUDE.md, but
    # this mirrors media.py's own fallback instead of fighting it); only
    # list it as a *derivative* candidate when it isn't already the source.
    main_path = edited or original or derivative
    source_path = _resolve_within_library(library["path"], main_path)
    derivatives = [_resolve_within_library(library["path"], derivative)] if derivative and derivative != main_path else []
    sizes, quality, cache_limit = _media_settings(db)
    try:
        result = media.get_or_generate(
            cache_dir,
            library_id=library["id"],
            asset_uuid=asset["uuid"],
            size=size,
            source_path=source_path,
            derivatives=derivatives,
            is_video=bool(asset["is_video"]),
            size_px=sizes[size],
            quality=quality,
            cache_size_limit_bytes=cache_limit,
        )
    except media.MediaBackendError as exc:
        # The asset row and its path both exist -- this isn't the "foreign
        # id" case the rest of this module 404s for. 415 says the asset
        # exists but no backend here could decode it (an unsupported RAW
        # variant, a corrupt file, a decompression-bomb guard trip).
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    return Response(content=result.data, media_type=result.content_type)


@router.get("/api/libraries/{library_id}/original/{asset_id}")
def asset_original(
    asset_id: str,
    version: Literal["original", "edited"] = "original",
    format: Literal["native", "jpeg"] = "native",
    download: bool = Query(False),
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    cache_dir: pathlib.Path = Depends(session_auth.get_media_cache_dir),
):
    asset = _get_asset_or_404(db, library["id"], asset_id)
    raw_path = asset["path_edited"] if version == "edited" else asset["path_original"]
    if not raw_path:
        raise HTTPException(status_code=404, detail="not found")
    file_path = _resolve_within_library(library["path"], raw_path)

    if format == "jpeg":
        if asset["is_video"]:
            raise HTTPException(status_code=400, detail="format=jpeg is not valid for a video asset")
        _, _, cache_limit = _media_settings(db)
        try:
            data = media.get_or_generate_jpeg(
                cache_dir,
                library_id=library["id"],
                asset_uuid=f"{asset['uuid']}:{version}",
                source_path=file_path,
                cache_size_limit_bytes=cache_limit,
            )
        except media.MediaBackendError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        filename = _escape_content_disposition_filename(file_path.with_suffix(".jpg").name)
        # `?download=1` is the explicit marker a Download/share action sends;
        # a bare viewer zoom or HEIC->JPEG fallback hits this same route
        # without it and must never write an audit row.
        if download:
            app_db.write_audit_log(
                db, "download", user_id=session["user_id"], library_id=library["id"], asset_id=asset["id"],
                detail=f"version={version} format=jpeg",
            )
        return Response(
            content=data,
            media_type="image/jpeg",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="not found")
    media_type, _ = mimetypes.guess_type(file_path.name)
    if download:
        app_db.write_audit_log(
            db, "download", user_id=session["user_id"], library_id=library["id"], asset_id=asset["id"],
            detail=f"version={version}",
        )
    return FileResponse(file_path, media_type=media_type or "application/octet-stream", filename=file_path.name)


@router.get("/api/libraries/{library_id}/livephoto/{asset_id}/video")
def asset_live_photo_video(
    asset_id: str,
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
):
    asset = _get_asset_or_404(db, library["id"], asset_id)
    raw_path = asset["path_edited_live_photo"] or asset["path_live_photo"]
    if not raw_path:
        raise HTTPException(status_code=404, detail="not found")
    file_path = _resolve_within_library(library["path"], raw_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="not found")
    media_type, _ = mimetypes.guess_type(file_path.name)
    return FileResponse(file_path, media_type=media_type or "video/quicktime", filename=file_path.name)
