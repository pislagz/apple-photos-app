"""P1.3: passwords, session cookies, lockout, first-run admin, logout.

Exercises the HTTP surface in `session_auth.py` through `main.create_app`,
with `get_db` overridden to a connection under `tmp_path` so nothing touches
the repo or the default `./data`.
"""

import contextlib
import logging
import threading
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from photos_viewer import app_db, session_auth
from photos_viewer.main import create_app

VALID_PASSWORD = "correct-horse-battery"


@pytest.fixture(autouse=True)
def _reset_env_derived_caches():
    """`PHOTOS_VIEWER_PUBLIC_ORIGINS` and `PHOTOS_VIEWER_TRUSTED_PROXIES`
    are parsed once and cached at startup (not re-parsed per request), so
    without this a cache populated by one test (or by a `client` fixture's
    `create_app()`, which runs before a test's own `monkeypatch.setenv`)
    would leak into the next."""
    session_auth.reset_public_origins_cache()
    session_auth.reset_trusted_proxies_cache()
    yield
    session_auth.reset_public_origins_cache()
    session_auth.reset_trusted_proxies_cache()


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


def _proxied_client(tmp_path, *, peer_host):
    """Wraps the app in uvicorn's own `ProxyHeadersMiddleware` -- the real
    mechanism `uvicorn photos_viewer.main:app` installs by default (see
    `session_auth`'s module docstring) -- instead of a hand-rolled stand-in
    for it, so the tests using this exercise what actually runs behind
    `tailscale serve`. `base_url` is plain `http://` so a test can tell
    "scheme rewritten by the middleware" apart from "scheme the direct
    connection already had"."""
    app = create_app()
    conn = app_db.connect(tmp_path)
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    proxied = ProxyHeadersMiddleware(app, trusted_hosts=["127.0.0.1", "::1"])
    return conn, TestClient(proxied, base_url="http://testserver", client=(peer_host, 51000))


@pytest.fixture
def proxied_client(tmp_path):
    """Same wiring as `loopback_client`, but through a real
    `ProxyHeadersMiddleware` instead of relying on this module to read
    forwarded headers itself -- the direct peer is loopback, same as every
    `tailscale serve` connection."""
    conn, test_client = _proxied_client(tmp_path, peer_host="127.0.0.1")
    try:
        yield test_client
    finally:
        conn.close()


@pytest.fixture
def proxied_client_untrusted_peer(tmp_path):
    """Same as `proxied_client`, but the direct peer is not loopback -- what
    a caller who can merely reach the port, without also being the trusted
    reverse proxy, looks like to `ProxyHeadersMiddleware`."""
    conn, test_client = _proxied_client(tmp_path, peer_host="203.0.113.5")
    try:
        yield test_client
    finally:
        conn.close()


def _gateway_client(tmp_path, *, peer_host):
    """`request.client.host` is a fixed non-loopback address, standing in
    for the Docker bridge gateway `tailscale serve` on the host connects
    through -- distinct from `proxied_client`, which exercises uvicorn's
    own `ProxyHeadersMiddleware`; this tests `_ip_lockout_key`'s own
    `PHOTOS_VIEWER_TRUSTED_PROXIES` handling directly."""
    app = create_app()
    conn = app_db.connect(tmp_path)
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    return conn, TestClient(app, base_url="https://testserver", client=(peer_host, 51000))


@pytest.fixture
def docker_gateway_client(tmp_path, monkeypatch):
    """The documented Docker default: the bridge-gateway address is listed
    in `PHOTOS_VIEWER_TRUSTED_PROXIES`, so it gets the same
    `Tailscale-User-Login`-keyed lockout treatment as a loopback peer."""
    monkeypatch.setenv("PHOTOS_VIEWER_TRUSTED_PROXIES", "172.17.0.1")
    conn, test_client = _gateway_client(tmp_path, peer_host="172.17.0.1")
    try:
        yield test_client
    finally:
        conn.close()


@pytest.fixture
def untrusted_gateway_client(tmp_path):
    """Same gateway peer, but `PHOTOS_VIEWER_TRUSTED_PROXIES` left unset --
    the documented behavior when it isn't configured: every caller behind
    the gateway shares one per-client lockout bucket."""
    conn, test_client = _gateway_client(tmp_path, peer_host="172.17.0.1")
    try:
        yield test_client
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


def test_setup_status_reports_needs_setup_before_any_admin_exists(client):
    response = client.get("/api/setup/status")

    assert response.status_code == 200
    assert response.json() == {"needs_setup": True}


def test_setup_status_reports_no_setup_needed_once_an_admin_exists(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.get("/api/setup/status")

    assert response.json() == {"needs_setup": False}


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


def test_rotating_the_header_from_loopback_hits_the_coarse_per_peer_ceiling(loopback_client, monkeypatch):
    """Issue #22 A: the coarse `MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER` ceiling
    is not limited to `PHOTOS_VIEWER_TRUSTED_PROXIES` peers -- loopback's
    own header-keyed buckets (see `test_loopback_per_client_lockout_is_keyed_...`
    above) share loopback's one `peer_ip` exactly the same way a trusted
    proxy's do, and anything else on the host can rotate the header there
    too. Mirrors `test_rotating_the_header_from_a_trusted_peer_hits_the_coarse_per_peer_ceiling`."""
    monkeypatch.setattr(session_auth, "MAX_FAILED_LOGIN_ATTEMPTS_PER_IP", 3)
    monkeypatch.setattr(session_auth, "MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER", 9)
    loopback_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    for user in range(9):
        loopback_client.post(
            "/api/auth/login",
            json={"username": f"nobody-{user}", "password": "whatever-password"},
            headers={"tailscale-user-login": f"rotating-{user}"},
        )

    still_locked_out = loopback_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "rotating-9"},
    )
    assert still_locked_out.status_code == 429


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

        # A fake clock: real time.monotonic() can be under 60 s on a freshly
        # booted host, which made the "window elapsed" half flaky.
        clock = {"now": 1000.0}
        monkeypatch.setattr(session_auth.time, "monotonic", lambda: clock["now"])
        monkeypatch.setattr(session_auth, "_last_session_prune_at", clock["now"])
        session_auth._prune_expired_sessions(conn)
        (still_there,) = conn.execute("SELECT COUNT(*) FROM sessions WHERE id = 'stale'").fetchone()
        assert still_there == 1

        clock["now"] += session_auth._SESSION_PRUNE_INTERVAL_SECONDS
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


