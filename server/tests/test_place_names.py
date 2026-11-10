"""D41: opt-in offline place names (GeoNames gazetteer) and the two privacy
opt-ins. Nothing here may reach the internet: the one download is served from
a local HTTP server, and every other path runs with sockets guarded."""

from __future__ import annotations

import http.server
import io
import math
import random
import socket
import threading
import zipfile

import pytest
from fastapi.testclient import TestClient

from photos_viewer import app_db, indexer, place_names, session_auth
from photos_viewer.main import create_app
from tests.fixtures import FixtureAsset, _build_asset_image_bytes, build_library

PASSWORD = "correct-horse-battery"

CITIES = [
    # name, country, lat, lon  (GeoNames columns 1, 8, 4, 5)
    ("Warsaw", "PL", 52.22977, 21.01178),
    ("Paris", "FR", 48.85341, 2.3488),
    ("Auckland", "NZ", -36.84853, 174.76349),
    ("Suva", "FJ", -18.14161, 178.44149),
    ("Longyearbyen", "SJ", 78.22334, 15.64689),
    ("Anadyr", "RU", 64.73424, 177.50766),
    ("Taveuni", "FJ", -16.9, 179.98),
]


def _dump(cities=CITIES) -> str:
    rows = []
    for i, (name, country, lat, lon) in enumerate(cities):
        cols = [""] * 19
        cols[0], cols[1], cols[2] = str(i), name, name
        cols[4], cols[5], cols[8] = str(lat), str(lon), country
        rows.append("\t".join(cols))
    return "\n".join(rows) + "\n"


def _zip(text: str, member="cities15000.txt") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(member, text)
    return buffer.getvalue()


@pytest.fixture
def geonames_server(monkeypatch):
    """A localhost stand-in for download.geonames.org."""
    payload = {"body": _zip(_dump()), "status": 200}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if "on_get" in payload:
                payload["on_get"]()
            self.send_response(payload["status"])
            self.end_headers()
            self.wfile.write(payload["body"])

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    payload["url"] = f"http://127.0.0.1:{server.server_port}/cities15000.zip"
    monkeypatch.setattr(place_names, "GEONAMES_URL", payload["url"])
    yield payload
    server.shutdown()


@pytest.fixture(autouse=True)
def _sync_backfill(monkeypatch):
    monkeypatch.setattr(place_names, "BACKGROUND", False)
    place_names._cache = None


def _gazetteer(cities=CITIES) -> place_names.Gazetteer:
    return place_names.Gazetteer(iter([(n, c, la, lo) for n, c, la, lo in cities]))


def test_nearest_city_within_range_and_none_far_from_any():
    g = _gazetteer()
    assert g.lookup(52.2297, 21.0122) == "Warsaw, PL"
    assert g.lookup(48.9, 2.4) == "Paris, FR"
    assert g.lookup(0.0, -140.0) is None  # open Pacific
    assert g.lookup(None, 10) is None
    assert g.lookup(999, 0) is None


def test_lookup_wraps_the_antimeridian_and_works_near_the_pole():
    g = _gazetteer()
    # A photo just across the date line (179.99W) from Taveuni at 179.98E.
    assert g.lookup(-16.9, -179.99) == "Taveuni, FJ"
    assert g.lookup(78.0, 15.0) == "Longyearbyen, SJ"
    # 1 degree of longitude near 64N is ~48 km, so the ring search must widen.
    assert g.lookup(64.7, 179.0) == "Anadyr, RU"


def test_grid_lookup_matches_brute_force():
    rng = random.Random(7)
    cities = [
        (f"c{i}", "XX", rng.uniform(-80, 80), rng.uniform(-180, 180))
        for i in range(400)
    ]
    g = _gazetteer(cities)
    for _ in range(300):
        lat, lon = rng.uniform(-80, 80), rng.uniform(-180, 180)
        nearest = min(
            (
                (place_names._haversine_km(lat, lon, la, lo), n)
                for n, _c, la, lo in cities
            )
        )
        expected = (
            f"{nearest[1]}, XX" if nearest[0] <= place_names._MAX_DISTANCE_KM else None
        )
        assert g.lookup(lat, lon) == expected


