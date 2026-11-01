"""P1.3: passwords, session cookies, lockout, first-run admin, logout.

Exercises the HTTP surface in `session_auth.py` through `main.create_app`,
with `get_db` overridden to a connection under `tmp_path` so nothing touches
the repo or the default `./data`.
"""

import pytest
from fastapi.testclient import TestClient

from photos_viewer import app_db, session_auth
from photos_viewer.main import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app()
    conn = app_db.connect(tmp_path)
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    try:
        # https, not the default http://testserver: the session cookie is
        # Secure (CLAUDE.md requires it), and a Secure cookie is never sent
        # back over plain http, including by httpx's own cookie jar.
        yield TestClient(app, base_url="https://testserver")
    finally:
        conn.close()


def test_first_run_creates_the_admin(client):
    response = client.post("/api/setup/admin", json={"username": "admin", "password": "correct-horse"})

    assert response.status_code == 201
    assert response.json() == {"username": "admin", "role": "admin"}


def test_first_run_disables_itself_after_the_first_admin(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": "correct-horse"})

    second = client.post("/api/setup/admin", json={"username": "admin2", "password": "whatever-1"})

    assert second.status_code == 409


def test_login_sets_an_httponly_secure_samesite_strict_cookie(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": "correct-horse"})

    response = client.post("/api/auth/login", json={"username": "admin", "password": "correct-horse"})

    assert response.status_code == 200
    set_cookie = response.headers["set-cookie"]
    assert "session=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Secure" in set_cookie
    assert "samesite=strict" in set_cookie.lower()


def test_wrong_password_is_rejected_and_does_not_set_a_cookie(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": "correct-horse"})

    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})

    assert response.status_code == 401
    assert "set-cookie" not in response.headers


def test_unknown_username_is_rejected_the_same_way_as_a_wrong_password(client):
    response = client.post("/api/auth/login", json={"username": "nobody", "password": "whatever"})

    assert response.status_code == 401


def test_repeated_failures_lock_out_the_account(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": "correct-horse"})

    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS):
        client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})

    locked_out = client.post("/api/auth/login", json={"username": "admin", "password": "correct-horse"})

    assert locked_out.status_code == 429


def test_a_successful_login_clears_the_failure_count(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": "correct-horse"})

    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS - 1):
        client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    ok = client.post("/api/auth/login", json={"username": "admin", "password": "correct-horse"})
    assert ok.status_code == 200

    still_ok = client.post("/api/auth/login", json={"username": "admin", "password": "correct-horse"})
    assert still_ok.status_code == 200


def test_a_disabled_user_cannot_log_in(client, tmp_path):
    client.post("/api/setup/admin", json={"username": "admin", "password": "correct-horse"})
    conn = app_db.connect(tmp_path)
    try:
        conn.execute("UPDATE users SET disabled = 1 WHERE username = 'admin'")
        conn.commit()
    finally:
        conn.close()

    response = client.post("/api/auth/login", json={"username": "admin", "password": "correct-horse"})

    assert response.status_code == 401


def test_logout_revokes_the_session_and_clears_the_cookie(client, tmp_path):
    client.post("/api/setup/admin", json={"username": "admin", "password": "correct-horse"})
    client.post("/api/auth/login", json={"username": "admin", "password": "correct-horse"})

    response = client.post("/api/auth/logout")

    assert response.status_code == 204
    conn = app_db.connect(tmp_path)
    try:
        (count,) = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()
    finally:
        conn.close()
    assert count == 0


def test_remember_me_requests_a_longer_cookie_lifetime(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": "correct-horse"})

    short = client.post("/api/auth/login", json={"username": "admin", "password": "correct-horse"})
    client.post("/api/auth/logout")
    long = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "correct-horse", "remember_me": True},
    )

    def max_age(response):
        for part in response.headers["set-cookie"].split(";"):
            key, _, value = part.strip().partition("=")
            if key.lower() == "max-age":
                return int(value)
        raise AssertionError("no Max-Age in Set-Cookie")

    assert max_age(long) > max_age(short)


def test_hash_password_round_trips():
    hashed = session_auth.hash_password("correct-horse")

    assert session_auth.verify_password(hashed, "correct-horse") is True
    assert session_auth.verify_password(hashed, "wrong") is False


def test_lookup_session_rejects_an_unknown_token(tmp_path):
    conn = app_db.connect(tmp_path)
    try:
        assert session_auth.lookup_session(conn, "not-a-real-token") is None
    finally:
        conn.close()
