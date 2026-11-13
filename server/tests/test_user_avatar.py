"""#256: avatar endpoints -- access enforcement, remove, missing-file fallback."""

from __future__ import annotations

import io

from PIL import Image

from photos_viewer import media, session_auth
from tests.test_library_assets import (
    _assign,
    _client,
    _create_library,
    _create_user,
    _insert_asset,
    _library_root_with_jpeg,
    _login,
)

CROP = {"x": 0.1, "y": 0.0, "width": 0.75, "height": 1.0}


def _setup(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    conn, client = _client(tmp_path)
    client.app.dependency_overrides[session_auth.get_data_dir] = lambda: tmp_path
    library_path, file_path = _library_root_with_jpeg(tmp_path)
    alice = _create_user(conn, "alice")
    bob = _create_user(conn, "bob")
    l1 = _create_library(conn, "L1", path=library_path)
    l2 = _create_library(conn, "L2", path=tmp_path / "L2.photoslibrary")
    _assign(conn, alice, l1)
    _assign(conn, bob, l2)
    _insert_asset(conn, l1, "a", path_original=str(file_path))
    _insert_asset(conn, l2, "b")
    _insert_asset(conn, l1, "h", path_original=str(file_path), hidden=1)
    return conn, client, l1, l2, file_path


def test_set_avatar_stores_a_256px_square_others_can_read(tmp_path, monkeypatch):
    conn, client, l1, _l2, _file = _setup(tmp_path, monkeypatch)
    try:
        _login(client, "alice")
        response = client.put(
            "/api/me/avatar", json={"library_id": l1, "asset_id": "a", **CROP}
        )
        assert response.status_code == 200, response.text
        version = response.json()["avatar_version"]
        assert client.get("/api/me").json()["avatar_version"] == version

        client.post("/api/auth/logout")
        _login(client, "bob")
        seen = client.get("/api/users/alice/avatar")
        assert seen.status_code == 200
        assert seen.headers["content-type"] == "image/jpeg"
        assert Image.open(io.BytesIO(seen.content)).size == (256, 256)
        assert client.get("/api/me").json()["avatar_version"] is None
    finally:
        conn.close()


def test_avatar_from_foreign_library_or_unknown_asset_404s(tmp_path, monkeypatch):
    conn, client, l1, l2, _file = _setup(tmp_path, monkeypatch)
    try:
        _login(client, "alice")
        for body in (
            {"library_id": l2, "asset_id": "b"},
            {"library_id": l2, "asset_id": "a"},
            {"library_id": l1, "asset_id": "b"},
            {"library_id": l1, "asset_id": "nope"},
            {"library_id": l1, "asset_id": "h"},
            {"library_id": 9999, "asset_id": "a"},
        ):
            response = client.put("/api/me/avatar", json={**body, **CROP})
            assert response.status_code == 404, body
        assert client.get("/api/me").json()["avatar_version"] is None
    finally:
        conn.close()


def test_admin_cannot_use_unassigned_library(tmp_path, monkeypatch):
    conn, client, _l1, l2, _file = _setup(tmp_path, monkeypatch)
    try:
        _create_user(conn, "root", role="admin")
        _login(client, "root")
        response = client.put(
            "/api/me/avatar", json={"library_id": l2, "asset_id": "b", **CROP}
        )
        assert response.status_code == 404
    finally:
        conn.close()


def test_avatar_requires_login_and_valid_crop(tmp_path, monkeypatch):
    conn, client, l1, _l2, _file = _setup(tmp_path, monkeypatch)
    try:
        body = {"library_id": l1, "asset_id": "a", **CROP}
        assert client.put("/api/me/avatar", json=body).status_code == 401
        assert client.delete("/api/me/avatar").status_code == 401
        assert client.get("/api/users/alice/avatar").status_code == 401
        _login(client, "alice")
        bad = {**body, "x": 0.5, "width": 0.9}
        assert client.put("/api/me/avatar", json=bad).status_code == 422
    finally:
        conn.close()


def test_avatar_survives_source_removal_and_access_loss(tmp_path, monkeypatch):
    conn, client, l1, _l2, file_path = _setup(tmp_path, monkeypatch)
    try:
        _login(client, "alice")
        client.put("/api/me/avatar", json={"library_id": l1, "asset_id": "a", **CROP})
        file_path.unlink()
        conn.execute("DELETE FROM library_assignments WHERE library_id = ?", (l1,))
        conn.execute("DELETE FROM assets WHERE library_id = ?", (l1,))
        conn.commit()
        assert client.get("/api/users/alice/avatar").status_code == 200
    finally:
        conn.close()


def test_remove_avatar(tmp_path, monkeypatch):
    conn, client, l1, _l2, _file = _setup(tmp_path, monkeypatch)
    try:
        _login(client, "alice")
        client.put("/api/me/avatar", json={"library_id": l1, "asset_id": "a", **CROP})
        assert client.delete("/api/me/avatar").status_code == 204
        assert client.get("/api/me").json()["avatar_version"] is None
        assert client.get("/api/users/alice/avatar").status_code == 404
        assert not (tmp_path / "avatars" / "1.jpg").exists()
    finally:
        conn.close()


def test_missing_avatar_file_is_a_404_not_an_error(tmp_path, monkeypatch):
    conn, client, l1, _l2, _file = _setup(tmp_path, monkeypatch)
    try:
        _login(client, "alice")
        client.put("/api/me/avatar", json={"library_id": l1, "asset_id": "a", **CROP})
        for f in (tmp_path / "avatars").glob("*.jpg"):
            f.unlink()
        assert client.get("/api/users/alice/avatar").status_code == 404
        assert client.get("/api/users/nobody/avatar").status_code == 404
    finally:
        conn.close()
