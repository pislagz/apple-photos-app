"""P1.1: `GET /api/health` works without touching disk."""

from fastapi.testclient import TestClient

from photos_viewer.main import app


def test_health_ok():
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
