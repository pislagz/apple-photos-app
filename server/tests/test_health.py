"""P1.1: `GET /api/health` works without touching disk."""

from fastapi.testclient import TestClient

from photos_viewer.main import app


def test_health_ok():
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_no_store_matches_api_me_exactly_not_lookalike_paths():
    with TestClient(app) as client:
        assert client.get("/api/me").headers["cache-control"] == "no-store"
        assert (
            client.get("/api/me/layout-override").headers["cache-control"] == "no-store"
        )
        assert "cache-control" not in client.get("/api/messages").headers
        assert "cache-control" not in client.get("/api/media").headers
