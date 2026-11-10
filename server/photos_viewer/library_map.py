"""P2.3: map clusters for one library, and the optional local basemap.

Everything here reads `app.db` only. The server never fetches tiles: in
OpenStreetMap mode the browser does, in Local file mode this module hands the
browser a PMTiles archive from disk, and Off draws no basemap at all.

Clusters come from the `assets.latitude/longitude` columns the indexer fills.
An asset without a location is simply absent, a hidden asset never appears,
and every query is pinned to the caller's own library id.
"""

from __future__ import annotations

import math
import os
import pathlib
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import app_db, session_auth

router = APIRouter()

MAX_ZOOM = 22
# Biggest clusters win; a world-wide high-zoom request cannot return the library.
MAX_CLUSTERS = 2000
# A cluster cell is a quarter of a 256px tile, so pins sit roughly 64px apart.
CELLS_PER_TILE = 4
PMTILES_MAGIC = b"PMTiles"
# Served under /api so it is behind the session check and the CSP's 'self'.
PMTILES_URL = "/api/map/tiles.pmtiles"


class BBox(BaseModel):
    west: float
    south: float
    east: float
    north: float


def parse_bbox(value: str) -> BBox:
    """`west,south,east,north` in degrees. West greater than east means the
    box crosses the antimeridian. 422 for anything else."""
    try:
        west, south, east, north = (float(part) for part in value.split(","))
    except ValueError:
        raise HTTPException(
            status_code=422, detail="bbox must be west,south,east,north"
        ) from None
    if (
        not (-90 <= south <= north <= 90)
        or not (-180 <= west <= 180)
        or not (-180 <= east <= 180)
    ):
        raise HTTPException(status_code=422, detail="bbox out of range")
    return BBox(west=west, south=south, east=east, north=north)


def bbox_clause(box: BBox) -> tuple[str, list[object]]:
    """SQL condition (on `assets`): has a location inside the box."""
    if box.west <= box.east:
        lon = "longitude BETWEEN ? AND ?"
        params: list[object] = [box.west, box.east]
    else:
        lon = "(longitude >= ? OR longitude <= ?)"
        params = [box.west, box.east]
    return (
        f"latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN ? AND ? AND {lon}",
        [box.south, box.north, *params],
    )


def place_clause(value: str) -> tuple[str, list[object]]:
    """`/assets?place=<bbox>`: the photos under one cluster."""
    return bbox_clause(parse_bbox(value))


class Cluster(BaseModel):
    lat: float
    lon: float
    count: int
    # Newest visible asset in the cluster: its thumbnail is the pin.
    cover_id: str
    # Bounds of the assets inside, so the client can fit or list exactly them.
    bounds: BBox


class MapResponse(BaseModel):
    clusters: list[Cluster]
    total: int
    # True when more than MAX_CLUSTERS cells matched and the smallest were dropped.
    truncated: bool = False


def _cell_filter(box: BBox, cell: float) -> tuple[str, list[object]]:
    """Condition that keeps whole grid cells: every cell the viewport touches,
    counted in full. Counting only the points inside the viewport would make a
    pin's count (and what it opens) depend on where the map happens to be
    panned. The lat/lon BETWEEN is only there so SQLite can use the index; the
    exact test is on the cell indexes."""
    cy0 = math.floor((box.south + 90) / cell)
    cy1 = math.floor((box.north + 90) / cell)
    cx0 = math.floor((box.west + 180) / cell)
    cx1 = math.floor((box.east + 180) / cell)
    south = cy0 * cell - 90
    north = (cy1 + 1) * cell - 90
    params: list[object] = [south, north]
    clause = "latitude BETWEEN ? AND ? AND cy BETWEEN ? AND ?"
    cy = [cy0, cy1]
    if box.west <= box.east:
        west, east = cx0 * cell - 180, (cx1 + 1) * cell - 180
        return (
            f"{clause} AND longitude BETWEEN ? AND ? AND cx BETWEEN ? AND ?",
            [*params, *cy, west, east, cx0, cx1],
        )
    return (
        f"{clause} AND cx NOT BETWEEN ? AND ?",
        [*params, *cy, cx1 + 1, cx0 - 1],
    )


