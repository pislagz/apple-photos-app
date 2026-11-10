"""P1.10: the admin API the admin UI calls -- users, invites, the access
matrix, sessions, the audit log, and settings.

Reuses `test_library_admin.py`'s `_client`/`_admin_client`/`_non_admin_client`
convention: no real `.photoslibrary`, just rows inserted directly or through
the admin API itself.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from photos_viewer import app_db, session_auth
from photos_viewer.main import create_app

VALID_PASSWORD = "correct-horse-battery"


def _client(tmp_path):
    app = create_app()
    conn = app_db.connect(tmp_path)
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    return conn, TestClient(app, base_url="https://testserver")


def _admin_client(tmp_path):
    conn, client = _client(tmp_path)
    client.post(
        "/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD}
    )
    client.post(
        "/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD}
    )
    return conn, client


def _non_admin_client(tmp_path):
    conn, client = _admin_client(tmp_path)
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES ('bob', ?, 'user')",
        (session_auth.hash_password(VALID_PASSWORD),),
    )
    conn.commit()
    client.post("/api/auth/login", json={"username": "bob", "password": VALID_PASSWORD})
    return conn, client


def _create_library(conn, display_name):
    conn.execute(
        "INSERT INTO libraries (display_name, path) VALUES (?, ?)",
        (display_name, f"/libraries/{display_name}.photoslibrary"),
    )
    conn.commit()
    return conn.execute(
        "SELECT id FROM libraries WHERE display_name = ?", (display_name,)
    ).fetchone()["id"]


# --------------------------------------------------------------------------
# Users
# --------------------------------------------------------------------------


def test_create_list_update_delete_user(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        created = client.post(
            "/api/admin/users",
            json={"username": "carol", "password": VALID_PASSWORD, "role": "user"},
        )
        assert created.status_code == 201, created.text
        assert created.json()["username"] == "carol"
        assert created.json()["role"] == "user"
        assert created.json()["disabled"] is False

        listed = client.get("/api/admin/users")
        assert {u["username"] for u in listed.json()} == {"admin", "carol"}

        updated = client.patch(
            "/api/admin/users/carol", json={"role": "admin", "disabled": True}
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["role"] == "admin"
        assert updated.json()["disabled"] is True

        deleted = client.delete(
            "/api/admin/users/carol", headers={"content-type": "application/json"}
        )
        assert deleted.status_code == 204
        assert client.get("/api/admin/users").json() == [
            u for u in listed.json() if u["username"] == "admin"
        ]
    finally:
        conn.close()


def test_create_user_duplicate_username_is_409(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        client.post(
            "/api/admin/users", json={"username": "carol", "password": VALID_PASSWORD}
        )
        again = client.post(
            "/api/admin/users", json={"username": "carol", "password": VALID_PASSWORD}
        )
        assert again.status_code == 409
    finally:
        conn.close()


def test_update_unknown_user_is_404(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        assert (
            client.patch("/api/admin/users/nobody", json={"disabled": True}).status_code
            == 404
        )
    finally:
        conn.close()


def test_cannot_demote_the_last_admin(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        response = client.patch("/api/admin/users/admin", json={"role": "user"})
        assert response.status_code == 400
        assert "admin" in response.json()["detail"]
    finally:
        conn.close()


def test_cannot_disable_the_last_admin(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        response = client.patch("/api/admin/users/admin", json={"disabled": True})
        assert response.status_code == 400
    finally:
        conn.close()


def test_cannot_delete_the_last_admin(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        response = client.delete(
            "/api/admin/users/admin", headers={"content-type": "application/json"}
        )
        assert response.status_code == 400
    finally:
        conn.close()


def test_demoting_one_of_two_admins_is_allowed(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        client.post(
            "/api/admin/users",
            json={"username": "carol", "password": VALID_PASSWORD, "role": "admin"},
        )
        response = client.patch("/api/admin/users/admin", json={"role": "user"})
        assert response.status_code == 200
    finally:
        conn.close()


def test_update_user_password_takes_effect(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        client.post(
            "/api/admin/users", json={"username": "carol", "password": VALID_PASSWORD}
        )
        client.patch(
            "/api/admin/users/carol", json={"password": "a-different-password-1"}
        )

        login = client.post(
            "/api/auth/login",
            json={"username": "carol", "password": "a-different-password-1"},
        )
        assert login.status_code == 200
    finally:
        conn.close()


def test_update_user_password_revokes_existing_sessions(tmp_path):
    """Issue #53: a password reset (admin-initiated, or a user's own change
    via this same PATCH) must kill any session issued under the old
    password -- otherwise a stolen or shared cookie survives the fix."""
    conn, client = _admin_client(tmp_path)
    try:
        client.post(
            "/api/admin/users", json={"username": "carol", "password": VALID_PASSWORD}
        )
        carol_client = TestClient(client.app, base_url="https://testserver")
        login = carol_client.post(
            "/api/auth/login", json={"username": "carol", "password": VALID_PASSWORD}
        )
        assert login.status_code == 200
        assert carol_client.get("/api/me").status_code == 200

        client.patch(
            "/api/admin/users/carol", json={"password": "a-different-password-1"}
        )

        assert carol_client.get("/api/me").status_code == 401
    finally:
        conn.close()


def test_admin_resetting_own_password_keeps_current_session_only(tmp_path):
    """#72: the session making the change survives; the admin's other
    sessions are revoked."""
    conn, client = _admin_client(tmp_path)
    try:
        other = TestClient(client.app, base_url="https://testserver")
        assert (
            other.post(
                "/api/auth/login",
                json={"username": "admin", "password": VALID_PASSWORD},
            ).status_code
            == 200
        )
        assert other.get("/api/me").status_code == 200

        resp = client.patch(
            "/api/admin/users/admin", json={"password": "a-different-password-1"}
        )

        assert resp.status_code == 200
        assert client.get("/api/me").status_code == 200
        assert other.get("/api/me").status_code == 401
    finally:
        conn.close()


def test_user_changes_write_audit_rows(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        client.post(
            "/api/admin/users", json={"username": "carol", "password": VALID_PASSWORD}
        )
        client.patch("/api/admin/users/carol", json={"disabled": True})
        client.delete(
            "/api/admin/users/carol", headers={"content-type": "application/json"}
        )

        actions = [
            row["action"]
            for row in conn.execute(
                "SELECT action FROM audit_log ORDER BY id"
            ).fetchall()
        ]
        assert actions == ["create_user", "update_user", "delete_user"]
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Invites
# --------------------------------------------------------------------------


def test_invite_create_and_accept_logs_in_the_new_user(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        created = client.post("/api/admin/invites", json={"role": "user"})
        assert created.status_code == 201
        code = created.json()["code"]

        info = client.get(f"/api/invites/{code}")
        assert info.status_code == 200
        assert info.json() == {"role": "user"}

        accepted = client.post(
            f"/api/invites/{code}/accept",
            json={"username": "dave", "password": VALID_PASSWORD},
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json() == {"username": "dave", "role": "user"}
        assert "photos_session" in accepted.cookies or accepted.cookies

        me = client.get("/api/me")
        assert me.status_code == 200
        assert me.json()["username"] == "dave"
    finally:
        conn.close()


def test_invite_can_only_be_accepted_once(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        code = client.post("/api/admin/invites", json={"role": "user"}).json()["code"]
        first = client.post(
            f"/api/invites/{code}/accept",
            json={"username": "dave", "password": VALID_PASSWORD},
        )
        assert first.status_code == 200

        second = client.post(
            f"/api/invites/{code}/accept",
            json={"username": "erin", "password": VALID_PASSWORD},
        )
        assert second.status_code == 404
        assert client.get(f"/api/invites/{code}").status_code == 404
    finally:
        conn.close()


def test_unknown_invite_code_is_404(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        assert client.get("/api/invites/not-a-real-code").status_code == 404
        assert (
            client.post(
                "/api/invites/not-a-real-code/accept",
                json={"username": "dave", "password": VALID_PASSWORD},
            ).status_code
            == 404
        )
    finally:
        conn.close()


def test_expired_invite_is_404(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        code = client.post("/api/admin/invites", json={"role": "user"}).json()["code"]
        conn.execute("UPDATE invites SET expires_at = datetime('now', '-1 second')")
        conn.commit()

        assert client.get(f"/api/invites/{code}").status_code == 404
    finally:
        conn.close()


def test_list_invites_is_admin_only(tmp_path):
    conn, client = _non_admin_client(tmp_path)
    try:
        assert client.get("/api/admin/invites").status_code == 403
        assert (
            client.post("/api/admin/invites", json={"role": "user"}).status_code == 403
        )
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Access matrix
# --------------------------------------------------------------------------


def test_access_matrix_assign_unassign_round_trip(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        user_id = client.post(
            "/api/admin/users", json={"username": "carol", "password": VALID_PASSWORD}
        ).json()["id"]
        library_id = _create_library(conn, "L1")

        assert (
            client.put(
                f"/api/admin/users/{user_id}/libraries/{library_id}",
                headers={"content-type": "application/json"},
            ).status_code
            == 204
        )

        matrix = client.get("/api/admin/access-matrix").json()
        assert matrix["assignments"][str(user_id)] == [library_id]

        assert (
            client.delete(
                f"/api/admin/users/{user_id}/libraries/{library_id}",
                headers={"content-type": "application/json"},
            ).status_code
            == 204
        )

        matrix = client.get("/api/admin/access-matrix").json()
        assert matrix["assignments"][str(user_id)] == []
    finally:
        conn.close()


def test_unassigning_a_library_404s_the_p19_routes_on_the_next_request(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        signup = client.post(
            "/api/admin/users", json={"username": "carol", "password": VALID_PASSWORD}
        )
        user_id = signup.json()["id"]
        library_id = _create_library(conn, "L1")
        client.put(
            f"/api/admin/users/{user_id}/libraries/{library_id}",
            headers={"content-type": "application/json"},
        )

        user_client = TestClient(client.app, base_url="https://testserver")
        user_client.post(
            "/api/auth/login", json={"username": "carol", "password": VALID_PASSWORD}
        )
        assert (
            user_client.get(f"/api/libraries/{library_id}/summary").status_code == 200
        )

        client.delete(
            f"/api/admin/users/{user_id}/libraries/{library_id}",
            headers={"content-type": "application/json"},
        )

        assert (
            user_client.get(f"/api/libraries/{library_id}/summary").status_code == 404
        )
    finally:
        conn.close()


def test_access_matrix_unknown_user_or_library_is_404(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        library_id = _create_library(conn, "L1")
        assert (
            client.put(
                f"/api/admin/users/999/libraries/{library_id}",
                headers={"content-type": "application/json"},
            ).status_code
            == 404
        )
        user_id = client.post(
            "/api/admin/users", json={"username": "carol", "password": VALID_PASSWORD}
        ).json()["id"]
        assert (
            client.put(
                f"/api/admin/users/{user_id}/libraries/999",
                headers={"content-type": "application/json"},
            ).status_code
            == 404
        )
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------


def test_list_and_revoke_session(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        client.post(
            "/api/admin/users", json={"username": "carol", "password": VALID_PASSWORD}
        )
        user_client = TestClient(client.app, base_url="https://testserver")
        user_client.post(
            "/api/auth/login", json={"username": "carol", "password": VALID_PASSWORD}
        )

        sessions = client.get("/api/admin/sessions").json()
        carol_session = next(s for s in sessions if s["username"] == "carol")

        # Issue #53: the listed id is an opaque public_id, never the
        # sha256 hash `sessions.id` stores for cookie lookups.
        stored_ids = {
            row["id"] for row in conn.execute("SELECT id FROM sessions").fetchall()
        }
        assert carol_session["id"] not in stored_ids

        assert user_client.get("/api/me").status_code == 200

        revoked = client.delete(
            f"/api/admin/sessions/{carol_session['id']}",
            headers={"content-type": "application/json"},
        )
        assert revoked.status_code == 204

        assert user_client.get("/api/me").status_code == 401
    finally:
        conn.close()


def test_revoke_unknown_session_is_404(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        assert (
            client.delete(
                "/api/admin/sessions/not-a-real-id",
                headers={"content-type": "application/json"},
            ).status_code
            == 404
        )
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Audit log
# --------------------------------------------------------------------------


def test_audit_log_lists_and_filters_by_user(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        created = client.post(
            "/api/admin/users", json={"username": "carol", "password": VALID_PASSWORD}
        )
        user_id = created.json()["id"]
        client.patch("/api/admin/users/carol", json={"disabled": True})

        all_entries = client.get("/api/admin/audit-log").json()["entries"]
        assert len(all_entries) >= 2

        filtered = client.get(f"/api/admin/audit-log?user_id={user_id}").json()[
            "entries"
        ]
        assert filtered
        assert all(entry["user_id"] == user_id for entry in filtered)
    finally:
        conn.close()


def test_audit_log_csv_export(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        client.post(
            "/api/admin/users", json={"username": "carol", "password": VALID_PASSWORD}
        )

        response = client.get("/api/admin/audit-log.csv")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert "create_user" in response.text
        assert response.text.splitlines()[0].startswith("id,occurred_at,action")
    finally:
        conn.close()


def test_audit_log_date_to_includes_the_whole_end_day(tmp_path):
    """Issue #53: `date_to=2026-11-02` must include entries from later that
    same day, not just ones at or before midnight."""
    conn, client = _admin_client(tmp_path)
    try:
        conn.execute(
            "INSERT INTO audit_log (occurred_at, action, actor) VALUES ('2026-11-02 23:59:00', 'create_user', 'admin')"
        )
        conn.commit()

        entries = client.get("/api/admin/audit-log?date_to=2026-11-02").json()[
            "entries"
        ]
        assert any(entry["occurred_at"] == "2026-11-02 23:59:00" for entry in entries)

        entries = client.get("/api/admin/audit-log?date_to=2026-11-01").json()[
            "entries"
        ]
        assert all(entry["occurred_at"] != "2026-11-02 23:59:00" for entry in entries)
    finally:
        conn.close()


def test_audit_log_csv_export_guards_against_formula_injection(tmp_path):
    """Issue #53: a cell that opens with `=`, `+`, `-`, `@`, tab, or CR is
    treated as a formula by spreadsheet apps that open the CSV -- prefix it
    so it round-trips as inert text instead."""
    conn, client = _admin_client(tmp_path)
    try:
        conn.execute(
            "INSERT INTO audit_log (occurred_at, action, actor, detail) VALUES "
            "('2026-11-02 12:00:00', 'create_user', 'admin', '=HYPERLINK(\"http://evil\")')"
        )
        conn.commit()

        response = client.get("/api/admin/audit-log.csv")
        assert response.status_code == 200
        # Prefixed with a leading `'` so a spreadsheet treats the cell as text,
        # not a formula -- the raw payload still appears, just made inert.
        assert "'=HYPERLINK" in response.text
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------


def test_settings_default_then_round_trip(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        defaults = client.get("/api/admin/settings")
        assert defaults.status_code == 200
        assert defaults.json()["map_tiles_mode"] == "off"  # D41: opt-in
        assert defaults.json()["osm_consent"] is False
        assert defaults.json()["map_tiles_pmtiles_path"] is None

        updated = client.put(
            "/api/admin/settings",
            json={
                "session_lifetime_desktop_seconds": 3600,
                "session_lifetime_pwa_seconds": 7200,
                "session_lifetime_remember_me_seconds": 86400,
                "thumb_size_grid": 320,
                "thumb_size_grid2x": 640,
                "thumb_size_preview": 1800,
                "thumb_quality": 90,
                "media_cache_size_limit_bytes": 1024**3,
                "zip_size_limit_bytes": 1024,
                "osm_consent": True,
                "map_tiles_pmtiles_path": "/data/world.pmtiles",
            },
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["map_tiles_mode"] == "local_file"
        assert updated.json()["map_tiles_pmtiles_path"] == "/data/world.pmtiles"
        assert updated.json()["thumb_quality"] == 90

        reread = client.get("/api/admin/settings")
        assert reread.json() == updated.json()
    finally:
        conn.close()


def test_settings_save_is_live_for_new_sessions(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        client.put(
            "/api/admin/settings",
            json={
                "session_lifetime_desktop_seconds": 120,
                "session_lifetime_pwa_seconds": 7200,
                "session_lifetime_remember_me_seconds": 86400,
                "thumb_size_grid": 300,
                "thumb_size_grid2x": 600,
                "thumb_size_preview": 1600,
                "thumb_quality": 85,
                "media_cache_size_limit_bytes": 1024**3,
                "zip_size_limit_bytes": 1024,
                "osm_consent": True,
                "map_tiles_pmtiles_path": None,
            },
        )
        assert session_auth.session_lifetime_seconds(conn, "desktop", False) == 120
    finally:
        conn.close()


def test_settings_rejects_out_of_range_values(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        response = client.put(
            "/api/admin/settings",
            json={
                "session_lifetime_desktop_seconds": 3600,
                "session_lifetime_pwa_seconds": 7200,
                "session_lifetime_remember_me_seconds": 86400,
                "thumb_size_grid": 300,
                "thumb_size_grid2x": 600,
                "thumb_size_preview": 1600,
                "thumb_quality": 150,
                "media_cache_size_limit_bytes": 1024**3,
                "zip_size_limit_bytes": 1024,
                "osm_consent": True,
                "map_tiles_pmtiles_path": None,
            },
        )
        assert response.status_code == 422
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Non-admin access
# --------------------------------------------------------------------------


def test_non_admin_is_403_on_every_admin_panel_route(tmp_path):
    conn, client = _non_admin_client(tmp_path)
    try:
        library_id = _create_library(conn, "L1")
        user_id = conn.execute(
            "SELECT id FROM users WHERE username = 'bob'"
        ).fetchone()["id"]

        assert (
            client.post(
                "/api/admin/users", json={"username": "x", "password": VALID_PASSWORD}
            ).status_code
            == 403
        )
        assert client.get("/api/admin/users").status_code == 403
        assert (
            client.patch("/api/admin/users/bob", json={"disabled": True}).status_code
            == 403
        )
        assert (
            client.delete(
                "/api/admin/users/bob", headers={"content-type": "application/json"}
            ).status_code
            == 403
        )

        assert client.get("/api/admin/access-matrix").status_code == 403
        assert (
            client.put(
                f"/api/admin/users/{user_id}/libraries/{library_id}",
                headers={"content-type": "application/json"},
            ).status_code
            == 403
        )
        assert (
            client.delete(
                f"/api/admin/users/{user_id}/libraries/{library_id}",
                headers={"content-type": "application/json"},
            ).status_code
            == 403
        )

        assert client.get("/api/admin/sessions").status_code == 403
        assert (
            client.delete(
                "/api/admin/sessions/x", headers={"content-type": "application/json"}
            ).status_code
            == 403
        )

        assert client.get("/api/admin/audit-log").status_code == 403
        assert client.get("/api/admin/audit-log.csv").status_code == 403

        assert client.get("/api/admin/settings").status_code == 403
        assert client.put("/api/admin/settings", json={}).status_code == 403
    finally:
        conn.close()


def test_settings_default_quality_matches_the_media_default():
    from photos_viewer import admin_panel, media

    assert admin_panel._SETTINGS_DEFAULTS["thumb_quality"] == media.DEFAULT_QUALITY
