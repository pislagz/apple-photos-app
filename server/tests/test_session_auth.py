"""P1.3: passwords, session cookies, lockout, first-run admin, logout.

Exercises the HTTP surface in `session_auth.py` through `main.create_app`,
with `get_db` overridden to a connection under `tmp_path` so nothing touches
the repo or the default `./data`.
"""

import threading
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from photos_viewer import app_db, session_auth
from photos_viewer.main import create_app

VALID_PASSWORD = "correct-horse-battery"


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


@pytest.fixture
def loopback_client(tmp_path):
    """Same as `client`, but `request.client.host` is `127.0.0.1` -- what
    every request looks like behind `tailscale serve` -- instead of
    httpx's default `testclient`, for the per-IP lockout tests below."""
    app = create_app()
    conn = app_db.connect(tmp_path)
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    try:
        yield TestClient(app, base_url="https://testserver", client=("127.0.0.1", 51000))
    finally:
        conn.close()


def test_first_run_creates_the_admin(client):
    response = client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    assert response.status_code == 201
    assert response.json() == {"username": "admin", "role": "admin"}


def test_first_run_disables_itself_after_the_first_admin(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    second = client.post("/api/setup/admin", json={"username": "admin2", "password": "another-long-pw"})

    assert second.status_code == 409


def test_concurrent_first_run_setup_creates_exactly_one_admin(tmp_path):
    """Two first-run requests racing must not both insert an admin: the
    count-then-insert in `setup_admin` is one `BEGIN IMMEDIATE` transaction,
    so the loser blocks until the winner commits and then sees the row."""
    barrier = threading.Barrier(2)
    outcomes: list[tuple[str, int]] = []
    lock = threading.Lock()

    def attempt(username):
        conn = app_db.connect(tmp_path)
        try:
            barrier.wait()
            try:
                payload = session_auth.AdminSetupRequest(username=username, password=VALID_PASSWORD)
                session_auth.setup_admin(payload, db=conn)
                with lock:
                    outcomes.append(("ok", 201))
            except HTTPException as exc:
                with lock:
                    outcomes.append(("error", exc.status_code))
        finally:
            conn.close()

    threads = [threading.Thread(target=attempt, args=(name,)) for name in ("admin-a", "admin-b")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert [outcome for outcome, _ in outcomes].count("ok") == 1
    error_statuses = [status for outcome, status in outcomes if outcome == "error"]
    assert error_statuses and all(status in (403, 409) for status in error_statuses)

    conn = app_db.connect(tmp_path)
    try:
        (count,) = conn.execute("SELECT COUNT(*) FROM users").fetchone()
    finally:
        conn.close()
    assert count == 1


def test_setup_admin_rejects_a_password_shorter_than_12_characters(client):
    response = client.post("/api/setup/admin", json={"username": "admin", "password": "short"})

    assert response.status_code == 422


def test_setup_admin_rejects_an_empty_username(client):
    response = client.post("/api/setup/admin", json={"username": "", "password": VALID_PASSWORD})

    assert response.status_code == 422


def test_setup_admin_rejects_a_username_over_64_characters(client):
    response = client.post("/api/setup/admin", json={"username": "a" * 65, "password": VALID_PASSWORD})

    assert response.status_code == 422


def test_setup_admin_normalizes_username_case_and_whitespace(client):
    response = client.post("/api/setup/admin", json={"username": "  Admin  ", "password": VALID_PASSWORD})

    assert response.status_code == 201
    assert response.json()["username"] == "admin"


def test_login_sets_an_httponly_secure_samesite_strict_cookie(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    assert response.status_code == 200
    set_cookie = response.headers["set-cookie"]
    assert "session=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Secure" in set_cookie
    assert "samesite=strict" in set_cookie.lower()


def test_login_is_case_insensitive_on_username(client):
    client.post("/api/setup/admin", json={"username": "Admin", "password": VALID_PASSWORD})

    response = client.post("/api/auth/login", json={"username": "ADMIN", "password": VALID_PASSWORD})

    assert response.status_code == 200


def test_wrong_password_is_rejected_and_does_not_set_a_cookie(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong-password-1"})

    assert response.status_code == 401
    assert "set-cookie" not in response.headers


def test_unknown_username_is_rejected_the_same_way_as_a_wrong_password(client):
    response = client.post("/api/auth/login", json={"username": "nobody", "password": "whatever-password"})

    assert response.status_code == 401


def test_unknown_username_still_runs_a_dummy_password_verification(client, monkeypatch):
    """Timing defense: a missing (or disabled) user must still pay for one
    Argon2 verify, against a fixed dummy hash, not skip straight to 401."""
    calls = []
    original_verify = session_auth.verify_password

    def spy(password_hash, password):
        calls.append(password_hash)
        return original_verify(password_hash, password)

    monkeypatch.setattr(session_auth, "verify_password", spy)

    client.post("/api/auth/login", json={"username": "nobody", "password": "whatever-password"})

    assert calls == [session_auth._DUMMY_PASSWORD_HASH]


def test_disabled_user_login_also_runs_a_dummy_password_verification(client, tmp_path, monkeypatch):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    conn = app_db.connect(tmp_path)
    try:
        conn.execute("UPDATE users SET disabled = 1 WHERE username = 'admin'")
        conn.commit()
    finally:
        conn.close()

    calls = []
    original_verify = session_auth.verify_password

    def spy(password_hash, password):
        calls.append(password_hash)
        return original_verify(password_hash, password)

    monkeypatch.setattr(session_auth, "verify_password", spy)

    response = client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    assert response.status_code == 401
    assert calls == [session_auth._DUMMY_PASSWORD_HASH]


def test_repeated_failures_lock_out_the_account(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS):
        client.post("/api/auth/login", json={"username": "admin", "password": "wrong-password-1"})

    locked_out = client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    assert locked_out.status_code == 429


def test_failures_against_unknown_usernames_do_not_lock_out_a_real_account(client):
    """Only failures against a username that exists count toward its
    per-username lockout -- otherwise probing with made-up usernames that
    happen to collide would do nothing (they aren't stored), but a wrong
    guess against a real one still must count, which this and the test
    above together cover."""
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS * 2):
        client.post("/api/auth/login", json={"username": "nobody-at-all", "password": "whatever-password"})

    still_ok = client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    assert still_ok.status_code == 200


def test_unknown_username_gets_429_after_the_same_number_of_failures_as_a_real_user(client):
    """Issue #12 C: an unknown name must be locked out after the same
    `MAX_FAILED_LOGIN_ATTEMPTS` as a real account -- a 429 on attempt N+1
    (rather than an immediate, cheap rejection) must not be a way to learn
    the username doesn't exist."""
    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS):
        client.post("/api/auth/login", json={"username": "ghost", "password": "whatever-password"})

    locked_out = client.post("/api/auth/login", json={"username": "ghost", "password": "whatever-password"})

    assert locked_out.status_code == 429


def test_failures_against_an_unknown_name_do_not_carry_over_once_it_becomes_a_real_account(client, tmp_path):
    """Issue #12 C: unknown-username failures are counted in a separate row
    set (`user_exists = 0`) from a real account's, so a flood of guesses
    against a not-yet-created name can never lock out an account later
    created with that same name."""
    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS * 2):
        client.post("/api/auth/login", json={"username": "charlie", "password": "whatever-password"})

    conn = app_db.connect(tmp_path)
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES ('charlie', ?, 'user')",
            (session_auth.hash_password(VALID_PASSWORD),),
        )
        conn.commit()
    finally:
        conn.close()

    response = client.post("/api/auth/login", json={"username": "charlie", "password": VALID_PASSWORD})

    assert response.status_code == 200


