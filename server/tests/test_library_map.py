"""P2.3: map clusters, the basemap setting, and the local PMTiles route."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from photos_viewer import app_db, library_map, session_auth
from photos_viewer.main import create_app

VALID_PASSWORD = "correct-horse-battery"

# (uuid suffix, lat, lon, hidden): three close together near Paris, two in
# Sydney, one hidden in Paris, one with no location at all.
PARIS = [(1, 48.8566, 2.3522), (2, 48.8570, 2.3530), (3, 48.8600, 2.3600)]
SYDNEY = [(4, -33.8688, 151.2093), (5, -33.8690, 151.2100)]
HIDDEN_PARIS = (6, 48.8567, 2.3523)
NO_LOCATION = 7


def _uuid(n):
    return f"A0000000-0000-0000-0000-{n:012d}"


@pytest.fixture
def env(tmp_path):
    app = create_app()
    conn = app_db.connect(tmp_path / "data")
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    client = TestClient(app, base_url="https://testserver")
    for name in ("L1", "L2"):
        (tmp_path / f"{name}.photoslibrary").mkdir()
        conn.execute(
            "INSERT INTO libraries (display_name, path) VALUES (?, ?)",
            (name, str(tmp_path / f"{name}.photoslibrary")),
        )
    ids = {
        r["display_name"]: r["id"]
        for r in conn.execute("SELECT id, display_name FROM libraries")
    }

    def add(library, n, lat, lon, hidden=0, uuid=None):
        conn.execute(
            "INSERT INTO assets (library_id, uuid, filename, date_created, hidden, "
            "latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                library,
                uuid or _uuid(n),
                f"IMG_{n}.JPG",
                f"2024-01-0{n}T00:00:00",
                hidden,
                lat,
                lon,
            ),
        )

    for n, lat, lon in PARIS + SYDNEY:
        add(ids["L1"], n, lat, lon)
    add(ids["L1"], HIDDEN_PARIS[0], HIDDEN_PARIS[1], HIDDEN_PARIS[2], hidden=1)
    add(ids["L1"], NO_LOCATION, None, None)
    # The other library has a photo in Paris too.
    add(ids["L2"], 1, 48.8566, 2.3522, uuid="B0000000-0000-0000-0000-000000000001")
    conn.commit()

    def login(username, library=None):
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')",
            (username, session_auth.hash_password(VALID_PASSWORD)),
        )
        uid = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()["id"]
        if library:
            conn.execute(
                "INSERT INTO library_assignments (user_id, library_id) VALUES (?, ?)",
                (uid, ids[library]),
            )
        conn.commit()
        r = client.post(
            "/api/auth/login", json={"username": username, "password": VALID_PASSWORD}
        )
        assert r.status_code == 200, r.text

    try:
        yield conn, client, ids, login, tmp_path
    finally:
        conn.close()


def test_low_zoom_clusters_and_high_zoom_splits(env):
    conn, client, ids, login, _ = env
    login("alice", "L1")
    url = f"/api/libraries/{ids['L1']}/map"
    low = client.get(url, params={"zoom": 2}).json()
    # Two clusters (Paris 3, Sydney 2), not five points; hidden and
    # null-location assets are not counted.
    assert [c["count"] for c in low["clusters"]] == [3, 2]
    assert low["total"] == 5
    paris = low["clusters"][0]
    assert paris["cover_id"] == _uuid(3)  # newest visible
    assert paris["bounds"]["west"] == pytest.approx(2.3522)
    assert paris["bounds"]["north"] == pytest.approx(48.86)
    high = client.get(url, params={"zoom": 22}).json()
    assert [c["count"] for c in high["clusters"]] == [1] * 5
    assert {c["cover_id"] for c in high["clusters"]} == {_uuid(n) for n in range(1, 6)}
    # Cluster count equals a direct SQL count.
    direct = conn.execute(
        "SELECT COUNT(*) FROM assets WHERE library_id = ? AND hidden = 0 "
        "AND latitude IS NOT NULL",
        (ids["L1"],),
    ).fetchone()[0]
    assert low["total"] == high["total"] == direct


def test_null_location_and_hidden_assets_are_absent(env):
    _, client, ids, login, _ = env
    login("alice", "L1")
    data = client.get(f"/api/libraries/{ids['L1']}/map", params={"zoom": 22}).json()
    covers = {c["cover_id"] for c in data["clusters"]}
    assert _uuid(NO_LOCATION) not in covers
    assert _uuid(HIDDEN_PARIS[0]) not in covers


def test_bbox_limits_and_stays_inside_the_library(env):
    _, client, ids, login, _ = env
    login("alice", "L1")
    url = f"/api/libraries/{ids['L1']}/map"
    paris_box = client.get(url, params={"bbox": "1,47,4,50", "zoom": 2}).json()
    assert paris_box["total"] == 3
    # L2's Paris photo is never included for a caller of L1.
    assert all(c["cover_id"].startswith("A0000000") for c in paris_box["clusters"])
    nowhere = client.get(url, params={"bbox": "-60,-10,-50,0", "zoom": 2}).json()
    assert nowhere == {"clusters": [], "total": 0, "truncated": False}
    # West > east crosses the antimeridian: Sydney only if the box wraps it.
    wrap = client.get(url, params={"bbox": "150,-40,-170,-30", "zoom": 2}).json()
    assert wrap["total"] == 2
    for bad in ("1,2,3", "a,b,c,d", "0,50,1,40", "0,0,400,10"):
        assert client.get(url, params={"bbox": bad}).status_code == 422


def test_place_filter_lists_the_photos_of_a_cluster(env):
    _, client, ids, login, _ = env
    login("alice", "L1")
    r = client.get(
        f"/api/libraries/{ids['L1']}/assets", params={"place": "2.35,48.85,2.37,48.87"}
    )
    assert r.status_code == 200
    assert {i["id"] for i in r.json()["items"]} == {_uuid(n) for n in (1, 2, 3)}


def test_404_for_other_users_401_anonymous(env):
    _, client, ids, login, _ = env
    url = f"/api/libraries/{ids['L1']}/map"
    assert client.get(url).status_code == 401
    assert (
        client.get(
            f"/api/libraries/{ids['L1']}/assets", params={"place": "0,0,1,1"}
        ).status_code
        == 401
    )
    login("bob", "L2")
    assert client.get(url).status_code == 404
    assert client.get(url, params={"bbox": "1,47,4,50"}).status_code == 404
    assert (
        client.get(
            f"/api/libraries/{ids['L1']}/assets", params={"place": "0,0,1,1"}
        ).status_code
        == 404
    )
    own = client.get(f"/api/libraries/{ids['L2']}/map", params={"zoom": 2}).json()
    assert own["total"] == 1 and own["clusters"][0]["cover_id"].startswith("B0000000")


# ---- basemap setting and PMTiles ---------------------------------------


def _pmtiles(tmp_path):
    path = tmp_path / "tiny.pmtiles"
    path.write_bytes(b"PMTiles" + bytes(range(256)))
    return path


def _set(conn, consent, path=None):
    app_db.set_setting(conn, "osm_consent", "1" if consent else "0")
    app_db.set_setting(
        conn, "map_tiles_pmtiles_path", "" if path is None else str(path)
    )
    conn.commit()


def test_config_requires_login_and_defaults_to_off(env):
    conn, client, _ids, login, _ = env
    assert client.get("/api/map/config").status_code == 401
    assert client.get("/api/map/tiles.pmtiles").status_code == 401
    login("alice", "L1")
    # D41: no OSM tiles until an admin opts in.
    assert client.get("/api/map/config").json() == {
        "mode": "off",
        "pmtiles_url": None,
    }
    _set(conn, True, None)
    assert client.get("/api/map/config").json() == {
        "mode": "online",
        "pmtiles_url": None,
    }


def test_without_consent_a_local_file_is_used_and_serves_ranges(env):
    conn, client, _ids, login, tmp_path = env
    login("alice", "L1")
    _set(conn, False, _pmtiles(tmp_path))
    assert client.get("/api/map/config").json() == {
        "mode": "local_file",
        "pmtiles_url": "/api/map/tiles.pmtiles",
    }
    r = client.get("/api/map/tiles.pmtiles", headers={"Range": "bytes=7-16"})
    assert r.status_code == 206
    assert r.content == bytes(range(10))
    assert r.headers["content-range"] == "bytes 7-16/263"
    assert r.headers["accept-ranges"] == "bytes"
    assert client.get("/api/map/tiles.pmtiles").status_code == 200


def test_with_consent_osm_wins_and_the_file_is_only_the_fallback(env):
    conn, client, _ids, login, tmp_path = env
    login("alice", "L1")
    _set(conn, True, _pmtiles(tmp_path))
    assert client.get("/api/map/config").json() == {
        "mode": "online",
        "pmtiles_url": "/api/map/tiles.pmtiles",
    }
    assert client.get("/api/map/tiles.pmtiles").status_code == 200


@pytest.mark.parametrize("kind", ["missing", "not_pmtiles", "directory"])
@pytest.mark.parametrize("consent", [False, True])
def test_bad_local_file_counts_as_no_file(env, kind, consent):
    conn, client, _ids, login, tmp_path = env
    login("alice", "L1")
    path = tmp_path / "x.pmtiles"
    if kind == "not_pmtiles":
        path.write_bytes(b"hello")
    elif kind == "directory":
        path.mkdir()
    _set(conn, consent, path)
    assert client.get("/api/map/config").json() == {
        "mode": "online" if consent else "off",
        "pmtiles_url": None,
    }
    assert client.get("/api/map/tiles.pmtiles").status_code == 404


def test_no_file_means_no_archive_route(env):
    conn, client, _ids, login, _tmp = env
    login("alice", "L1")
    _set(conn, False, None)
    assert client.get("/api/map/tiles.pmtiles").status_code == 404


def test_indexed_fixture_locations_reach_the_map(tmp_path):
    """End to end through osxphotos: a located fixture asset clusters, an
    unlocated one is absent."""
    from photos_viewer import indexer
    from tests.fixtures import FixtureAsset, _build_asset_image_bytes, build_library

    data = _build_asset_image_bytes()
    assets = [
        FixtureAsset(
            uuid=_uuid(n),
            filename=f"IMG_{n}.HEIC",
            data=data,
            created=700000000.0 + n,
            latitude=lat,
            longitude=lon,
        )
        for n, lat, lon in ((1, 48.85, 2.35), (2, 48.86, 2.36), (3, None, None))
    ]
    package = build_library(tmp_path, assets)
    app = create_app()
    conn = app_db.connect(tmp_path / "data")
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    try:
        conn.execute(
            "INSERT INTO libraries (display_name, path) VALUES ('L1', ?)",
            (str(package),),
        )
        conn.commit()
        library_id = conn.execute("SELECT id FROM libraries").fetchone()["id"]
        indexer.index_library(conn, library_id, package, force=True)
        rows = conn.execute(
            "SELECT uuid, latitude FROM assets ORDER BY uuid"
        ).fetchall()
        assert [r["latitude"] is not None for r in rows] == [True, True, False]
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES ('a', ?, 'user')",
            (session_auth.hash_password(VALID_PASSWORD),),
        )
        conn.execute(
            "INSERT INTO library_assignments (user_id, library_id) VALUES (1, ?)",
            (library_id,),
        )
        conn.commit()
        client = TestClient(app, base_url="https://testserver")
        client.post(
            "/api/auth/login", json={"username": "a", "password": VALID_PASSWORD}
        )
        data = client.get(f"/api/libraries/{library_id}/map", params={"zoom": 1}).json()
        assert data["total"] == 2
    finally:
        conn.close()


def test_pin_opens_exactly_its_own_photos_even_when_cut_by_the_viewport(env):
    _, client, ids, login, _ = env
    login("alice", "L1")
    url = f"/api/libraries/{ids['L1']}"
    # Neighbouring points within one zoom-9 cell would overlap rectangles; a
    # viewport whose edge cuts through Paris must still count all of it.
    for viewport in ("2.3,48,2.5,49", "-180,-85,180,85", "2.352,48.8,2.353,48.9"):
        data = client.get(f"{url}/map", params={"bbox": viewport, "zoom": 9}).json()
        assert data["clusters"]
        for c in data["clusters"]:
            b = c["bounds"]
            place = f"{b['west']},{b['south']},{b['east']},{b['north']}"
            listed = client.get(f"{url}/assets", params={"place": place}).json()
            assert len(listed["items"]) == c["count"]


def test_cluster_count_is_capped_keeping_the_largest(env, monkeypatch):
    _, client, ids, login, _ = env
    login("alice", "L1")
    monkeypatch.setattr(library_map, "MAX_CLUSTERS", 1)
    data = client.get(f"/api/libraries/{ids['L1']}/map", params={"zoom": 22}).json()
    assert len(data["clusters"]) == 1 and data["truncated"] is True
    low = client.get(f"/api/libraries/{ids['L1']}/map", params={"zoom": 2}).json()
    assert [c["count"] for c in low["clusters"]] == [3] and low["truncated"] is True


def test_location_index_exists(env):
    conn = env[0]
    cols = [r["name"] for r in conn.execute("PRAGMA index_info(idx_assets_location)")]
    assert cols == ["library_id", "hidden", "latitude", "longitude"]