@router.get("/api/libraries/{library_id}/map", response_model=MapResponse)
def map_clusters(
    bbox: str | None = None,
    zoom: int = Query(0, ge=0, le=MAX_ZOOM),
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> MapResponse:
    cell = 360.0 / (2**zoom) / CELLS_PER_TILE
    if bbox:
        where, params = _cell_filter(parse_bbox(bbox), cell)
    else:
        where, params = "1", []
    # Shifting to non-negative makes CAST(... AS INTEGER) a floor. The cover is
    # the max of "date|uuid": the newest asset, without a window function over
    # every located photo. (SQLite's bare-column rule would not hold here, as
    # the query has several MIN/MAX aggregates.)
    rows = db.execute(
        f"""
        SELECT COUNT(*) AS n, AVG(latitude) AS lat, AVG(longitude) AS lon,
               MIN(latitude) AS s, MAX(latitude) AS n_lat,
               MIN(longitude) AS w, MAX(longitude) AS e,
               MAX(COALESCE(date_created, '') || '|' || uuid) AS newest
        FROM (
            SELECT uuid, date_created, latitude, longitude,
                   CAST((latitude + 90) / ? AS INTEGER) AS cy,
                   CAST((longitude + 180) / ? AS INTEGER) AS cx
            FROM assets
            WHERE library_id = ? AND hidden = 0
              AND latitude IS NOT NULL AND longitude IS NOT NULL
        )
        WHERE {where}
        GROUP BY cx, cy
        ORDER BY n DESC, cx, cy
        LIMIT ?
        """,
        (cell, cell, library["id"], *params, MAX_CLUSTERS + 1),
    ).fetchall()
    truncated = len(rows) > MAX_CLUSTERS
    clusters = [
        Cluster(
            lat=r["lat"],
            lon=r["lon"],
            count=r["n"],
            cover_id=r["newest"].split("|", 1)[1],
            # The extent of this cell's own points. Cells are disjoint, so a
            # `place=` listing of this box returns exactly `count` photos.
            bounds=BBox(west=r["w"], south=r["s"], east=r["e"], north=r["n_lat"]),
        )
        for r in rows[:MAX_CLUSTERS]
    ]
    return MapResponse(
        clusters=clusters, total=sum(c.count for c in clusters), truncated=truncated
    )


# --------------------------------------------------------------------------
# Basemap setting, readable by any signed-in user (the admin settings route
# is admin-only).
# --------------------------------------------------------------------------


def _local_pmtiles(db: sqlite3.Connection) -> pathlib.Path | None:
    """The configured archive if it is a readable PMTiles file, else None."""
    if app_db.get_setting(db, "map_tiles_mode") != "local_file":
        return None
    raw = app_db.get_setting(db, "map_tiles_pmtiles_path")
    if not raw:
        return None
    path = pathlib.Path(raw)
    try:
        if not (path.is_file() and os.access(path, os.R_OK)):
            return None
        with path.open("rb") as handle:
            if handle.read(len(PMTILES_MAGIC)) != PMTILES_MAGIC:
                return None
    except OSError:
        return None
    return path


class MapConfig(BaseModel):
    # online: browser fetches OSM tiles. local_file: `pmtiles_url` (same
    # origin). off: no basemap. A local_file whose archive is missing or
    # unreadable is reported as "off" -- it never falls back to OSM.
    mode: Literal["online", "local_file", "off"]
    pmtiles_url: str | None = None


@router.get("/api/map/config", response_model=MapConfig)
def map_config(
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> MapConfig:
    mode = app_db.get_setting(db, "map_tiles_mode") or "online"
    if mode == "local_file":
        return (
            MapConfig(mode="local_file", pmtiles_url=PMTILES_URL)
            if _local_pmtiles(db)
            else MapConfig(mode="off")
        )
    return MapConfig(mode="off" if mode == "off" else "online")


@router.get("/api/map/tiles.pmtiles")
def map_pmtiles(
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> FileResponse:
    path = _local_pmtiles(db)
    if path is None:
        raise HTTPException(status_code=404, detail="not found")
    # FileResponse answers Range requests (206) and sets Accept-Ranges.
    return FileResponse(path, media_type="application/octet-stream")
