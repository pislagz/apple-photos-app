"""P1.9: the read API for a library's indexed assets.

Every route reads only `app.db` rows inserted directly by these tests --
never a real `.photoslibrary` -- except where a route decodes an actual
file (`thumb`, `original`), which uses a tiny real image under `tmp_path`,
the same convention `test_media.py` uses for the P1.7 backend.
"""

from __future__ import annotations

import io

from fastapi.testclient import TestClient
from PIL import Image

from photos_viewer import app_db, media, session_auth
from photos_viewer.main import create_app

VALID_PASSWORD = "correct-horse-battery"


def _client(tmp_path):
    app = create_app()
    conn = app_db.connect(tmp_path / "data")
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    app.dependency_overrides[session_auth.get_media_cache_dir] = lambda: tmp_path / "media_cache"
    return conn, TestClient(app, base_url="https://testserver")


def _create_user(conn, username, *, role="user"):
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        (username, session_auth.hash_password(VALID_PASSWORD), role),
    )
    conn.commit()
    return conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()["id"]


def _create_library(conn, display_name, *, path):
    conn.execute("INSERT INTO libraries (display_name, path) VALUES (?, ?)", (display_name, str(path)))
    conn.commit()
    return conn.execute("SELECT id FROM libraries WHERE display_name = ?", (display_name,)).fetchone()["id"]


def _assign(conn, user_id, library_id):
    conn.execute("INSERT INTO library_assignments (user_id, library_id) VALUES (?, ?)", (user_id, library_id))
    conn.commit()


