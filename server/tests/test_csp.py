"""P1.20: every response carries the Content-Security-Policy, with
tile.openstreetmap.org as the only external host."""

import re

from fastapi.testclient import TestClient

from photos_viewer.main import create_app


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
    assert d["frame-ancestors"] == ["'none'"]
    assert d["connect-src"] == ["'self'", "https://tile.openstreetmap.org"]
    assert "worker-src" not in d


def test_only_external_host_is_osm_tiles(tmp_path):
    (tmp_path / "index.html").write_text("<html></html>")
    response = TestClient(create_app(web_dist_dir=tmp_path)).get("/")

    hosts = re.findall(r"https?://[^\s;]+", response.headers["content-security-policy"])
    assert hosts == ["https://tile.openstreetmap.org"]