def test_per_ip_lockout_trips_even_across_different_usernames(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    for i in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS_PER_IP):
        client.post("/api/auth/login", json={"username": f"nobody-{i}", "password": "whatever-password"})

    locked_out = client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    assert locked_out.status_code == 429


def test_loopback_with_no_tailscale_header_does_not_lock_out_other_users(loopback_client):
    """Issue #12 A: behind `tailscale serve`, every request arrives from
    `127.0.0.1`. Without a `Tailscale-User-Login` header there is no way to
    tell callers apart, so the per-client limit must be skipped entirely --
    otherwise many wrong passwords from one real user would lock out
    everyone else on the tailnet."""
    loopback_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    for i in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS_PER_IP * 2):
        loopback_client.post("/api/auth/login", json={"username": f"nobody-{i}", "password": "whatever-password"})

    still_ok = loopback_client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    assert still_ok.status_code == 200


def test_loopback_per_client_lockout_is_keyed_on_the_tailscale_user_login_header(loopback_client):
    """With a `Tailscale-User-Login` header present, loopback callers are
    distinguishable again, and the per-client limit applies per header
    value: flooding as "alice" must not lock out "bob"."""
    loopback_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    for i in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS_PER_IP):
        loopback_client.post(
            "/api/auth/login",
            json={"username": f"nobody-{i}", "password": "whatever-password"},
            headers={"tailscale-user-login": "alice"},
        )

    alice_locked_out = loopback_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    assert alice_locked_out.status_code == 429

    bob_still_ok = loopback_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "bob"},
    )
    assert bob_still_ok.status_code == 200


