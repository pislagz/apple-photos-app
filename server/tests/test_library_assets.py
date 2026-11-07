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


def _unlock_hidden(client):
    response = client.post("/api/auth/reconfirm-password", json={"password": VALID_PASSWORD})
    assert response.status_code == 204, response.text


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


def test_me_defaults_to_no_layout_override(tmp_path):
    conn, client = _client(tmp_path)
    try:
        _create_user(conn, "alice")
        _login(client, "alice")

        assert client.get("/api/me").json()["layout_override"] is None
    finally:
        conn.close()


def test_layout_override_is_stored_server_side(tmp_path):
    """Issue #53: the layout choice is per-user state on the server, not
    just in the browser's localStorage, so it follows the user across
    devices. localStorage is only a fast default while `/api/me` loads."""
    conn, client = _client(tmp_path)
    try:
        _create_user(conn, "alice")
        _login(client, "alice")

        response = client.put("/api/me/layout-override", json={"layout_override": "mobile"})
        assert response.status_code == 204

        assert client.get("/api/me").json()["layout_override"] == "mobile"

        client.put("/api/me/layout-override", json={"layout_override": None})
        assert client.get("/api/me").json()["layout_override"] is None
    finally:
        conn.close()


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


def test_list_assets_excludes_hidden(tmp_path):
    """P1.13: hidden assets never appear in `/assets` -- only in `/hidden`."""
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "visible")
        _insert_asset(conn, library_id, "hidden-one", hidden=1)
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/assets")

        assert response.status_code == 200
        assert [item["id"] for item in response.json()["items"]] == ["visible"]
    finally:
        conn.close()


def test_list_assets_album_and_person_filters_stay_empty_with_a_hidden_asset(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "hidden-one", hidden=1)
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/assets", params={"album": "anything"})

        assert response.status_code == 200
        assert response.json() == {"items": [], "next_cursor": None}
    finally:
        conn.close()


def test_hidden_endpoint_lists_only_hidden_and_respects_type_filter(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "visible")
        _insert_asset(conn, library_id, "hidden-photo", hidden=1, is_video=0)
        _insert_asset(conn, library_id, "hidden-video", hidden=1, is_video=1)
        _login(client, "alice")
        _unlock_hidden(client)

        response = client.get(f"/api/libraries/{library_id}/hidden")

        assert response.status_code == 200
        assert {item["id"] for item in response.json()["items"]} == {"hidden-photo", "hidden-video"}

        filtered = client.get(f"/api/libraries/{library_id}/hidden", params={"type": "video"})
        assert filtered.status_code == 200
        assert [item["id"] for item in filtered.json()["items"]] == ["hidden-video"]
    finally:
        conn.close()


def test_hidden_endpoint_pagination_cursor_works_like_assets(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "newest", hidden=1, date_created="2024-01-03T00:00:00")
        _insert_asset(conn, library_id, "oldest", hidden=1, date_created="2024-01-01T00:00:00")
        _login(client, "alice")
        _unlock_hidden(client)

        first_page = client.get(f"/api/libraries/{library_id}/hidden", params={"limit": 1})
        assert first_page.status_code == 200
        first_body = first_page.json()
        assert [item["id"] for item in first_body["items"]] == ["newest"]
        assert first_body["next_cursor"] is not None

        second_page = client.get(
            f"/api/libraries/{library_id}/hidden", params={"limit": 1, "cursor": first_body["next_cursor"]}
        )
        assert second_page.status_code == 200
        assert [item["id"] for item in second_page.json()["items"]] == ["oldest"]
    finally:
        conn.close()


