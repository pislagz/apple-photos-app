"""P2.4: Search, asset_labels, and the leo.sqlite copy."""

from __future__ import annotations

import ast
import pathlib

from fastapi.testclient import TestClient

from photos_viewer import (
    app_db,
    indexer,
    libraries,
    library_search,
    search_index,
    session_auth,
)
from photos_viewer.main import create_app
from tests.fixtures import (
    FixtureAlbum,
    FixtureAsset,
    FixturePerson,
    _build_asset_image_bytes,
    build_library,
)

VALID_PASSWORD = "correct-horse-battery"
ANN = "C0000000-0000-0000-0000-000000000001"


def _uuid(n):
    return f"A0000000-0000-0000-0000-{n:012d}"


def _assets(labels=None):
    data = _build_asset_image_bytes()
    labels = labels or {}
    return [
        FixtureAsset(
            uuid=_uuid(n),
            filename=f"IMG_{n:04d}.HEIC",
            data=data,
            # 700000000 is 2023-03-08; each asset a day later
            created=700000000.0 + n * 86400,
            hidden=(n == 4),
            labels=labels.get(n, ()),
        )
        for n in range(1, 6)
    ]


def _build(tmp_path, labels, name="L.photoslibrary"):
    return build_library(
        tmp_path,
        _assets(labels),
        albums=[FixtureAlbum("B0000000-0000-0000-0000-000000000001", "Road Trip", [2])],
        people=[
            FixturePerson(ANN, "Ann Lee", "D0000000-0000-0000-0000-000000000001", [1])
        ],
        package_name=name,
    )


def _setup(tmp_path, labels=None):
    app = create_app()
    conn = app_db.connect(tmp_path / "data")
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    app.dependency_overrides[session_auth.get_media_cache_dir] = lambda: (
        tmp_path / "media_cache"
    )
    client = TestClient(app, base_url="https://testserver")
    package = _build(
        tmp_path,
        labels
        or {1: ("Dog", "Beach"), 2: ("Snow",), 4: ("Dog",), 5: ("Sports Field",)},
    )
    conn.execute(
        "INSERT INTO libraries (display_name, path) VALUES ('L1', ?)", (str(package),)
    )
    conn.commit()
    library_id = conn.execute("SELECT id FROM libraries").fetchone()["id"]
    indexer.index_library(conn, library_id, package, force=True)
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES ('alice', ?, 'user')",
        (session_auth.hash_password(VALID_PASSWORD),),
    )
    conn.execute(
        "INSERT INTO library_assignments (user_id, library_id) VALUES (1, ?)",
        (library_id,),
    )
    conn.commit()
    assert (
        client.post(
            "/api/auth/login", json={"username": "alice", "password": VALID_PASSWORD}
        ).status_code
        == 200
    )
    return conn, client, library_id, package


def _search(client, library_id, q, **params):
    response = client.get(
        f"/api/libraries/{library_id}/search", params={"q": q, **params}
    )
    assert response.status_code == 200, response.text
    return {item["id"] for item in response.json()["items"]}


def test_label_search_is_case_insensitive_and_excludes_hidden(tmp_path):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        # asset 4 also has "Dog" but is hidden
        for q in ("dog", "DOG", "Dog", "do"):
            assert _search(client, lib, q) == {_uuid(1)}, q
        assert _search(client, lib, "field") == {_uuid(5)}  # a later word of a label
        assert _search(client, lib, "dog beach") == {_uuid(1)}  # AND
        assert _search(client, lib, "dog snow") == set()
    finally:
        conn.close()


def test_labels_are_rebuilt_on_reindex(tmp_path):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        assert _search(client, lib, "dog") == {_uuid(1)}
        rows = conn.execute(
            "SELECT label, label_normalized FROM asset_labels"
        ).fetchall()
        assert ("Dog", "dog") in {(r[0], r[1]) for r in rows}
        # The owner's Mac re-analysed: asset 1 lost "Dog", gained "Cat".
        package = _build(tmp_path / "second", {1: ("Cat", "Beach"), 2: ("Snow",)})
        indexer.index_library(conn, lib, package, force=True)
        assert _search(client, lib, "dog") == set()
        assert _search(client, lib, "cat") == {_uuid(1)}
        assert _search(client, lib, "beach") == {_uuid(1)}
    finally:
        conn.close()


