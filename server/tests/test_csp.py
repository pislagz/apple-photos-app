"""P1.20, D41: every response carries the Content-Security-Policy. With the
map off (the default) there is no external host at all; tile.openstreetmap.org
appears on connect-src only while an admin has turned the OSM map on."""

import re

from fastapi.testclient import TestClient

from photos_viewer import app_db, session_auth
from photos_viewer.main import create_app


def _app_with_db(tmp_path, mode=None):
    (tmp_path / "index.html").write_text("<html></html>")
    app = create_app(web_dist_dir=tmp_path)
    conn = app_db.connect(tmp_path / "data")
    if mode is not None:
        app_db.set_setting(conn, "map_tiles_mode", mode)
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    return app, conn


def _directives(response) -> dict[str, list[str]]:
    header = response.headers["content-security-policy"]
    out = {}
    for part in header.split(";"):
        name, *values = part.split()
        out[name] = values
    return out


def test_html_and_api_carry_policy(tmp_path):
    (tmp_path / "index.html").write_text("<html>shell</html>")
    client = TestClient(create_app(web_dist_dir=tmp_path))

    html = client.get("/")
    api = client.get("/api/health")
    missing = client.get("/api/nope")

    assert _directives(html) == _directives(api) == _directives(missing)
    d = _directives(html)
    assert d["default-src"] == ["'self'"]
    assert d["script-src"] == ["'self'"]
    assert d["style-src"] == ["'self'"]
    assert d["font-src"] == ["'self'"]
    assert d["img-src"] == ["'self'", "blob:", "data:"]
    assert d["object-src"] == ["'none'"]
    assert d["base-uri"] == ["'self'"]
    assert d["form-action"] == ["'self'"]
    assert d["frame-ancestors"] == ["'none'"]
    assert d["connect-src"] == ["'self'"]
    assert "worker-src" not in d


def test_no_external_host_while_the_osm_map_is_off(tmp_path):
    for mode in (None, "off", "local_file"):
        app, conn = _make(tmp_path, mode)
        response = TestClient(app).get("/")
        assert (
            re.findall(r"https?://[^\s;]+", response.headers["content-security-policy"])
            == []
        )
        conn.close()


def _make(tmp_path, mode):
    directory = tmp_path / f"site-{mode}"
    directory.mkdir()
    return _app_with_db(directory, mode)


def test_only_external_host_is_osm_tiles_and_only_when_turned_on(tmp_path):
    app, conn = _make(tmp_path, "online")
    response = TestClient(app).get("/")
    hosts = re.findall(r"https?://[^\s;]+", response.headers["content-security-policy"])
    assert hosts == ["https://tile.openstreetmap.org"]
    assert _directives(response)["connect-src"] == [
        "'self'",
        "https://tile.openstreetmap.org",
    ]
    conn.close()


def test_saving_settings_updates_the_policy_at_once(tmp_path):
    app, conn = _make(tmp_path, "online")
    client = TestClient(app, base_url="https://testserver")
    assert (
        "tile.openstreetmap.org" in client.get("/").headers["content-security-policy"]
    )
    # Saving the setting drops the cached policy; the next response follows it.
    app_db.set_setting(conn, "map_tiles_mode", "off")
    app.state.csp_cache = None
    assert (
        "tile.openstreetmap.org"
        not in client.get("/").headers["content-security-policy"]
    )
    conn.close()
