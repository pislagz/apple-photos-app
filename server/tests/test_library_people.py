"""P2.2: the People list and `/assets?person=`."""

from __future__ import annotations

from fastapi.testclient import TestClient

from photos_viewer import app_db, indexer, session_auth
from photos_viewer.main import create_app
from tests.fixtures import (
    FixtureAsset,
    FixturePerson,
    _build_asset_image_bytes,
    build_library,
)

VALID_PASSWORD = "correct-horse-battery"
ANN, BEN, NOBODY, ONLY_HIDDEN, NOBODY_BIG, NOBODY_HIDDEN = (
    f"C0000000-0000-0000-0000-00000000000{n}" for n in (1, 2, 3, 4, 5, 6)
)


def _uuid(n):
    return f"A0000000-0000-0000-0000-{n:012d}"


def _assets():
    data = _build_asset_image_bytes()
    return [
        FixtureAsset(
            uuid=_uuid(n),
            filename=f"IMG_{n:04d}.HEIC",
            data=data,
            created=700000000.0 + n * 86400,
            hidden=(n == 4),
        )
        for n in range(1, 7)
    ]


def _setup(tmp_path):
    app = create_app()
    conn = app_db.connect(tmp_path / "data")
    app.dependency_overrides[session_auth.get_db] = lambda: conn
    app.dependency_overrides[session_auth.get_media_cache_dir] = lambda: (
        tmp_path / "media_cache"
    )
    client = TestClient(app, base_url="https://testserver")
    people = [
        # asset 4 (index 3) is hidden
        FixturePerson(ANN, "Ann", "D0000000-0000-0000-0000-000000000001", [0, 1, 3]),
        FixturePerson(BEN, "Ben", "D0000000-0000-0000-0000-000000000002", [1, 4]),
        FixturePerson(
            NOBODY, "x", "D0000000-0000-0000-0000-000000000003", [2, 5], named=False
        ),
        FixturePerson(ONLY_HIDDEN, "Hal", "D0000000-0000-0000-0000-000000000004", [3]),
        # More photos than anyone named: must still sort after the named people.
        FixturePerson(
            NOBODY_BIG,
            "x",
            "D0000000-0000-0000-0000-000000000005",
            [0, 1, 2, 4, 5],
            named=False,
        ),
        # Unnamed, and every photo hidden: stays out.
        FixturePerson(
            NOBODY_HIDDEN,
            "x",
            "D0000000-0000-0000-0000-000000000006",
            [3],
            named=False,
        ),
    ]
    package = build_library(tmp_path, _assets(), people=people)
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


def test_people_round_trip_with_counts_equal_to_sql_and_hidden_excluded(tmp_path):
    conn, client, library_id = _setup(tmp_path)
    try:
        _login(conn, client, "alice", library_id)
        body = client.get(f"/api/libraries/{library_id}/people").json()

        by_id = {p["id"]: p for p in body["people"]}
        # Unnamed groups are listed; people whose photos are all hidden (named
        # ONLY_HIDDEN or unnamed NOBODY_HIDDEN) are omitted.
        assert set(by_id) == {ANN, BEN, NOBODY, NOBODY_BIG}
        # Named first (most photos first), then unnamed by photo count.
        assert [p["id"] for p in body["people"]] == [ANN, BEN, NOBODY_BIG, NOBODY]
        assert [p["name"] for p in body["people"]] == ["Ann", "Ben", None, None]
        # Generated labels follow list order; named people keep their names.
        assert [p["label"] for p in body["people"]] == [
            "Ann",
            "Ben",
            "Person A",
            "Person B",
        ]
        assert by_id[NOBODY_BIG]["count"] == 5 and by_id[NOBODY]["count"] == 2
        for uuid, person in by_id.items():
            expected = conn.execute(
                "SELECT COUNT(*) FROM asset_people ap JOIN people p ON p.id = ap.person_id "
                "JOIN assets a ON a.id = ap.asset_id WHERE p.uuid = ? AND a.hidden = 0",
                (uuid,),
            ).fetchone()[0]
            assert person["count"] == expected
        assert by_id[ANN]["count"] == 2  # three links, one hidden

        cover = by_id[ANN]["cover"]
        # Best-quality face on a visible asset; the fixture's y is flipped
        # into a top-left origin (0.6 stored -> 0.4 displayed).
        assert cover == {"asset_id": _uuid(1), "x": 0.3, "y": 0.4, "w": 0.2, "h": 0.2}
        assert by_id[BEN]["cover"]["asset_id"] in {_uuid(2), _uuid(5)}
    finally:
        conn.close()