def test_a_tailnet_origin_is_accepted_when_listed_in_public_origins(client, monkeypatch):
    """Issue #14 A: behind `tailscale serve`, the browser's Origin is the
    tailnet `ts.net` name, which never matches `request.url`. Listing it in
    `PHOTOS_VIEWER_PUBLIC_ORIGINS` must let the (otherwise same-origin,
    non-proxied) request through."""
    monkeypatch.setenv("PHOTOS_VIEWER_PUBLIC_ORIGINS", "https://box.tailxyz.ts.net")
    session_auth.reset_public_origins_cache()
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "https://box.tailxyz.ts.net"},
    )

    assert response.status_code == 200


def test_an_unlisted_origin_is_still_rejected_with_public_origins_configured(client, monkeypatch):
    monkeypatch.setenv("PHOTOS_VIEWER_PUBLIC_ORIGINS", "https://box.tailxyz.ts.net")
    session_auth.reset_public_origins_cache()
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "https://evil.example"},
    )

    assert response.status_code == 403


def test_public_origins_env_warns_on_each_invalid_entry_and_keeps_the_valid_ones(monkeypatch, caplog):
    """Issue #16 B: a typo'd entry (e.g. missing its `scheme://`) must not
    silently vanish -- the admin needs to see, in the server's own log,
    which entry and which variable."""
    monkeypatch.setenv(
        "PHOTOS_VIEWER_PUBLIC_ORIGINS",
        "https://box.tailxyz.ts.net, not-a-url, https://second.tailxyz.ts.net",
    )

    with caplog.at_level("WARNING"):
        origins = session_auth._public_origins_from_env()

    assert origins == {
        session_auth._parse_origin("https://box.tailxyz.ts.net"),
        session_auth._parse_origin("https://second.tailxyz.ts.net"),
    }
    assert any(
        "PHOTOS_VIEWER_PUBLIC_ORIGINS" in record.message and "not-a-url" in record.message
        for record in caplog.records
    )


def test_public_origins_env_with_a_valid_entry_does_not_fail_startup(monkeypatch):
    monkeypatch.setenv("PHOTOS_VIEWER_PUBLIC_ORIGINS", "https://box.tailxyz.ts.net")

    create_app()


def test_public_origins_env_with_only_invalid_entries_fails_startup(monkeypatch):
    """Issue #16 B: if every entry is invalid, the var is indistinguishable
    from unset from the CSRF check's point of view -- except the admin
    thinks they've configured an override. Fail loudly instead."""
    monkeypatch.setenv("PHOTOS_VIEWER_PUBLIC_ORIGINS", "not-a-url, also-not-one")

    with pytest.raises(RuntimeError, match="PHOTOS_VIEWER_PUBLIC_ORIGINS"):
        create_app()


def test_login_succeeds_through_the_real_proxy_headers_middleware_from_loopback(proxied_client):
    """Issue #16 A: the documented deployment is plain `uvicorn
    photos_viewer.main:app` behind `tailscale serve`, which connects from
    loopback. uvicorn's own `ProxyHeadersMiddleware` (on by default,
    trusting `127.0.0.1`/`::1` by default) rewrites the scheme from
    `X-Forwarded-Proto` before any code in this module runs, so the
    browser's `https://` Origin matches the request's own (now-https)
    origin with no forwarded-header parsing in `session_auth.py` itself."""
    proxied_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = proxied_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "https://testserver", "x-forwarded-proto": "https"},
    )

    assert response.status_code == 200


def test_login_still_rejects_a_mismatched_origin_through_the_real_proxy_headers_middleware(proxied_client):
    proxied_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = proxied_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "https://evil.example", "x-forwarded-proto": "https"},
    )

    assert response.status_code == 403


def test_forwarded_proto_from_an_untrusted_peer_is_ignored_by_the_real_proxy_headers_middleware(
    proxied_client_untrusted_peer,
):
    """Issue #16 A: only a loopback peer is trusted by default
    (`--forwarded-allow-ips`). A non-loopback caller's claimed
    `X-Forwarded-Proto: https` must not upgrade the request's own (plain
    http, in this test) scheme, so an Origin that only matches the claimed
    scheme is still rejected -- the origin check runs against the real
    scheme, not the forwarded one."""
    proxied_client_untrusted_peer.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = proxied_client_untrusted_peer.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "https://testserver", "x-forwarded-proto": "https"},
    )

    assert response.status_code == 403


