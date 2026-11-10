"""P1.12B: the server serves the built web app (`web/dist`) itself, with a
SPA fallback for client-side routes, so the PWA is reachable without Vite
running. `/api/*` must stay excluded -- an unknown API path still 404s as
JSON, never falling back to `index.html`.
"""

from fastapi.testclient import TestClient

from photos_viewer.main import create_app


def _write_fake_dist(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "icons").mkdir()
    (tmp_path / "index.html").write_text("<html>shell</html>")
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log('app')")
    (tmp_path / "sw.js").write_text("// service worker")
    (tmp_path / "manifest.webmanifest").write_text('{"name": "Photos"}')
    (tmp_path / "icons" / "icon.svg").write_text("<svg></svg>")
    return tmp_path


def test_root_serves_index_html(tmp_path):
    app = create_app(web_dist_dir=_write_fake_dist(tmp_path))
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert response.text == "<html>shell</html>"


def test_client_side_route_falls_back_to_index_html(tmp_path):
    app = create_app(web_dist_dir=_write_fake_dist(tmp_path))
    client = TestClient(app)

    response = client.get("/admin")

    assert response.status_code == 200
    assert response.text == "<html>shell</html>"


def test_hashed_asset_is_served_as_itself(tmp_path):
    app = create_app(web_dist_dir=_write_fake_dist(tmp_path))
    client = TestClient(app)

    response = client.get("/assets/index-abc123.js")

    assert response.status_code == 200
    assert response.text == "console.log('app')"


def test_service_worker_gets_a_no_cache_header(tmp_path):
    app = create_app(web_dist_dir=_write_fake_dist(tmp_path))
    client = TestClient(app)

    response = client.get("/sw.js")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-cache"


def test_manifest_gets_the_manifest_content_type(tmp_path):
    app = create_app(web_dist_dir=_write_fake_dist(tmp_path))
    client = TestClient(app)

    response = client.get("/manifest.webmanifest")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/manifest+json"


def test_unknown_api_path_still_404s_as_json(tmp_path):
    app = create_app(web_dist_dir=_write_fake_dist(tmp_path))
    client = TestClient(app)

    response = client.get("/api/unknown")

    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"detail": "not found"}


def test_path_traversal_outside_dist_falls_back_to_index_html(tmp_path):
    # %2e%2e survives an HTTP client's own URL normalization (plain "../"
    # would get collapsed before the request is even sent) and only turns
    # back into ".." once Starlette decodes the path -- the case the
    # `_safe_dist_file` containment check exists for.
    outside = tmp_path.parent / "outside-secret.txt"
    outside.write_text("do not serve me")
    app = create_app(web_dist_dir=_write_fake_dist(tmp_path))
    client = TestClient(app)

    response = client.get("/icons/%2e%2e/%2e%2e/outside-secret.txt")

    assert response.status_code == 200
    assert response.text == "<html>shell</html>"


def test_root_404s_when_no_dist_dir_is_built(tmp_path):
    app = create_app(web_dist_dir=tmp_path / "does-not-exist")
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 404


def test_dist_without_index_html_is_not_mounted(tmp_path, caplog):
    (tmp_path / "assets").mkdir()
    client = TestClient(create_app(web_dist_dir=tmp_path))

    assert client.get("/").status_code == 404
    assert client.get("/admin").status_code == 404
    assert client.get("/api/health").status_code == 200
    assert "no index.html" in caplog.text


def test_app_shell_must_be_revalidated_because_it_carries_the_csp(tmp_path):
    client = TestClient(create_app(web_dist_dir=_write_fake_dist(tmp_path)))

    for path in ("/", "/index.html", "/admin"):
        assert client.get(path).headers["cache-control"] == "no-cache"
