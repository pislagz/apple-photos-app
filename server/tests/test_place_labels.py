"""P2.5: place names come only from the library's own place record.

A photo with GPS and no place record has `place*` null (the web shows
coordinates or "Unknown place"); a photo with a place record returns that
text unchanged. Sockets are guarded so any geocoding attempt fails the test.
"""

from __future__ import annotations

import ast
import pathlib
import socket

import pytest
from fastapi.testclient import TestClient

from photos_viewer import app_db, indexer, session_auth
from photos_viewer.main import create_app
from tests.fixtures import FixtureAsset, _build_asset_image_bytes, build_library

PASSWORD = "correct-horse-battery"


def _uuid(n):
    return f"A0000000-0000-0000-0000-{n:012d}"


@pytest.fixture
def no_connections(monkeypatch):
    attempts = []

    def refuse(self, address, *args, **kwargs):
        attempts.append(address)
        raise AssertionError(f"unexpected connection to {address!r}")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(
        socket.socket, "connect_ex", lambda self, a: attempts.append(a) or 1
    )
    yield attempts
    assert attempts == []


def _setup(tmp_path):
    data = _build_asset_image_bytes()
    assets = [
        FixtureAsset(
            uuid=_uuid(1),
            filename="IMG_0001.HEIC",
            data=data,
            latitude=52.2297,
            longitude=21.0122,
        ),
        FixtureAsset(
            uuid=_uuid(2),
            filename="IMG_0002.HEIC",
            data=data,
            latitude=48.86,
            longitude=2.35,
        ),
    ]
    package = build_library(tmp_path, assets)
    app = create_app()
    conn = app_db.connect(tmp_path / "data")
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    app.dependency_overrides[session_auth.get_media_cache_dir] = lambda: (
        tmp_path / "media_cache"
    )
    client = TestClient(app, base_url="https://testserver")
    conn.execute(
        "INSERT INTO libraries (display_name, path) VALUES ('L1', ?)", (str(package),)
    )
    conn.commit()
    lib = conn.execute("SELECT id FROM libraries").fetchone()["id"]
    indexer.index_library(conn, lib, package, force=True)
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES ('alice', ?, 'user')",
        (session_auth.hash_password(PASSWORD),),
    )
    conn.execute(
        "INSERT INTO library_assignments (user_id, library_id) VALUES (1, ?)", (lib,)
    )
    conn.commit()
    r = client.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})
    assert r.status_code == 200
    return conn, client, lib


def test_gps_without_place_record_has_no_name_and_a_place_record_is_unchanged(
    tmp_path, no_connections
):
    conn, client, lib = _setup(tmp_path)
    try:
        conn.execute(
            "UPDATE assets SET place = 'Zürich', place_country_code = 'CH', "
            "place_address = 'Bahnhofstrasse 1, Zürich, Switzerland' WHERE uuid = ?",
            (_uuid(2),),
        )
        conn.commit()
        bare = client.get(f"/api/libraries/{lib}/assets/{_uuid(1)}").json()
        assert (bare["latitude"], bare["longitude"]) == (52.2297, 21.0122)
        assert (bare["place"], bare["place_address"], bare["place_country_code"]) == (
            None,
            None,
            None,
        )

        named = client.get(f"/api/libraries/{lib}/assets/{_uuid(2)}").json()
        assert named["place"] == "Zürich"
        assert named["place_address"] == "Bahnhofstrasse 1, Zürich, Switzerland"
        assert named["place_country_code"] == "CH"

        found = client.get(
            f"/api/libraries/{lib}/search", params={"q": "zurich"}
        ).json()
        assert [i["id"] for i in found["items"]] == [_uuid(2)]
        # a coordinate-only photo is not findable by a made-up place name
        found = client.get(
            f"/api/libraries/{lib}/search", params={"q": "warsaw"}
        ).json()
        assert found["items"] == []
    finally:
        conn.close()


def test_place_code_paths_import_no_network_or_geocoder():
    banned = {
        "requests",
        "httpx",
        "urllib",
        "urllib3",
        "aiohttp",
        "http",
        "socket",
        "geopy",
        "reverse_geocoder",
        "nominatim",
    }
    root = pathlib.Path(indexer.__file__).parent
    for name in (
        "indexer.py",
        "library_assets.py",
        "library_search.py",
        "library_map.py",
    ):
        tree = ast.parse((root / name).read_text())
        for node in ast.walk(tree):
            mods = []
            if isinstance(node, ast.Import):
                mods = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                mods = [node.module]
            for m in mods:
                assert m.split(".")[0] not in banned, f"{name} imports {m}"


class _PlaceInfo:
    """What the indexer reads from `PhotoInfo.place`."""

    def __init__(self, name, country_code, address_str):
        self.name = name
        self.country_code = country_code
        self.address_str = address_str


class _PhotoWithPlace:
    """A PhotoInfo stand-in: every attribute comes from the real record
    except `place`, which the synthetic fixture cannot carry."""

    def __init__(self, photo, place):
        self._photo = photo
        self.place = place

    def __getattr__(self, name):
        return getattr(self._photo, name)


class _PhotosDBWithPlaces:
    def __init__(self, photosdb, places):
        self._photosdb = photosdb
        self._places = places

    def photos(self):
        for photo in self._photosdb.photos():
            yield _PhotoWithPlace(photo, self._places.get(photo.uuid))

    def __getattr__(self, name):
        return getattr(self._photosdb, name)


def test_indexer_copies_photoinfo_place_into_the_place_columns(tmp_path):
    from photos_viewer import libraries

    data = _build_asset_image_bytes()
    package = build_library(
        tmp_path,
        [
            FixtureAsset(uuid=_uuid(1), filename="IMG_0001.HEIC", data=data),
            FixtureAsset(uuid=_uuid(2), filename="IMG_0002.HEIC", data=data),
        ],
    )
    conn = app_db.connect(tmp_path / "data")
    opened = libraries.open_library_readonly(package)
    try:
        conn.execute(
            "INSERT INTO libraries (display_name, path) VALUES ('L1', ?)",
            (str(package),),
        )
        conn.commit()
        lib = conn.execute("SELECT id FROM libraries").fetchone()["id"]
        places = {
            _uuid(1): _PlaceInfo(
                "Zürich", "CH", "Bahnhofstrasse 1, Zürich, Switzerland"
            )
        }
        conn.execute("BEGIN IMMEDIATE")
        indexer._write_index(conn, lib, _PhotosDBWithPlaces(opened.db, places))
        conn.commit()

        rows = {
            r["uuid"]: (r["place"], r["place_country_code"], r["place_address"])
            for r in conn.execute(
                "SELECT uuid, place, place_country_code, place_address FROM assets"
            )
        }
        assert rows[_uuid(1)] == (
            "Zürich",
            "CH",
            "Bahnhofstrasse 1, Zürich, Switzerland",
        )
        assert rows[_uuid(2)] == (None, None, None)
    finally:
        opened.close()
        conn.close()