def test_ip_lockout_key_is_the_forwarded_address_through_the_real_proxy_headers_middleware(proxied_client, monkeypatch):
    """Issue #16 A: once a trusted peer's `X-Forwarded-For` has rewritten
    `request.client`, that's the real per-device tailnet address
    `_ip_lockout_key` keys on -- two different forwarded addresses must not
    share a lockout counter."""
    # #59: a small limit keeps this off the 15-minute window and the cost of
    # dozens of Argon2 verifies, and asserting each priming attempt is a plain
    # 401 means a miss here reports its cause instead of a later 200-vs-429.
    monkeypatch.setattr(session_auth, "MAX_FAILED_LOGIN_ATTEMPTS_PER_IP", 3)
    proxied_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    for i in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS_PER_IP):
        priming = proxied_client.post(
            "/api/auth/login",
            json={"username": f"nobody-{i}", "password": "whatever-password"},
            headers={"x-forwarded-for": "100.64.1.1", "x-forwarded-proto": "https"},
        )
        assert priming.status_code == 401, priming.text

    device_a_locked_out = proxied_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "https://testserver", "x-forwarded-for": "100.64.1.1", "x-forwarded-proto": "https"},
    )
    assert device_a_locked_out.status_code == 429

    device_b_still_ok = proxied_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "https://testserver", "x-forwarded-for": "100.64.1.2", "x-forwarded-proto": "https"},
    )
    assert device_b_still_ok.status_code == 200


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


def test_admin_unlock_writes_an_audit_row_with_the_admin_as_actor(client, tmp_path):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    conn = app_db.connect(tmp_path)
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES ('bob', ?, 'user')",
            (session_auth.hash_password(VALID_PASSWORD),),
        )
        conn.commit()
        bob_id = conn.execute("SELECT id FROM users WHERE username = 'bob'").fetchone()["id"]
    finally:
        conn.close()

    response = client.post("/api/admin/users/bob/unlock", json={})
    assert response.status_code == 200

    conn = app_db.connect(tmp_path)
    try:
        row = conn.execute("SELECT * FROM audit_log WHERE action = 'unlock_user'").fetchone()
    finally:
        conn.close()
    assert row["actor"] == "admin"
    assert row["user_id"] == bob_id
    assert row["detail"] == "ip_limits_cleared=false"


def test_admin_unlock_with_clear_ip_limits_also_clears_the_per_ip_counter(client, tmp_path):
    """Issue #16, optional nit: `ip_limits_cleared` in the audit log must
    reflect what the caller actually asked for, not a hard-coded `false` --
    and asking for it must actually clear `ip_login_failures`, the same
    counter the CLI's `--clear-ip-limits` clears."""
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    for i in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS_PER_IP):
        client.post("/api/auth/login", json={"username": f"nobody-{i}", "password": "whatever-password"})
    ip_locked_out = client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})
    assert ip_locked_out.status_code == 429

    response = client.post("/api/admin/users/admin/unlock", json={"clear_ip_limits": True})
    assert response.status_code == 200

    conn = app_db.connect(tmp_path)
    try:
        row = conn.execute("SELECT * FROM audit_log WHERE action = 'unlock_user'").fetchone()
    finally:
        conn.close()
    assert row["detail"] == "ip_limits_cleared=true"

    unlocked_login = client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})
    assert unlocked_login.status_code == 200


def test_admin_unlock_with_clear_ip_limits_restores_login_after_the_per_peer_ceiling_trips(
    docker_gateway_client, monkeypatch
):
    """Issue #22 B: the recovery path for `MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER`'s
    shared lockout (see `server/README.md`) is the same `clear_ip_limits`
    unlock used for the fine-grained per-IP limit, since both counters live
    in `ip_login_failures`."""
    monkeypatch.setattr(session_auth, "MAX_FAILED_LOGIN_ATTEMPTS_PER_IP", 3)
    monkeypatch.setattr(session_auth, "MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER", 9)
    docker_gateway_client.post(
        "/api/setup/admin",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "admin-device"},
    )
    login = docker_gateway_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "admin-device"},
    )
    assert login.status_code == 200

    for user in range(9):
        docker_gateway_client.post(
            "/api/auth/login",
            json={"username": f"nobody-{user}", "password": "whatever-password"},
            headers={"tailscale-user-login": f"rotating-{user}"},
        )

    ceiling_tripped = docker_gateway_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "rotating-9"},
    )
    assert ceiling_tripped.status_code == 429

    unlock = docker_gateway_client.post(
        "/api/admin/users/admin/unlock",
        json={"clear_ip_limits": True},
        headers={"tailscale-user-login": "admin-device"},
    )
    assert unlock.status_code == 200

    restored_login = docker_gateway_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "rotating-9"},
    )
    assert restored_login.status_code == 200


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


# -- Issue #18 A: PUBLIC_ORIGINS parsed/warned once at startup, not per request --


def test_public_origins_env_warning_is_logged_once_not_once_per_request(monkeypatch, caplog, tmp_path):
    """A re-parse (and re-warning) on every state-changing request would be
    both wasted work and log spam; `validate_public_origins_env` must do
    the one parse at startup, and later requests must reuse the cache."""
    monkeypatch.setenv("PHOTOS_VIEWER_PUBLIC_ORIGINS", "not-a-url, https://box.tailxyz.ts.net")

    with caplog.at_level("WARNING"):
        app = create_app()
        conn = app_db.connect(tmp_path)
        app.dependency_overrides[session_auth.get_db] = lambda: conn
        try:
            test_client = TestClient(app, base_url="https://testserver")
            test_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
            for _ in range(3):
                test_client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": VALID_PASSWORD},
                    headers={"origin": "https://box.tailxyz.ts.net"},
                )
        finally:
            conn.close()

    warnings = [record for record in caplog.records if "not-a-url" in record.message]
    assert len(warnings) == 1


