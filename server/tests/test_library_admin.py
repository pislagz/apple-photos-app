"""P1.5: admin-only library registry -- add, list, rename, remove, status."""

import hashlib
import pathlib
import shutil

from fastapi.testclient import TestClient

from photos_viewer import app_db, indexer, libraries, session_auth
from photos_viewer.main import create_app
from tests.fixtures import build_closed_fixture_library, build_fixture_library

VALID_PASSWORD = "correct-horse-battery"


def _snapshot(package_path: pathlib.Path) -> dict:
    snapshot = {}
    for path in sorted(package_path.rglob("*")):
        rel = str(path.relative_to(package_path))
        stat = path.stat()
        snapshot[rel] = ("dir", stat.st_mtime_ns) if path.is_dir() else (stat.st_size, stat.st_mtime_ns)
    return snapshot


def _full_snapshot(package_path: pathlib.Path) -> dict:
    """Stronger than `_snapshot`: covers the package root's own mtime (which
    `rglob` never visits) and the sha256 of every file's content, not just
    its size, so a rewrite that happens to leave size and mtime alone still
    gets caught.
    """
    snapshot = {}
    for path in (package_path, *package_path.rglob("*")):
        rel = "." if path == package_path else str(path.relative_to(package_path))
        stat = path.stat()
        if path.is_dir():
            snapshot[rel] = ("dir", stat.st_mtime_ns)
        else:
            snapshot[rel] = ("file", stat.st_mtime_ns, hashlib.sha256(path.read_bytes()).hexdigest())
    return snapshot


def _client(tmp_path):
    app = create_app()
    conn = app_db.connect(tmp_path)
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    return conn, TestClient(app, base_url="https://testserver")


def _admin_client(tmp_path):
    conn, client = _client(tmp_path)
    client.post("/api/setup/admin", json={"username": "admin", "password": VALID_PASSWORD})
    client.post("/api/auth/login", json={"username": "admin", "password": VALID_PASSWORD})
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