def test_a_successful_login_clears_the_failure_count(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS - 1):
        client.post("/api/auth/login", json={"username": "admin", "password": "wrong-password-1"})
    ok = client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})
    assert ok.status_code == 200

    still_ok = client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})
    assert still_ok.status_code == 200


def test_a_disabled_user_cannot_log_in(client, tmp_path):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    conn = app_db.connect(tmp_path)
    try:
        conn.execute("UPDATE users SET disabled = 1 WHERE username = 'admin'")
        conn.commit()
    finally:
        conn.close()

    response = client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    assert response.status_code == 401


def test_login_rehashes_a_password_with_outdated_argon2_parameters(client, tmp_path):
    from argon2 import PasswordHasher

    weak_hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    conn = app_db.connect(tmp_path)
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')",
            (weak_hasher.hash(VALID_PASSWORD),),
        )
        conn.commit()
        (before,) = conn.execute("SELECT password_hash FROM users WHERE username = 'admin'").fetchone()
    finally:
        conn.close()

    response = client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})
    assert response.status_code == 200

    conn = app_db.connect(tmp_path)
    try:
        (after,) = conn.execute("SELECT password_hash FROM users WHERE username = 'admin'").fetchone()
    finally:
        conn.close()
    assert after != before
    assert session_auth.verify_password(after, VALID_PASSWORD) is True


def test_logout_revokes_the_session_and_clears_the_cookie(client, tmp_path):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.post("/api/auth/logout", json={})

    assert response.status_code == 204
    conn = app_db.connect(tmp_path)
    try:
        (count,) = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()
    finally:
        conn.close()
    assert count == 0


def test_remember_me_requests_a_longer_cookie_lifetime(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    short = client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/logout", json={})
    long = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD, "remember_me": True},
    )

    def max_age(response):
        for part in response.headers["set-cookie"].split(";"):
            key, _, value = part.strip().partition("=")
            if key.lower() == "max-age":
                return int(value)
        raise AssertionError("no Max-Age in Set-Cookie")

    assert max_age(long) > max_age(short)


def test_hash_password_round_trips():
    hashed = session_auth.hash_password(VALID_PASSWORD)

    assert session_auth.verify_password(hashed, VALID_PASSWORD) is True
    assert session_auth.verify_password(hashed, "wrong") is False


def test_lookup_session_rejects_an_unknown_token(tmp_path):
    conn = app_db.connect(tmp_path)
    try:
        assert session_auth.lookup_session(conn, "not-a-real-token") is None
    finally:
        conn.close()