@contextlib.contextmanager
def _bare_root_logger():
    """Save and restore both the root logger's handlers and this module's
    own, so a test can simulate "nothing has configured logging yet" (the
    production default under plain `uvicorn photos_viewer.main:app`)
    without leaking state into other tests.

    This is a plain context manager, not a pytest fixture: pytest's own
    logging plugin re-attaches a fresh capture handler to the root logger
    for each test phase (setup/call/teardown), so clearing in a fixture's
    pre-yield setup code -- which runs during the *setup* phase -- would
    already be undone by the time the test body runs in the *call* phase.
    Entering this as a `with` block inside the test body clears it live,
    during that same call phase, so it actually sticks for the assertions.
    """
    root = logging.getLogger()
    saved_root_handlers = root.handlers[:]
    saved_own_handlers = session_auth.logger.handlers[:]
    root.handlers[:] = []
    session_auth.logger.handlers[:] = []
    try:
        yield root
    finally:
        root.handlers[:] = saved_root_handlers
        session_auth.logger.handlers[:] = saved_own_handlers


def test_invalid_public_origin_warning_goes_through_a_handler_with_a_level_label(monkeypatch):
    """uvicorn's own logging config never attaches a handler to the root
    logger, so a bare `logger.warning(...)` prints with no "WARNING:"
    label under `uvicorn photos_viewer.main:app`. This module's logger
    needs its own handler, with a formatter that includes the level."""
    monkeypatch.setenv("PHOTOS_VIEWER_PUBLIC_ORIGINS", "not-a-url")

    with _bare_root_logger():
        session_auth._public_origins_from_env()

        assert session_auth.logger.handlers
        formatter = session_auth.logger.handlers[-1].formatter
        assert formatter is not None
        assert "%(levelname)s" in formatter._fmt


# -- Issue #20 C: don't double up on an already-configured root logger --


def test_ensure_logger_has_a_handler_skips_when_root_already_has_one():
    """A root handler configured elsewhere (uvicorn `--log-config`, or the
    host app's own logging setup) means this module's warnings already
    reach a handler via propagation; adding a second one here would print
    every warning twice."""
    with _bare_root_logger() as root:
        seen = []
        probe = logging.Handler()
        probe.emit = seen.append
        root.addHandler(probe)

        session_auth._ensure_logger_has_a_handler()

        assert session_auth.logger.handlers == []
        session_auth.logger.warning("boom")
        assert len(seen) == 1


def test_ensure_logger_has_a_handler_adds_one_when_nothing_configured():
    """Mirrors `test_invalid_public_origin_warning_goes_through_a_handler_with_a_level_label`
    directly against the helper: with no handler anywhere in the chain, a
    bare `logger.warning(...)` has nowhere to go, so this adds one."""
    with _bare_root_logger():
        session_auth._ensure_logger_has_a_handler()

        assert len(session_auth.logger.handlers) == 1


def test_reset_public_origins_cache_allows_a_fresh_parse(monkeypatch):
    monkeypatch.setenv("PHOTOS_VIEWER_PUBLIC_ORIGINS", "https://first.tailxyz.ts.net")
    first = session_auth._public_origins_from_env()
    assert first == {session_auth._parse_origin("https://first.tailxyz.ts.net")}

    monkeypatch.setenv("PHOTOS_VIEWER_PUBLIC_ORIGINS", "https://second.tailxyz.ts.net")
    assert session_auth._public_origins_from_env() == first, "still cached -- env change not yet observed"

    session_auth.reset_public_origins_cache()

    assert session_auth._public_origins_from_env() == {session_auth._parse_origin("https://second.tailxyz.ts.net")}


# -- Issue #18 B: trusted reverse-proxy addresses for the per-client lockout --


def test_docker_gateway_lockout_is_keyed_on_the_tailscale_user_login_header_when_trusted(docker_gateway_client):
    """With the bridge-gateway address listed in
    `PHOTOS_VIEWER_TRUSTED_PROXIES`, it gets the same treatment loopback
    gets by default: distinct `Tailscale-User-Login` values don't share a
    lockout bucket."""
    docker_gateway_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    for i in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS_PER_IP):
        docker_gateway_client.post(
            "/api/auth/login",
            json={"username": f"nobody-{i}", "password": "whatever-password"},
            headers={"tailscale-user-login": "alice"},
        )

    alice_locked_out = docker_gateway_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    assert alice_locked_out.status_code == 429

    bob_still_ok = docker_gateway_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "bob"},
    )
    assert bob_still_ok.status_code == 200


def test_docker_gateway_lockout_is_shared_across_users_when_not_trusted(untrusted_gateway_client):
    """Documented behavior when `PHOTOS_VIEWER_TRUSTED_PROXIES` isn't
    configured: the gateway address is keyed like any other non-loopback
    peer, so every caller behind it shares one bucket -- distinct
    `Tailscale-User-Login` headers don't help."""
    untrusted_gateway_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    for i in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS_PER_IP):
        untrusted_gateway_client.post(
            "/api/auth/login",
            json={"username": f"nobody-{i}", "password": "whatever-password"},
            headers={"tailscale-user-login": "alice"},
        )

    bob_also_locked_out = untrusted_gateway_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "bob"},
    )
    assert bob_also_locked_out.status_code == 429


# -- Issue #20 A: a trusted peer can't buy unlimited tries by rotating its
# `Tailscale-User-Login` header --


