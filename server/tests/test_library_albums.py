"""P2.1: the albums list (folder tree + smart albums) and `/assets?album=`."""

from __future__ import annotations

from fastapi.testclient import TestClient

from photos_viewer import app_db, indexer, session_auth
from photos_viewer.main import create_app
from tests.fixtures import (
    HIDDEN_ASSET_UUID,
    FixtureAlbum,
    FixtureAsset,
    FixtureFolder,
    _build_asset_image_bytes,
    build_library,
)

VALID_PASSWORD = "correct-horse-battery"
TRIP, EUROPE, FRANCE = (
    "E0000000-0000-0000-0000-000000000001",
    "E0000000-0000-0000-0000-000000000002",
    "E0000000-0000-0000-0000-000000000003",
)
ALB_PARIS, ALB_LOOSE, ALB_HIDDEN_ONLY = (
    f"B0000000-0000-0000-0000-00000000000{n}" for n in (1, 2, 3)
)


def _assets():
    data = _build_asset_image_bytes()

    def asset(n, **kw):
        return FixtureAsset(
            uuid=f"A0000000-0000-0000-0000-{n:012d}",
            filename=f"IMG_{n:04d}.HEIC",
            data=data,
            created=700000000.0 + n * 86400,
            **kw,
        )

    return [
        asset(1, favorite=True),
        asset(2),
        asset(3, kind=1, uti="com.apple.quicktime-movie"),
        asset(4, favorite=True, hidden=True),
        asset(5, favorite=True),
    ]


def _uuid(n):
    return f"A0000000-0000-0000-0000-{n:012d}"


def _setup(tmp_path):
    app = create_app()
    conn = app_db.connect(tmp_path / "data")
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    app.dependency_overrides[session_auth.get_media_cache_dir] = lambda: (
        tmp_path / "media_cache"
    )
    client = TestClient(app, base_url="https://testserver")
    folders = [
        FixtureFolder(TRIP, "Trips"),
        FixtureFolder(EUROPE, "Europe", parent_uuid=TRIP),
        FixtureFolder(FRANCE, "France", parent_uuid=EUROPE),
    ]
    albums = [
        FixtureAlbum(ALB_PARIS, "Paris", [0, 1, 3], parent_uuid=FRANCE),
        FixtureAlbum(ALB_LOOSE, "Loose", [4]),
        FixtureAlbum(ALB_HIDDEN_ONLY, "Only Hidden", [3]),
    ]
    package = build_library(tmp_path, _assets(), albums=albums, folders=folders)
    conn.execute(
        "INSERT INTO libraries (display_name, path) VALUES ('L1', ?)", (str(package),)
    )
    conn.commit()
    library_id = conn.execute("SELECT id FROM libraries").fetchone()["id"]
    indexer.index_library(conn, library_id, package, force=True)
    return conn, client, library_id


def _login(conn, client, username, library_id=None):
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')",
        (username, session_auth.hash_password(VALID_PASSWORD)),
    )
    user_id = conn.execute(
        "SELECT id FROM users WHERE username = ?", (username,)
    ).fetchone()["id"]
    if library_id:
        conn.execute(
            "INSERT INTO library_assignments (user_id, library_id) VALUES (?, ?)",
            (user_id, library_id),
        )
    conn.commit()
    response = client.post(
        "/api/auth/login", json={"username": username, "password": VALID_PASSWORD}
    )
    assert response.status_code == 200, response.text


def _ids(response):
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def test_folder_tree_round_trips_parents(tmp_path):
    conn, client, library_id = _setup(tmp_path)
    try:
        _login(conn, client, "alice", library_id)
        body = client.get(f"/api/libraries/{library_id}/albums").json()

        tree = {node["id"]: node for node in body["tree"]}
        assert set(tree) == {TRIP, ALB_LOOSE, ALB_HIDDEN_ONLY}
        europe = tree[TRIP]["children"][0]
        assert (europe["id"], europe["kind"], europe["title"]) == (
            EUROPE,
            "folder",
            "Europe",
        )
        france = europe["children"][0]
        assert (france["id"], france["title"]) == (FRANCE, "France")
        paris = france["children"][0]
        assert (paris["id"], paris["kind"], paris["title"]) == (
            ALB_PARIS,
            "album",
            "Paris",
        )
        assert tree[TRIP]["count"] is None
    finally:
        conn.close()


def test_albums_exclude_hidden_assets_from_counts_and_covers(tmp_path):
    conn, client, library_id = _setup(tmp_path)
    try:
        _login(conn, client, "alice", library_id)
        body = client.get(f"/api/libraries/{library_id}/albums").json()
        flat = {}

        def walk(nodes):
            for node in nodes:
                flat[node["id"]] = node
                walk(node["children"])

        walk(body["tree"])
        # Paris holds assets 1, 2 and the hidden 4.
        assert flat[ALB_PARIS]["count"] == 2
        assert flat[ALB_PARIS]["cover_id"] == _uuid(2)  # newest visible
        # An album holding only a hidden asset stays listed, empty, with no cover.
        assert flat[ALB_HIDDEN_ONLY]["count"] == 0
        assert flat[ALB_HIDDEN_ONLY]["cover_id"] is None
        assert HIDDEN_ASSET_UUID not in str(body) and _uuid(4) not in str(body)

        assert _ids(
            client.get(
                f"/api/libraries/{library_id}/assets", params={"album": ALB_PARIS}
            )
        ) == [
            _uuid(2),
            _uuid(1),
        ]
        assert (
            _ids(
                client.get(
                    f"/api/libraries/{library_id}/assets",
                    params={"album": ALB_HIDDEN_ONLY},
                )
            )
            == []
        )
    finally:
        conn.close()