def test_matches_date_place_person_album_and_camera(tmp_path):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        conn.execute(
            "UPDATE assets SET place = 'Zürich', place_address = 'Bahnhofstrasse, Switzerland', "
            "camera_make = 'Apple', camera_model = 'iPhone 15 Pro' WHERE uuid = ?",
            (_uuid(3),),
        )
        search_index.rebuild_library(conn, lib)
        conn.commit()
        everyone = {_uuid(n) for n in (1, 2, 3, 5)}
        assert _search(client, lib, "2023") == everyone
        assert _search(client, lib, "march") == everyone
        assert _search(client, lib, "2023-03-11") == {_uuid(3)}
        assert _search(client, lib, "2022") == set()
        assert _search(client, lib, "zurich") == {_uuid(3)}  # accent-insensitive
        assert _search(client, lib, "switz") == {_uuid(3)}
        assert _search(client, lib, "iphone 15") == {_uuid(3)}
        assert _search(client, lib, "apple") == {_uuid(3)}
        assert _search(client, lib, "ann") == {_uuid(2)}
        assert _search(client, lib, "lee snow") == {_uuid(2)}  # person AND label
        assert _search(client, lib, "road") == {_uuid(3)}  # album title
        assert _search(client, lib, "road dog") == set()
    finally:
        conn.close()


def test_empty_query_is_an_empty_page_and_paging_works(tmp_path):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        for q in ("", "   "):
            body = client.get(f"/api/libraries/{lib}/search", params={"q": q}).json()
            assert body == {"items": [], "next_cursor": None}
        assert client.get(f"/api/libraries/{lib}/search").json()["items"] == []
        first = client.get(
            f"/api/libraries/{lib}/search", params={"q": "2023", "limit": 3}
        ).json()
        assert len(first["items"]) == 3 and first["next_cursor"]
        rest = client.get(
            f"/api/libraries/{lib}/search",
            params={"q": "2023", "limit": 3, "cursor": first["next_cursor"]},
        ).json()
        assert {i["id"] for i in first["items"] + rest["items"]} == {
            _uuid(n) for n in (1, 2, 3, 5)
        }
    finally:
        conn.close()


def test_wildcards_in_the_query_are_literal(tmp_path):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        for q in ("%", "_", "d%", "'; DROP TABLE assets; --"):
            assert _search(client, lib, q) == set()
        assert conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0] == 5
    finally:
        conn.close()


def _add_library(conn, tmp_path, labels):
    package = _build(tmp_path / "other", labels, name="Other.photoslibrary")
    conn.execute(
        "INSERT INTO libraries (display_name, path) VALUES ('L2', ?)", (str(package),)
    )
    conn.commit()
    other = conn.execute(
        "SELECT id FROM libraries WHERE display_name = 'L2'"
    ).fetchone()["id"]
    indexer.index_library(conn, other, package, force=True)
    return other


def test_foreign_library_unknown_library_and_anonymous(tmp_path):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        other = _add_library(
            conn, tmp_path, {1: ("Zebra",)}
        )  # alice is not assigned to it
        assert (
            client.get(
                f"/api/libraries/{other}/search", params={"q": "zebra"}
            ).status_code
            == 404
        )
        assert (
            client.get("/api/libraries/9999/search", params={"q": "dog"}).status_code
            == 404
        )
        anon = TestClient(client.app, base_url="https://testserver")
        assert (
            anon.get(f"/api/libraries/{lib}/search", params={"q": "dog"}).status_code
            == 401
        )
    finally:
        conn.close()


