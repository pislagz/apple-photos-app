"""#519 Family login: profile list, profile sign-in, passwordless rules, admin
password management, and Hidden for passwordless accounts. Every rule is
asserted on the server."""

from __future__ import annotations

from fastapi.testclient import TestClient

from photos_viewer import app_db, session_auth
from photos_viewer.main import create_app
from tests.test_library_assets import (
    VALID_PASSWORD,
    _assign,
    _create_library,
    _create_user,
    _insert_asset,
)

LAN = ("192.168.1.20", 5000)
TAILNET = ("100.101.102.103", 5000)
PUBLIC = ("8.8.8.8", 5000)


def _app(tmp_path, peer=LAN):
    app = create_app()
    conn = app_db.connect(tmp_path / "data")
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    app.dependency_overrides[session_auth.get_data_dir] = lambda: tmp_path
    return conn, TestClient(app, base_url="https://testserver", client=peer)


def _client_for(conn, peer):
    app = create_app()
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    return TestClient(app, base_url="https://testserver", client=peer)


def _passwordless(conn, username):
    uid = _create_user(conn, username)
    conn.execute("UPDATE users SET password_hash = '' WHERE id = ?", (uid,))
    conn.commit()
    return uid


def _profile_login(client, uid, password=""):
    return client.post(
        "/api/auth/profile-login", json={"user_id": uid, "password": password}
    )


def test_profile_list_is_public_and_minimal_while_family_login_is_on(tmp_path):
    conn, client = _app(tmp_path)
    try:
        ann = _create_user(conn, "ann")
        _passwordless(conn, "kid")
        response = client.get("/api/auth/profiles")
        assert response.status_code == 200
        profiles = response.json()["profiles"]
        assert [p["display_name"] for p in profiles] == ["ann", "kid"]
        for p in profiles:
            assert set(p) == {"id", "display_name", "avatar_url"}
        assert profiles[0]["id"] == ann
        assert "hash" not in response.text and "role" not in response.text
    finally:
        conn.close()


def test_profile_list_is_404_when_family_login_is_off(tmp_path):
    conn, client = _app(tmp_path)
    try:
        uid = _create_user(conn, "ann")
        app_db.set_setting(conn, session_auth.FAMILY_LOGIN_SETTING, "0")
        assert client.get("/api/auth/profiles").status_code == 404
        assert _profile_login(client, uid, VALID_PASSWORD).status_code == 404
        # The normal form is unaffected.
        ok = client.post(
            "/api/auth/login", json={"username": "ann", "password": VALID_PASSWORD}
        )
        assert ok.status_code == 200
    finally:
        conn.close()


def test_hidden_from_screen_and_disabled_users_are_not_listed_or_usable(tmp_path):
    conn, client = _app(tmp_path)
    try:
        shown = _create_user(conn, "shown")
        secret = _create_user(conn, "secret")
        off = _create_user(conn, "off")
        conn.execute("UPDATE users SET show_on_profiles = 0 WHERE id = ?", (secret,))
        conn.execute("UPDATE users SET disabled = 1 WHERE id = ?", (off,))
        conn.commit()
        names = [
            p["display_name"]
            for p in client.get("/api/auth/profiles").json()["profiles"]
        ]
        assert names == ["shown"]
        assert _profile_login(client, shown, VALID_PASSWORD).status_code == 200
        client.post("/api/auth/logout")
        for uid in (secret, off, 9999):
            assert _profile_login(client, uid, VALID_PASSWORD).status_code == 401
        # A hidden user still signs in through the normal form.
        ok = client.post(
            "/api/auth/login", json={"username": "secret", "password": VALID_PASSWORD}
        )
        assert ok.status_code == 200
    finally:
        conn.close()