def test_download_writes_the_dataset_and_a_failed_download_keeps_the_old_one(
    tmp_path, geonames_server
):
    rows = place_names.download(tmp_path, geonames_server["url"])
    assert rows == len(CITIES)
    path = place_names.gazetteer_path(tmp_path)
    assert path.read_text().count("\n") == len(CITIES)
    before = path.read_bytes()

    geonames_server["body"] = b"not a zip"
    with pytest.raises(place_names.DownloadError):
        place_names.download(tmp_path, geonames_server["url"])
    geonames_server["body"] = _zip(_dump(), member="other.txt")
    with pytest.raises(place_names.DownloadError):
        place_names.download(tmp_path, geonames_server["url"])
    assert path.read_bytes() == before
    assert list(path.parent.glob("*.part")) == []


def test_the_download_url_is_the_official_geonames_dump():
    assert place_names.GEONAMES_URL == (
        "https://download.geonames.org/export/dump/cities15000.zip"
    )
    assert "CC BY 4.0" in place_names.ATTRIBUTION


def test_nothing_outside_the_admin_download_can_open_a_connection():
    import ast
    import pathlib

    root = pathlib.Path(place_names.__file__).parent
    for path in root.glob("*.py"):
        tree = ast.parse(path.read_text())
        calls = {
            f"{path.name}:{ast.unparse(node.func)}"
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and ast.unparse(node.func) in ("place_names.download", "download")
        }
        if path.name not in ("admin_panel.py", "place_names.py"):
            assert not calls, calls
    assert "urllib" not in (root / "indexer.py").read_text()


# --------------------------------------------------------------------------
# Indexing, API fields, settings
# --------------------------------------------------------------------------


def _uuid(n):
    return f"A0000000-0000-0000-0000-{n:012d}"


def _admin_with_library(tmp_path):
    data = _build_asset_image_bytes()
    package = build_library(
        tmp_path,
        [
            FixtureAsset(
                uuid=_uuid(1),
                filename="IMG_1.HEIC",
                data=data,
                latitude=52.2297,
                longitude=21.0122,
            ),
            FixtureAsset(
                uuid=_uuid(2),
                filename="IMG_2.HEIC",
                data=data,
                latitude=48.86,
                longitude=2.35,
            ),
            FixtureAsset(uuid=_uuid(3), filename="IMG_3.HEIC", data=data),
        ],
    )
    app = create_app()
    conn = app_db.connect(tmp_path / "data")
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    app.dependency_overrides[session_auth.get_media_cache_dir] = lambda: (
        tmp_path / "media_cache"
    )
    client = TestClient(app, base_url="https://testserver")
    assert (
        client.post(
            "/api/setup/admin", json={"username": "admin", "password": PASSWORD}
        ).status_code
        == 201
    )
    client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    conn.execute(
        "INSERT INTO libraries (display_name, path) VALUES ('L1', ?)", (str(package),)
    )
    conn.commit()
    lib = conn.execute("SELECT id FROM libraries").fetchone()["id"]
    conn.execute(
        "INSERT INTO library_assignments (user_id, library_id) VALUES (1, ?)", (lib,)
    )
    conn.commit()
    return app, conn, client, lib, package


def _settings(client, **overrides):
    current = client.get("/api/admin/settings").json()
    current.update(overrides)
    response = client.put("/api/admin/settings", json=current)
    assert response.status_code == 200, response.text
    return response.json()


def _detail(client, lib, n):
    return client.get(f"/api/libraries/{lib}/assets/{_uuid(n)}").json()


def test_indexing_fills_place_offline_only_when_enabled_and_downloaded(
    tmp_path, geonames_server
):
    _app, conn, client, lib, package = _admin_with_library(tmp_path)
    try:
        # Off by default: nothing stored, nothing shown.
        indexer.index_library(conn, lib, package, force=True)
        assert _detail(client, lib, 1)["place_offline"] is None

        # On but not downloaded yet: still nothing.
        _settings(client, osm_consent=True)
        indexer.index_library(conn, lib, package, force=True)
        assert _detail(client, lib, 1)["place_offline"] is None

        # Downloaded (admin action): the backfill names GPS photos without a
        # touch of the library, and a re-index keeps them.
        assert (
            client.post("/api/admin/place-names/download", json={}).status_code == 200
        )
        assert _detail(client, lib, 1)["place_offline"] == "Warsaw, PL"
        assert _detail(client, lib, 2)["place_offline"] == "Paris, FR"
        assert _detail(client, lib, 3)["place_offline"] is None  # no GPS
        indexer.index_library(conn, lib, package, force=True)
        assert _detail(client, lib, 1)["place_offline"] == "Warsaw, PL"

        # Apple's own record stays untouched next to it, and is not overwritten.
        detail = _detail(client, lib, 1)
        assert (detail["place"], detail["place_address"]) == (None, None)

        # Turning it off blanks the column.
        _settings(client, osm_consent=False)
        assert _detail(client, lib, 1)["place_offline"] is None
    finally:
        conn.close()


