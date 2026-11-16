"""Library picker: configured folders, candidate listing, and its limits."""

from __future__ import annotations

import os
import shutil

from photos_viewer import library_folders
from tests.fixtures import build_fixture_library
from tests.test_library_admin import _admin_client, _non_admin_client


def _make_package(folder, name):
    package = folder / name
    (package / "database").mkdir(parents=True)
    (package / "database" / "Photos.sqlite").write_bytes(b"x" * 10)
    return package


def test_folders_are_seeded_from_the_environment(tmp_path, monkeypatch):
    root = tmp_path / "mount"
    root.mkdir()
    monkeypatch.setenv(library_folders.LIBRARIES_DIR_ENV, str(root))
    conn, client = _admin_client(tmp_path / "data")
    try:
        response = client.get("/api/admin/library-folders")
        assert response.json() == [{"path": str(root.resolve()), "reachable": True}]
    finally:
        conn.close()


def test_add_and_remove_a_folder(tmp_path, monkeypatch):
    monkeypatch.delenv(library_folders.LIBRARIES_DIR_ENV, raising=False)
    monkeypatch.setattr(library_folders, "DOCKER_MOUNT", tmp_path / "nope")
    folder = tmp_path / "photos"
    folder.mkdir()
    conn, client = _admin_client(tmp_path / "data")
    try:
        assert client.get("/api/admin/library-folders").json() == []
        added = client.post("/api/admin/library-folders", json={"path": str(folder)})
        assert [f["path"] for f in added.json()] == [str(folder.resolve())]
        # Adding twice does not duplicate.
        again = client.post("/api/admin/library-folders", json={"path": str(folder)})
        assert len(again.json()) == 1
        removed = client.delete(
            "/api/admin/library-folders", params={"path": str(folder.resolve())}
        )
        assert removed.json() == []
        gone = client.delete(
            "/api/admin/library-folders", params={"path": str(folder.resolve())}
        )
        assert gone.status_code == 404
    finally:
        conn.close()