def test_profile_avatar_only_for_listed_users_while_family_login_is_on(tmp_path):
    conn, client = _app(tmp_path)
    try:
        shown = _create_user(conn, "shown")
        hidden = _create_user(conn, "hid")
        for uid in (shown, hidden):
            conn.execute("UPDATE users SET avatar_version = 1 WHERE id = ?", (uid,))
        conn.execute("UPDATE users SET show_on_profiles = 0 WHERE id = ?", (hidden,))
        conn.commit()
        from photos_viewer.user_avatar import avatar_path

        for uid in (shown, hidden):
            path = avatar_path(tmp_path, uid)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"\xff\xd8jpeg")
        assert client.get(f"/api/auth/profiles/{shown}/avatar").status_code == 200
        assert client.get(f"/api/auth/profiles/{hidden}/avatar").status_code == 404
        app_db.set_setting(conn, session_auth.FAMILY_LOGIN_SETTING, "0")
        assert client.get(f"/api/auth/profiles/{shown}/avatar").status_code == 404
    finally:
        conn.close()


def test_profile_with_password_asks_for_it_without_counting_a_failure(tmp_path):
    conn, client = _app(tmp_path)
    try:
        uid = _create_user(conn, "ann")
        for _ in range(8):
            r = _profile_login(client, uid, "")
            assert r.status_code == 401
            assert r.json()["detail"]["code"] == "password_required"
        assert _profile_login(client, uid, VALID_PASSWORD).status_code == 200
    finally:
        conn.close()


def test_profile_password_attempts_are_throttled(tmp_path):
    conn, client = _app(tmp_path)
    try:
        uid = _create_user(conn, "ann")
        for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS):
            assert _profile_login(client, uid, "wrong-password-1").status_code == 401
        assert _profile_login(client, uid, "wrong-password-1").status_code == 429
        assert _profile_login(client, uid, VALID_PASSWORD).status_code == 429
    finally:
        conn.close()


def test_passwordless_signs_in_from_private_networks_by_default(tmp_path):
    conn, _ = _app(tmp_path)
    try:
        uid = _passwordless(conn, "kid")
        for peer in (
            LAN,
            TAILNET,
            ("127.0.0.1", 1),
            ("10.1.2.3", 1),
            ("172.20.0.5", 1),
            ("::1", 1),
            ("fd7a:115c:a1e0::1", 1),
            ("fc00::5", 1),
        ):
            client = _client_for(conn, peer)
            r = _profile_login(client, uid)
            assert r.status_code == 200, peer
            assert r.json()["username"] == "kid"
            assert client.get("/api/auth/me").status_code == 200
    finally:
        conn.close()


def test_passwordless_blocked_from_public_addresses_unless_anywhere(tmp_path):
    conn, _ = _app(tmp_path)
    try:
        uid = _passwordless(conn, "kid")
        for peer in (PUBLIC, ("172.32.0.1", 1), ("100.128.0.1", 1), ("2001:db8::1", 1)):
            client = _client_for(conn, peer)
            r = _profile_login(client, uid)
            assert r.status_code == 403, peer
            assert r.json()["detail"]["code"] == "passwordless_network"
            assert client.get("/api/auth/me").status_code == 401
            # The plain form gives nothing away about the account.
            plain = client.post(
                "/api/auth/login", json={"username": "kid", "password": ""}
            )
            assert plain.status_code == 401
            assert plain.json()["detail"] == "invalid username or password"
        app_db.set_setting(conn, session_auth.PASSWORDLESS_SETTING, "anywhere")
        assert _profile_login(_client_for(conn, PUBLIC), uid).status_code == 200
    finally:
        conn.close()


def test_forwarded_for_header_never_widens_passwordless(tmp_path):
    conn, _ = _app(tmp_path)
    try:
        uid = _passwordless(conn, "kid")
        client = _client_for(conn, PUBLIC)
        r = client.post(
            "/api/auth/profile-login",
            json={"user_id": uid, "password": ""},
            headers={"X-Forwarded-For": "192.168.1.5", "X-Real-IP": "192.168.1.5"},
        )
        assert r.status_code == 403
    finally:
        conn.close()


def test_passwordless_accepts_only_an_empty_password(tmp_path):
    conn, _ = _app(tmp_path)
    try:
        uid = _passwordless(conn, "kid")
        client = _client_for(conn, LAN)
        assert _profile_login(client, uid, "anything-at-all-1").status_code == 401
        plain = client.post("/api/auth/login", json={"username": "kid", "password": ""})
        assert plain.status_code == 200
    finally:
        conn.close()