def test_lookup_session_rejects_a_session_whose_user_is_now_disabled(tmp_path):
    conn = app_db.connect(tmp_path)
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES ('admin', 'h', 'admin')",
        )
        conn.commit()
        (user_id,) = conn.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()
        raw_token, _ = session_auth.create_session(conn, user_id)

        assert session_auth.lookup_session(conn, raw_token) is not None

        conn.execute("UPDATE users SET disabled = 1 WHERE id = ?", (user_id,))
        conn.commit()

        assert session_auth.lookup_session(conn, raw_token) is None
    finally:
        conn.close()


def test_lookup_session_only_touches_last_seen_at_after_the_throttle_window(tmp_path):
    conn = app_db.connect(tmp_path)
    try:
        conn.execute("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'h', 'admin')")
        conn.commit()
        (user_id,) = conn.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()
        raw_token, _ = session_auth.create_session(conn, user_id)
        session_id = session_auth._hash_token(raw_token)
        conn.execute(
            "UPDATE sessions SET last_seen_at = datetime('now', '-1 seconds') WHERE id = ?",
            (session_id,),
        )
        conn.commit()
        (before,) = conn.execute("SELECT last_seen_at FROM sessions WHERE id = ?", (session_id,)).fetchone()

        session_auth.lookup_session(conn, raw_token)

        (after,) = conn.execute("SELECT last_seen_at FROM sessions WHERE id = ?", (session_id,)).fetchone()
        assert after == before
    finally:
        conn.close()


def test_prune_expired_sessions_is_throttled_to_about_once_a_minute(tmp_path, monkeypatch):
    """Issue #12 B: pruning is a DELETE plus commit on every call unless
    throttled. Inside the throttle window it must do nothing at all, even
    though `lookup_session`'s own WHERE clause would already reject the
    stale row regardless of whether this ran."""
    conn = app_db.connect(tmp_path)
    try:
        conn.execute("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'h', 'admin')")
        conn.commit()
        (user_id,) = conn.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()
        conn.execute(
            "INSERT INTO sessions (id, user_id, expires_at) VALUES ('stale', ?, datetime('now', '-1 hour'))",
            (user_id,),
        )
        conn.commit()

        monkeypatch.setattr(session_auth, "_last_session_prune_at", time.monotonic())
        session_auth._prune_expired_sessions(conn)
        (still_there,) = conn.execute("SELECT COUNT(*) FROM sessions WHERE id = 'stale'").fetchone()
        assert still_there == 1

        monkeypatch.setattr(session_auth, "_last_session_prune_at", 0.0)
        session_auth._prune_expired_sessions(conn)
        (pruned,) = conn.execute("SELECT COUNT(*) FROM sessions WHERE id = 'stale'").fetchone()
        assert pruned == 0
    finally:
        conn.close()


def test_get_auth_me_returns_the_current_user(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json() == {"username": "admin", "role": "admin"}


def test_get_auth_me_401s_with_no_cookie(client):
    response = client.get("/api/auth/me")

    assert response.status_code == 401


def test_get_auth_me_401s_after_logout(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/logout", json={})

    response = client.get("/api/auth/me")

    assert response.status_code == 401


def test_get_auth_me_401s_after_the_session_is_revoked_by_id(client, tmp_path):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    conn = app_db.connect(tmp_path)
    try:
        (session_id,) = conn.execute("SELECT id FROM sessions").fetchone()
        session_auth.revoke_session_by_id(conn, session_id)
    finally:
        conn.close()

    response = client.get("/api/auth/me")

    assert response.status_code == 401


def test_get_auth_me_401s_after_expiry(client, monkeypatch):
    monkeypatch.setenv("PHOTOS_VIEWER_SESSION_LIFETIME_DESKTOP_SECONDS", "0")
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})
    time.sleep(1.1)

    response = client.get("/api/auth/me")

    assert response.status_code == 401


def test_post_without_json_content_type_is_rejected(client):
    response = client.post(
        "/api/auth/login",
        content=b'{"username": "admin", "password": "correct-horse-battery"}',
        headers={"content-type": "text/plain"},
    )

    assert response.status_code == 415