def test_add_folder_rejects_missing_paths_and_the_filesystem_root(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        missing = client.post(
            "/api/admin/library-folders", json={"path": str(tmp_path / "nope")}
        )
        assert missing.status_code == 400
        root = client.post("/api/admin/library-folders", json={"path": "/"})
        assert root.status_code == 400
        blank = client.post("/api/admin/library-folders", json={"path": "  "})
        assert blank.status_code == 400
    finally:
        conn.close()


def test_candidates_list_every_package_in_every_folder(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    _make_package(a, "Family.photoslibrary")
    _make_package(b, "Trips.photoslibrary")
    (a / "notes.txt").write_text("x")
    (a / "folder").mkdir()
    _make_package(a, ".Hidden.photoslibrary")
    conn, client = _admin_client(tmp_path / "data")
    try:
        for folder in (a, b):
            client.post("/api/admin/library-folders", json={"path": str(folder)})
        body = client.get("/api/admin/library-candidates").json()
        assert [c["name"] for c in body["candidates"]] == [
            "Family.photoslibrary",
            "Trips.photoslibrary",
        ]
        assert all(c["status"] == "not_added" for c in body["candidates"])
        assert all(c["size_bytes"] is None for c in body["candidates"])
    finally:
        conn.close()


def test_candidates_mark_registered_libraries_as_ready(tmp_path):
    folder = tmp_path / "libs"
    folder.mkdir()
    package = build_fixture_library(folder)
    conn, client = _admin_client(tmp_path / "data")
    try:
        client.post("/api/admin/library-folders", json={"path": str(folder)})
        client.post("/api/admin/libraries", json={"path": str(package)})
        (candidate,) = client.get("/api/admin/library-candidates").json()["candidates"]
        assert candidate["registered"] is True
        assert candidate["status"] == "ready"
        assert candidate["library_id"] is not None
    finally:
        conn.close()


def test_symlink_leading_outside_the_folder_is_not_listed(tmp_path):
    folder = tmp_path / "libs"
    folder.mkdir()
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    _make_package(outside, "Secret.photoslibrary")
    os.symlink(outside / "Secret.photoslibrary", folder / "Sneaky.photoslibrary")
    _make_package(folder, "Real.photoslibrary")
    conn, client = _admin_client(tmp_path / "data")
    try:
        client.post("/api/admin/library-folders", json={"path": str(folder)})
        names = [
            c["name"]
            for c in client.get("/api/admin/library-candidates").json()["candidates"]
        ]
        assert names == ["Real.photoslibrary"]
    finally:
        conn.close()


def test_listing_is_not_recursive(tmp_path):
    folder = tmp_path / "libs"
    _make_package(folder / "deeper", "Deep.photoslibrary")
    conn, client = _admin_client(tmp_path / "data")
    try:
        client.post("/api/admin/library-folders", json={"path": str(folder)})
        body = client.get("/api/admin/library-candidates").json()
        assert body["candidates"] == []
    finally:
        conn.close()


def test_size_is_computed_for_listed_packages_only(tmp_path):
    folder = tmp_path / "libs"
    folder.mkdir()
    package = _make_package(folder, "Family.photoslibrary")
    (package / "originals").mkdir()
    (package / "originals" / "a.jpg").write_bytes(b"y" * 90)
    other = tmp_path / "other"
    other.mkdir()
    conn, client = _admin_client(tmp_path / "data")
    try:
        client.post("/api/admin/library-folders", json={"path": str(folder)})
        ok = client.get(
            "/api/admin/library-candidates/size", params={"path": str(package)}
        )
        assert ok.json()["size_bytes"] == 100
        for bad in (str(other), str(folder / ".." / "other"), "/etc", str(folder)):
            r = client.get("/api/admin/library-candidates/size", params={"path": bad})
            assert r.status_code == 404
    finally:
        conn.close()


def test_folder_endpoints_are_admin_only(tmp_path):
    conn, client = _non_admin_client(tmp_path)
    try:
        assert client.get("/api/admin/library-folders").status_code == 403
        assert client.get("/api/admin/library-candidates").status_code == 403
        assert (
            client.get(
                "/api/admin/library-candidates/size", params={"path": "/"}
            ).status_code
            == 403
        )
        assert (
            client.post("/api/admin/library-folders", json={"path": "/tmp"}).status_code
            == 403
        )
        assert (
            client.delete(
                "/api/admin/library-folders", params={"path": "/tmp"}
            ).status_code
            == 403
        )
    finally:
        conn.close()


def test_missing_typed_path_says_what_was_found_nearby(tmp_path):
    folder = tmp_path / "libs"
    folder.mkdir()
    shutil.copytree(
        build_fixture_library(tmp_path / "src"), folder / "Family.photoslibrary"
    )
    conn, client = _admin_client(tmp_path / "data")
    try:
        client.post("/api/admin/library-folders", json={"path": str(folder)})
        close = client.post(
            "/api/admin/libraries",
            json={"path": str(folder / "Famly.photoslibrary")},
        )
        assert close.status_code == 400
        assert "Did you mean Family.photoslibrary" in close.json()["detail"]
        far = client.post(
            "/api/admin/libraries", json={"path": str(folder / "Zzzzz.photoslibrary")}
        )
        assert "Libraries that were found: Family.photoslibrary" in far.json()["detail"]
    finally:
        conn.close()


def test_missing_typed_path_with_no_folders_says_none_found(tmp_path, monkeypatch):
    monkeypatch.delenv(library_folders.LIBRARIES_DIR_ENV, raising=False)
    monkeypatch.setattr(library_folders, "DOCKER_MOUNT", tmp_path / "nope")
    conn, client = _admin_client(tmp_path / "data")
    try:
        response = client.post(
            "/api/admin/libraries", json={"path": str(tmp_path / "X.photoslibrary")}
        )
        assert "No libraries found. Add a folder" in response.json()["detail"]
    finally:
        conn.close()


def _scan_client(tmp_path, monkeypatch):
    monkeypatch.delenv(library_folders.LIBRARIES_DIR_ENV, raising=False)
    monkeypatch.setattr(library_folders, "DOCKER_MOUNT", tmp_path / "nope")
    return _admin_client(tmp_path / "data")


def test_unreadable_folder_is_reported_unreachable(tmp_path, monkeypatch):
    folder = tmp_path / "locked"
    folder.mkdir()
    _make_package(folder, "Family.photoslibrary")
    conn, client = _scan_client(tmp_path, monkeypatch)
    try:
        client.post("/api/admin/library-folders", json={"path": str(folder)})
        folder.chmod(0)
        try:
            body = client.get("/api/admin/library-candidates").json()
        finally:
            folder.chmod(0o755)
        # root ignores permission bits, so only assert for other users.
        if os.geteuid() != 0:
            assert body["candidates"] == []
            assert body["folders"][0]["reachable"] is False
    finally:
        conn.close()


def test_regular_file_named_photoslibrary_is_not_listed(tmp_path, monkeypatch):
    folder = tmp_path / "photos"
    folder.mkdir()
    (folder / "Fake.photoslibrary").write_text("not a package")
    _make_package(folder, "Real.photoslibrary")
    conn, client = _scan_client(tmp_path, monkeypatch)
    try:
        client.post("/api/admin/library-folders", json={"path": str(folder)})
        body = client.get("/api/admin/library-candidates").json()
        assert [c["name"] for c in body["candidates"]] == ["Real.photoslibrary"]
    finally:
        conn.close()


def test_missing_folder_is_unreachable_and_lists_nothing(tmp_path, monkeypatch):
    folder = tmp_path / "drive"
    folder.mkdir()
    conn, client = _scan_client(tmp_path, monkeypatch)
    try:
        client.post("/api/admin/library-folders", json={"path": str(folder)})
        folder.rmdir()
        body = client.get("/api/admin/library-candidates").json()
        assert body["candidates"] == []
        assert body["folders"] == [{"path": str(folder.resolve()), "reachable": False}]
    finally:
        conn.close()


def test_library_endpoints_need_a_session(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        client.post("/api/auth/logout")
        client.cookies.clear()
        for method, url in [
            ("get", "/api/admin/library-folders"),
            ("get", "/api/admin/library-candidates"),
            ("get", "/api/admin/library-candidates/size?path=/x"),
            ("post", "/api/admin/libraries/from-scan"),
        ]:
            kwargs = {"json": {"candidate_path": "/x"}} if method == "post" else {}
            response = getattr(client, method)(url, **kwargs)
            assert response.status_code == 401, url
    finally:
        conn.close()


def test_add_from_scan_accepts_listed_and_rejects_other_paths(tmp_path, monkeypatch):
    folder = tmp_path / "photos"
    folder.mkdir()
    package = tmp_path / "elsewhere" / "Other.photoslibrary"
    built = build_fixture_library(tmp_path / "src")
    shutil.copytree(built, folder / "Fixture.photoslibrary")
    shutil.copytree(built, package)
    conn, client = _scan_client(tmp_path, monkeypatch)
    try:
        client.post("/api/admin/library-folders", json={"path": str(folder)})
        outside = client.post(
            "/api/admin/libraries/from-scan", json={"candidate_path": str(package)}
        )
        assert outside.status_code == 400
        assert conn.execute("SELECT COUNT(*) FROM libraries").fetchone()[0] == 0
        listed = (folder / "Fixture.photoslibrary").resolve()
        ok = client.post(
            "/api/admin/libraries/from-scan",
            json={"candidate_path": str(listed), "display_name": "Fixture"},
        )
        assert ok.status_code == 201
        assert ok.json()["path"] == str(listed)
    finally:
        conn.close()


def test_add_from_scan_is_admin_only(tmp_path):
    conn, client = _non_admin_client(tmp_path)
    try:
        response = client.post(
            "/api/admin/libraries/from-scan", json={"candidate_path": "/x"}
        )
        assert response.status_code == 403
    finally:
        conn.close()