def test_rotating_the_header_from_a_trusted_peer_hits_the_coarse_per_peer_ceiling(docker_gateway_client, monkeypatch):
    """Only the proxy itself is supposed to set `Tailscale-User-Login`, but
    anything else that can reach a trusted peer's address (a host-level
    client, or a LAN client on a published port) can set its own value and,
    without this ceiling, buy a fresh `MAX_FAILED_LOGIN_ATTEMPTS_PER_IP`-try
    bucket on every rotation. `MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER` caps the
    sum across every header value (and the peer-IP fallback) sharing one
    trusted peer, regardless of how finely the header is rotated. The
    limits are monkeypatched down so the test doesn't pay for dozens of
    real Argon2 dummy-password verifications."""
    monkeypatch.setattr(session_auth, "MAX_FAILED_LOGIN_ATTEMPTS_PER_IP", 3)
    monkeypatch.setattr(session_auth, "MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER", 9)
    docker_gateway_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    for user in range(9):
        docker_gateway_client.post(
            "/api/auth/login",
            json={"username": f"nobody-{user}", "password": "whatever-password"},
            headers={"tailscale-user-login": f"rotating-{user}"},
        )

    still_locked_out = docker_gateway_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "rotating-9"},
    )
    assert still_locked_out.status_code == 429


def test_distinct_users_behind_a_trusted_peer_stay_separate_below_the_ceiling(docker_gateway_client, monkeypatch):
    """The coarse per-peer ceiling is deliberately far looser than the
    per-client one, so it must not trip for ordinary use: several distinct,
    real users behind one trusted peer, each well under their own
    `MAX_FAILED_LOGIN_ATTEMPTS_PER_IP` limit."""
    monkeypatch.setattr(session_auth, "MAX_FAILED_LOGIN_ATTEMPTS_PER_IP", 3)
    monkeypatch.setattr(session_auth, "MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER", 9)
    docker_gateway_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    tries_per_user = session_auth.MAX_FAILED_LOGIN_ATTEMPTS_PER_IP - 1
    for user in range(3):
        for i in range(tries_per_user):
            docker_gateway_client.post(
                "/api/auth/login",
                json={"username": f"nobody-{user}-{i}", "password": "whatever-password"},
                headers={"tailscale-user-login": f"user-{user}"},
            )

    assert 3 * tries_per_user < session_auth.MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER

    still_ok = docker_gateway_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "user-0"},
    )
    assert still_ok.status_code == 200


def test_trusted_peer_with_no_header_falls_back_to_the_peer_ip_bucket(docker_gateway_client, monkeypatch):
    """A trusted peer is reachable by more than the reverse proxy, so a
    request with no `Tailscale-User-Login` header at all can't be assumed
    to be the loopback-like safe case either -- it gets its own bucket,
    keyed on the peer's address, same as an untrusted direct caller."""
    monkeypatch.setattr(session_auth, "MAX_FAILED_LOGIN_ATTEMPTS_PER_IP", 3)
    docker_gateway_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    for i in range(3):
        docker_gateway_client.post(
            "/api/auth/login",
            json={"username": f"nobody-{i}", "password": "whatever-password"},
        )

    headerless_locked_out = docker_gateway_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
    )
    assert headerless_locked_out.status_code == 429

    alice_still_ok = docker_gateway_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    assert alice_still_ok.status_code == 200


def test_ordinary_peers_do_not_share_the_coarse_per_peer_ceiling(tmp_path, monkeypatch):
    """Issue #22 A: the coarse ceiling is scoped to one shared `peer_ip`.
    An ordinary, non-loopback, non-trusted-proxy caller has no header-keyed
    bucket at all -- `client_ip == peer_ip` (see `is_ip_locked_out`) -- so
    two such callers at different addresses must never be combined into one
    ceiling just because their failures sum past it."""
    monkeypatch.setattr(session_auth, "MAX_FAILED_LOGIN_ATTEMPTS_PER_IP", 100)
    monkeypatch.setattr(session_auth, "MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER", 5)
    conn_a, client_a = _gateway_client(tmp_path, peer_host="203.0.113.5")
    client_a.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    conn_b, client_b = _gateway_client(tmp_path, peer_host="203.0.113.9")
    try:
        for i in range(3):
            client_a.post("/api/auth/login", json={"username": f"nobody-a-{i}", "password": "whatever-password"})
        for i in range(3):
            client_b.post("/api/auth/login", json={"username": f"nobody-b-{i}", "password": "whatever-password"})
        # 6 combined failures would trip a ceiling of 5 if it were global;
        # each peer only has 3 of its own, well under it.

        a_still_ok = client_a.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})
        assert a_still_ok.status_code == 200

        b_still_ok = client_b.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})
        assert b_still_ok.status_code == 200
    finally:
        conn_a.close()
        conn_b.close()


def test_trusted_proxies_env_accepts_ips_and_cidrs(monkeypatch):
    monkeypatch.setenv("PHOTOS_VIEWER_TRUSTED_PROXIES", "172.17.0.1, 172.18.0.0/16")

    create_app()  # must not raise

    assert session_auth._is_trusted_proxy("172.17.0.1") is True
    assert session_auth._is_trusted_proxy("172.18.5.9") is True
    assert session_auth._is_trusted_proxy("203.0.113.5") is False


def test_trusted_proxies_env_with_an_invalid_entry_fails_startup(monkeypatch):
    """A typo'd address or CIDR that silently never matches the real proxy
    would look like it's working right up until the first burst of failed
    logins locks out the whole tailnet -- refuse to start instead."""
    monkeypatch.setenv("PHOTOS_VIEWER_TRUSTED_PROXIES", "not-an-address")

    with pytest.raises(RuntimeError, match="PHOTOS_VIEWER_TRUSTED_PROXIES"):
        create_app()


