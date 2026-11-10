"""D41: optional offline place names for photos that have GPS but no place
name saved by Photos.

The names come from a GeoNames dump (`cities15000`: cities with 15,000+
people, CC BY 4.0) that an admin downloads once, by hand, into
`<data dir>/geonames/`. Everything after that is local: a photo's coordinates
are looked up in an in-memory grid of the ~25,000 cities and never leave the
process, and nothing is fetched per photo.

The result is stored in its own column, `assets.place_offline`, next to (never
over) Apple's `place`, `place_address` and `place_country_code`, which always
win in the UI. Turning the setting off blanks the column.

The one outbound request this server ever makes is `download()`, started by an
admin from Settings once the admin has agreed to "Map & place names", to the
official GeoNames dump URL below. It runs only on that request; indexing,
serving and the test suite never reach it. Without that consent the lookup is
off and the column stays empty.
"""

from __future__ import annotations

import io
import logging
import math
import os
import pathlib
import sqlite3
import tempfile
import threading
import urllib.request
import zipfile
from collections.abc import Iterator

from . import app_db

logger = logging.getLogger(__name__)

DATASET = "cities15000"
GEONAMES_URL = f"https://download.geonames.org/export/dump/{DATASET}.zip"
ATTRIBUTION = "Place names from GeoNames (https://www.geonames.org), CC BY 4.0."
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
_MAX_DISTANCE_KM = 100.0
_EARTH_RADIUS_KM = 6371.0
_CELL_DEGREES = 1.0


def gazetteer_path(data_dir: str | pathlib.Path) -> pathlib.Path:
    return pathlib.Path(data_dir) / "geonames" / f"{DATASET}.txt"


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


