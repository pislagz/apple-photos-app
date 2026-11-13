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
import os
import pathlib
import re
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from . import (
    app_db,
    library_albums,
    library_map,
    library_people,
    library_watch,
    media,
    session_auth,
)

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
    built by hand. Without this, a filename containing a `"` or a CR/LF --
    both of which osxphotos will happily report, since a `.photoslibrary`
    filename is whatever the OS let the user name it -- could break out of
    the quoted string or inject a header."""
    sanitized = filename.replace("\r", "").replace("\n", "")
    return sanitized.replace("\\", "\\\\").replace('"', '\\"')


_CONTROL_OR_SEPARATOR = re.compile(r"[\x00-\x1f\x7f/\\]")
_TRAILING_EXTENSION = re.compile(r"\.[A-Za-z0-9]{1,5}$")


def download_name(
    asset: sqlite3.Row, file_path: pathlib.Path, suffix: str | None = None
) -> str:
    """The name a user knows (`original_filename`, e.g. IMG_1234.HEIC), not
    Photos' internal stored name (a UUID). The stem comes from the original
    name (then `filename`, then the path); the extension is that of the file
    actually sent -- `suffix` overrides it for a HEIC->JPEG conversion -- so an
    edited JPEG of a HEIC original is not mislabelled."""
    raw = asset["original_filename"] or asset["filename"] or file_path.name
    stem = _TRAILING_EXTENSION.sub("", _CONTROL_OR_SEPARATOR.sub("_", raw)).strip()
    stem = stem.lstrip(".") or _TRAILING_EXTENSION.sub("", file_path.name) or "download"
    ext = file_path.suffix if suffix is None else suffix
    return f"{stem}{ext}"


def _percent_encode(value: str) -> str:
    # Local RFC 5987 encoder: this module must not import urllib (a test
    # keeps network-capable modules out of the library code paths).
    unreserved = set(
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    )
    return "".join(
        chr(b) if b in unreserved else f"%{b:02X}" for b in value.encode("utf-8")
    )


def content_disposition(name: str) -> str:
    """`attachment` header with an escaped ASCII fallback plus `filename*`
    (RFC 5987/6266) so non-ASCII names survive."""
    ascii_name = name.encode("ascii", "replace").decode().replace("?", "_")
    header = (
        f'attachment; filename="{_escape_content_disposition_filename(ascii_name)}"'
    )
    if ascii_name != name:
        header += f"; filename*=UTF-8''{_percent_encode(name)}"
    return header


def _media_settings(db: sqlite3.Connection) -> tuple[dict[str, int], int, int]:
    sizes = {
        key: int(app_db.get_setting(db, f"thumb_size_{key}") or default)
        for key, default in media.SIZES.items()
    }
    quality = int(app_db.get_setting(db, "thumb_quality") or media.DEFAULT_QUALITY)
    # 0 is a real value ("no cache"), so test for None, not truthiness.
    stored_limit = app_db.get_setting(db, "media_cache_size_limit_bytes")
    cache_limit = (
        media.DEFAULT_CACHE_SIZE_LIMIT_BYTES
        if stored_limit is None
        else int(stored_limit)
    )
    return sizes, quality, cache_limit


class UpdatedNote(BaseModel):
    """The latest applied index run that changed visible photos. Counts never
    include Hidden photos (the banner must not reveal them)."""

    run_id: int
    added: int
    removed: int
    finished_at: str | None


class LibrarySummary(BaseModel):
    id: int
    display_name: str
    # P1.22: "Being updated" -- the library's package is missing, still
    # copying, or not valid yet; its photo routes answer 503 meanwhile.
    updating: bool = False
    updating_reason: str | None = None
    # "Library updated" banner: set until this user dismisses that run.
    updated_note: UpdatedNote | None = None


class MeResponse(BaseModel):
    username: str
    role: Literal["admin", "user"]
    libraries: list[LibrarySummary]
    layout_override: Literal["desktop", "mobile"] | None
    # Whether the admin agreed to "Map & place names"; the Info panel explains
    # a missing place name with it.
    osm_consent: bool = False
    # Set while the user has an avatar; changes with every new one so the
    # browser re-fetches it. The picture is /api/users/{username}/avatar.
    avatar_version: int | None = None


def _updated_note(
    db: sqlite3.Connection, library_id: int, user_id: int
) -> UpdatedNote | None:
    # The library's first run (its registration) is not an "update". A run
    # recorded before the visible counts existed has NULLs and is skipped, so
    # it can never leak Hidden photos into a count.
    run = db.execute(
        "SELECT id, added_visible, removed_visible, finished_at FROM library_index_runs "
        "WHERE library_id = ? AND outcome = 'applied' "
        "AND id > (SELECT MIN(id) FROM library_index_runs WHERE library_id = ?) "
        "AND (added_visible > 0 OR removed_visible > 0) ORDER BY id DESC LIMIT 1",
        (library_id, library_id),
    ).fetchone()
    if run is None:
        return None
    dismissed = db.execute(
        "SELECT run_id FROM library_note_dismissals WHERE user_id = ? AND library_id = ?",
        (user_id, library_id),
    ).fetchone()
    if dismissed is not None and dismissed["run_id"] >= run["id"]:
        return None
    return UpdatedNote(
        run_id=run["id"],
        added=run["added_visible"],
        removed=run["removed_visible"],
        finished_at=run["finished_at"],
    )


def _library_summary(
    db: sqlite3.Connection, row: sqlite3.Row, user_id: int
) -> LibrarySummary:
    updating, reason = library_watch.public_availability(row)
    note = None
    if not updating and library_watch.show_updated_note(db):
        note = _updated_note(db, row["id"], user_id)
    return LibrarySummary(
        id=row["id"],
        display_name=row["display_name"],
        updating=updating,
        updating_reason=reason,
        updated_note=note,
    )


class DismissNoteRequest(BaseModel):
    run_id: int


@router.post(
    "/api/libraries/{library_id}/updated-note/dismiss",
    response_model=DismissNoteRequest,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def dismiss_updated_note(
    payload: DismissNoteRequest,
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> DismissNoteRequest:
    """Per user, so it follows them across devices. Keeps the highest run id."""
    db.execute(
        "INSERT INTO library_note_dismissals (user_id, library_id, run_id) VALUES (?, ?, ?) "
        "ON CONFLICT (user_id, library_id) DO UPDATE SET run_id = MAX(run_id, excluded.run_id)",
        (session["user_id"], library["id"], payload.run_id),
    )
    db.commit()
    return payload


@router.get("/api/me", response_model=MeResponse)
def read_me(
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> MeResponse:
    rows = db.execute(
        "SELECT libraries.* FROM libraries "
        "JOIN library_assignments ON library_assignments.library_id = libraries.id "
        "WHERE library_assignments.user_id = ? ORDER BY libraries.display_name",
        (session["user_id"],),
    ).fetchall()
    avatar = db.execute(
        "SELECT avatar_version FROM users WHERE id = ?", (session["user_id"],)
    ).fetchone()
    return MeResponse(
        username=session["username"],
        avatar_version=avatar["avatar_version"] if avatar else None,
        role=session["role"],
        libraries=[_library_summary(db, row, session["user_id"]) for row in rows],
        layout_override=session["layout_override"],
        osm_consent=app_db.osm_consent(db),
    )


class LayoutOverrideRequest(BaseModel):
    layout_override: Literal["desktop", "mobile"] | None


@router.put(
    "/api/me/layout-override",
    status_code=204,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def write_layout_override(
    payload: LayoutOverrideRequest,
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> None:
    """Server-side layout choice, so it follows a user across devices.
    The web app's localStorage copy is only a fast default while this
    loads -- this value is authoritative once `/api/me` returns it."""
    db.execute(
        "UPDATE users SET layout_override = ? WHERE id = ?",
        (payload.layout_override, session["user_id"]),
    )
    db.commit()


class AssetListItem(BaseModel):
    id: str
    filename: str | None
    original_filename: str | None
    date: str | None
    is_video: bool
    is_live_photo: bool
    favorite: bool
    width: int | None
    height: int | None
    duration: float | None
    # The original is HEIC/HEIF, so a zip can offer "HEIC as JPEG" (#254).
    is_heic: bool = False


class AssetListResponse(BaseModel):
    items: list[AssetListItem]
    next_cursor: str | None


def _encode_cursor(date_created: str, asset_row_id: int) -> str:
    raw = f"{date_created}\x00{asset_row_id}".encode()
    return base64.urlsafe_b64encode(raw).decode()


def _decode_cursor(cursor: str) -> tuple[str, int]:
    try:
        date_created, asset_row_id = (
            base64.urlsafe_b64decode(cursor.encode()).decode().split("\x00")
        )
        return date_created, int(asset_row_id)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="invalid cursor") from exc


_HEIC_UTIS = {"public.heic", "public.heif", "public.heics", "public.heifs"}
_HEIC_SUFFIXES = (".heic", ".heif")


def _is_heic(row: sqlite3.Row) -> bool:
    """By the original's UTI (what Photos recorded); rows indexed before the
    UTI columns existed fall back to the file extension."""
    keys = row.keys()
    uti = (row["uti_original"] if "uti_original" in keys else None) or (
        row["uti"] if "uti" in keys else None
    )
    if uti:
        return uti.lower() in _HEIC_UTIS
    names = [row["filename"]]
    if "original_filename" in keys:
        names.append(row["original_filename"])
    return any(name and name.lower().endswith(_HEIC_SUFFIXES) for name in names)


def _to_list_item(row: sqlite3.Row) -> AssetListItem:
    return AssetListItem(
        id=row["uuid"],
        filename=row["filename"],
        original_filename=row["original_filename"],
        date=row["date_created"],
        is_video=bool(row["is_video"]),
        is_live_photo=bool(row["is_live_photo"]),
        favorite=bool(row["favorite"]),
        width=row["width"],
        height=row["height"],
        duration=row["duration"],
        is_heic=_is_heic(row),
    )


# Filter menu: `filter=` picks one of these, `hide=` drops kinds from any view.
# "Not in an Album" means no user album; smart albums are not in `asset_albums`.
_KIND_SQL = {
    "edited": "path_edited IS NOT NULL",
    "screenshots": "is_screenshot = 1",
    "shared": "is_syndicated = 1",
    "not-in-album": "NOT EXISTS (SELECT 1 FROM asset_albums aa WHERE aa.asset_id = assets.id)",
}
_HIDE_SQL = {
    "screenshots": "is_screenshot = 0",
    "shared": "is_syndicated = 0",
}


def _parse_hide(hide: str | None) -> frozenset[str]:
    names = frozenset(part for part in (hide or "").split(",") if part)
    if not names <= _HIDE_SQL.keys():
        raise HTTPException(status_code=422, detail="unknown hide value")
    return names


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
    favorite: bool | None = None,
    kind: str | None = None,
    hide: frozenset[str] = frozenset(),
    extra: tuple[str, list[object]] | None = None,
) -> AssetListResponse:
    clauses = ["library_id = ?", "hidden = ?"]
    params: list[object] = [library_id, int(hidden)]
    if extra:
        clauses.append(extra[0])
        params.extend(extra[1])
    if type_ == "photo":
        clauses.append("is_video = 0")
    elif type_ == "video":
        clauses.append("is_video = 1")
    if favorite:
        clauses.append("favorite = 1")
    if kind:
        clauses.append(_KIND_SQL[kind])
    clauses.extend(_HIDE_SQL[name] for name in sorted(hide))
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
    next_cursor = (
        _encode_cursor(page[-1]["date_created"], page[-1]["id"]) if has_more else None
    )
    return AssetListResponse(
        items=[_to_list_item(row) for row in page], next_cursor=next_cursor
    )


@router.get("/api/libraries/{library_id}/assets", response_model=AssetListResponse)
def list_assets(
    cursor: str | None = None,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    album: str | None = None,
    person: str | None = None,
    place: str | None = None,
    type_: Literal["photo", "video"] | None = Query(None, alias="type"),
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    favorite: bool | None = None,
    filter_: Literal["edited", "screenshots", "shared", "not-in-album"] | None = Query(
        None, alias="filter"
    ),
    hide: str | None = None,
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> AssetListResponse:
    # `album` is a user album's uuid or `smart:<slug>` (see library_albums);
    # an id that is not this library's 404s. `person` is a named person's uuid
    # (library_people), same 404 rule. `place` is a map bbox (library_map).
    # All may be combined (AND).
    extras = []
    if album:
        extras.append(library_albums.album_clause(db, library["id"], album))
    if person:
        extras.append(library_people.person_clause(db, library["id"], person))
    if place:
        extras.append(library_map.place_clause(place))
    extra = (
        (" AND ".join(e[0] for e in extras), [p for e in extras for p in e[1]])
        if extras
        else None
    )

    return _list_assets(
        db,
        library["id"],
        hidden=False,
        cursor=cursor,
        limit=limit,
        type_=type_,
        from_=from_,
        to=to,
        favorite=favorite,
        kind=filter_,
        hide=_parse_hide(hide),
        extra=extra,
    )


@router.get("/api/libraries/{library_id}/hidden", response_model=AssetListResponse)
def list_hidden_assets(
    cursor: str | None = None,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    type_: Literal["photo", "video"] | None = Query(None, alias="type"),
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> AssetListResponse:
    """Apple Photos' Hidden album: the one list that returns an asset with
    `hidden = 1` -- every other route in this module excludes it. Needs a
    recent `/api/auth/reconfirm-password` (#130); checked after the library
    guard so a foreign library still 404s."""
    session_auth.require_hidden_unlocked(session, db)
    return _list_assets(
        db,
        library["id"],
        hidden=True,
        cursor=cursor,
        limit=limit,
        type_=type_,
        from_=from_,
        to=to,
    )


class SummaryBucket(BaseModel):
    key: str
    count: int


class SummaryPeriodBucket(SummaryBucket):
    # #91: the mobile Years/Months tiles' key photos -- up to
    # `_KEY_ASSETS_PER_BUCKET`, favorite first, then by osxphotos' own
    # aesthetic score, so the client can cycle a tile through a few
    # candidates instead of pinning one "best shot" (Pawel declined a
    # curated-best-shot feature; this only re-orders assets already in the
    # bucket). Days (#301) carries one key photo per day for its cards.
    key_asset_ids: list[str]


class SummaryResponse(BaseModel):
    years: list[SummaryPeriodBucket]
    months: list[SummaryPeriodBucket]
    days: list[SummaryPeriodBucket]


_KEY_ASSETS_PER_BUCKET = 5


def _buckets(
    db: sqlite3.Connection, library_id: int, length: int
) -> list[SummaryBucket]:
    rows = db.execute(
        f"SELECT substr({_LOCAL_DAY_SQL}, 1, ?) AS key, COUNT(*) AS count FROM assets "
        "WHERE library_id = ? AND hidden = 0 AND date_created IS NOT NULL GROUP BY key ORDER BY key",
        (length, library_id),
    ).fetchall()
    return [SummaryBucket(key=row["key"], count=row["count"]) for row in rows]


def _period_buckets(
    db: sqlite3.Connection,
    library_id: int,
    length: int,
    per_bucket: int = _KEY_ASSETS_PER_BUCKET,
) -> list[SummaryPeriodBucket]:
    buckets = _buckets(db, library_id, length)
    # Ranked within each bucket -- favorite first, then score, then most
    # recent -- and capped at `_KEY_ASSETS_PER_BUCKET` *before* grouping in
    # Python, so a bucket with thousands of assets costs one indexed scan
    # plus a window-function pass, not a client-side sort of everything in
    # it. Hidden assets are excluded by the same `hidden = 0` filter as the
    # counts above -- a hidden photo must never be a tile's key photo
    # (P1.13).
    key_rows = db.execute(
        f"""
        SELECT key, uuid FROM (
            SELECT substr({_LOCAL_DAY_SQL}, 1, ?) AS key, uuid,
                   ROW_NUMBER() OVER (
                       PARTITION BY substr({_LOCAL_DAY_SQL}, 1, ?)
                       ORDER BY favorite DESC, COALESCE(score, -1.0) DESC, date_created DESC
                   ) AS rn
            FROM assets
            WHERE library_id = ? AND hidden = 0 AND date_created IS NOT NULL
        )
        WHERE rn <= ?
        ORDER BY key, rn
        """,
        (length, length, library_id, per_bucket),
    ).fetchall()
    key_asset_ids: dict[str, list[str]] = {}
    for row in key_rows:
        key_asset_ids.setdefault(row["key"], []).append(row["uuid"])
    return [
        SummaryPeriodBucket(
            key=bucket.key,
            count=bucket.count,
            key_asset_ids=key_asset_ids.get(bucket.key, []),
        )
        for bucket in buckets
    ]


@router.get("/api/libraries/{library_id}/summary", response_model=SummaryResponse)
def library_summary(
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> SummaryResponse:
    return SummaryResponse(
        years=_period_buckets(db, library["id"], 4),
        months=_period_buckets(db, library["id"], 7),
        days=_period_buckets(db, library["id"], 10, per_bucket=1),
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
    # D41: nearest city from the offline gazetteer (opt-in); the three Photos
    # fields above always win when present.
    place_offline: str | None = None
    camera_make: str | None
    camera_model: str | None
    has_edited: bool
    # False on an Optimize Mac Storage copy: only a smaller derivative is on
    # disk, so a download is not the original (set at index time).
    original_available: bool = True
    # True for a "referenced" original stored outside the package that no
    # PHOTOS_VIEWER_REFERENCED_ROOTS entry covers: /original answers 404
    # `original_not_available` for it.
    original_outside_library: bool = False
    has_live_photo_video: bool
    people: list[str]
    albums: list[str]


def _get_asset_or_404(
    db: sqlite3.Connection, library_id: int, asset_id: str
) -> sqlite3.Row:
    row = db.execute(
        "SELECT * FROM assets WHERE library_id = ? AND uuid = ?", (library_id, asset_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


def _get_media_asset_or_404(
    db: sqlite3.Connection, library_id: int, asset_id: str, session: sqlite3.Row
) -> sqlite3.Row:
    """`_get_asset_or_404` for the detail and byte-serving routes: a hidden
    asset's metadata and media need the same Hidden unlock as the Hidden list (#151). Checked
    after the lookup so a foreign or unknown id still 404s."""
    asset = _get_asset_or_404(db, library_id, asset_id)
    if asset["hidden"]:
        session_auth.require_hidden_unlocked(session, db)
    return asset


def _media_cache_headers(asset: sqlite3.Row) -> dict[str, str]:
    """A hidden asset's bytes must not outlive the Hidden unlock in the
    browser cache (#151): FileResponse sends Last-Modified/ETag, which lets
    browsers heuristically cache and re-show them after a re-lock."""
    return {"Cache-Control": "private, no-store"} if asset["hidden"] else {}


@router.get(
    "/api/libraries/{library_id}/assets/{asset_id}", response_model=AssetDetailResponse
)
def asset_detail(
    asset_id: str,
    response: Response,
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> AssetDetailResponse:
    # A hidden asset's metadata (place, people, albums) is gated like its
    # media (#151).
    asset = _get_media_asset_or_404(db, library["id"], asset_id, session)
    response.headers.update(_media_cache_headers(asset))
    # An unnamed face group has neither name nor display_name (NULL or ""); it
    # has no string to list, and a None in `people: list[str]` fails response
    # validation (HTTP 500), so it is skipped.
    people = sorted(
        {
            label
            for row in db.execute(
                "SELECT people.name, people.display_name FROM asset_people "
                "JOIN people ON people.id = asset_people.person_id WHERE asset_people.asset_id = ?",
                (asset["id"],),
            ).fetchall()
            if (label := row["display_name"] or row["name"])
        }
    )
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
        place_offline=asset["place_offline"],
        camera_make=asset["camera_make"],
        camera_model=asset["camera_model"],
        has_edited=asset["path_edited"] is not None,
        original_available=not asset["original_missing"],
        original_outside_library=_original_not_available(
            library["path"], asset["path_edited"] or asset["path_original"]
        ),
        has_live_photo_video=bool(
            asset["path_live_photo"] or asset["path_edited_live_photo"]
        ),
        people=people,
        albums=albums,
    )


MAX_SELECTION_SUMMARY = 50000
_SUMMARY_CHUNK = 500


class SelectionSummaryRequest(BaseModel):
    asset_ids: list[str] = Field(min_length=1, max_length=MAX_SELECTION_SUMMARY)


class SelectionSummaryResponse(BaseModel):
    count: int
    photos: int
    videos: int
    # Same UTC `date_created` strings the list items carry; null when no
    # selected asset has a date.
    date_first: str | None
    date_last: str | None
    # Sum of the recorded original file sizes (assets without one add nothing).
    total_bytes: int
    # The one saved place name every selected asset shares (Photos' own
    # record, as in the single-asset Info row), else null.
    place: str | None


@router.post(
    "/api/libraries/{library_id}/selection-summary",
    response_model=SelectionSummaryResponse,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def selection_summary(
    payload: SelectionSummaryRequest,
    response: Response,
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> SelectionSummaryResponse:
    """Desktop Info panel with 2+ photos selected (D21). Reads only `app.db`.
    Every id is resolved like the single-asset detail route: a foreign or
    unknown id is a 404, a hidden one needs the Hidden unlock."""
    ids = list(dict.fromkeys(payload.asset_ids))
    rows: list[sqlite3.Row] = []
    for start in range(0, len(ids), _SUMMARY_CHUNK):
        chunk = ids[start : start + _SUMMARY_CHUNK]
        marks = ",".join("?" * len(chunk))
        rows.extend(
            db.execute(
                "SELECT hidden, is_video, date_created, original_filesize, "
                "COALESCE(NULLIF(place_address, ''), NULLIF(place, ''), NULLIF(place_offline, '')) AS label "
                f"FROM assets WHERE library_id = ? AND uuid IN ({marks})",
                (library["id"], *chunk),
            ).fetchall()
        )
    if len(rows) != len(ids):
        raise HTTPException(status_code=404, detail="not found")
    if any(row["hidden"] for row in rows):
        session_auth.require_hidden_unlocked(session, db)
        response.headers["Cache-Control"] = "private, no-store"
    dates = [row["date_created"] for row in rows if row["date_created"]]
    labels = {row["label"] for row in rows}
    videos = sum(1 for row in rows if row["is_video"])
    return SelectionSummaryResponse(
        count=len(rows),
        photos=len(rows) - videos,
        videos=videos,
        date_first=min(dates) if dates else None,
        date_last=max(dates) if dates else None,
        total_bytes=sum(row["original_filesize"] or 0 for row in rows),
        place=next(iter(labels)) if len(labels) == 1 and None not in labels else None,
    )


ORIGINAL_NOT_AVAILABLE = "original_not_available"
# Extra read-only roots (os.pathsep-separated absolute paths) that may hold
# "referenced" originals stored outside a .photoslibrary. Unset = none.
REFERENCED_ROOTS_ENV = "PHOTOS_VIEWER_REFERENCED_ROOTS"


class OriginalNotAvailable(HTTPException):
    """The recorded file lives outside the package (a Photos "referenced"
    original) and no allowed root covers it. A 404 whose `detail` is
    `original_not_available`, so the web can tell it from a plain 404."""

    def __init__(self) -> None:
        super().__init__(status_code=404, detail=ORIGINAL_NOT_AVAILABLE)


def _referenced_roots() -> list[pathlib.Path]:
    roots = []
    for raw in os.environ.get(REFERENCED_ROOTS_ENV, "").split(os.pathsep):
        raw = raw.strip()
        if raw and os.path.isabs(raw):
            roots.append(pathlib.Path(raw).resolve())
    return roots


def _is_under(path: pathlib.Path, root: pathlib.Path) -> bool:
    return path == root or path.is_relative_to(root)


def _resolve_within_library(library_path: str, raw_path: str) -> pathlib.Path:
    """The path `assets` recorded for this asset, checked against the
    library's own registered root (or an allowed referenced root, resolved
    with symlinks first). Never takes a path from the request --
    `raw_path` always comes from an `app.db` row already scoped to this
    `library_id` -- this is defense in depth against a corrupted index row,
    not a defense against a malicious caller.

    A clean absolute path outside every root is a referenced original and
    raises `OriginalNotAvailable`; `..` parts, relative paths and symlinks
    that leave a root stay a plain 404."""
    library_root = pathlib.Path(library_path).resolve()
    allowed = [library_root, *_referenced_roots()]
    raw = pathlib.Path(raw_path)
    resolved = raw.resolve()
    if any(_is_under(resolved, root) for root in allowed):
        return resolved
    if not raw.is_absolute() or ".." in raw.parts:
        raise HTTPException(status_code=404, detail="not found")
    lexical_roots = [pathlib.Path(library_path), *allowed]
    if any(_is_under(raw, root) for root in lexical_roots):
        # Looked inside a root but a symlink leads out of it.
        raise HTTPException(status_code=404, detail="not found")
    raise OriginalNotAvailable()


def _original_not_available(library_path: str, raw_path: str | None) -> bool:
    if not raw_path:
        return False
    try:
        _resolve_within_library(library_path, raw_path)
    except OriginalNotAvailable:
        return True
    except HTTPException:
        return False
    return False


def render_thumb(
    db: sqlite3.Connection,
    cache_dir: pathlib.Path,
    library: sqlite3.Row,
    asset: sqlite3.Row,
    size: str,
) -> media.GeneratedImage:
    """Shared by the thumb route and the avatar crop (user_avatar)."""
    edited, original, derivative = (
        asset["path_edited"],
        asset["path_original"],
        asset["path_derivative"],
    )
    if not edited and not original and not derivative:
        raise HTTPException(status_code=404, detail="not found")
    # Apple Photos always shows the edited render when one exists (P1.17b);
    # a derivative substitutes for a missing original/edit (e.g. an iCloud
    # asset with "Optimize Mac Storage" -- out of scope per CLAUDE.md, but
    # this mirrors media.py's own fallback instead of fighting it); only
    # list it as a *derivative* candidate when it isn't already the source.
    main_path = edited or original or derivative
    try:
        source_path = _resolve_within_library(library["path"], main_path)
        derivatives = (
            [_resolve_within_library(library["path"], derivative)]
            if derivative and derivative != main_path
            else []
        )
    except OriginalNotAvailable:
        # Referenced original: the package's own derivative still works.
        if not derivative or derivative == main_path:
            raise
        source_path = _resolve_within_library(library["path"], derivative)
        derivatives = []
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
    return result


@router.get("/api/libraries/{library_id}/thumb/{asset_id}")
def asset_thumb(
    asset_id: str,
    size: Literal["grid", "grid2x", "preview"] = "grid",
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    cache_dir: pathlib.Path = Depends(session_auth.get_media_cache_dir),
) -> Response:
    asset = _get_media_asset_or_404(db, library["id"], asset_id, session)
    result = render_thumb(db, cache_dir, library, asset, size)
    return Response(
        content=result.data,
        media_type=result.content_type,
        headers=_media_cache_headers(asset),
    )


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
    asset = _get_media_asset_or_404(db, library["id"], asset_id, session)
    raw_path = asset["path_edited"] if version == "edited" else asset["path_original"]
    # "Optimize Mac Storage" copy: no full-size original, only a derivative.
    # Serve it and say so (X-Photos-Original-Missing) rather than 404.
    fallback_headers: dict[str, str] = {}
    if (
        version == "original"
        and asset["path_derivative"]
        and (
            not raw_path
            or _original_not_available(library["path"], raw_path)
            or not _resolve_within_library(library["path"], raw_path).exists()
        )
    ):
        raw_path = asset["path_derivative"]
        fallback_headers = {"X-Photos-Original-Missing": "1"}
    if not raw_path:
        raise HTTPException(status_code=404, detail="not found")
    file_path = _resolve_within_library(library["path"], raw_path)

    if format == "jpeg":
        if asset["is_video"]:
            raise HTTPException(
                status_code=400, detail="format=jpeg is not valid for a video asset"
            )
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
            # Same convention as the thumb route: the asset exists, no backend can decode it.
            raise HTTPException(status_code=415, detail=str(exc)) from exc
        disposition = content_disposition(download_name(asset, file_path, ".jpg"))
        # `?download=1` is the explicit marker a Download/share action sends;
        # a bare viewer zoom or HEIC->JPEG fallback hits this same route
        # without it and must never write an audit row.
        if download:
            app_db.write_audit_log(
                db,
                "download",
                user_id=session["user_id"],
                library_id=library["id"],
                asset_id=asset["id"],
                detail=f"version={version} format=jpeg",
            )
        return Response(
            content=data,
            media_type="image/jpeg",
            headers={
                "Content-Disposition": disposition,
                **fallback_headers,
                **_media_cache_headers(asset),
            },
        )

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="not found")
    media_type, _ = mimetypes.guess_type(file_path.name)
    if download:
        app_db.write_audit_log(
            db,
            "download",
            user_id=session["user_id"],
            library_id=library["id"],
            asset_id=asset["id"],
            detail=f"version={version}",
        )
    return FileResponse(
        file_path,
        media_type=media_type or "application/octet-stream",
        headers={
            "Content-Disposition": content_disposition(download_name(asset, file_path)),
            **fallback_headers,
            **_media_cache_headers(asset),
        },
    )


@router.get("/api/libraries/{library_id}/livephoto/{asset_id}/video")
def asset_live_photo_video(
    asset_id: str,
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
):
    asset = _get_media_asset_or_404(db, library["id"], asset_id, session)
    raw_path = asset["path_edited_live_photo"] or asset["path_live_photo"]
    if not raw_path:
        raise HTTPException(status_code=404, detail="not found")
    file_path = _resolve_within_library(library["path"], raw_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="not found")
    media_type, _ = mimetypes.guess_type(file_path.name)
    return FileResponse(
        file_path,
        media_type=media_type or "video/quicktime",
        headers={
            "Content-Disposition": content_disposition(download_name(asset, file_path)),
            **_media_cache_headers(asset),
        },
    )