def test_a_query_cannot_return_another_librarys_asset(tmp_path):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        other = _add_library(conn, tmp_path, {1: ("Zebra", "Dog")})
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM asset_labels al JOIN assets a ON a.id = al.asset_id "
                "WHERE a.library_id = ? AND al.label_normalized = 'zebra'",
                (other,),
            ).fetchone()[0]
            == 1
        )
        # The other library's label is invisible from this one; "dog" finds only this library's asset.
        assert _search(client, lib, "zebra") == set()
        rows = client.get(f"/api/libraries/{lib}/search", params={"q": "dog"}).json()[
            "items"
        ]
        assert [i["id"] for i in rows] == [_uuid(1)]
    finally:
        conn.close()


def test_search_module_imports_no_http_client():
    tree = ast.parse(pathlib.Path(library_search.__file__).read_text())
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert not imported & {
        "requests",
        "httpx",
        "urllib",
        "urllib3",
        "http",
        "aiohttp",
        "socket",
    }


def test_copy_mode_copies_psi_and_leo(tmp_path):
    package = _build(tmp_path, {1: ("Dog",)})
    search_dir = package / "database" / "search"
    (search_dir / "leo.sqlite").write_bytes(b"leo bytes")
    sqlite_path = package / "database" / "Photos.sqlite"
    dest = tmp_path / "copy"
    dest.mkdir()
    libraries._copy_search_index(sqlite_path, dest / "Photos.sqlite")
    assert (dest / "search" / "psi.sqlite").read_bytes() == (
        search_dir / "psi.sqlite"
    ).read_bytes()
    assert (dest / "search" / "leo.sqlite").read_bytes() == b"leo bytes"
    # leo only (macOS 27+ shape)
    (search_dir / "psi.sqlite").unlink()
    dest2 = tmp_path / "copy2"
    dest2.mkdir()
    libraries._copy_search_index(sqlite_path, dest2 / "Photos.sqlite")
    assert [p.name for p in (dest2 / "search").iterdir()] == ["leo.sqlite"]


def test_migration_creates_asset_labels(tmp_path):
    db = app_db.connect(tmp_path)
    try:
        assert db.execute(
            "SELECT 1 FROM sqlite_master WHERE name = 'asset_labels'"
        ).fetchone()
    finally:
        db.close()


def test_migration_21_flags_indexed_libraries_for_reindex(tmp_path):
    db = app_db.connect(tmp_path / "data")
    try:
        db.execute("PRAGMA user_version = 20")
        db.execute("DROP TABLE asset_labels")
        db.execute("DROP TABLE passkey_challenges")  # migration 22
        db.execute("DROP TABLE passkeys")
        db.execute("DROP TABLE prewarm_jobs")  # migration 23
        db.execute("DROP TABLE library_note_dismissals")  # migration 24
        db.execute("ALTER TABLE library_index_runs DROP COLUMN added_visible")
        db.execute("ALTER TABLE library_index_runs DROP COLUMN removed_visible")
        db.execute("ALTER TABLE assets DROP COLUMN original_missing")
        db.execute("ALTER TABLE assets DROP COLUMN place_offline")  # D41
        db.execute("ALTER TABLE assets DROP COLUMN is_syndicated")  # migration 26
        db.execute("DROP TRIGGER assets_fts_delete")  # D36
        db.execute("DROP TABLE assets_fts")
        db.execute(
            "INSERT INTO libraries (display_name, path, last_indexed_signature) VALUES ('A', 'a', 's')"
        )
        db.execute("INSERT INTO libraries (display_name, path) VALUES ('B', 'b')")
        db.commit()
        app_db.migrate(db)
        flags = {
            r["display_name"]: r["reindex_needed"]
            for r in db.execute("SELECT * FROM libraries")
        }
        assert flags == {"A": 1, "B": 0}
    finally:
        db.close()