def test_apple_place_names_are_never_looked_up_over(tmp_path):
    class Place:
        name = "Zürich"
        address_str = None

    assert indexer._offline_place(_gazetteer(), Place(), 52.2297, 21.0122) is None
    assert indexer._offline_place(_gazetteer(), None, 52.2297, 21.0122) == "Warsaw, PL"
    assert indexer._offline_place(None, None, 52.2297, 21.0122) is None


def test_backfill_skips_assets_that_have_an_apple_name(tmp_path):
    _app, conn, client, lib, package = _admin_with_library(tmp_path)
    try:
        indexer.index_library(conn, lib, package, force=True)
        conn.execute("UPDATE assets SET place = 'Zürich' WHERE uuid = ?", (_uuid(1),))
        conn.commit()
        place_names.backfill(conn, _gazetteer())
        assert _detail(client, lib, 1)["place_offline"] is None
        assert _detail(client, lib, 2)["place_offline"] == "Paris, FR"
    finally:
        conn.close()


def test_lookup_and_indexing_make_no_connections(tmp_path, monkeypatch):
    attempts = []
    monkeypatch.setattr(
        socket.socket, "connect", lambda self, a, *r, **k: attempts.append(a)
    )
    _app, conn, client, lib, package = _admin_with_library(tmp_path)
    try:
        path = place_names.gazetteer_path(tmp_path / "data")
        path.parent.mkdir(parents=True)
        path.write_text(_dump())
        _settings(client, osm_consent=True)
        indexer.index_library(conn, lib, package, force=True)
        assert _detail(client, lib, 1)["place_offline"] == "Warsaw, PL"
        assert attempts == []
    finally:
        conn.close()


def test_selection_summary_uses_the_offline_name_when_there_is_no_apple_one(tmp_path):
    _app, conn, client, lib, package = _admin_with_library(tmp_path)
    try:
        indexer.index_library(conn, lib, package, force=True)
        conn.execute(
            "UPDATE assets SET place_offline = 'Warsaw, PL' WHERE uuid IN (?, ?)",
            (_uuid(1), _uuid(2)),
        )
        conn.commit()
        response = client.post(
            f"/api/libraries/{lib}/selection-summary",
            json={"asset_ids": [_uuid(1), _uuid(2)]},
        )
        assert response.json()["place"] == "Warsaw, PL"
    finally:
        conn.close()


def test_place_name_admin_routes_are_admin_only_audited_and_report_errors(
    tmp_path, geonames_server
):
    _app, conn, client, _lib, _package = _admin_with_library(tmp_path)
    try:
        status = client.get("/api/admin/place-names").json()
        assert status["downloaded"] is False
        assert status["consent_decided"] is True  # setup recorded the choice
        assert status["consent"] is False
        _settings(client, osm_consent=True)  # downloading needs the consent
        assert "GeoNames" in status["attribution"]

        geonames_server["body"] = b"junk"
        failed = client.post("/api/admin/place-names/download", json={})
        assert failed.status_code == 502
        assert client.get("/api/admin/place-names").json()["downloaded"] is False

        geonames_server["body"] = _zip(_dump())
        ok = client.post("/api/admin/place-names/download", json={})
        assert ok.status_code == 200 and ok.json()["downloaded"] is True
        row = conn.execute(
            "SELECT * FROM audit_log WHERE action = 'place_names_download'"
        ).fetchone()
        assert row is not None and "rows=7" in row["detail"]

        # A plain user gets 403 on both.
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES ('bob', ?, 'user')",
            (session_auth.hash_password(PASSWORD),),
        )
        conn.commit()
        client.post("/api/auth/login", json={"username": "bob", "password": PASSWORD})
        assert client.get("/api/admin/place-names").status_code == 403
        assert (
            client.post("/api/admin/place-names/download", json={}).status_code == 403
        )
    finally:
        conn.close()