def test_add_library_with_a_bad_path(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        missing = tmp_path / "Nope.photoslibrary"

        response = client.post("/api/admin/libraries", json={"path": str(missing)})

        assert response.status_code == 400
        assert str(missing) in response.json()["detail"]
        assert "mounted" not in response.json()["detail"]
    finally:
        conn.close()


def test_add_library_with_a_missing_mount(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        unmounted = tmp_path / "Volumes" / "ExternalDrive" / "Photos.photoslibrary"

        response = client.post("/api/admin/libraries", json={"path": str(unmounted)})

        assert response.status_code == 400
        assert "mounted" in response.json()["detail"]
    finally:
        conn.close()


def test_add_library_with_an_unsupported_version(tmp_path, monkeypatch):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        monkeypatch.setattr(libraries, "SUPPORTED_PHOTOS_VERSIONS", frozenset({12}))

        response = client.post("/api/admin/libraries", json={"path": str(package_path)})

        assert response.status_code == 400
        assert "version" in response.json()["detail"]
    finally:
        conn.close()


def test_add_library_succeeds_and_defaults_the_display_name(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)

        response = client.post("/api/admin/libraries", json={"path": str(package_path)})

        assert response.status_code == 201
        body = response.json()
        assert body["display_name"] == "Synthetic"
        assert body["path"] == str(package_path)
        assert isinstance(body["id"], int)
    finally:
        conn.close()


def test_add_library_honors_an_explicit_display_name(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)

        response = client.post(
            "/api/admin/libraries", json={"path": str(package_path), "display_name": "Family Photos"}
        )

        assert response.status_code == 201
        assert response.json()["display_name"] == "Family Photos"
    finally:
        conn.close()


def test_add_library_twice_at_the_same_path_is_a_conflict(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        client.post("/api/admin/libraries", json={"path": str(package_path)})

        response = client.post("/api/admin/libraries", json={"path": str(package_path)})

        assert response.status_code == 409
    finally:
        conn.close()


def test_add_library_writes_an_audit_row(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        client.post("/api/admin/libraries", json={"path": str(package_path)})

        row = conn.execute("SELECT action, actor, detail FROM audit_log WHERE action = 'add_library'").fetchone()

        assert row["actor"] == "admin"
        assert str(package_path) in row["detail"]
    finally:
        conn.close()


def test_list_libraries(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        client.post("/api/admin/libraries", json={"path": str(package_path)})

        response = client.get("/api/admin/libraries")

        assert response.status_code == 200
        assert [row["path"] for row in response.json()] == [str(package_path)]
    finally:
        conn.close()


def test_rename_library(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        added = client.post("/api/admin/libraries", json={"path": str(package_path)}).json()

        response = client.patch(f"/api/admin/libraries/{added['id']}", json={"display_name": "Renamed"})

        assert response.status_code == 200
        assert response.json()["display_name"] == "Renamed"
        listed = client.get("/api/admin/libraries").json()
        assert listed[0]["display_name"] == "Renamed"
    finally:
        conn.close()


def test_rename_unknown_library_is_404(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        response = client.patch("/api/admin/libraries/999", json={"display_name": "Renamed"})

        assert response.status_code == 404
    finally:
        conn.close()


def test_remove_library_deletes_the_row_but_leaves_the_package_on_disk(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        sqlite_path = package_path / "database" / "Photos.sqlite"
        added = client.post("/api/admin/libraries", json={"path": str(package_path)}).json()

        response = client.delete(
            f"/api/admin/libraries/{added['id']}", headers={"content-type": "application/json"}
        )

        assert response.status_code == 204
        assert client.get("/api/admin/libraries").json() == []
        assert package_path.is_dir()
        assert sqlite_path.is_file()
    finally:
        conn.close()


def test_remove_unknown_library_is_404(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        response = client.delete("/api/admin/libraries/999", headers={"content-type": "application/json"})

        assert response.status_code == 404
    finally:
        conn.close()


def test_remove_library_writes_an_audit_row(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        added = client.post("/api/admin/libraries", json={"path": str(package_path)}).json()

        client.delete(f"/api/admin/libraries/{added['id']}", headers={"content-type": "application/json"})

        row = conn.execute("SELECT actor, detail FROM audit_log WHERE action = 'remove_library'").fetchone()
        assert row["actor"] == "admin"
        assert str(package_path) in row["detail"]
    finally:
        conn.close()


def test_library_status_reports_size_and_no_warnings_for_a_healthy_library(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        added = client.post("/api/admin/libraries", json={"path": str(package_path)}).json()

        response = client.get(f"/api/admin/libraries/{added['id']}/status")

        assert response.status_code == 200
        body = response.json()
        assert body["total_size_bytes"] > 0
        assert body["asset_count"] == 1
        assert body["video_count"] == 0
        assert body["people_count"] == 0
        assert body["last_indexed_at"] is not None
        assert body["prewarm_progress"] is None
        assert body["warnings"] == []
    finally:
        conn.close()


def test_library_status_does_not_write_into_the_package(tmp_path):
    # library_is_locked is called on every status request; on a WAL-mode
    # database, opening it with plain `mode=ro` (as opposed to `immutable=1`)
    # creates a `-shm`/`-wal` pair if neither already exists, which is a
    # write into the package -- forbidden even for an admin-only status
    # check. Add/rename/remove exercise the same package, each with their
    # own status read in between.
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)

        before = _snapshot(package_path)
        added = client.post("/api/admin/libraries", json={"path": str(package_path)}).json()

        status_response = client.get(f"/api/admin/libraries/{added['id']}/status")
        assert status_response.status_code == 200
        assert status_response.json()["warnings"] == []

        client.patch(f"/api/admin/libraries/{added['id']}", json={"display_name": "renamed"})
        client.get(f"/api/admin/libraries/{added['id']}/status")
        client.delete(f"/api/admin/libraries/{added['id']}", headers={"content-type": "application/json"})

        after = _snapshot(package_path)
        assert set(after) - set(before) == set(), "status check created a new file or directory"
        assert after == before, "status check changed an existing file's size or mtime"
    finally:
        conn.close()


def test_library_status_does_not_write_into_a_closed_librarys_package(tmp_path):
    # A real closed library (Photos.app not running) has no `-wal`/`-shm`
    # next to Photos.sqlite -- unlike the open-WAL fixture used above, which
    # already has them from its own kept-open connection and so can't catch
    # a status check that would *create* them. `sqlite_db_is_locked`-style
    # plain `mode=ro` opens do create them on a WAL-mode database with
    # neither present, which is a write into the package. Snapshotting every
    # file's content (not just size) and every directory's mtime, including
    # the package root, catches a rewrite that a size/mtime-only check could
    # miss too.
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_closed_fixture_library(tmp_path)
        assert not list(package_path.glob("database/Photos.sqlite-wal"))
        assert not list(package_path.glob("database/Photos.sqlite-shm"))

        before = _full_snapshot(package_path)
        # add_library indexes the fixture (P1.6); the status loop below and
        # the explicit reindex must not touch the package either.
        added = client.post("/api/admin/libraries", json={"path": str(package_path)}).json()
        assert added is not None

        for _ in range(3):
            status_response = client.get(f"/api/admin/libraries/{added['id']}/status")
            assert status_response.status_code == 200
            assert status_response.json()["warnings"] == []
            assert status_response.json()["asset_count"] == 1

        reindex_response = client.post(f"/api/admin/libraries/{added['id']}/reindex", json={})
        assert reindex_response.status_code == 200
        assert reindex_response.json()["asset_count"] == 1

        client.patch(f"/api/admin/libraries/{added['id']}", json={"display_name": "renamed"})
        client.get(f"/api/admin/libraries/{added['id']}/status")
        client.delete(f"/api/admin/libraries/{added['id']}", headers={"content-type": "application/json"})

        after = _full_snapshot(package_path)
        new_paths = set(after) - set(before)
        assert new_paths == set(), f"status check created new paths: {new_paths}"
        assert after == before, "status check changed an existing file or directory's content/mtime"
    finally:
        conn.close()


def test_library_status_warns_when_the_drive_is_unmounted(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        added = client.post("/api/admin/libraries", json={"path": str(package_path)}).json()
        shutil.rmtree(package_path)

        response = client.get(f"/api/admin/libraries/{added['id']}/status")

        assert response.status_code == 200
        body = response.json()
        assert body["total_size_bytes"] is None
        assert [w["code"] for w in body["warnings"]] == ["drive_not_mounted"]
    finally:
        conn.close()


def test_library_status_unknown_library_is_404(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        response = client.get("/api/admin/libraries/999/status")

        assert response.status_code == 404
    finally:
        conn.close()


def test_indexing_the_fixture_is_idempotent(tmp_path):
    # add_library already indexes once; a second forced re-index of an
    # unchanged sqlite file must replace, not duplicate, the asset/people rows.
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        added = client.post("/api/admin/libraries", json={"path": str(package_path)}).json()

        first = indexer.index_library(conn, added["id"], package_path)
        assert first is False, "unchanged sqlite file should skip the walk entirely"
        asset_rows = conn.execute("SELECT COUNT(*) FROM assets WHERE library_id = ?", (added["id"],)).fetchone()[0]
        assert asset_rows == 1

        second = indexer.index_library(conn, added["id"], package_path, force=True)
        assert second is True
        asset_rows = conn.execute("SELECT COUNT(*) FROM assets WHERE library_id = ?", (added["id"],)).fetchone()[0]
        assert asset_rows == 1
    finally:
        conn.close()


def test_reindex_endpoint_forces_a_fresh_walk_and_is_audit_logged(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        added = client.post("/api/admin/libraries", json={"path": str(package_path)}).json()
        first_indexed_at = conn.execute(
            "SELECT last_indexed_at FROM libraries WHERE id = ?", (added["id"],)
        ).fetchone()["last_indexed_at"]

        response = client.post(f"/api/admin/libraries/{added['id']}/reindex", json={})

        assert response.status_code == 200
        body = response.json()
        assert body["asset_count"] == 1
        assert conn.execute(
            "SELECT last_indexed_at FROM libraries WHERE id = ?", (added["id"],)
        ).fetchone()["last_indexed_at"] >= first_indexed_at
        row = conn.execute("SELECT actor, detail FROM audit_log WHERE action = 'reindex_library'").fetchone()
        assert row["actor"] == "admin"
        assert str(package_path) in row["detail"]
    finally:
        conn.close()


def test_reindex_unknown_library_is_404(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        response = client.post("/api/admin/libraries/999/reindex", json={})

        assert response.status_code == 404
    finally:
        conn.close()


def test_reindex_an_unmounted_library_is_400(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        added = client.post("/api/admin/libraries", json={"path": str(package_path)}).json()
        shutil.rmtree(package_path)

        response = client.post(f"/api/admin/libraries/{added['id']}/reindex", json={})

        assert response.status_code == 400
        assert "mounted" in response.json()["detail"]
    finally:
        conn.close()


def test_library_status_reads_only_app_db_once_indexed(tmp_path):
    # Remove the package after indexing so a correct asset_count/video_count/
    # people_count/last_indexed_at can only have come from app.db, not from
    # opening the (now-gone) library again.
    conn, client = _admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)
        added = client.post("/api/admin/libraries", json={"path": str(package_path)}).json()
        shutil.rmtree(package_path)

        response = client.get(f"/api/admin/libraries/{added['id']}/status")

        assert response.status_code == 200
        body = response.json()
        assert body["asset_count"] == 1
        assert body["video_count"] == 0
        assert body["people_count"] == 0
        assert body["last_indexed_at"] is not None
    finally:
        conn.close()


def test_non_admin_is_403_on_every_library_admin_route(tmp_path):
    conn, client = _non_admin_client(tmp_path)
    try:
        package_path = build_fixture_library(tmp_path)

        assert client.post("/api/admin/libraries", json={"path": str(package_path)}).status_code == 403
        assert client.get("/api/admin/libraries").status_code == 403
        assert client.patch("/api/admin/libraries/1", json={"display_name": "x"}).status_code == 403
        assert (
            client.delete("/api/admin/libraries/1", headers={"content-type": "application/json"}).status_code
            == 403
        )
        assert client.get("/api/admin/libraries/1/status").status_code == 403
        assert (
            client.post("/api/admin/libraries/1/reindex", headers={"content-type": "application/json"}).status_code
            == 403
        )
    finally:
        conn.close()
