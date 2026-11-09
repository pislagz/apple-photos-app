"""P1.22: quarterly library drops -- detection, stability, readiness, the
"Being updated" state, the run summary and the Replace action. All on the
synthetic fixture; the checker is driven by hand with a zero stability window."""

import shutil

from photos_viewer import app_db, library_watch, session_auth
from tests.fixtures import FixtureAsset, _build_asset_image_bytes, build_library
from tests.test_library_admin import _admin_client, _full_snapshot

IMG = _build_asset_image_bytes()


def _asset(n: int, **kwargs) -> FixtureAsset:
    return FixtureAsset(
        uuid=f"{n:08X}-0000-0000-0000-000000000000",
        filename=f"IMG_{n:04d}.HEIC",
        data=IMG,
        **kwargs,
    )


def _setup(tmp_path, assets, name="Alice.photoslibrary"):
    conn, client = _admin_client(tmp_path)
    client.app.dependency_overrides[session_auth.get_media_cache_dir] = lambda: (
        tmp_path / "media_cache"
    )
    package = build_library(tmp_path / "lib", assets, package_name=name)
    added = client.post("/api/admin/libraries", json={"path": str(package)}).json()
    app_db.set_setting(conn, "library_stable_minutes", "0")
    return conn, client, package, added["id"]


def _drive(conn, library_id, times=3):
    return [library_watch.check_library(conn, library_id) for _ in range(times)]


def _ids(conn, library_id):
    return {
        r["uuid"]: r["id"]
        for r in conn.execute(
            "SELECT id, uuid FROM assets WHERE library_id = ?", (library_id,)
        )
    }


def _replace_package(package, assets):
    shutil.rmtree(package)
    return build_library(package.parent, assets, package_name=package.name)


def test_same_path_swap_applies_with_exact_counts_and_stable_ids(tmp_path):
    a = [_asset(n) for n in range(1, 5)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        before = _ids(conn, lib)
        assert client.get(f"/api/libraries/{lib}/assets").status_code == 200

        # 1 kept, 2 edited, 3 newly hidden, 4 removed, 5 and 6 new.
        _replace_package(
            package,
            [
                a[0],
                FixtureAsset(
                    uuid=a[1].uuid, filename=a[1].filename, data=IMG + b"edit"
                ),
                _asset(3, hidden=True),
                _asset(5),
                _asset(6),
            ],
        )
        assert library_watch.check_library(conn, lib) == "pending"
        # While pending, users see "Being updated" and the old index is untouched.
        assert client.get(f"/api/libraries/{lib}/assets").status_code == 503
        assert client.get("/api/me").json()["libraries"][0]["updating"] is True
        assert _ids(conn, lib) == before

        assert "applied" in _drive(conn, lib, 2)
        after = _ids(conn, lib)
        for uuid in (a[0].uuid, a[1].uuid, a[2].uuid):
            assert after[uuid] == before[uuid]
        assert a[3].uuid not in after and len(after) == 5

        run = conn.execute(
            "SELECT * FROM library_index_runs WHERE library_id = ? ORDER BY id DESC LIMIT 1",
            (lib,),
        ).fetchone()
        assert (
            run["outcome"],
            run["added"],
            run["removed"],
            run["changed"],
            run["hidden_changed"],
        ) == (
            "applied",
            2,
            1,
            1,
            1,
        )
        assert client.get(f"/api/libraries/{lib}/assets").status_code == 200
        hidden = conn.execute(
            "SELECT uuid FROM assets WHERE library_id = ? AND hidden = 1", (lib,)
        ).fetchall()
        assert [r["uuid"] for r in hidden] == [a[2].uuid]
        status = client.get(f"/api/admin/libraries/{lib}/status").json()
        assert status["updating"] is False and status["last_update"]["added"] == 2
        assert status["asset_count"] == 4  # hidden one excluded
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM audit_log WHERE action = 'library.update.applied'"
            ).fetchone()[0]
            == 1
        )
    finally:
        conn.close()


def test_large_removal_applies_without_a_hold(tmp_path):
    a = [_asset(n) for n in range(1, 11)]
    conn, _client, package, lib = _setup(tmp_path, a)
    try:
        _replace_package(package, a[:7])
        assert "applied" in _drive(conn, lib)
        assert len(_ids(conn, lib)) == 7
    finally:
        conn.close()


def _seed_albums(conn, lib):
    conn.execute(
        "INSERT INTO albums (library_id, uuid, title) VALUES (?, 'alb', 'Keep')", (lib,)
    )
    conn.commit()