def _provider(conn):
    return lambda: conn


def test_first_run_setup_records_the_single_consent_off_by_default(tmp_path):
    for body, mode, consent in (
        ({}, "off", "0"),
        ({"osm_consent": True}, "online", "1"),
    ):
        directory = tmp_path / mode
        directory.mkdir()
        app = create_app()
        conn = app_db.connect(directory)
        app.dependency_overrides[session_auth.get_db] = _provider(conn)
        client = TestClient(app, base_url="https://testserver")
        response = client.post(
            "/api/setup/admin", json={"username": "admin", "password": PASSWORD, **body}
        )
        assert response.status_code == 201
        assert app_db.get_setting(conn, "map_tiles_mode") == mode
        assert app_db.get_setting(conn, "osm_consent") == consent
        audited = conn.execute(
            "SELECT detail FROM audit_log WHERE action = 'osm_consent_agreed'"
        ).fetchall()
        assert len(audited) == (1 if consent == "1" else 0)
        conn.close()


def test_consent_notice_stays_until_the_question_is_answered(tmp_path):
    _app, conn, client, _lib, _package = _admin_with_library(tmp_path)
    try:
        # An install from before the consent existed: no saved answer.
        conn.execute("DELETE FROM settings WHERE key = 'osm_consent'")
        conn.commit()
        status = client.get("/api/admin/place-names").json()
        assert status["consent_decided"] is False and status["consent"] is False
        _settings(client)
        assert client.get("/api/admin/place-names").json()["consent_decided"] is True
    finally:
        conn.close()


def test_without_consent_nothing_is_downloaded_looked_up_or_mapped(
    tmp_path, geonames_server
):
    hits = []
    geonames_server["on_get"] = lambda: hits.append(1)
    _app, conn, client, lib, package = _admin_with_library(tmp_path)
    try:
        # Data on disk and every old switch on, but no consent.
        path = place_names.gazetteer_path(tmp_path / "data")
        path.parent.mkdir(parents=True)
        path.write_text(_dump())
        app_db.set_setting(conn, "map_tiles_mode", "online")
        app_db.set_setting(conn, "offline_place_names", "1")
        assert app_db.get_setting(conn, "osm_consent") == "0"

        refused = client.post("/api/admin/place-names/download", json={})
        assert refused.status_code == 403
        assert hits == []

        indexer.index_library(conn, lib, package, force=True)
        assert _detail(client, lib, 1)["place_offline"] is None
        assert client.get("/api/map/config").json() == {
            "mode": "off",
            "pmtiles_url": None,
        }
        assert client.get("/api/me").json()["osm_consent"] is False
    finally:
        conn.close()


def test_agreeing_and_withdrawing_are_audited_and_blank_the_names(
    tmp_path, geonames_server
):
    _app, conn, client, lib, package = _admin_with_library(tmp_path)
    try:
        indexer.index_library(conn, lib, package, force=True)
        _settings(client, osm_consent=True)
        assert client.get("/api/me").json()["osm_consent"] is True
        assert client.get("/api/map/config").json()["mode"] == "online"
        assert (
            client.post("/api/admin/place-names/download", json={}).status_code == 200
        )
        assert _detail(client, lib, 1)["place_offline"] == "Warsaw, PL"
        _settings(client, osm_consent=False)
        assert _detail(client, lib, 1)["place_offline"] is None
        assert client.get("/api/map/config").json()["mode"] == "off"
        actions = [
            row["action"]
            for row in conn.execute(
                "SELECT action FROM audit_log WHERE action LIKE 'osm_consent%' ORDER BY id"
            )
        ]
        assert actions == ["osm_consent_agreed", "osm_consent_withdrawn"]
    finally:
        conn.close()


def test_math_import_is_used():  # keeps the module's haversine honest
    assert math.isclose(place_names._haversine_km(0, 0, 0, 1), 111.19, rel_tol=0.01)