def test_smart_album_counts_match_direct_sql(tmp_path):
    conn, client, library_id = _setup(tmp_path)
    try:
        _login(conn, client, "alice", library_id)
        smart = {
            a["id"]: a
            for a in client.get(f"/api/libraries/{library_id}/albums").json()["smart"]
        }

        direct_favorites = conn.execute(
            "SELECT COUNT(*) FROM assets WHERE library_id = ? AND hidden = 0 AND favorite = 1",
            (library_id,),
        ).fetchone()[0]
        direct_videos = conn.execute(
            "SELECT COUNT(*) FROM assets WHERE library_id = ? AND hidden = 0 AND is_video = 1",
            (library_id,),
        ).fetchone()[0]
        assert (
            smart["smart:favorites"]["count"] == direct_favorites == 2
        )  # the hidden favorite is not counted
        assert smart["smart:videos"]["count"] == direct_videos == 1
        assert smart["smart:favorites"]["cover_id"] == _uuid(5)
        # Nothing selfie-flagged: an empty smart album is omitted.
        assert "smart:selfies" not in smart
        # Every asset was added within the window of the newest one.
        recent = conn.execute(
            "SELECT COUNT(*) FROM assets WHERE library_id = ? AND hidden = 0",
            (library_id,),
        ).fetchone()[0]
        assert smart["smart:recently-added"]["count"] == recent

        for album_id, entry in smart.items():
            listed = []
            cursor = None
            while True:
                params = {
                    "album": album_id,
                    "limit": 1,
                    **({"cursor": cursor} if cursor else {}),
                }
                page = client.get(
                    f"/api/libraries/{library_id}/assets", params=params
                ).json()
                listed += [item["id"] for item in page["items"]]
                cursor = page["next_cursor"]
                if not cursor:
                    break
            assert len(listed) == entry["count"], album_id
            assert _uuid(4) not in listed
    finally:
        conn.close()


def test_other_users_and_anonymous_get_404_and_401(tmp_path):
    conn, client, library_id = _setup(tmp_path)
    try:
        anonymous = client.get(f"/api/libraries/{library_id}/albums")
        assert anonymous.status_code == 401
        _login(conn, client, "bob")  # assigned to nothing
        assert client.get(f"/api/libraries/{library_id}/albums").status_code == 404
        for album in (ALB_PARIS, "smart:favorites"):
            response = client.get(
                f"/api/libraries/{library_id}/assets", params={"album": album}
            )
            assert response.status_code == 404
    finally:
        conn.close()


def test_album_of_another_library_is_404_even_with_an_assigned_library(tmp_path):
    conn, client, _library_id = _setup(tmp_path)
    try:
        conn.execute(
            "INSERT INTO libraries (display_name, path) VALUES ('L2', ?)",
            (str(tmp_path / "L2.photoslibrary"),),
        )
        other = conn.execute(
            "SELECT id FROM libraries WHERE display_name = 'L2'"
        ).fetchone()["id"]
        _login(conn, client, "bob", other)
        response = client.get(
            f"/api/libraries/{other}/assets", params={"album": ALB_PARIS}
        )
        assert response.status_code == 404
        assert client.get(f"/api/libraries/{other}/albums").json() == {
            "tree": [],
            "smart": [],
        }
    finally:
        conn.close()


def test_migration_flags_indexed_libraries_for_reindex(tmp_path):
    conn = app_db.connect(tmp_path / "data")
    try:
        conn.execute("PRAGMA user_version = 17")
        conn.execute("DROP TABLE faces")  # migration 19 re-creates it
        conn.execute("DROP TABLE asset_labels")
        conn.execute("DROP TABLE passkey_challenges")  # migration 22
        conn.execute("DROP TABLE passkeys")
        conn.execute("DROP TABLE prewarm_jobs")  # migration 23
        # migration 24
        conn.execute("DROP TABLE library_note_dismissals")
        conn.execute("ALTER TABLE library_index_runs DROP COLUMN added_visible")
        conn.execute("ALTER TABLE library_index_runs DROP COLUMN removed_visible")
        conn.execute("ALTER TABLE assets DROP COLUMN original_missing")
        conn.execute("ALTER TABLE assets DROP COLUMN place_offline")  # D41
        conn.execute("DROP TABLE folders")
        conn.execute("ALTER TABLE albums DROP COLUMN parent_uuid")
        conn.execute("ALTER TABLE albums DROP COLUMN list_order")
        conn.execute(
            "INSERT INTO libraries (display_name, path, last_indexed_signature) VALUES ('A', 'a', 'sig')"
        )
        conn.execute("INSERT INTO libraries (display_name, path) VALUES ('B', 'b')")
        conn.commit()

        app_db.migrate(conn)

        flags = {
            r["display_name"]: r["reindex_needed"]
            for r in conn.execute("SELECT * FROM libraries")
        }
        assert flags == {"A": 1, "B": 0}
        assert conn.execute("SELECT COUNT(*) FROM folders").fetchone()[0] == 0
    finally:
        conn.close()
