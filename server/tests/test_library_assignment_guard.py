"""P1.8: the per-library assignment guard every `/api/libraries/{library_id}/...`
route must depend on.

No real library route exists yet (P1.9). The scenario tests run against a
test-only route, registered on the real app, that depends on
`require_library_assignment` -- the same dependency any real P1.9 route will
use. The router-audit tests prove `unguarded_library_routes` actually
catches a route that forgets it.
"""

from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient

from photos_viewer import app_db, session_auth
from photos_viewer.main import create_app

VALID_PASSWORD = "correct-horse-battery"


def _probe_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/libraries/{library_id}/_probe")
    def probe(library: object = Depends(session_auth.require_library_assignment)) -> dict:
        return {"id": library["id"], "display_name": library["display_name"]}

    return router


def _client(tmp_path):
    app = create_app()
    conn = app_db.connect(tmp_path)
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    app.include_router(_probe_router())
    return conn, TestClient(app, base_url="https://testserver")


def _create_user(conn, username, *, role="user", disabled=False):
    conn.execute(
        "INSERT INTO users (username, password_hash, role, disabled) VALUES (?, ?, ?, ?)",
        (username, session_auth.hash_password(VALID_PASSWORD), role, int(disabled)),
    )
    conn.commit()
    return conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()["id"]


def _create_library(conn, display_name):
    conn.execute(
        "INSERT INTO libraries (display_name, path) VALUES (?, ?)",
        (display_name, f"/libraries/{display_name}.photoslibrary"),
    )
    conn.commit()
    return conn.execute("SELECT id FROM libraries WHERE display_name = ?", (display_name,)).fetchone()["id"]


def _assign(conn, user_id, library_id):
    conn.execute("INSERT INTO library_assignments (user_id, library_id) VALUES (?, ?)", (user_id, library_id))
    conn.commit()


def _login(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": VALID_PASSWORD})
    assert response.status_code == 200, response.text


def test_assigned_user_reaches_the_route(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1")
        _assign(conn, user_id, library_id)
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/_probe")

        assert response.status_code == 200
        assert response.json() == {"id": library_id, "display_name": "L1"}
    finally:
        conn.close()


def test_unassigned_user_gets_404(tmp_path):
    conn, client = _client(tmp_path)
    try:
        _create_user(conn, "alice")
        library_id = _create_library(conn, "L1")
        # alice is never assigned to L1.
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/_probe")

        assert response.status_code == 404
    finally:
        conn.close()


def test_unknown_library_id_gets_404(tmp_path):
    conn, client = _client(tmp_path)
    try:
        _create_user(conn, "alice")
        _login(client, "alice")

        response = client.get("/api/libraries/999/_probe")

        assert response.status_code == 404
    finally:
        conn.close()


def test_admin_without_self_assignment_gets_404(tmp_path):
    """CLAUDE.md's access-control scenario: an admin who has not assigned a
    library to themselves gets 404 on it too, same as any other user."""
    conn, client = _client(tmp_path)
    try:
        client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
        library_id = _create_library(conn, "L1")
        _login(client, "admin")

        response = client.get(f"/api/libraries/{library_id}/_probe")

        assert response.status_code == 404
    finally:
        conn.close()


def test_anonymous_gets_401(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_id = _create_library(conn, "L1")

        response = client.get(f"/api/libraries/{library_id}/_probe")

        assert response.status_code == 401
    finally:
        conn.close()


def test_disabled_user_gets_401(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1")
        _assign(conn, user_id, library_id)
        _login(client, "alice")
        conn.execute("UPDATE users SET disabled = 1 WHERE username = 'alice'")
        conn.commit()

        response = client.get(f"/api/libraries/{library_id}/_probe")

        assert response.status_code == 401
    finally:
        conn.close()


def test_revoked_session_gets_401(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1")
        _assign(conn, user_id, library_id)
        _login(client, "alice")
        conn.execute("DELETE FROM sessions")
        conn.commit()

        response = client.get(f"/api/libraries/{library_id}/_probe")

        assert response.status_code == 401
    finally:
        conn.close()


def test_router_audit_passes_on_the_real_app():
    """No real `/api/libraries/{...}` route exists yet (P1.9 adds them), so
    this is currently vacuously true -- it stays wired in so the first real
    route that forgets the dependency fails CI."""
    app = create_app()

    assert session_auth.unguarded_library_routes(app) == []


def test_router_audit_catches_a_route_missing_the_dependency():
    app = FastAPI()
    router = APIRouter()

    @router.get("/api/libraries/{library_id}/guarded")
    def guarded(library: object = Depends(session_auth.require_library_assignment)) -> dict:
        return {}

    @router.get("/api/libraries/{library_id}/unguarded")
    def unguarded(library_id: int) -> dict:
        return {}

    app.include_router(router)

    assert session_auth.unguarded_library_routes(app) == ["/api/libraries/{library_id}/unguarded"]


def test_router_audit_ignores_routes_outside_the_library_prefix():
    app = FastAPI()

    @app.get("/api/admin/libraries/{library_id}")
    def admin_route(library_id: int) -> dict:
        return {}

    assert session_auth.unguarded_library_routes(app) == []