def test_search_scan_tokenises_each_distinct_field_value_once():
    """A scan calls the UDFs several times per row; repeated field values must
    hit the word cache instead of re-folding. Counting cache misses is
    deterministic where a wall-clock bound would flake."""
    import sqlite3

    db = sqlite3.connect(":memory:")
    db.executescript(
        """
        CREATE TABLE assets (id INTEGER PRIMARY KEY, date_created TEXT,
            date_created_local_day TEXT, place TEXT, place_address TEXT,
            camera_make TEXT, camera_model TEXT, filename TEXT,
            original_filename TEXT, title TEXT, description TEXT);
        CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, display_name TEXT);
        CREATE TABLE asset_people (asset_id INTEGER, person_id INTEGER);
        CREATE TABLE albums (id INTEGER PRIMARY KEY, title TEXT);
        CREATE TABLE asset_albums (asset_id INTEGER, album_id INTEGER);
        CREATE TABLE asset_labels (asset_id INTEGER, label_normalized TEXT);
        """
    )
    places = ["Zürich", "Paris", "Lisbon", "Oslo"]
    rows = 4000
    db.executemany(
        "INSERT INTO assets VALUES (?, '2024-01-01T00:00:00', '2024-01-01', ?, ?, 'Apple', 'iPhone 15', 'f', 'f', NULL, NULL)",
        [(i, places[i % 4], f"{places[i % 4]} Road") for i in range(rows)],
    )
    library_search._register(db)
    library_search._words.cache_clear()

    where, params = library_search.scan_clause(library_search.parse_terms("zurich"))
    found = db.execute(f"SELECT COUNT(*) FROM assets WHERE {where}", params).fetchone()[
        0
    ]

    assert found == rows // 4
    distinct_values = len(places) * 2 + 2 + 1  # place, address, make, model, +slack
    assert library_search._words.cache_info().misses <= distinct_values


def test_matches_filename_original_filename_title_and_description(tmp_path):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        conn.execute(
            "UPDATE assets SET filename = 'A1B2C3.heic', original_filename = 'DSC_Sunset.JPG', "
            "title = 'Café terrace', description = 'Grandma birthday lunch' WHERE uuid = ?",
            (_uuid(3),),
        )
        # A hidden photo with the same words never shows up.
        conn.execute(
            "UPDATE assets SET original_filename = 'DSC_Sunset2.JPG', "
            "title = 'Café hidden', description = 'birthday' WHERE uuid = ?",
            (_uuid(4),),
        )
        search_index.rebuild_library(conn, lib)
        conn.commit()
        assert _search(client, lib, "a1b2") == {_uuid(3)}  # filename
        assert _search(client, lib, "DSC_Sun") == {_uuid(3)}  # original_filename
        assert _search(client, lib, "cafe") == {_uuid(3)}  # title, accent-insensitive
        assert _search(client, lib, "TERRACE") == {_uuid(3)}
        assert _search(client, lib, "birthday") == {_uuid(3)}  # description
        assert _search(client, lib, "grandma lunch") == {_uuid(3)}  # AND over words
        assert _search(client, lib, "cafe dog") == set()  # every term must match
        assert _search(client, lib, "dog a1b2") == set()
        # Mixed: one term in the filename, one in the title.
        assert _search(client, lib, "dsc terrace") == {_uuid(3)}
    finally:
        conn.close()


def test_a_term_matching_only_the_filename_finds_the_photo(tmp_path):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        # IMG_0002.HEIC has no place, person, album title match, label or date
        # for this term: only its original filename carries it.
        conn.execute(
            "UPDATE assets SET original_filename = 'Zebrafoto.HEIC' WHERE uuid = ?",
            (_uuid(2),),
        )
        search_index.rebuild_library(conn, lib)
        conn.commit()
        assert _search(client, lib, "zebrafoto") == {_uuid(2)}
        assert _search(client, lib, "zebrafoto", type="video") == set()
    finally:
        conn.close()


def _fts_docs(conn):
    return {
        r[0]: (r[1], r[2])
        for r in conn.execute("SELECT rowid, txt, month FROM assets_fts")
    }


