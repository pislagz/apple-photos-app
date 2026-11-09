"""P3.2: streamed zip of selected originals."""

from __future__ import annotations

import io
import zipfile

from PIL import Image

from photos_viewer import app_db, media
from tests.test_library_assets import (
    _assign,
    _client,
    _create_library,
    _create_user,
    _insert_asset,
    _login,
    _unlock_hidden,
)


def _setup(tmp_path, files: dict[str, bytes], **asset_overrides):
    conn, client = _client(tmp_path)
    library_path = tmp_path / "L1.photoslibrary"
    originals = library_path / "originals"
    originals.mkdir(parents=True)
    user_id = _create_user(conn, "alice")
    library_id = _create_library(conn, "L1", path=library_path)
    _assign(conn, user_id, library_id)
    for uuid, data in files.items():
        path = originals / f"{uuid}.bin"
        path.write_bytes(data)
        _insert_asset(
            conn,
            library_id,
            uuid,
            path_original=str(path),
            original_filename="IMG_0001.JPG",
            **asset_overrides,
        )
    _login(client, "alice")
    return conn, client, library_id, library_path


def _tree(root):
    return sorted(
        (str(p.relative_to(root)), p.stat().st_mtime_ns, p.stat().st_size)
        for p in root.rglob("*")
    )


def test_zip_streams_valid_archive_with_unique_names_and_identical_bytes(tmp_path):
    files = {"a": b"alpha" * 1000, "b": b"bravo" * 500, "c": bytes(range(256)) * 10}
    conn, client, lib, library_path = _setup(tmp_path, files)
    try:
        before = _tree(library_path)
        response = client.post(
            f"/api/libraries/{lib}/zip", json={"asset_ids": ["a", "b", "c", "a"]}
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"
        assert response.headers["x-zip-total-bytes"] == str(
            sum(len(v) for v in files.values())
        )
        archive = zipfile.ZipFile(io.BytesIO(response.content))
        assert archive.testzip() is None
        names = archive.namelist()
        assert len(names) == 3 and len({n.lower() for n in names}) == 3
        assert names[:2] == ["IMG_0001.JPG", "IMG_0001 (2).JPG"]
        assert [archive.read(n) for n in names] == [files["a"], files["b"], files["c"]]
        assert all(i.compress_type == zipfile.ZIP_STORED for i in archive.infolist())
        assert _tree(library_path) == before
    finally:
        conn.close()


def test_zip_over_limit_is_413_before_streaming_and_leaves_no_files(tmp_path):
    conn, client, lib, library_path = _setup(
        tmp_path, {"a": b"x" * 600, "b": b"y" * 600}
    )
    try:
        app_db.set_setting(conn, "zip_size_limit_bytes", "1000")
        before_lib = _tree(library_path)
        before_data = _tree(tmp_path)
        response = client.post(
            f"/api/libraries/{lib}/zip", json={"asset_ids": ["a", "b"]}
        )
        assert response.status_code == 413
        assert "zip limit" in response.json()["detail"]
        assert not response.content.startswith(b"PK")
        assert _tree(library_path) == before_lib
        assert _tree(tmp_path) == before_data
        assert (
            conn.execute("SELECT * FROM audit_log WHERE action = 'zip'").fetchone()
            is None
        )
        # within the limit it works
        assert (
            client.post(
                f"/api/libraries/{lib}/zip", json={"asset_ids": ["a"]}
            ).status_code
            == 200
        )
    finally:
        conn.close()


def test_zip_writes_one_audit_row(tmp_path):
    conn, client, lib, _ = _setup(tmp_path, {"a": b"1", "b": b"22"})
    try:
        client.post(f"/api/libraries/{lib}/zip", json={"asset_ids": ["a", "b"]})
        rows = conn.execute("SELECT * FROM audit_log WHERE action = 'zip'").fetchall()
        assert len(rows) == 1
        assert (
            rows[0]["library_id"] == lib
            and "count=2" in rows[0]["detail"]
            and "bytes=3" in rows[0]["detail"]
        )
    finally:
        conn.close()


def test_zip_with_unknown_or_foreign_id_is_404_without_audit(tmp_path):
    conn, client, lib, _ = _setup(tmp_path, {"a": b"1"})
    try:
        other = _create_library(conn, "L2", path=tmp_path / "L2.photoslibrary")
        _insert_asset(conn, other, "z", path_original=str(tmp_path / "nope"))
        for ids in (["a", "z"], ["a", "missing"]):
            assert (
                client.post(
                    f"/api/libraries/{lib}/zip", json={"asset_ids": ids}
                ).status_code
                == 404
            )
        assert (
            client.post(
                f"/api/libraries/{other}/zip", json={"asset_ids": ["z"]}
            ).status_code
            == 404
        )
        assert (
            conn.execute("SELECT * FROM audit_log WHERE action = 'zip'").fetchone()
            is None
        )
    finally:
        conn.close()


def test_zip_hidden_asset_needs_unlock(tmp_path):
    conn, client, lib, _ = _setup(tmp_path, {"a": b"1"}, hidden=1)
    try:
        locked = client.post(f"/api/libraries/{lib}/zip", json={"asset_ids": ["a"]})
        assert locked.status_code in (403, 404)
        assert not locked.content.startswith(b"PK")
        _unlock_hidden(client)
        assert (
            client.post(
                f"/api/libraries/{lib}/zip", json={"asset_ids": ["a"]}
            ).status_code
            == 200
        )
    finally:
        conn.close()


def test_zip_requires_ids(tmp_path):
    conn, client, lib, _ = _setup(tmp_path, {"a": b"1"})
    try:
        assert (
            client.post(f"/api/libraries/{lib}/zip", json={"asset_ids": []}).status_code
            == 422
        )
    finally:
        conn.close()


def test_zip_format_jpeg_converts_heic_and_keeps_other_files(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    conn, client, lib, library_path = _setup(tmp_path, {"b": b"plain"})
    try:
        buffer = io.BytesIO()
        Image.new("RGB", (32, 24), color=(120, 160, 200)).save(
            buffer, format="HEIF", quality=50
        )
        heic = library_path / "originals" / "a.heic"
        heic.write_bytes(buffer.getvalue())
        _insert_asset(
            conn, lib, "a", path_original=str(heic), original_filename="IMG_9.HEIC"
        )
        response = client.post(
            f"/api/libraries/{lib}/zip",
            json={"asset_ids": ["a", "b"], "format": "jpeg"},
        )
        assert response.status_code == 200
        archive = zipfile.ZipFile(io.BytesIO(response.content))
        assert archive.namelist() == ["IMG_9.jpg", "IMG_0001.JPG"]
        assert Image.open(io.BytesIO(archive.read("IMG_9.jpg"))).format == "JPEG"
        assert archive.read("IMG_0001.JPG") == b"plain"
    finally:
        conn.close()
