"""P2.3: map clusters for one library, and the optional local basemap.

Everything here reads `app.db` only. The server never fetches tiles: in
OpenStreetMap mode the browser does, in Local file mode this module hands the
browser a PMTiles archive from disk, and Off draws no basemap at all.

Clusters come from the `assets.latitude/longitude` columns the indexer fills.
An asset without a location is simply absent, a hidden asset never appears,
and every query is pinned to the caller's own library id.
"""

from __future__ import annotations

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


@router.get("/api/libraries/{library_id}/map", response_model=MapResponse)
def map_clusters(
    bbox: str | None = None,
    zoom: int = Query(0, ge=0, le=MAX_ZOOM),
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> MapResponse:
    where, params = (
        bbox_clause(parse_bbox(bbox))
        if bbox
        else ("latitude IS NOT NULL AND longitude IS NOT NULL", [])
    )
    cell = 360.0 / (2**zoom) / CELLS_PER_TILE
    # Shifting to non-negative makes CAST(... AS INTEGER) a floor.
    rows = db.execute(
        f"""
        SELECT COUNT(*) AS n, AVG(latitude) AS lat, AVG(longitude) AS lon,
               MIN(latitude) AS s, MAX(latitude) AS n_lat,
               MIN(longitude) AS w, MAX(longitude) AS e,
               MAX(CASE WHEN rn = 1 THEN uuid END) AS cover
        FROM (
            SELECT uuid, latitude, longitude, cx, cy,
                   ROW_NUMBER() OVER (
                       PARTITION BY cx, cy ORDER BY date_created DESC, id DESC
                   ) AS rn
            FROM (
                SELECT id, uuid, date_created, latitude, longitude,
                       CAST((latitude + 90) / ? AS INTEGER) AS cy,
                       CAST((longitude + 180) / ? AS INTEGER) AS cx
                FROM assets WHERE library_id = ? AND hidden = 0 AND {where}
            )
        )
        GROUP BY cx, cy
        ORDER BY n DESC, cx, cy
        """,
        (cell, cell, library["id"], *params),
    ).fetchall()
    clusters = [
        Cluster(
            lat=r["lat"],
            lon=r["lon"],
            count=r["n"],
            cover_id=r["cover"],
            bounds=BBox(west=r["w"], south=r["s"], east=r["e"], north=r["n_lat"]),
        )
        for r in rows
    ]
    return MapResponse(clusters=clusters, total=sum(c.count for c in clusters))


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
