"""D4: the per-user "Library updated · +N added, −M removed" banner, and D5's
`original_available` flag. Synthetic fixture only; the checker is driven by hand."""

from fastapi.testclient import TestClient

from photos_viewer import app_db, session_auth
from tests.test_library_admin import VALID_PASSWORD
from tests.test_library_replacement import (
    IMG,
    _asset,
    _drive,
    _replace_package,
    _setup,
)


def _note(client):
    return client.get("/api/me").json()["libraries"][0]["updated_note"]


def _dismiss(client, lib, run_id):
    return client.post(
        f"/api/libraries/{lib}/updated-note/dismiss", json={"run_id": run_id}
    )


def test_note_counts_added_and_removed_and_never_hidden(tmp_path):
    a = [_asset(1), _asset(2), _asset(3, hidden=True)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        assert _note(client) is None
        # 2 removed (one visible, one Hidden), 1 added visible, 2 added Hidden.
        _replace_package(
            package,
            [_asset(1), _asset(4), _asset(5, hidden=True), _asset(6, hidden=True)],
        )
        _drive(conn, lib)
        note = _note(client)
        assert (note["added"], note["removed"]) == (1, 1)
        run = conn.execute(
            "SELECT added, removed FROM library_index_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
        assert (run["added"], run["removed"]) == (3, 2)  # raw counts keep Hidden
    finally:
        conn.close()


def test_hidden_only_update_shows_no_note(tmp_path):
    a = [_asset(1)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        _replace_package(package, a + [_asset(2, hidden=True)])
        _drive(conn, lib)
        assert _note(client) is None
    finally:
        conn.close()


def test_dismissal_is_per_user_and_a_newer_run_shows_again(tmp_path):
    a = [_asset(1)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES ('bob', ?, 'user')",
            (session_auth.hash_password(VALID_PASSWORD),),
        )
        conn.execute(
            "INSERT INTO library_assignments (user_id, library_id) "
            "SELECT id, ? FROM users WHERE username = 'bob'",
            (lib,),
        )
        conn.commit()
        package = _replace_package(package, a + [_asset(2)])
        _drive(conn, lib)
        first = _note(client)
        assert first is not None
        assert _dismiss(client, lib, first["run_id"]).status_code == 200
        assert _note(client) is None

        bob = TestClient(client.app, base_url="https://testserver")
        bob.post(
            "/api/auth/login", json={"username": "bob", "password": VALID_PASSWORD}
        )
        assert _note(bob)["run_id"] == first["run_id"]

        _replace_package(package, a + [_asset(2), _asset(3)])
        _drive(conn, lib)
        assert _note(client)["run_id"] > first["run_id"]
    finally:
        conn.close()


def test_dismiss_is_guarded(tmp_path):
    conn, client, _package, lib = _setup(tmp_path, [_asset(1)])
    try:
        assert _dismiss(client, lib + 99, 1).status_code == 404
        client.cookies.clear()
        assert _dismiss(client, lib, 1).status_code == 401
    finally:
        conn.close()


def test_runs_before_the_visible_counts_never_show_a_note(tmp_path):
    a = [_asset(1)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        _replace_package(package, a + [_asset(2)])
        _drive(conn, lib)
        conn.execute(
            "UPDATE library_index_runs SET added_visible = NULL, removed_visible = NULL"
        )
        conn.commit()
        assert _note(client) is None
    finally:
        conn.close()


def test_original_available_is_false_when_only_a_derivative_exists(tmp_path):
    a = [_asset(1), _asset(2)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        url = f"/api/libraries/{lib}/assets/"
        assert client.get(url + a[0].uuid).json()["original_available"] is True
        package = _replace_package(package, a)
        derivatives = package / "resources" / "derivatives" / a[0].uuid[0]
        derivatives.mkdir(parents=True, exist_ok=True)
        (derivatives / f"{a[0].uuid}_1_105_c.jpeg").write_bytes(IMG)
        for f in (package / "originals").rglob("*"):
            if f.is_file() and f.name == a[0].filename:
                f.unlink()
        assert "applied" in _drive(conn, lib)
        assert client.get(url + a[0].uuid).json()["original_available"] is False
        assert client.get(url + a[1].uuid).json()["original_available"] is True
    finally:
        conn.close()


def test_migration_flags_indexed_libraries_for_a_reindex(tmp_path):
    conn = app_db.connect(tmp_path)
    try:
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(assets)")}
        assert "original_missing" in columns
    finally:
        conn.close()
