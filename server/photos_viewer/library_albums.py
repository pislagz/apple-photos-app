"""P2.1: the albums list (folder tree + smart albums) for one library.

Reads only `app.db`, never a `.photoslibrary` path, and depends on
`session_auth.require_library_assignment` like every other library-scoped
route, so a foreign `library_id` 404s. Hidden assets are never counted and
never chosen as a cover.

An album's assets are listed through `GET /assets?album=<id>` (see
`library_assets.py`): a user album's id is its Photos uuid, a smart album's id
is `smart:<slug>`. This module owns the smart-album definitions and the
id -> SQL-filter resolution so the list and the counts can't drift apart.
"""

from __future__ import annotations

import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import session_auth

router = APIRouter()

SMART_PREFIX = "smart:"
RECENT_DAYS = 30

# slug -> (title, SQL condition on `assets`). Conditions use no parameters
# except RECENTLY_ADDED's, which `smart_clause` fills in.
_RAW_SQL = "(path_raw IS NOT NULL OR uti LIKE '%raw-image%' OR uti_original LIKE '%raw-image%')"
# "Recently Added" is relative to the library's newest import, not the
# wall clock: a library copied onto the drive months ago would otherwise
# show an empty album forever.
_RECENT_SQL = (
    "julianday(date_added) >= julianday((SELECT MAX(date_added) FROM assets "
    f"WHERE library_id = ? AND hidden = 0)) - {RECENT_DAYS}"
)
SMART_ALBUMS: dict[str, tuple[str, str]] = {
    "favorites": ("Favorites", "favorite = 1"),
    "videos": ("Videos", "is_video = 1"),
    "selfies": ("Selfies", "is_selfie = 1"),
    "live-photos": ("Live Photos", "is_live_photo = 1"),
    "portrait": ("Portrait", "is_portrait = 1"),
    "panoramas": ("Panoramas", "is_panorama = 1"),
    "screenshots": ("Screenshots", "is_screenshot = 1"),
    "slo-mo": ("Slo-mo", "is_slow_mo = 1"),
    "raw": ("RAW", _RAW_SQL),
    "recently-added": ("Recently Added", _RECENT_SQL),
}


def smart_clause(slug: str, library_id: int) -> tuple[str, list[object]]:
    condition = SMART_ALBUMS[slug][1]
    return condition, ([library_id] if "?" in condition else [])


def album_clause(
    db: sqlite3.Connection, library_id: int, album: str
) -> tuple[str, list[object]]:
    """SQL condition (on `assets`) and parameters for an `album=` value.
    404 when the id is not an album or smart album of *this* library."""
    if album.startswith(SMART_PREFIX):
        slug = album[len(SMART_PREFIX) :]
        if slug not in SMART_ALBUMS:
            raise HTTPException(status_code=404, detail="not found")
        return smart_clause(slug, library_id)
    row = db.execute(
        "SELECT id FROM albums WHERE library_id = ? AND uuid = ?", (library_id, album)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return "id IN (SELECT asset_id FROM asset_albums WHERE album_id = ?)", [row["id"]]


class AlbumNode(BaseModel):
    id: str
    kind: Literal["album", "folder"]
    title: str
    # None for a folder: it holds albums, not photos of its own.
    count: int | None
    cover_id: str | None
    children: list[AlbumNode]


class SmartAlbum(BaseModel):
    id: str
    title: str
    count: int
    cover_id: str | None


class AlbumsResponse(BaseModel):
    tree: list[AlbumNode]
    smart: list[SmartAlbum]


def _smart_albums(db: sqlite3.Connection, library_id: int) -> list[SmartAlbum]:
    out: list[SmartAlbum] = []
    for slug, (title, _) in SMART_ALBUMS.items():
        condition, params = smart_clause(slug, library_id)
        count = db.execute(
            f"SELECT COUNT(*) FROM assets WHERE library_id = ? AND hidden = 0 AND {condition}",
            (library_id, *params),
        ).fetchone()[0]
        if not count:
            continue
        cover = db.execute(
            f"SELECT uuid FROM assets WHERE library_id = ? AND hidden = 0 AND {condition} "
            "ORDER BY date_created DESC, id DESC LIMIT 1",
            (library_id, *params),
        ).fetchone()
        out.append(
            SmartAlbum(
                id=f"{SMART_PREFIX}{slug}",
                title=title,
                count=count,
                cover_id=cover["uuid"],
            )
        )
    return out


def _tree(db: sqlite3.Connection, library_id: int) -> list[AlbumNode]:
    counts = {
        row["album_id"]: row["n"]
        for row in db.execute(
            "SELECT aa.album_id, COUNT(*) AS n FROM asset_albums aa JOIN assets a ON a.id = aa.asset_id "
            "WHERE a.library_id = ? AND a.hidden = 0 GROUP BY aa.album_id",
            (library_id,),
        )
    }
    covers = {
        row["album_id"]: row["uuid"]
        for row in db.execute(
            """
            SELECT album_id, uuid FROM (
                SELECT aa.album_id, a.uuid,
                       ROW_NUMBER() OVER (PARTITION BY aa.album_id ORDER BY a.date_created DESC, a.id DESC) AS rn
                FROM asset_albums aa JOIN assets a ON a.id = aa.asset_id
                WHERE a.library_id = ? AND a.hidden = 0
            ) WHERE rn = 1
            """,
            (library_id,),
        )
    }
    # (sort key, node, parent uuid) for folders and albums alike, so siblings
    # of both kinds interleave in Photos' own sidebar order.
    entries: list[tuple[tuple[int, str], AlbumNode, str | None]] = []
    for row in db.execute(
        "SELECT uuid, title, parent_uuid, list_order FROM folders WHERE library_id = ?",
        (library_id,),
    ):
        title = row["title"] or "Untitled Folder"
        node = AlbumNode(
            id=row["uuid"],
            kind="folder",
            title=title,
            count=None,
            cover_id=None,
            children=[],
        )
        entries.append(((row["list_order"], title.lower()), node, row["parent_uuid"]))
    for row in db.execute(
        "SELECT id, uuid, title, parent_uuid, list_order FROM albums WHERE library_id = ?",
        (library_id,),
    ):
        title = row["title"] or "Untitled Album"
        node = AlbumNode(
            id=row["uuid"],
            kind="album",
            title=title,
            count=counts.get(row["id"], 0),
            cover_id=covers.get(row["id"]),
            children=[],
        )
        entries.append(((row["list_order"], title.lower()), node, row["parent_uuid"]))

    folder_ids = {node.id for _, node, _ in entries if node.kind == "folder"}
    by_id = {node.id: node for _, node, _ in entries}
    top: list[AlbumNode] = []
    for _, node, parent_uuid in sorted(entries, key=lambda e: e[0]):
        # A parent that was not indexed (should not happen) must not hide the entry.
        if parent_uuid in folder_ids and parent_uuid != node.id:
            by_id[parent_uuid].children.append(node)
        else:
            top.append(node)
    return top


@router.get("/api/libraries/{library_id}/albums", response_model=AlbumsResponse)
def list_albums(
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> AlbumsResponse:
    return AlbumsResponse(
        tree=_tree(db, library["id"]), smart=_smart_albums(db, library["id"])
    )
