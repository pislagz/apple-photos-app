"""D21: `POST /api/libraries/{id}/selection-summary` for the desktop Info panel."""

from __future__ import annotations

from tests.test_library_assets import (
    _assign,
    _client,
    _create_library,
    _create_user,
    _insert_asset,
    _login,
    _unlock_hidden,
)


def _setup(tmp_path):
    conn, client = _client(tmp_path)
    user_id = _create_user(conn, "alice")
    library_id = _create_library(conn, "L1", path=tmp_path / "L1.photoslibrary")
    _assign(conn, user_id, library_id)
    _login(client, "alice")
    return conn, client, library_id


def test_summary_counts_split_dates_size_and_shared_place(tmp_path):
    conn, client, lib = _setup(tmp_path)
    try:
        _insert_asset(
            conn,
            lib,
            "a",
            date_created="2024-03-09T10:00:00",
            original_filesize=1000,
            place="Zurich",
        )
        _insert_asset(
            conn,
            lib,
            "b",
            date_created="2024-03-03T10:00:00",
            original_filesize=2500,
            place="Zurich",
        )
        _insert_asset(
            conn,
            lib,
            "c",
            date_created="2024-03-05T10:00:00",
            is_video=1,
            place="Zurich",
        )
        response = client.post(
            f"/api/libraries/{lib}/selection-summary",
            json={"asset_ids": ["a", "b", "c", "a"]},
        )
        assert response.status_code == 200
        assert response.json() == {
            "count": 3,
            "photos": 2,
            "videos": 1,
            "date_first": "2024-03-03T10:00:00",
            "date_last": "2024-03-09T10:00:00",
            "total_bytes": 3500,
            "place": "Zurich",
        }
    finally:
        conn.close()


def test_place_is_null_unless_every_asset_shares_one(tmp_path):
    conn, client, lib = _setup(tmp_path)
    try:
        _insert_asset(conn, lib, "a", place="Zurich")
        _insert_asset(conn, lib, "b", place="Bern")
        _insert_asset(
            conn, lib, "c", place="Zurich", place_address="Bahnhofstrasse, Zurich"
        )
        _insert_asset(conn, lib, "d")
        url = f"/api/libraries/{lib}/selection-summary"
        assert client.post(url, json={"asset_ids": ["a", "b"]}).json()["place"] is None
        assert client.post(url, json={"asset_ids": ["a", "d"]}).json()["place"] is None
        assert client.post(url, json={"asset_ids": ["a", "a2"]}).status_code == 404
        # The address wins over the short name, like the single-asset row.
        assert (
            client.post(url, json={"asset_ids": ["c", "c"]}).json()["place"]
            == "Bahnhofstrasse, Zurich"
        )
        assert client.post(url, json={"asset_ids": ["d", "d"]}).json()["place"] is None
    finally:
        conn.close()


def test_unknown_id_is_404_and_hidden_needs_the_unlock(tmp_path):
    conn, client, lib = _setup(tmp_path)
    try:
        _insert_asset(conn, lib, "a")
        _insert_asset(conn, lib, "h", hidden=1)
        url = f"/api/libraries/{lib}/selection-summary"
        assert client.post(url, json={"asset_ids": ["a", "nope"]}).status_code == 404
        assert client.post(url, json={"asset_ids": ["a", "h"]}).status_code == 403
        _unlock_hidden(client)
        response = client.post(url, json={"asset_ids": ["a", "h"]})
        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, no-store"
        assert client.post(url, json={"asset_ids": []}).status_code == 422
    finally:
        conn.close()