def test_asset_detail_thumb_and_original_work_for_a_hidden_asset(tmp_path, monkeypatch):
    """Hidden assets stay viewable by uuid -- only *lists* exclude them. Their
    metadata and media need the Hidden unlock (#151)."""
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    conn, client = _client(tmp_path)
    try:
        library_path, file_path = _library_root_with_jpeg(tmp_path)
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", hidden=1, path_original=str(file_path))
        _login(client, "alice")

        assert client.get(f"/api/libraries/{library_id}/assets/a").status_code == 403

        _unlock_hidden(client)
        detail = client.get(f"/api/libraries/{library_id}/assets/a")
        assert detail.status_code == 200
        assert detail.json()["hidden"] is True
        assert client.get(f"/api/libraries/{library_id}/thumb/a").status_code == 200
        assert client.get(f"/api/libraries/{library_id}/original/a").status_code == 200
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
        years_2024 = next(bucket for bucket in body["years"] if bucket["key"] == "2024")
        assert years_2024["count"] == 2
        assert set(years_2024["key_asset_ids"]) == {"a", "b"}
        years_2023 = next(bucket for bucket in body["years"] if bucket["key"] == "2023")
        assert years_2023["count"] == 1
        assert years_2023["key_asset_ids"] == ["c"]
        months_2024_01 = next(bucket for bucket in body["months"] if bucket["key"] == "2024-01")
        assert months_2024_01["count"] == 2
        assert set(months_2024_01["key_asset_ids"]) == {"a", "b"}
        assert {"key": "2024-01-01", "count": 1} in body["days"]
    finally:
        conn.close()