def test_trusted_proxies_env_with_an_invalid_entry_fails_the_same_way_reached_directly(monkeypatch):
    """Issue #20 D: `_trusted_proxies()` parses and validates in one place,
    so an invalid entry raises the same `RuntimeError` whether it's reached
    through `validate_trusted_proxies_env()` at startup (the case above) or
    through `_is_trusted_proxy()`/`_ip_lockout_key()` on an ordinary
    request, before startup validation ever runs -- not dropped silently
    on one path and refused on the other."""
    monkeypatch.setenv("PHOTOS_VIEWER_TRUSTED_PROXIES", "not-an-address")

    with pytest.raises(RuntimeError, match="PHOTOS_VIEWER_TRUSTED_PROXIES"):
        session_auth._is_trusted_proxy("172.17.0.1")


# -- Issue #18 C: a malformed port is an invalid origin, not a crash --


def test_post_with_a_malformed_port_in_origin_header_is_rejected_not_500(client):
    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "https://box.ts.net:abc"},
    )

    assert response.status_code == 403


def test_public_origins_env_entry_with_a_malformed_port_is_invalid_not_a_crash(monkeypatch):
    monkeypatch.setenv("PHOTOS_VIEWER_PUBLIC_ORIGINS", "https://box.ts.net:abc")

    with pytest.raises(RuntimeError, match="PHOTOS_VIEWER_PUBLIC_ORIGINS"):
        create_app()


# -- Issue #18 D: only http/https, and only a bare origin --


def test_post_with_a_non_http_scheme_origin_is_rejected(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"origin": "ftp://testserver"},
    )

    assert response.status_code == 403


@pytest.mark.parametrize(
    "entry",
    [
        "ftp://box.tailxyz.ts.net",
        "https://box.tailxyz.ts.net/app",
        "https://box.tailxyz.ts.net?x=1",
        "https://box.tailxyz.ts.net#frag",
    ],
)
def test_public_origins_env_entry_with_a_bad_scheme_path_query_or_fragment_is_invalid(monkeypatch, entry):
    monkeypatch.setenv("PHOTOS_VIEWER_PUBLIC_ORIGINS", entry)

    with pytest.raises(RuntimeError, match="PHOTOS_VIEWER_PUBLIC_ORIGINS"):
        create_app()


def test_public_origins_env_entry_with_a_trailing_slash_is_accepted(monkeypatch):
    monkeypatch.setenv("PHOTOS_VIEWER_PUBLIC_ORIGINS", "https://box.tailxyz.ts.net/")

    create_app()  # must not raise


# -- P1.4: optional tailnet identity allow-list --


def test_tailnet_allowlist_is_empty_by_default_and_admin_get_reflects_that(loopback_client):
    loopback_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    loopback_client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    response = loopback_client.get("/api/admin/settings/tailnet-allowlist")

    assert response.status_code == 200
    assert response.json() == {"identities": []}


def test_tailnet_allowlist_empty_allows_a_request_with_no_header_at_all(loopback_client):
    loopback_client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    loopback_client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    response = loopback_client.get("/api/auth/me")

    assert response.status_code == 200


def test_tailnet_allowlist_rejects_a_missing_header_once_the_list_is_non_empty(loopback_client):
    loopback_client.post(
        "/api/setup/admin",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    loopback_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    put = loopback_client.put(
        "/api/admin/settings/tailnet-allowlist",
        json={"identities": ["alice"]},
        headers={"tailscale-user-login": "alice"},
    )
    assert put.status_code == 200

    response = loopback_client.get("/api/auth/me")

    assert response.status_code == 403


def test_tailnet_allowlist_rejects_a_non_matching_header(loopback_client):
    loopback_client.post(
        "/api/setup/admin",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    loopback_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    loopback_client.put(
        "/api/admin/settings/tailnet-allowlist",
        json={"identities": ["alice"]},
        headers={"tailscale-user-login": "alice"},
    )

    response = loopback_client.get("/api/auth/me", headers={"tailscale-user-login": "bob"})

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "tailnet_identity_not_allowed"


def test_tailnet_allowlist_allows_a_matching_header(loopback_client):
    loopback_client.post(
        "/api/setup/admin",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    loopback_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    loopback_client.put(
        "/api/admin/settings/tailnet-allowlist",
        json={"identities": ["alice"]},
        headers={"tailscale-user-login": "alice"},
    )

    response = loopback_client.get("/api/auth/me", headers={"tailscale-user-login": "alice"})

    assert response.status_code == 200


def test_tailnet_allowlist_ignores_a_header_from_an_untrusted_peer(client, tmp_path):
    """`client` (unlike `loopback_client`) is not loopback and not a
    `PHOTOS_VIEWER_TRUSTED_PROXIES` entry, so even a header that matches the
    allow-list exactly must not satisfy it -- otherwise any LAN caller that
    can merely reach the port could set its own `Tailscale-User-Login` and
    walk straight through. Set up via the DB directly, not the PUT route --
    `client` has no trusted identity of its own, so issue #26's self-lockout
    guard would refuse this exact list from this exact caller."""
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})
    conn = app_db.connect(tmp_path)
    try:
        session_auth.set_allowed_tailnet_identities(conn, ["evil"])
    finally:
        conn.close()

    response = client.get("/api/auth/me", headers={"tailscale-user-login": "evil"})

    assert response.status_code == 403


def test_tailnet_allowlist_rejects_login_with_a_non_matching_header(loopback_client):
    loopback_client.post(
        "/api/setup/admin",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    loopback_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    loopback_client.put(
        "/api/admin/settings/tailnet-allowlist",
        json={"identities": ["alice"]},
        headers={"tailscale-user-login": "alice"},
    )

    response = loopback_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "bob"},
    )

    assert response.status_code == 403