def test_post_with_a_cross_origin_origin_header_is_rejected(client):
    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "https://evil.example"},
    )

    assert response.status_code == 403


def test_post_with_a_same_host_origin_header_is_accepted(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "https://testserver"},
    )

    assert response.status_code == 200


def test_post_with_a_same_host_but_different_port_origin_is_rejected(client):
    """Issue #12 E: the CSRF origin check must compare scheme, host, *and*
    port -- a same-host Origin on a different port is not same-origin."""
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "https://testserver:8443"},
    )

    assert response.status_code == 403


def test_post_with_a_same_host_but_different_scheme_origin_is_rejected(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "http://testserver"},
    )

    assert response.status_code == 403


def test_login_does_not_enforce_the_setup_minimum_password_length(client):
    """Issue #12 F: a short wrong password at login must go through the
    same lockout accounting and Argon2 verify as any other wrong password
    (401), not get turned away early by a 422 -- which would itself be a
    way to learn something about the real password's length."""
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.post("/api/auth/login", json={"username": "admin", "password": "short"})

    assert response.status_code == 401


def test_login_still_rejects_a_password_over_the_maximum_length(client):
    response = client.post("/api/auth/login", json={"username": "admin", "password": "a" * 1025})

    assert response.status_code == 422


def test_admin_unlock_clears_the_lockout_and_the_user_can_log_in_again(client, tmp_path):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    conn = app_db.connect(tmp_path)
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES ('bob', ?, 'user')",
            (session_auth.hash_password(VALID_PASSWORD),),
        )
        conn.commit()
    finally:
        conn.close()

    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS):
        client.post("/api/auth/login", json={"username": "bob", "password": "wrong-password-1"})
    locked_out = client.post("/api/auth/login", json={"username": "bob", "password": VALID_PASSWORD})
    assert locked_out.status_code == 429

    unlock = client.post("/api/admin/users/bob/unlock", json={})
    assert unlock.status_code == 200
    assert unlock.json() == {"username": "bob"}

    unlocked_login = client.post("/api/auth/login", json={"username": "bob", "password": VALID_PASSWORD})
    assert unlocked_login.status_code == 200


def test_admin_unlock_is_403_for_a_non_admin(client, tmp_path):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    conn = app_db.connect(tmp_path)
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES ('bob', ?, 'user')",
            (session_auth.hash_password(VALID_PASSWORD),),
        )
        conn.commit()
    finally:
        conn.close()

    client.post("/api/auth/login", json={"username": "bob", "password": VALID_PASSWORD})

    response = client.post("/api/admin/users/bob/unlock", json={})

    assert response.status_code == 403


def test_admin_unlock_404s_for_an_unknown_user(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.post("/api/admin/users/nobody/unlock", json={})

    assert response.status_code == 404


def test_env_seconds_falls_back_to_the_default_on_a_bad_value(monkeypatch, caplog):
    monkeypatch.setenv("PHOTOS_VIEWER_SESSION_LIFETIME_DESKTOP_SECONDS", "not-a-number")

    assert session_auth._env_seconds("PHOTOS_VIEWER_SESSION_LIFETIME_DESKTOP_SECONDS", 123) == 123


def test_env_seconds_falls_back_to_the_default_on_a_negative_value(monkeypatch):
    monkeypatch.setenv("PHOTOS_VIEWER_SESSION_LIFETIME_DESKTOP_SECONDS", "-5")

    assert session_auth._env_seconds("PHOTOS_VIEWER_SESSION_LIFETIME_DESKTOP_SECONDS", 123) == 123


def test_cookie_secure_defaults_to_true(monkeypatch):
    monkeypatch.delenv("PHOTOS_VIEWER_COOKIE_SECURE", raising=False)

    assert session_auth._cookie_secure() is True


def test_cookie_secure_can_be_disabled_for_plain_http_dev(monkeypatch):
    monkeypatch.setenv("PHOTOS_VIEWER_COOKIE_SECURE", "false")

    assert session_auth._cookie_secure() is False