def test_passwordless_cannot_sign_in_when_family_login_is_off(tmp_path):
    conn, client = _app(tmp_path)
    try:
        _passwordless(conn, "kid")
        app_db.set_setting(conn, session_auth.FAMILY_LOGIN_SETTING, "0")
        plain = client.post("/api/auth/login", json={"username": "kid", "password": ""})
        assert plain.status_code == 401
    finally:
        conn.close()


def test_passwordless_cannot_change_or_add_a_password_but_others_can(tmp_path):
    conn, client = _app(tmp_path)
    try:
        uid = _passwordless(conn, "kid")
        assert _profile_login(client, uid).status_code == 200
        for current in ("", VALID_PASSWORD):
            r = client.post(
                "/api/auth/change-password",
                json={"current_password": current, "new_password": "a-new-password-1"},
            )
            assert r.status_code == 403
            assert r.json()["detail"]["code"] == "no_password"
        # Still passwordless afterwards.
        assert (
            conn.execute(
                "SELECT password_hash FROM users WHERE id = ?", (uid,)
            ).fetchone()[0]
            == ""
        )
        assert client.get("/api/me").json()["has_password"] is False
        client.post("/api/auth/logout")

        _create_user(conn, "ann")
        client.post(
            "/api/auth/login", json={"username": "ann", "password": VALID_PASSWORD}
        )
        assert client.get("/api/me").json()["has_password"] is True
        r = client.post(
            "/api/auth/change-password",
            json={
                "current_password": VALID_PASSWORD,
                "new_password": "a-new-password-1",
            },
        )
        assert r.status_code == 204
    finally:
        conn.close()


def test_hidden_is_denied_for_passwordless_users_but_kept_for_others(tmp_path):
    conn, client = _app(tmp_path)
    try:
        kid = _passwordless(conn, "kid")
        ann = _create_user(conn, "ann")
        lib = _create_library(conn, "L", path=tmp_path / "L.photoslibrary")
        _assign(conn, kid, lib)
        _assign(conn, ann, lib)
        _insert_asset(conn, lib, "h", hidden=1)

        assert _profile_login(client, kid).status_code == 200
        r = client.post("/api/auth/reconfirm-password", json={"password": ""})
        assert r.status_code == 403
        assert client.get(f"/api/libraries/{lib}/hidden").status_code == 403
        denied = client.get(f"/api/libraries/{lib}/hidden")
        assert denied.json()["detail"]["code"] == "hidden_unavailable"
        # Even if a session somehow carried an unlock stamp.
        conn.execute(
            "UPDATE sessions SET hidden_unlocked_until = datetime('now','+5 minutes')"
        )
        conn.commit()
        assert client.get(f"/api/libraries/{lib}/hidden").status_code == 403
        client.post("/api/auth/logout")

        assert _profile_login(client, ann, VALID_PASSWORD).status_code == 200
        assert client.get(f"/api/libraries/{lib}/hidden").status_code == 403  # locked
        ok = client.post(
            "/api/auth/reconfirm-password", json={"password": VALID_PASSWORD}
        )
        assert ok.status_code == 204
        assert client.get(f"/api/libraries/{lib}/hidden").status_code == 200
    finally:
        conn.close()


def _admin(tmp_path):
    conn, client = _app(tmp_path)
    _create_user(conn, "root", role="admin")
    r = client.post(
        "/api/auth/login", json={"username": "root", "password": VALID_PASSWORD}
    )
    assert r.status_code == 200
    return conn, client