def test_summary_key_asset_ids_rank_favorite_then_score_then_recency_and_cap_at_five(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        # Lower score but favorited -- outranks every non-favorite.
        _insert_asset(conn, library_id, "favorite", date_created="2024-01-01T00:00:00", favorite=1, score=0.1)
        _insert_asset(conn, library_id, "high-score", date_created="2024-01-02T00:00:00", score=0.9)
        _insert_asset(conn, library_id, "low-score", date_created="2024-01-03T00:00:00", score=0.2)
        _insert_asset(conn, library_id, "no-score", date_created="2024-01-04T00:00:00")
        for day in range(5, 9):
            _insert_asset(conn, library_id, f"filler-{day}", date_created=f"2024-01-0{day}T00:00:00")
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/summary")

        assert response.status_code == 200
        body = response.json()
        months_2024_01 = next(bucket for bucket in body["months"] if bucket["key"] == "2024-01")
        assert months_2024_01["count"] == 8
        assert months_2024_01["key_asset_ids"] == ["favorite", "high-score", "low-score", "filler-8", "filler-7"]
    finally:
        conn.close()


def test_summary_excludes_hidden(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "visible", date_created="2024-01-01T00:00:00")
        _insert_asset(conn, library_id, "hidden-one", date_created="2024-01-01T00:00:00", hidden=1)
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/summary")

        assert response.status_code == 200
        body = response.json()
        years_2024 = next(bucket for bucket in body["years"] if bucket["key"] == "2024")
        assert years_2024["count"] == 1
        assert years_2024["key_asset_ids"] == ["visible"]
        months_2024_01 = next(bucket for bucket in body["months"] if bucket["key"] == "2024-01")
        assert months_2024_01["count"] == 1
        assert months_2024_01["key_asset_ids"] == ["visible"]
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


def test_asset_detail_includes_camera_make_and_model(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", camera_make="Apple", camera_model="iPhone 15 Pro")
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/assets/a")

        assert response.status_code == 200
        body = response.json()
        assert body["camera_make"] == "Apple"
        assert body["camera_model"] == "iPhone 15 Pro"
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


def _dominant_channel(data: bytes) -> str:
    decoded = Image.open(io.BytesIO(data)).convert("RGB")
    r, g, b = decoded.resize((1, 1)).getpixel((0, 0))
    return max(("r", r), ("g", g), ("b", b), key=lambda pair: pair[1])[0]


def test_thumb_prefers_edited_version_when_present(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    conn, client = _client(tmp_path)
    try:
        library_path, original_path = _library_root_with_jpeg(tmp_path, name="original.jpg")
        edited_path = original_path.parent / "edited.jpg"
        Image.new("RGB", (800, 600), color=(200, 60, 10)).save(edited_path, format="JPEG")
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", path_original=str(original_path), path_edited=str(edited_path))
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/thumb/a", params={"size": "grid"})

        assert response.status_code == 200
        assert _dominant_channel(response.content) == "r"  # edited.jpg's (200, 60, 10), not original's (10, 20, 30)
    finally:
        conn.close()


def test_thumb_reverts_to_original_after_edit_removed_with_no_stale_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    conn, client = _client(tmp_path)
    try:
        library_path, original_path = _library_root_with_jpeg(tmp_path, name="original.jpg")
        edited_path = original_path.parent / "edited.jpg"
        Image.new("RGB", (800, 600), color=(200, 60, 10)).save(edited_path, format="JPEG")
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        asset_pk = _insert_asset(
            conn, library_id, "a", path_original=str(original_path), path_edited=str(edited_path)
        )
        _login(client, "alice")

        edited_response = client.get(f"/api/libraries/{library_id}/thumb/a", params={"size": "grid"})
        assert _dominant_channel(edited_response.content) == "r"

        # A re-index that picks up a revert clears path_edited via the same
        # upsert that set it (indexer.py) -- simulate that directly.
        conn.execute("UPDATE assets SET path_edited = NULL WHERE id = ?", (asset_pk,))
        conn.commit()

        reverted_response = client.get(f"/api/libraries/{library_id}/thumb/a", params={"size": "grid"})

        assert reverted_response.status_code == 200
        assert _dominant_channel(reverted_response.content) == "b"  # original.jpg's (10, 20, 30)
        assert reverted_response.content != edited_response.content
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


def test_original_version_param_selects_edited_or_original_bytes(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_path = tmp_path / "L1.photoslibrary"
        originals = library_path / "originals"
        originals.mkdir(parents=True)
        original_path = originals / "a.jpg"
        original_path.write_bytes(b"original bytes")
        edited_path = originals / "a_edited.jpg"
        edited_path.write_bytes(b"edited bytes")
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", path_original=str(original_path), path_edited=str(edited_path))
        _login(client, "alice")

        # The route itself always defaults to "original" -- the P1.17b
        # edited-by-default behaviour lives in the client, which passes
        # `version=edited` explicitly once it knows `has_edited` is true.
        default_response = client.get(f"/api/libraries/{library_id}/original/a")
        edited_response = client.get(f"/api/libraries/{library_id}/original/a", params={"version": "edited"})

        assert default_response.content == b"original bytes"
        assert edited_response.content == b"edited bytes"
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


def test_original_download_writes_an_audit_row(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_path, file_path = _library_root_with_jpeg(tmp_path)
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        asset_pk = _insert_asset(conn, library_id, "a", path_original=str(file_path))
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/original/a", params={"download": "1"})

        assert response.status_code == 200
        row = conn.execute("SELECT * FROM audit_log WHERE action = 'download'").fetchone()
        assert row is not None
        assert row["user_id"] == user_id
        assert row["library_id"] == library_id
        assert row["asset_id"] == asset_pk
        assert row["detail"] == "version=original"
    finally:
        conn.close()


def test_original_without_download_marker_writes_no_audit_row(tmp_path):
    # Viewer zoom and the HEIC->JPEG fallback hit the same route without the
    # explicit marker a Download/share click sends -- this is what a zoom
    # request looks like, and it must not be recorded as a download.
    conn, client = _client(tmp_path)
    try:
        library_path, file_path = _library_root_with_jpeg(tmp_path)
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", path_original=str(file_path))
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/original/a")

        assert response.status_code == 200
        assert conn.execute("SELECT * FROM audit_log WHERE action = 'download'").fetchone() is None
    finally:
        conn.close()


def test_original_download_marker_writes_exactly_one_audit_row(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_path, file_path = _library_root_with_jpeg(tmp_path)
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "a", path_original=str(file_path))
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/original/a", params={"download": "1"})

        assert response.status_code == 200
        rows = conn.execute("SELECT * FROM audit_log WHERE action = 'download'").fetchall()
        assert len(rows) == 1
    finally:
        conn.close()


def test_original_download_of_another_users_library_404s_and_writes_no_audit_row(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_path, file_path = _library_root_with_jpeg(tmp_path)
        library_id = _create_library(conn, "L2", path=library_path)
        _insert_asset(conn, library_id, "a", path_original=str(file_path))
        owner_id = _create_user(conn, "bob")
        _assign(conn, owner_id, library_id)
        _create_user(conn, "alice")  # never assigned to L2
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/original/a")

        assert response.status_code == 404
        assert conn.execute("SELECT * FROM audit_log WHERE action = 'download'").fetchone() is None
    finally:
        conn.close()


def test_original_download_of_missing_edited_version_404s_and_writes_no_audit_row(tmp_path):
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
        assert conn.execute("SELECT * FROM audit_log WHERE action = 'download'").fetchone() is None
    finally:
        conn.close()


def test_original_format_jpeg_download_writes_an_audit_row(tmp_path, monkeypatch):
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

        response = client.get(f"/api/libraries/{library_id}/original/a", params={"format": "jpeg", "download": "1"})

        assert response.status_code == 200
        row = conn.execute("SELECT * FROM audit_log WHERE action = 'download'").fetchone()
        assert row is not None
        assert row["user_id"] == user_id
        assert row["detail"] == "version=original format=jpeg"
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


def test_livephoto_video_prefers_edited_over_original(tmp_path):
    conn, client = _client(tmp_path)
    try:
        library_path = tmp_path / "L1.photoslibrary"
        originals = library_path / "originals"
        originals.mkdir(parents=True)
        original_video = originals / "a.mov"
        original_video.write_bytes(b"original live photo video")
        edited_video = originals / "a_edited.mov"
        edited_video.write_bytes(b"edited live photo video")
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(
            conn, library_id, "a",
            path_live_photo=str(original_video), path_edited_live_photo=str(edited_video),
        )
        _login(client, "alice")

        response = client.get(f"/api/libraries/{library_id}/livephoto/a/video")

        assert response.status_code == 200
        assert response.content == b"edited live photo video"
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
            f"/api/libraries/{library_id}/hidden",
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


def test_hidden_endpoint_is_locked_until_the_password_is_reconfirmed(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "hidden-one", hidden=1)
        _login(client, "alice")
        url = f"/api/libraries/{library_id}/hidden"

        locked = client.get(url)
        assert locked.status_code == 403
        assert locked.json()["detail"]["code"] == "hidden_locked"

        _unlock_hidden(client)
        assert client.get(url).status_code == 200

        assert client.post("/api/auth/lock-hidden", json={}).status_code == 204
        assert client.get(url).status_code == 403
    finally:
        conn.close()


def test_hidden_unlock_expires(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _login(client, "alice")
        _unlock_hidden(client)
        conn.execute("UPDATE sessions SET hidden_unlocked_until = datetime('now', '-1 seconds')")
        conn.commit()

        assert client.get(f"/api/libraries/{library_id}/hidden").status_code == 403
    finally:
        conn.close()


def test_hidden_unlock_slides_only_when_less_than_half_the_window_is_left(tmp_path):
    # Hidden thumbnails also go through the unlock check (#151); a DB write
    # per thumbnail request would serialise grid loads, so the sliding
    # window is only rewritten once it is past its half-life.
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _login(client, "alice")
        _unlock_hidden(client)
        url = f"/api/libraries/{library_id}/hidden"

        def until() -> str:
            return conn.execute("SELECT hidden_unlocked_until FROM sessions").fetchone()[0]

        conn.execute("UPDATE sessions SET hidden_unlocked_until = datetime('now', '+250 seconds')")
        conn.commit()
        fresh = until()
        assert client.get(url).status_code == 200
        assert until() == fresh

        conn.execute("UPDATE sessions SET hidden_unlocked_until = datetime('now', '+60 seconds')")
        conn.commit()
        stale = until()
        assert client.get(url).status_code == 200
        assert until() > stale
    finally:
        conn.close()


def test_foreign_library_hidden_still_404s_even_when_unlocked(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        l1 = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        l2 = _create_library(conn, "L2", path=tmp_path / "L2.photoslibrary")
        _assign(conn, user_id, l1)
        _login(client, "alice")
        _unlock_hidden(client)

        assert client.get(f"/api/libraries/{l2}/hidden").status_code == 404
    finally:
        conn.close()


def test_favorite_filter_lists_only_favorites_and_combines_with_type_and_cursor(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "fav-photo-new", favorite=1, is_video=0, date_created="2024-01-05T00:00:00")
        _insert_asset(conn, library_id, "plain-photo", favorite=0, is_video=0, date_created="2024-01-04T00:00:00")
        _insert_asset(conn, library_id, "fav-video", favorite=1, is_video=1, date_created="2024-01-03T00:00:00")
        _insert_asset(conn, library_id, "fav-photo-old", favorite=1, is_video=0, date_created="2024-01-02T00:00:00")
        _login(client, "alice")
        url = f"/api/libraries/{library_id}/assets"

        def ids(**params):
            response = client.get(url, params=params)
            assert response.status_code == 200, response.text
            return [item["id"] for item in response.json()["items"]]

        assert ids(favorite="true") == ["fav-photo-new", "fav-video", "fav-photo-old"]
        assert len(ids()) == 4
        assert len(ids(favorite="false")) == 4
        assert ids(favorite="true", type="photo") == ["fav-photo-new", "fav-photo-old"]
        assert ids(favorite="true", type="video") == ["fav-video"]

        first = client.get(url, params={"favorite": "true", "type": "photo", "limit": 1}).json()
        assert [item["id"] for item in first["items"]] == ["fav-photo-new"]
        assert first["next_cursor"]
        second = client.get(
            url, params={"favorite": "true", "type": "photo", "limit": 1, "cursor": first["next_cursor"]}
        ).json()
        assert [item["id"] for item in second["items"]] == ["fav-photo-old"]
        assert second["next_cursor"] is None
    finally:
        conn.close()


def test_hidden_asset_media_requires_the_hidden_unlock(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_path, file_path = _library_root_with_jpeg(tmp_path)
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "hid", hidden=1, path_original=str(file_path))
        _insert_asset(conn, library_id, "vis", path_original=str(file_path))
        _login(client, "alice")
        base = f"/api/libraries/{library_id}"
        hidden_urls = [f"{base}/thumb/hid", f"{base}/original/hid", f"{base}/original/hid?format=jpeg"]
        visible_urls = [f"{base}/thumb/vis", f"{base}/original/vis"]

        for url in hidden_urls:
            locked = client.get(url)
            assert locked.status_code == 403, url
            assert locked.json()["detail"]["code"] == "hidden_locked"
        for url in visible_urls:
            assert client.get(url).status_code == 200, url
        assert client.get(f"{base}/thumb/missing").status_code == 404
        assert client.get(f"{base}/assets/hid").status_code == 403
        assert client.get(f"{base}/assets/vis").status_code == 200

        _unlock_hidden(client)
        assert client.get(f"{base}/assets/hid").status_code == 200
        for url in hidden_urls + visible_urls:
            assert client.get(url).status_code == 200, url
        for url in hidden_urls:
            assert client.get(url).headers["cache-control"] == "private, no-store", url
        for url in visible_urls:
            assert "no-store" not in client.get(url).headers.get("cache-control", ""), url

        assert client.post("/api/auth/lock-hidden", json={}).status_code == 204
        for url in hidden_urls:
            assert client.get(url).status_code == 403, url
        for url in visible_urls:
            assert client.get(url).status_code == 200, url
    finally:
        conn.close()


def test_hidden_live_photo_video_requires_the_hidden_unlock(tmp_path):
    conn, client = _client(tmp_path)
    try:
        user_id = _create_user(conn, "alice")
        library_path, file_path = _library_root_with_jpeg(tmp_path)
        library_id = _create_library(conn, "L1", path=library_path)
        _assign(conn, user_id, library_id)
        _insert_asset(conn, library_id, "hid", hidden=1, path_live_photo=str(file_path))
        _login(client, "alice")
        url = f"/api/libraries/{library_id}/livephoto/hid/video"

        assert client.get(url).status_code == 403
        _unlock_hidden(client)
        unlocked = client.get(url)
        assert unlocked.status_code == 200
        assert unlocked.headers["cache-control"] == "private, no-store"
    finally:
        conn.close()