def _login(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": VALID_PASSWORD})
    assert response.status_code == 200, response.text


def _insert_asset(conn, library_id, asset_uuid, **overrides):
    columns = {
        "library_id": library_id,
        "uuid": asset_uuid,
        "filename": f"{asset_uuid}.jpg",
        "date_created": "2024-01-01T00:00:00",
        **overrides,
    }
    names = ", ".join(columns)
    placeholders = ", ".join("?" for _ in columns)
    conn.execute(f"INSERT INTO assets ({names}) VALUES ({placeholders})", tuple(columns.values()))
    conn.commit()
    return conn.execute(
        "SELECT id FROM assets WHERE library_id = ? AND uuid = ?", (library_id, asset_uuid)
    ).fetchone()["id"]


def test_me_lists_only_assigned_libraries(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        assigned = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _create_library(conn, "L2", path=tmp_path / "L2.photoslibrary")
        _assign(conn, user_id, assigned)
        _login(client, "alice")

        response = client.get("/api/me")

        assert response.status_code == 200
        body = response.json()
        assert body["username"] == "alice"
        assert body["role"] == "user"
        assert body["libraries"] == [{"id": assigned, "display_name": "L1"}]
    finally:
        conn.close()


def test_me_requires_authentication(tmp_path):
    _, client = _client(tmp_path)
    response = client.get("/api/me")
    assert response.status_code == 401


def test_list_assets_pagination_is_stable_against_inserts_above_the_cursor(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "newest", date_created="2024-01-03T00:00:00")
        _insert_asset(conn, library_id, "middle", date_created="2024-01-02T00:00:00")
        _insert_asset(conn, library_id, "oldest", date_created="2024-01-01T00:00:00")
        _login(client, "alice")

        first_page = client.get(f"/api/libraries/{library_id}/assets", params={"limit": 2})
        assert first_page.status_code == 200
        first_body = first_page.json()
        assert [item["id"] for item in first_body["items"]] == ["newest", "middle"]
        assert first_body["next_cursor"] is not None

        # Simulate a re-index inserting a row newer than anything paged so far --
        # it sorts "above" the cursor and must not perturb the next page.
        _insert_asset(conn, library_id, "inserted-later", date_created="2024-01-05T00:00:00")

        second_page = client.get(
            f"/api/libraries/{library_id}/assets", params={"limit": 2, "cursor": first_body["next_cursor"]}
        )
        assert second_page.status_code == 200
        second_body = second_page.json()
        assert [item["id"] for item in second_body["items"]] == ["oldest"]
        assert second_body["next_cursor"] is None
    finally:
        conn.close()


def test_list_assets_filters_by_type(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a-photo", is_video=0)
        _insert_asset(conn, library_id, "a-video", is_video=1)
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/assets", params={"type": "video"})

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["items"]] == ["a-video"]
    finally:
        conn.close()


def test_list_assets_album_filter_returns_empty_until_phase_2(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a-photo")
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/assets", params={"album": "anything"})

        assert response.status_code == 200
        assert response.json() == {"items": [], "next_cursor": None}
    finally:
        conn.close()


def test_summary_counts_by_year_month_day(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", date_created="2024-01-01T00:00:00")
        _insert_asset(conn, library_id, "b", date_created="2024-01-02T00:00:00")
        _insert_asset(conn, library_id, "c", date_created="2023-06-15T00:00:00")
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/summary")

        assert response.status_code == 200
        body = response.json()
        assert {"key": "2024", "count": 2} in body["years"]
        assert {"key": "2023", "count": 1} in body["years"]
        assert {"key": "2024-01", "count": 2} in body["months"]
        assert {"key": "2024-01-01", "count": 1} in body["days"]
    finally:
        conn.close()


def test_list_assets_does_not_return_a_next_cursor_on_an_exactly_full_last_page(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", date_created="2024-01-02T00:00:00")
        _insert_asset(conn, library_id, "b", date_created="2024-01-01T00:00:00")
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/assets", params={"limit": 2})

        assert response.status_code == 200
        body = response.json()
        assert [item["id"] for item in body["items"]] == ["a", "b"]
        assert body["next_cursor"] is None
    finally:
        conn.close()


def test_summary_buckets_by_local_day_not_utc_day(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        # Captured shortly before midnight in a negative-UTC-offset timezone,
        # so the UTC instant already rolled over to the next calendar day --
        # bucketing must use the photographer's local day, not the UTC day.
        _insert_asset(
            conn,
            library_id,
            "late-evening",
            date_created="2024-01-02T02:00:00Z",
            date_created_local_day="2024-01-01",
        )
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/summary")

        assert response.status_code == 200
        body = response.json()
        assert {"key": "2024-01-01", "count": 1} in body["days"]
        assert {"key": "2024-01-02", "count": 1} not in body["days"]
    finally:
        conn.close()


def test_list_assets_from_to_filters_by_local_day_not_utc_day(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(
            conn,
            library_id,
            "late-evening",
            date_created="2024-01-02T02:00:00Z",
            date_created_local_day="2024-01-01",
        )
        _login(client, "alice")

        included = client.get(
            f"/api/libraries/{library_id}/assets", params={"from": "2024-01-01", "to": "2024-01-01"}
        )
        assert included.status_code == 200
        assert [item["id"] for item in included.json()["items"]] == ["late-evening"]

        excluded = client.get(
            f"/api/libraries/{library_id}/assets", params={"from": "2024-01-02", "to": "2024-01-02"}
        )
        assert excluded.status_code == 200
        assert excluded.json()["items"] == []
    finally:
        conn.close()


def test_asset_detail_includes_people_and_albums(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        asset_row_id = _insert_asset(conn, library_id, "a", favorite=1)
        conn.execute(
            "INSERT INTO people (library_id, uuid, name, display_name) VALUES (?, 'p1', 'Alice', NULL)",
            (library_id,),
        )
        person_id = conn.execute("SELECT id FROM people WHERE uuid = 'p1'").fetchone()["id"]
        conn.execute("INSERT INTO asset_people (asset_id, person_id) VALUES (?, ?)", (asset_row_id, person_id))
        conn.execute("INSERT INTO albums (library_id, uuid, title) VALUES (?, 'al1', 'Trip')", (library_id,))
        album_id = conn.execute("SELECT id FROM albums WHERE uuid = 'al1'").fetchone()["id"]
        conn.execute("INSERT INTO asset_albums (asset_id, album_id) VALUES (?, ?)", (asset_row_id, album_id))
        conn.commit()
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/assets/a")

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == "a"
        assert body["favorite"] is True
        assert body["people"] == ["Alice"]
        assert body["albums"] == ["Trip"]
    finally:
        conn.close()


def test_asset_detail_cross_library_asset_id_404s(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        other_library_id = _create_library(conn, "L2", path=tmp_path / "L2.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, other_library_id, "in-l2")
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/assets/in-l2")

        assert response.status_code == 404
    finally:
        conn.close()


def test_asset_detail_unassigned_library_404s(tmp_path):
    conn, client = _client(tmp_path)
    try:
        _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _insert_asset(conn, library_id, "a")
        # alice is never assigned to L1.
        _create_user(conn, "bob")
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/assets/a")

        assert response.status_code == 404
    finally:
        conn.close()


def _library_root_with_jpeg(tmp_path, name="photo.jpg", *, size=(800, 600), content: bytes | None = None):
    library_path = tmp_path / "L1.photoslibrary"
    originals = library_path / "originals"
    originals.mkdir(parents=True, exist_ok=True)
    file_path = originals / name
    if content is not None:
        file_path.write_bytes(content)
    else:
        Image.new("RGB", size, color=(10, 20, 30)).save(file_path, format="JPEG")
    return library_path, file_path


def test_thumb_returns_generated_image(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    conn, client = _client(tmp_path)
    try:
        library_path, file_path = _library_root_with_jpeg(tmp_path)
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", path_original=str(file_path))
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/thumb/a", params={"size": "grid"})

        assert response.status_code == 200
        assert response.headers["content-type"] in ("image/webp", "image/jpeg")
        decoded = Image.open(io.BytesIO(response.content))
        assert max(decoded.size) <= media.SIZES["grid"]
    finally:
        conn.close()


def test_thumb_missing_source_404s(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_path = tmp_path / "L1.photoslibrary"
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a")  # no path_original, no path_derivative
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/thumb/a")

        assert response.status_code == 404
    finally:
        conn.close()


def test_thumb_unknown_asset_id_404s(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_path, _ = _library_root_with_jpeg(tmp_path)
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/thumb/does-not-exist")

        assert response.status_code == 404
    finally:
        conn.close()


def test_original_native_download_supports_range_206(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_path, file_path = _library_root_with_jpeg(tmp_path, content=b"0123456789")
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", path_original=str(file_path))
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/original/a", headers={"Range": "bytes=2-4"})

        assert response.status_code == 206
        assert response.content == b"234"
    finally:
        conn.close()


def test_original_edited_version_404s_when_path_edited_absent(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_path, file_path = _library_root_with_jpeg(tmp_path)
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", path_original=str(file_path))  # path_edited left NULL
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/original/a", params={"version": "edited"})

        assert response.status_code == 404
    finally:
        conn.close()


def test_original_format_jpeg_transcodes_heic(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    conn, client = _client(tmp_path)
    try:
        library_path = tmp_path / "L1.photoslibrary"
        originals = library_path / "originals"
        originals.mkdir(parents=True)
        heic_path = originals / "a.heic"
        buffer = io.BytesIO()
        Image.new("RGB", (32, 24), color=(120, 160, 200)).save(buffer, format="HEIF", quality=50)
        heic_path.write_bytes(buffer.getvalue())
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", path_original=str(heic_path))
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/original/a", params={"format": "jpeg"})

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        decoded = Image.open(io.BytesIO(response.content))
        assert decoded.format == "JPEG"
    finally:
        conn.close()


def test_livephoto_video_missing_404s(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_path, file_path = _library_root_with_jpeg(tmp_path)
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", path_original=str(file_path))  # no path_live_photo
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/livephoto/a/video")

        assert response.status_code == 404
    finally:
        conn.close()


def test_livephoto_video_downloads_the_recorded_file(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_path = tmp_path / "L1.photoslibrary"
        originals = library_path / "originals"
        originals.mkdir(parents=True)
        video_path = originals / "a.mov"
        video_path.write_bytes(b"not a real video, just bytes to serve")
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", path_live_photo=str(video_path))
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/livephoto/a/video")

        assert response.status_code == 200
        assert response.content == b"not a real video, just bytes to serve"
    finally:
        conn.close()


def test_library_routes_404_for_unassigned_user_and_401_for_anonymous(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_path, file_path = _library_root_with_jpeg(tmp_path)
        library_id = _create_library(conn, "L1", path=library_path)
        _insert_asset(conn, library_id, "a", path_original=str(file_path))
        _create_user(conn, "alice")  # never assigned

        anonymous_routes = [
            f"/api/libraries/{library_id}/assets",
            f"/api/libraries/{library_id}/summary",
            f"/api/libraries/{library_id}/assets/a",
            f"/api/libraries/{library_id}/thumb/a",
            f"/api/libraries/{library_id}/original/a",
            f"/api/libraries/{library_id}/livephoto/a/video",
        ]
        for route in anonymous_routes:
            assert client.get(route).status_code == 401

        _login(client, "alice")
        for route in anonymous_routes:
            assert client.get(route).status_code == 404
    finally:
        conn.close()