def test_assets_person_filter_lists_only_that_persons_visible_assets(tmp_path):
    conn, client, library_id = _setup(tmp_path)
    try:
        _login(conn, client, "alice", library_id)
        for person, expected in (
            (ANN, {_uuid(1), _uuid(2)}),
            (BEN, {_uuid(2), _uuid(5)}),
            (NOBODY, {_uuid(3), _uuid(6)}),  # an unnamed group works too
        ):
            response = client.get(
                f"/api/libraries/{library_id}/assets", params={"person": person}
            )
            assert response.status_code == 200
            assert {i["id"] for i in response.json()["items"]} == expected
        # cursor pagination
        page = client.get(
            f"/api/libraries/{library_id}/assets", params={"person": ANN, "limit": 1}
        ).json()
        assert len(page["items"]) == 1 and page["next_cursor"]
        rest = client.get(
            f"/api/libraries/{library_id}/assets",
            params={"person": ANN, "limit": 1, "cursor": page["next_cursor"]},
        ).json()
        assert (
            rest["next_cursor"] is None
            and rest["items"][0]["id"] != page["items"][0]["id"]
        )
        # unknown ids are 404, not an empty page
        for bad in ("nope", "C0000000-0000-0000-0000-0000000000ff"):
            assert (
                client.get(
                    f"/api/libraries/{library_id}/assets", params={"person": bad}
                ).status_code
                == 404
            )
    finally:
        conn.close()


def test_other_users_other_libraries_and_anonymous(tmp_path):
    conn, client, library_id = _setup(tmp_path)
    try:
        assert client.get(f"/api/libraries/{library_id}/people").status_code == 401
        assert (
            client.get(
                f"/api/libraries/{library_id}/assets", params={"person": ANN}
            ).status_code
            == 401
        )
        conn.execute(
            "INSERT INTO libraries (display_name, path) VALUES ('L2', ?)",
            (str(tmp_path / "L2.photoslibrary"),),
        )
        other = conn.execute(
            "SELECT id FROM libraries WHERE display_name = 'L2'"
        ).fetchone()["id"]
        _login(conn, client, "bob", other)
        assert client.get(f"/api/libraries/{library_id}/people").status_code == 404
        assert (
            client.get(
                f"/api/libraries/{library_id}/assets", params={"person": ANN}
            ).status_code
            == 404
        )
        # Bob's own library has no such person
        assert (
            client.get(
                f"/api/libraries/{other}/assets", params={"person": ANN}
            ).status_code
            == 404
        )
        assert client.get(f"/api/libraries/{other}/people").json() == {"people": []}
    finally:
        conn.close()


def test_migration_19_flags_indexed_libraries_for_reindex(tmp_path):
    conn = app_db.connect(tmp_path / "data")
    try:
        conn.execute("PRAGMA user_version = 18")
        conn.execute("DROP TABLE faces")
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
        conn.execute("ALTER TABLE users DROP COLUMN avatar_version")  # 26 (#256)
        conn.execute("DROP TRIGGER assets_fts_delete")  # D36
        conn.execute("DROP TABLE assets_fts")
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
        assert conn.execute("SELECT COUNT(*) FROM faces").fetchone()[0] == 0
    finally:
        conn.close()


def test_unnamed_labels_are_bijective_base_26():
    from photos_viewer.library_people import unnamed_label

    cases = {1: "A", 2: "B", 26: "Z", 27: "AA", 28: "AB", 52: "AZ", 53: "BA"}
    cases.update({702: "ZZ", 703: "AAA"})
    for index, letters in cases.items():
        assert unnamed_label(index) == f"Person {letters}"


def test_unnamed_label_is_the_same_on_each_request_and_ties_break_by_id(tmp_path):
    conn, client, library_id = _setup(tmp_path)
    try:
        _login(conn, client, "alice", library_id)
        url = f"/api/libraries/{library_id}/people"
        first = client.get(url).json()["people"]
        again = client.get(url).json()["people"]
        assert first == again
        labels = {p["id"]: p["label"] for p in first}
        assert labels[NOBODY_BIG] == "Person A" and labels[NOBODY] == "Person B"
    finally:
        conn.close()