def test_indexer_rows_equal_a_rebuild_from_app_db(tmp_path):
    """The indexer writes each row from the osxphotos objects; `rebuild_library`
    derives it from `app.db`. They must agree or the two paths drift."""
    conn, _client, lib, _ = _setup(tmp_path)
    try:
        written = _fts_docs(conn)
        assert len(written) == 5
        search_index.rebuild_library(conn, lib)
        rebuilt = _fts_docs(conn)
        assert {k: sorted(v[0].split()) for k, v in written.items()} == {
            k: sorted(v[0].split()) for k, v in rebuilt.items()
        }
        assert {k: v[1] for k, v in written.items()} == {
            k: v[1] for k, v in rebuilt.items()
        }
    finally:
        conn.close()


def test_search_uses_the_fts_table_and_deleting_assets_drops_rows(tmp_path):
    conn, _client, lib, _ = _setup(tmp_path)
    try:
        where, params = search_index.search_clause(library_search.parse_terms("dog"))
        plan = " ".join(
            r[3]
            for r in conn.execute(
                f"EXPLAIN QUERY PLAN SELECT * FROM assets WHERE {where}", params
            )
        )
        assert "assets_fts" in plan and "VIRTUAL TABLE" in plan
        assert conn.execute("SELECT COUNT(*) FROM assets_fts").fetchone()[0] == 5
        conn.execute("DELETE FROM libraries WHERE id = ?", (lib,))  # cascades
        conn.commit()
        assert conn.execute("SELECT COUNT(*) FROM assets_fts").fetchone()[0] == 0
    finally:
        conn.close()


def test_fts_and_scan_agree_on_a_set_of_queries(tmp_path):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        queries = [
            "dog", "DO", "field", "dog beach", "dog snow", "2023", "2023-03",
            "2023-03-09", "mar", "ma", "marc", "march 2023", "ann", "lee ann",
            "road", "trip", "img", "IMG_0002", "apple", "iphone", "zzz", "%", "_",
            "'; DROP TABLE assets; --", "é", "d%",
        ]  # fmt: skip
        for q in queries:
            fast = _search(client, lib, q)
            conn.execute("UPDATE libraries SET reindex_needed = 1")
            conn.commit()
            scanned = _search(client, lib, q)
            conn.execute("UPDATE libraries SET reindex_needed = 0")
            conn.commit()
            assert fast == scanned, q
    finally:
        conn.close()


def test_month_needs_three_letters_and_filenames_split_on_underscore(tmp_path):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        assert _search(client, lib, "ma") == set()
        assert len(_search(client, lib, "mar")) == 4  # March 2023, hidden excluded
        # D64: the number part of IMG_0002 is a word of its own.
        assert _search(client, lib, "0002") == {_uuid(2)}
        assert _search(client, lib, "img_00") >= {_uuid(2)}
    finally:
        conn.close()


def test_migration_25_flags_indexed_libraries_for_reindex(tmp_path):
    db = app_db.connect(tmp_path / "data")
    try:
        db.execute("ALTER TABLE assets DROP COLUMN is_syndicated")  # migration 26
        db.execute("DROP TRIGGER assets_fts_delete")
        db.execute("DROP TABLE assets_fts")
        db.execute(
            f"PRAGMA user_version = {len(app_db._MIGRATIONS) - 2}"
        )  # the FTS migration is #25; #26 follows it
        db.execute(
            "INSERT INTO libraries (display_name, path, last_indexed_signature) VALUES ('A', 'a', 's')"
        )
        db.execute("INSERT INTO libraries (display_name, path) VALUES ('B', 'b')")
        db.commit()
        app_db.migrate(db)
        flags = {
            r["display_name"]: r["reindex_needed"]
            for r in db.execute("SELECT * FROM libraries")
        }
        assert flags == {"A": 1, "B": 0}
        assert db.execute(
            "SELECT 1 FROM sqlite_master WHERE name = 'assets_fts'"
        ).fetchone()
    finally:
        db.close()