def test_tailnet_allowlist_rejects_first_run_setup_with_a_non_matching_header(loopback_client, tmp_path):
    conn = app_db.connect(tmp_path)
    try:
        session_auth.set_allowed_tailnet_identities(conn, ["alice"])
    finally:
        conn.close()

    response = loopback_client.post(
        "/api/setup/admin",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "bob"},
    )

    assert response.status_code == 403


def test_health_stays_open_when_the_tailnet_allowlist_is_non_empty(client, tmp_path):
    conn = app_db.connect(tmp_path)
    try:
        session_auth.set_allowed_tailnet_identities(conn, ["alice"])
    finally:
        conn.close()

    response = client.get("/api/health")

    assert response.status_code == 200


def test_tailnet_allowlist_admin_api_is_403_for_a_non_admin(client, tmp_path):
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

    get_response = client.get("/api/admin/settings/tailnet-allowlist")
    put_response = client.put("/api/admin/settings/tailnet-allowlist", json={"identities": ["alice"]})

    assert get_response.status_code == 403
    assert put_response.status_code == 403


def test_tailnet_allowlist_admin_api_is_401_with_no_session(client):
    response = client.get("/api/admin/settings/tailnet-allowlist")

    assert response.status_code == 401

    assert session_auth._parse_origin("https://box.tailxyz.ts.net/") == ("https", "box.tailxyz.ts.net", 443)


# -- Issue #26: self-lockout guard and normalisation on save --


def test_normalize_tailnet_identities_strips_dedupes_and_lowercases():
    result = session_auth.normalize_tailnet_identities([" Alice@Example.com ", "alice@example.com", "", "   ", "Bob"])

    assert result == ["alice@example.com", "bob"]


def test_tailnet_allowlist_put_rejects_a_list_missing_the_callers_own_identity(loopback_client):
    loopback_client.post(
        "/api/setup/admin",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    loopback_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )

    response = loopback_client.put(
        "/api/admin/settings/tailnet-allowlist",
        json={"identities": ["bob"]},
        headers={"tailscale-user-login": "alice"},
    )

    assert response.status_code == 400
    still_empty = loopback_client.get(
        "/api/admin/settings/tailnet-allowlist", headers={"tailscale-user-login": "alice"}
    )
    assert still_empty.json() == {"identities": []}


def test_tailnet_allowlist_put_accepts_a_list_containing_the_callers_own_identity(loopback_client):
    loopback_client.post(
        "/api/setup/admin",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )
    loopback_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice"},
    )

    response = loopback_client.put(
        "/api/admin/settings/tailnet-allowlist",
        json={"identities": ["alice", "bob"]},
        headers={"tailscale-user-login": "alice"},
    )

    assert response.status_code == 200
    assert response.json() == {"identities": ["alice", "bob"]}


def test_tailnet_allowlist_put_rejects_a_non_empty_list_from_a_caller_with_no_trusted_identity(client):
    """`client` is neither loopback nor a trusted proxy, so it has no
    trusted `Tailscale-User-Login` identity at all -- a non-empty list
    would lock out every caller, including this one."""
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.put("/api/admin/settings/tailnet-allowlist", json={"identities": ["alice"]})

    assert response.status_code == 400


def test_tailnet_allowlist_put_always_accepts_an_empty_list(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.put("/api/admin/settings/tailnet-allowlist", json={"identities": []})

    assert response.status_code == 200
    assert response.json() == {"identities": []}


def test_tailnet_allowlist_put_normalizes_whitespace_case_and_duplicates(loopback_client):
    loopback_client.post(
        "/api/setup/admin",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice@example.com"},
    )
    loopback_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": VALID_PASSWORD},
        headers={"tailscale-user-login": "alice@example.com"},
    )

    response = loopback_client.put(
        "/api/admin/settings/tailnet-allowlist",
        json={"identities": [" Alice@Example.com ", "alice@example.com", "bob", "  "]},
        headers={"tailscale-user-login": "alice@example.com"},
    )

    assert response.status_code == 200
    assert response.json() == {"identities": ["alice@example.com", "bob"]}

    allowed = loopback_client.get("/api/auth/me", headers={"tailscale-user-login": "ALICE@EXAMPLE.COM"})
    assert allowed.status_code == 200


def _setup_and_login(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    assert client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD}).status_code == 200


def test_reconfirm_password_succeeds_with_204_and_keeps_the_session(client, tmp_path):
    _setup_and_login(client)
    conn = app_db.connect(tmp_path)
    try:
        before = [tuple(r) for r in conn.execute("SELECT id, public_id, user_id, expires_at FROM sessions")]
        cookie_before = client.cookies.get(session_auth.COOKIE_NAME)

        response = client.post("/api/auth/reconfirm-password", json={"password": VALID_PASSWORD})

        assert response.status_code == 204
        assert "set-cookie" not in response.headers
        assert client.cookies.get(session_auth.COOKIE_NAME) == cookie_before
        after = [tuple(r) for r in conn.execute("SELECT id, public_id, user_id, expires_at FROM sessions")]
        assert after == before
        assert client.get("/api/auth/me").status_code == 200
    finally:
        conn.close()


def test_reconfirm_password_wrong_password_is_401_and_session_survives(client):
    _setup_and_login(client)

    response = client.post("/api/auth/reconfirm-password", json={"password": "wrong-password-1"})

    assert response.status_code == 401
    assert client.get("/api/auth/me").status_code == 200