def test_admin_creates_passwordless_user_and_sets_and_removes_passwords(tmp_path):
    conn, client = _admin(tmp_path)
    try:
        r = client.post("/api/admin/users", json={"username": "kid"})
        assert r.status_code == 201, r.text
        assert r.json()["has_password"] is False
        assert (
            conn.execute(
                "SELECT password_hash FROM users WHERE username='kid'"
            ).fetchone()[0]
            == ""
        )
        r = client.patch("/api/admin/users/kid", json={"password": "a-good-password-1"})
        assert r.json()["has_password"] is True
        other = _client_for(conn, LAN)
        assert (
            other.post(
                "/api/auth/login",
                json={"username": "kid", "password": "a-good-password-1"},
            ).status_code
            == 200
        )
        # Removing the password ends the user's sessions.
        r = client.patch("/api/admin/users/kid", json={"remove_password": True})
        assert r.status_code == 200 and r.json()["has_password"] is False
        assert other.get("/api/auth/me").status_code == 401
        assert (
            _client_for(conn, LAN)
            .post(
                "/api/auth/login",
                json={"username": "kid", "password": "a-good-password-1"},
            )
            .status_code
            == 401
        )
        both = client.patch(
            "/api/admin/users/kid",
            json={"remove_password": True, "password": "a-good-password-1"},
        )
        assert both.status_code == 422
    finally:
        conn.close()


def test_password_management_and_settings_are_admin_only(tmp_path):
    conn, _ = _app(tmp_path)
    try:
        _create_user(conn, "ann")
        _create_user(conn, "bob")
        client = _client_for(conn, LAN)
        client.post(
            "/api/auth/login", json={"username": "ann", "password": VALID_PASSWORD}
        )
        assert (
            client.patch(
                "/api/admin/users/bob", json={"password": "a-good-password-1"}
            ).status_code
            == 403
        )
        assert (
            client.patch(
                "/api/admin/users/bob", json={"remove_password": True}
            ).status_code
            == 403
        )
        assert (
            client.patch(
                "/api/admin/users/ann", json={"remove_password": True}
            ).status_code
            == 403
        )
        assert (
            client.patch(
                "/api/admin/users/ann", json={"show_on_profiles": False}
            ).status_code
            == 403
        )
        assert (
            client.post("/api/admin/users", json={"username": "x"}).status_code == 403
        )
        assert client.get("/api/admin/settings/family-login").status_code == 403
        assert (
            client.put(
                "/api/admin/settings/family-login",
                json={"enabled": False, "passwordless_signin": "anywhere"},
            ).status_code
            == 403
        )
        assert session_auth.family_login_enabled(conn)
        # Unauthenticated: 401.
        assert (
            _client_for(conn, LAN).get("/api/admin/settings/family-login").status_code
            == 401
        )
    finally:
        conn.close()


def test_admin_settings_defaults_and_updates(tmp_path):
    conn, client = _admin(tmp_path)
    try:
        assert client.get("/api/admin/settings/family-login").json() == {
            "enabled": True,
            "passwordless_signin": "private",
        }
        r = client.put(
            "/api/admin/settings/family-login",
            json={"enabled": False, "passwordless_signin": "anywhere"},
        )
        assert r.status_code == 200
        assert client.get("/api/admin/settings/family-login").json() == {
            "enabled": False,
            "passwordless_signin": "anywhere",
        }
        bad = client.put(
            "/api/admin/settings/family-login",
            json={"enabled": True, "passwordless_signin": "world"},
        )
        assert bad.status_code == 422
    finally:
        conn.close()


def test_admin_toggles_show_on_profiles(tmp_path):
    conn, client = _admin(tmp_path)
    try:
        _create_user(conn, "ann")
        anon = _client_for(conn, LAN)
        assert [
            p["display_name"] for p in anon.get("/api/auth/profiles").json()["profiles"]
        ] == ["ann", "root"]
        r = client.patch("/api/admin/users/ann", json={"show_on_profiles": False})
        assert r.json()["show_on_profiles"] is False
        assert [
            p["display_name"] for p in anon.get("/api/auth/profiles").json()["profiles"]
        ] == ["root"]
        client.patch("/api/admin/users/ann", json={"show_on_profiles": True})
        assert len(anon.get("/api/auth/profiles").json()["profiles"]) == 2
    finally:
        conn.close()


def test_migration_defaults_for_existing_users(tmp_path):
    conn = app_db.connect(tmp_path / "data")
    try:
        _create_user(conn, "ann")
        row = conn.execute("SELECT show_on_profiles FROM users").fetchone()
        assert row[0] == 1
        assert session_auth.family_login_enabled(conn)
        assert session_auth.passwordless_mode(conn) == "private"
    finally:
        conn.close()