def test_truncated_database_is_never_indexed_and_deletes_nothing(tmp_path):
    a = [_asset(n) for n in range(1, 4)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        before = _ids(conn, lib)
        sqlite_path = package / "database" / "Photos.sqlite"
        sqlite_path.write_bytes(sqlite_path.read_bytes()[:200])
        assert "not_ready" in _drive(conn, lib)
        assert _ids(conn, lib) == before
        assert client.get(f"/api/libraries/{lib}/assets").status_code == 503
        status = client.get(f"/api/admin/libraries/{lib}/status").json()
        assert (
            status["updating"] is True and "not readable" in status["updating_reason"]
        )
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM library_index_runs WHERE outcome = 'not_ready'"
            ).fetchone()[0]
            == 1
        )
    finally:
        conn.close()


def test_database_without_originals_for_the_sample_stays_pending(tmp_path):
    a = [_asset(n) for n in range(1, 4)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        before = _ids(conn, lib)
        package = _replace_package(package, a + [_asset(9)])
        for f in (package / "originals").rglob("*.HEIC"):
            f.unlink()
        assert "not_ready" in _drive(conn, lib)
        assert _ids(conn, lib) == before
        reason = client.get(f"/api/admin/libraries/{lib}/status").json()[
            "updating_reason"
        ]
        assert "copy looks incomplete: 4 of 4 sampled photos have no file yet" in reason
        # The files arrive: the next check applies it.
        _replace_package(package, a + [_asset(9)])
        assert "applied" in _drive(conn, lib)
        assert len(_ids(conn, lib)) == 4
    finally:
        conn.close()


def test_a_changing_fingerprint_keeps_the_library_pending(tmp_path):
    a = [_asset(1)]
    conn, _client, package, lib = _setup(tmp_path, a)
    try:
        app_db.set_setting(conn, "library_stable_minutes", "0")
        _replace_package(package, a + [_asset(2)])
        assert library_watch.check_library(conn, lib) == "pending"
        # Still being written between two checks: the window restarts.
        (package / "database" / "extra.bin").write_bytes(b"x" * 10)
        assert library_watch.check_library(conn, lib) == "pending"
        assert len(_ids(conn, lib)) == 1
        assert library_watch.check_library(conn, lib) == "applied"
    finally:
        conn.close()


def test_stability_window_is_respected(tmp_path):
    a = [_asset(1)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        app_db.set_setting(conn, "library_stable_minutes", "10")
        _replace_package(package, a + [_asset(2)])
        assert library_watch.check_library(conn, lib) == "pending"
        assert library_watch.check_library(conn, lib) == "pending"
        assert len(_ids(conn, lib)) == 1
        # "Index now" skips the wait.
        assert (
            client.post(f"/api/admin/libraries/{lib}/reindex", json={}).status_code
            == 200
        )
        assert len(_ids(conn, lib)) == 2
        assert client.get(f"/api/libraries/{lib}/assets").status_code == 200
    finally:
        conn.close()


def test_missing_package_keeps_everything_and_restores_when_it_returns(tmp_path):
    a = [_asset(n) for n in range(1, 4)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        before = _ids(conn, lib)
        conn.execute(
            "INSERT INTO albums (library_id, uuid, title) VALUES (?, 'alb', 'Keep')",
            (lib,),
        )
        conn.commit()
        backup = tmp_path / "backup.photoslibrary"
        shutil.copytree(package, backup)
        shutil.rmtree(package)

        assert library_watch.check_library(conn, lib) == "missing"
        assert _ids(conn, lib) == before
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM albums WHERE library_id = ?", (lib,)
            ).fetchone()[0]
            == 1
        )
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM library_assignments WHERE library_id = ?", (lib,)
            ).fetchone()[0]
            == 1
        )
        assert client.get(f"/api/libraries/{lib}/assets").status_code == 503
        status = client.get(f"/api/admin/libraries/{lib}/status").json()
        assert (
            status["updating"] is True and "missing since" in status["updating_reason"]
        )
        assert library_watch.check_library(conn, lib) == "missing"
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM audit_log WHERE action = 'library.file_missing'"
            ).fetchone()[0]
            == 1
        )

        shutil.copytree(backup, package)
        assert library_watch.check_library(conn, lib) == "ok"
        assert _ids(conn, lib) == before
        assert client.get(f"/api/libraries/{lib}/assets").status_code == 200
    finally:
        conn.close()