def test_reconfirm_password_shares_the_login_lockout(client):
    _setup_and_login(client)

    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS):
        client.post("/api/auth/reconfirm-password", json={"password": "wrong-password-1"})

    locked = client.post("/api/auth/reconfirm-password", json={"password": VALID_PASSWORD})
    assert locked.status_code == 429
    # same counter as login
    assert client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD}).status_code == 429


def test_failed_logins_count_toward_reconfirm_lockout_and_success_clears_them(client):
    _setup_and_login(client)
    client.post("/api/auth/reconfirm-password", json={"password": "wrong-password-1"})
    assert client.post("/api/auth/reconfirm-password", json={"password": VALID_PASSWORD}).status_code == 204
    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS - 1):
        client.post("/api/auth/reconfirm-password", json={"password": "wrong-password-1"})
    assert client.post("/api/auth/reconfirm-password", json={"password": VALID_PASSWORD}).status_code == 204


def test_reconfirm_password_requires_a_session(client):
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})

    response = client.post("/api/auth/reconfirm-password", json={"password": VALID_PASSWORD})

    assert response.status_code == 401


def test_reconfirm_password_rejects_cross_site_requests(client):
    _setup_and_login(client)

    cross_origin = client.post(
        "/api/auth/reconfirm-password",
        json={"password": VALID_PASSWORD},
        headers={"origin": "https://evil.example"},
    )
    form = client.post(
        "/api/auth/reconfirm-password",
        content="password=x",
        headers={"content-type": "application/x-www-form-urlencoded"},
    )

    assert cross_origin.status_code == 403
    assert form.status_code == 415


def test_per_peer_ceiling_env_override(monkeypatch):
    """#57: the ceiling is configurable; bad values fall back to the default."""
    default = session_auth.MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER
    monkeypatch.delenv("PHOTOS_VIEWER_MAX_FAILED_LOGINS_PER_PEER", raising=False)
    assert session_auth.max_failed_logins_per_peer() == default
    monkeypatch.setenv("PHOTOS_VIEWER_MAX_FAILED_LOGINS_PER_PEER", "1000")
    assert session_auth.max_failed_logins_per_peer() == 1000
    for bad in ("abc", "-5", "0"):
        monkeypatch.setenv("PHOTOS_VIEWER_MAX_FAILED_LOGINS_PER_PEER", bad)
        assert session_auth.max_failed_logins_per_peer() == default


def test_per_peer_ceiling_env_is_enforced(tmp_path, monkeypatch):
    conn = app_db.connect(tmp_path)
    try:
        monkeypatch.setenv("PHOTOS_VIEWER_MAX_FAILED_LOGINS_PER_PEER", "3")
        for i in range(2):
            session_auth.record_ip_login_failure(conn, f"user{i}", "127.0.0.1")
        assert not session_auth.is_ip_locked_out(conn, "other", "127.0.0.1")
        session_auth.record_ip_login_failure(conn, "user2", "127.0.0.1")
        assert session_auth.is_ip_locked_out(conn, "other", "127.0.0.1")
    finally:
        conn.close()


NEW_PASSWORD = "a-brand-new-passphrase"


def _second_session_cookie(client, tmp_path):
    """A second login for the same user from another 'device'."""
    other = TestClient(client.app, base_url="https://testserver")
    assert other.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD}).status_code == 200
    return other


def test_change_password_revokes_other_sessions_and_keeps_the_current_one(client, tmp_path):
    _setup_and_login(client)
    other = _second_session_cookie(client, tmp_path)
    cookie_before = client.cookies.get(session_auth.COOKIE_NAME)

    response = client.post(
        "/api/auth/change-password", json={"current_password": VALID_PASSWORD, "new_password": NEW_PASSWORD}
    )

    assert response.status_code == 204
    assert client.cookies.get(session_auth.COOKIE_NAME) == cookie_before
    assert client.get("/api/auth/me").status_code == 200
    assert other.get("/api/auth/me").status_code == 401
    fresh = TestClient(client.app, base_url="https://testserver")
    assert fresh.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD}).status_code == 401
    assert fresh.post("/api/auth/login", json={"username": "admin", "password": NEW_PASSWORD}).status_code == 200


def test_change_password_with_the_wrong_current_password_is_401_and_changes_nothing(client):
    _setup_and_login(client)
    other = _second_session_cookie(client, None)

    response = client.post(
        "/api/auth/change-password", json={"current_password": "wrong-password-1", "new_password": NEW_PASSWORD}
    )

    assert response.status_code == 401
    assert other.get("/api/auth/me").status_code == 200
    fresh = TestClient(client.app, base_url="https://testserver")
    assert fresh.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD}).status_code == 200


def test_change_password_enforces_the_minimum_length(client):
    _setup_and_login(client)

    response = client.post(
        "/api/auth/change-password", json={"current_password": VALID_PASSWORD, "new_password": "short"}
    )

    assert response.status_code == 422


def test_change_password_requires_a_session_and_shares_the_login_lockout(client):
    unauthenticated = client.post(
        "/api/auth/change-password", json={"current_password": VALID_PASSWORD, "new_password": NEW_PASSWORD}
    )
    assert unauthenticated.status_code == 401

    _setup_and_login(client)
    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS):
        client.post("/api/auth/change-password", json={"current_password": "wrong-password-1", "new_password": NEW_PASSWORD})
    locked = client.post(
        "/api/auth/change-password", json={"current_password": VALID_PASSWORD, "new_password": NEW_PASSWORD}
    )
    assert locked.status_code == 429