class Gazetteer:
    """Nearest-city lookup over 1-degree grid buckets: a query scans its own
    cell and grows the ring of cells until a found city is provably nearer
    than anything in the next ring (or the distance cap is reached)."""

    def __init__(self, cities: Iterator[tuple[str, str, float, float]]) -> None:
        self._grid: dict[tuple[int, int], list[tuple[float, float, str]]] = {}
        self.size = 0
        for name, country, lat, lon in cities:
            label = f"{name}, {country}" if country else name
            self._grid.setdefault(self._cell(lat, lon), []).append((lat, lon, label))
            self.size += 1

    @staticmethod
    def _cell(lat: float, lon: float) -> tuple[int, int]:
        return (math.floor(lat / _CELL_DEGREES), math.floor(lon / _CELL_DEGREES))

    def lookup(self, latitude: float | None, longitude: float | None) -> str | None:
        if latitude is None or longitude is None:
            return None
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            return None
        row, col = self._cell(latitude, longitude)
        cols = int(360 / _CELL_DEGREES)
        # Kilometres per cell step, in the worst direction: a degree of
        # longitude shrinks toward the poles, so ring r holds nothing nearer
        # than (r - 1) * km_per_cell.
        km_per_cell = 111.0 * max(
            0.02, math.cos(math.radians(min(89.0, abs(latitude) + _CELL_DEGREES)))
        )
        max_ring = int(_MAX_DISTANCE_KM / km_per_cell) + 2
        best: tuple[float, str] | None = None
        for ring in range(max_ring + 1):
            if best is not None and best[0] <= max(0, ring - 1) * km_per_cell:
                break
            for r in range(row - ring, row + ring + 1):
                on_edge_row = r in (row - ring, row + ring)
                step = 1 if on_edge_row else max(1, 2 * ring)
                for c in range(col - ring, col + ring + 1, step):
                    wrapped = (c + cols // 2) % cols - cols // 2  # antimeridian
                    for lat, lon, label in self._grid.get((r, wrapped), ()):
                        distance = _haversine_km(latitude, longitude, lat, lon)
                        if best is None or distance < best[0]:
                            best = (distance, label)
        if best is None or best[0] > _MAX_DISTANCE_KM:
            return None
        return best[1]


def _parse(lines: Iterator[str]) -> Iterator[tuple[str, str, float, float]]:
    # Tab separated: 1 name, 4 latitude, 5 longitude, 8 country code.
    for line in lines:
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 9:
            continue
        try:
            yield parts[1], parts[8], float(parts[4]), float(parts[5])
        except ValueError:
            continue


_cache_lock = threading.Lock()
_cache: tuple[pathlib.Path, int, int, Gazetteer] | None = None


def load(data_dir: str | pathlib.Path) -> Gazetteer | None:
    """The downloaded gazetteer, parsed once per file version; None if the
    admin has not downloaded it."""
    global _cache
    path = gazetteer_path(data_dir)
    try:
        stat = path.stat()
    except OSError:
        return None
    with _cache_lock:
        if (
            _cache
            and _cache[0] == path
            and _cache[1:3] == (stat.st_mtime_ns, stat.st_size)
        ):
            return _cache[3]
        with path.open(encoding="utf-8") as handle:
            gazetteer = Gazetteer(_parse(handle))
        _cache = (path, stat.st_mtime_ns, stat.st_size, gazetteer)
        return gazetteer


def data_dir_of(db: sqlite3.Connection) -> pathlib.Path | None:
    row = db.execute("PRAGMA database_list").fetchone()
    return pathlib.Path(row["file"]).parent if row and row["file"] else None


def enabled(db: sqlite3.Connection) -> bool:
    """Offline place names follow the single OSM-data consent."""
    return app_db.osm_consent(db)


def indexing_lookup(db: sqlite3.Connection) -> Gazetteer | None:
    """The gazetteer the indexer should use for this run, or None when the
    setting is off or the data is not downloaded."""
    if not enabled(db):
        return None
    data_dir = data_dir_of(db)
    return load(data_dir) if data_dir else None


def status(data_dir: str | pathlib.Path) -> dict:
    path = gazetteer_path(data_dir)
    downloaded = path.is_file()
    return {
        "dataset": DATASET,
        "downloaded": downloaded,
        "size_bytes": path.stat().st_size if downloaded else 0,
        "source_url": GEONAMES_URL,
        "attribution": ATTRIBUTION,
        "license_url": LICENSE_URL,
    }


class DownloadError(Exception):
    pass


def download(data_dir: str | pathlib.Path, url: str | None = None) -> int:
    """Fetch the GeoNames zip and store its `cities15000.txt`. Returns the
    number of rows. The file is written beside its final name and moved into
    place, so a failed download leaves the previous data intact."""
    source = url or GEONAMES_URL
    target = gazetteer_path(data_dir)
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        request = urllib.request.Request(
            source, headers={"User-Agent": "photos-viewer"}
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read(_MAX_DOWNLOAD_BYTES + 1)
        if len(body) > _MAX_DOWNLOAD_BYTES:
            raise DownloadError("The GeoNames file is larger than expected.")
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            member = f"{DATASET}.txt"
            if member not in archive.namelist():
                raise DownloadError(f"{member} is missing from the download.")
            text = archive.read(member)
    except DownloadError:
        raise
    except (OSError, zipfile.BadZipFile, ValueError) as exc:
        raise DownloadError(f"Could not download the place-name data: {exc}") from exc
    rows = sum(1 for _ in _parse(io.StringIO(text.decode("utf-8", "replace"))))
    if rows == 0:
        raise DownloadError("The download held no places.")
    handle, temp_name = tempfile.mkstemp(dir=target.parent, suffix=".part")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(text)
        os.replace(temp_name, target)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    return rows


def backfill(db: sqlite3.Connection, gazetteer: Gazetteer) -> int:
    """Fill `place_offline` from the coordinates already in `app.db` for every
    asset with GPS and no name from Photos. No library file is touched."""
    updated = 0
    rows = db.execute(
        "SELECT id, latitude, longitude FROM assets "
        "WHERE latitude IS NOT NULL AND longitude IS NOT NULL "
        "AND COALESCE(place, place_address, '') = ''"
    ).fetchall()
    for batch_start in range(0, len(rows), 2000):
        for row in rows[batch_start : batch_start + 2000]:
            name = gazetteer.lookup(row["latitude"], row["longitude"])
            db.execute(
                "UPDATE assets SET place_offline = ? WHERE id = ? AND place_offline IS NOT ?",
                (name, row["id"], name),
            )
            updated += 1
        db.commit()
    return updated


def clear(db: sqlite3.Connection) -> None:
    db.execute("UPDATE assets SET place_offline = NULL WHERE place_offline IS NOT NULL")
    db.commit()


BACKGROUND = True
_backfill_lock = threading.Lock()


def apply_setting(data_dir: str | pathlib.Path) -> None:
    """After the setting changed or the data arrived: fill or blank the
    column. Runs on its own connection (in a thread unless `BACKGROUND` is
    off, for tests), because a big library takes a few seconds."""

    def run() -> None:
        with _backfill_lock:
            conn = app_db.connect(data_dir)
            try:
                gazetteer = indexing_lookup(conn)
                if gazetteer is None:
                    clear(conn)
                else:
                    backfill(conn, gazetteer)
            except Exception:
                logger.warning("offline place-name pass failed", exc_info=True)
            finally:
                conn.close()

    if BACKGROUND:
        threading.Thread(target=run, daemon=True, name="place-names").start()
    else:
        run()