def test_optimize_storage_is_detected_and_warned(tmp_path):
    a = [_asset(n) for n in range(1, 5)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        package = _replace_package(package, a)
        for asset in a:
            derivatives = package / "resources" / "derivatives" / asset.uuid[0]
            derivatives.mkdir(parents=True, exist_ok=True)
            (derivatives / f"{asset.uuid}_1_105_c.jpeg").write_bytes(IMG)
        for f in (package / "originals").rglob("*.HEIC"):
            f.unlink()
        assert "applied" in _drive(conn, lib)
        run = client.get(f"/api/admin/libraries/{lib}/status").json()["last_update"]
        assert run["originals_missing"] == 4
        codes = [
            w["code"]
            for w in client.get(f"/api/admin/libraries/{lib}/status").json()["warnings"]
        ]
        assert "originals_missing" in codes
    finally:
        conn.close()


def test_checking_never_writes_into_the_package(tmp_path):
    conn, _client, package, lib = _setup(tmp_path, [_asset(1), _asset(2)])
    try:
        snapshot = _full_snapshot(package)
        _drive(conn, lib)
        library_watch.check_ready(package)[0].close()
        assert _full_snapshot(package) == snapshot
    finally:
        conn.close()


def test_settings_keys_round_trip(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        body = client.get("/api/admin/settings").json()
        assert body["library_check_interval_minutes"] == 15
        assert body["library_stable_minutes"] == 10
        assert body["show_library_updated_note"] is True
        body["library_check_interval_minutes"] = 0
        body["show_library_updated_note"] = False
        out = client.put("/api/admin/settings", json=body).json()
        assert (
            out["library_check_interval_minutes"] == 0
            and out["show_library_updated_note"] is False
        )
    finally:
        conn.close()


def test_updated_note_appears_after_an_update_with_new_photos(tmp_path):
    a = [_asset(1)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        assert client.get("/api/me").json()["libraries"][0]["updated_note"] is None
        _replace_package(package, a + [_asset(2), _asset(3)])
        _drive(conn, lib)
        assert (
            "2 new photos"
            in client.get("/api/me").json()["libraries"][0]["updated_note"]
        )
        app_db.set_setting(conn, "show_library_updated_note", "0")
        assert client.get("/api/me").json()["libraries"][0]["updated_note"] is None
    finally:
        conn.close()


def test_renamed_replace_keeps_id_and_assignments(tmp_path):
    a = [_asset(n) for n in range(1, 4)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        before = _ids(conn, lib)
        renamed = build_library(
            tmp_path / "lib", a + [_asset(4)], package_name="Alice 2026.photoslibrary"
        )
        preview = client.post(
            f"/api/admin/libraries/{lib}/replace", json={"path": str(renamed)}
        ).json()
        assert preview["overlap"] == 1.0 and preview["store_uuid_match"] is True
        assert (preview["would_add"], preview["would_remove"], preview["warnings"]) == (
            1,
            0,
            [],
        )
        assert conn.execute(
            "SELECT path FROM libraries WHERE id = ?", (lib,)
        ).fetchone()["path"] == str(package)

        confirmed = client.post(
            f"/api/admin/libraries/{lib}/replace",
            json={"path": str(renamed), "confirm": True},
        ).json()
        assert confirmed["confirmed"] is True and confirmed["status"]["path"] == str(
            renamed
        )
        after = _ids(conn, lib)
        assert {u: i for u, i in after.items() if u in before} == before and len(
            after
        ) == 4
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM library_assignments WHERE library_id = ?", (lib,)
            ).fetchone()[0]
            == 1
        )
        run = conn.execute(
            "SELECT trigger FROM library_index_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
        assert run["trigger"] == "replace"
        actions = {r["action"] for r in conn.execute("SELECT action FROM audit_log")}
        assert {"library.replace.previewed", "library.replace.confirmed"} <= actions
    finally:
        conn.close()


def test_replace_with_an_unrelated_library_warns_and_needs_override(tmp_path):
    a = [_asset(n) for n in range(1, 4)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        other = build_library(
            tmp_path / "lib",
            [_asset(n) for n in range(50, 53)],
            package_name="Bob.photoslibrary",
            store_uuid="OTHER",
        )
        preview = client.post(
            f"/api/admin/libraries/{lib}/replace", json={"path": str(other)}
        ).json()
        assert preview["overlap"] == 0.0 and preview["store_uuid_match"] is False
        assert {w["code"] for w in preview["warnings"]} == {
            "low_overlap",
            "store_uuid_differs",
        }

        refused = client.post(
            f"/api/admin/libraries/{lib}/replace",
            json={"path": str(other), "confirm": True},
        )
        assert refused.status_code == 409
        assert conn.execute(
            "SELECT path FROM libraries WHERE id = ?", (lib,)
        ).fetchone()["path"] == str(package)
        ok = client.post(
            f"/api/admin/libraries/{lib}/replace",
            json={"path": str(other), "confirm": True, "replace_anyway": True},
        )
        assert ok.status_code == 200
    finally:
        conn.close()


def test_replace_refuses_a_path_registered_as_another_library(tmp_path):
    conn, client, _package, lib = _setup(tmp_path, [_asset(1)])
    try:
        other = build_library(
            tmp_path / "lib", [_asset(2)], package_name="Bob.photoslibrary"
        )
        other_id = client.post(
            "/api/admin/libraries", json={"path": str(other)}
        ).json()["id"]
        response = client.post(
            f"/api/admin/libraries/{lib}/replace", json={"path": str(other)}
        )
        assert response.status_code == 409
        assert other_id != lib
    finally:
        conn.close()


def test_replace_is_admin_only(tmp_path):
    from tests.test_library_admin import _non_admin_client

    conn, client = _non_admin_client(tmp_path)
    try:
        assert (
            client.post(
                "/api/admin/libraries/1/replace", json={"path": "/x"}
            ).status_code
            == 403
        )
    finally:
        conn.close()


def test_user_facing_updating_reason_hides_internal_details() -> None:
    """Users get a fixed reason; exception text and paths stay admin-only."""
    from photos_viewer import library_watch

    pending = {
        "missing_since": None,
        "pending_signature": "x",
        "pending_reason": "indexing failed: /secret/path boom",
    }
    missing = {
        "missing_since": "2026-11-09T03:00:00Z",
        "pending_signature": None,
        "pending_reason": None,
    }
    clear = {"missing_since": None, "pending_signature": None, "pending_reason": None}
    assert library_watch.availability(pending) == (
        True,
        "indexing failed: /secret/path boom",
    )
    updating, reason = library_watch.public_availability(pending)
    assert updating is True and "/secret" not in reason
    assert library_watch.public_availability(missing) == (
        True,
        "The library is temporarily unavailable.",
    )
    assert library_watch.public_availability(clear) == (False, None)


def test_cache_purge_removes_removed_and_changed_assets_only(tmp_path):
    a = [_asset(n) for n in range(1, 5)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        for asset in a:
            assert (
                client.get(f"/api/libraries/{lib}/thumb/{asset.uuid}").status_code
                == 200
            )

        def cached(asset):
            folder = tmp_path / "media_cache" / str(lib) / asset.uuid[:2] / asset.uuid
            return folder.exists() and any(folder.iterdir())

        assert all(cached(x) for x in a)
        # 1 kept, 2 edited, 3 removed, 4 kept.
        _replace_package(
            package,
            [
                a[0],
                FixtureAsset(
                    uuid=a[1].uuid, filename=a[1].filename, data=IMG + b"edit"
                ),
                a[3],
            ],
        )
        assert "applied" in _drive(conn, lib)
        assert cached(a[0]) and cached(a[3])
        assert not cached(a[1]) and not cached(a[2])
    finally:
        conn.close()


def test_original_download_says_when_it_served_a_derivative(tmp_path):
    a = [_asset(1)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        url = f"/api/libraries/{lib}/original/{a[0].uuid}"
        full = client.get(url)
        assert (
            full.status_code == 200 and "x-photos-original-missing" not in full.headers
        )
        package = _replace_package(package, a)
        derivatives = package / "resources" / "derivatives" / a[0].uuid[0]
        derivatives.mkdir(parents=True, exist_ok=True)
        (derivatives / f"{a[0].uuid}_1_105_c.jpeg").write_bytes(IMG)
        for f in (package / "originals").rglob("*.HEIC"):
            f.unlink()
        assert "applied" in _drive(conn, lib)
        fallback = client.get(url + "?download=1")
        assert (
            fallback.status_code == 200
            and fallback.headers["x-photos-original-missing"] == "1"
        )
    finally:
        conn.close()


def test_status_suggests_an_unregistered_library_next_to_a_missing_one(tmp_path):
    conn, client, package, lib = _setup(tmp_path, [_asset(1)])
    try:
        assert (
            client.get(f"/api/admin/libraries/{lib}/status").json()["suggestion"]
            is None
        )
        build_library(
            tmp_path / "lib", [_asset(1)], package_name="Alice 2026.photoslibrary"
        )
        shutil.rmtree(package)
        suggestion = client.get(f"/api/admin/libraries/{lib}/status").json()[
            "suggestion"
        ]
        assert suggestion["name"] == "Alice 2026.photoslibrary"
        assert suggestion["path"] == str(tmp_path / "lib" / "Alice 2026.photoslibrary")
        assert (
            suggestion["message"]
            == "A new library appeared next to this one: Alice 2026.photoslibrary. Replace?"
        )
    finally:
        conn.close()


def test_library_settings_are_bounded(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        body = client.get("/api/admin/settings").json()
        for key, value in (
            ("library_stable_minutes", -1),
            ("library_check_interval_minutes", 100000),
        ):
            assert (
                client.put("/api/admin/settings", json={**body, key: value}).status_code
                == 422
            )
    finally:
        conn.close()
