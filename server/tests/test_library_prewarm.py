"""P3.3: resumable thumbnail pre-warm."""

from __future__ import annotations

import pytest
from PIL import Image

from photos_viewer import app_db, library_prewarm, media, session_auth
from tests.test_library_admin import _admin_client
from tests.test_library_assets import _insert_asset

N = 6


def _tree(root):
    return sorted(
        (str(p.relative_to(root)), p.stat().st_mtime_ns, p.stat().st_size)
        for p in root.rglob("*")
    )


def _setup(tmp_path, count=N, *, library_name="L1"):
    conn, client = _admin_client(tmp_path)
    client.app.dependency_overrides[session_auth.get_media_cache_dir] = lambda: (
        app_db.media_cache_dir(tmp_path)
    )
    package = tmp_path / f"{library_name}.photoslibrary"
    originals = package / "originals"
    originals.mkdir(parents=True)
    library_id = conn.execute(
        "INSERT INTO libraries (display_name, path) VALUES (?, ?)",
        (library_name, str(package)),
    ).lastrowid
    conn.execute(
        "INSERT INTO library_assignments (user_id, library_id) SELECT id, ? FROM users WHERE username = 'admin'",
        (library_id,),
    )
    conn.commit()
    for i in range(count):
        path = originals / f"a{i}.jpg"
        Image.new("RGB", (900, 600), (i * 30, 80, 120)).save(path, "JPEG")
        _insert_asset(
            conn,
            library_id,
            f"a{i}",
            path_original=str(path),
            original_filename=f"a{i}.jpg",
        )
    return conn, client, library_id, package


@pytest.fixture
def generations(monkeypatch):
    """Counts real decodes (cache misses) so a hit is distinguishable."""
    calls: list[tuple[str, int]] = []
    real = media._generate_from_chosen

    def counting(chosen, target_px, quality, *, is_video):
        calls.append((chosen.name, target_px))
        return real(chosen, target_px, quality, is_video=is_video)

    monkeypatch.setattr(media, "_generate_from_chosen", counting)
    return calls


def _start(client, library_id):
    return client.post(f"/api/admin/libraries/{library_id}/prewarm/start", json={})


def _cache_files(tmp_path, library_id):
    root = app_db.media_cache_dir(tmp_path) / str(library_id)
    return [p for p in root.rglob("*") if p.is_file()] if root.exists() else []


def test_job_fills_cache_under_data_dir_and_package_is_unchanged(tmp_path, generations):
    conn, client, lib, package = _setup(tmp_path)
    try:
        before = _tree(package)
        assert _start(client, lib).json()["state"] == "running"
        assert library_prewarm.run_library(tmp_path, lib, pause_s=0) == "done"
        files = _cache_files(tmp_path, lib)
        assert len(files) == N * 2  # grid + grid2x
        assert all(f.is_relative_to(app_db.media_cache_dir(tmp_path)) for f in files)
        assert _tree(package) == before
        status = client.get(f"/api/admin/libraries/{lib}/status").json()
        assert status["prewarm_progress"] == 1.0
        assert status["prewarm"]["state"] == "done" and status["prewarm"]["done"] == N
    finally:
        conn.close()


def test_resume_after_kill_does_not_regenerate_finished_thumbs(tmp_path, generations):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        _start(client, lib)
        # "Killed" after 3 assets: the first job object just stops.
        assert (
            library_prewarm.run_library(tmp_path, lib, max_assets=3, pause_s=0)
            == "running"
        )
        assert len(generations) == 6
        status = client.get(f"/api/admin/libraries/{lib}/status").json()
        assert status["prewarm"]["done"] == 3 and 0 < status["prewarm_progress"] < 1
        generations.clear()
        # Fresh run (a restarted process): continues from the cursor.
        assert library_prewarm.run_library(tmp_path, lib, pause_s=0) == "done"
        assert len(generations) == 6
        assert {name for name, _ in generations} == {"a3.jpg", "a4.jpg", "a5.jpg"}
        # Even with the cursor lost, the cache alone prevents regeneration.
        conn.execute("UPDATE prewarm_jobs SET state = 'running', cursor_uuid = NULL")
        conn.commit()
        generations.clear()
        assert library_prewarm.run_library(tmp_path, lib, pause_s=0) == "done"
        assert generations == []
    finally:
        conn.close()


def test_pause_stops_new_work_and_resume_continues(tmp_path, generations):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        _start(client, lib)
        library_prewarm.run_library(tmp_path, lib, max_assets=2, pause_s=0)
        assert (
            client.post(f"/api/admin/libraries/{lib}/prewarm/pause", json={}).json()[
                "state"
            ]
            == "paused"
        )
        generations.clear()
        assert library_prewarm.run_library(tmp_path, lib, pause_s=0) == "paused"
        assert generations == []
        assert _start(client, lib).json()["state"] == "running"
        assert library_prewarm.run_library(tmp_path, lib, pause_s=0) == "done"
        assert len(_cache_files(tmp_path, lib)) == N * 2
    finally:
        conn.close()


def test_pause_during_a_run_stops_before_the_next_asset(tmp_path, generations):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        _start(client, lib)
        handled = []

        def stop_after_two_then_pause():
            handled.append(1)
            if len(handled) == 3:
                client.post(f"/api/admin/libraries/{lib}/prewarm/pause", json={})
            return False

        library_prewarm.run_library(
            tmp_path, lib, should_stop=stop_after_two_then_pause, pause_s=0
        )
        # The asset in flight when the pause landed finishes; no 4th starts.
        assert len(_cache_files(tmp_path, lib)) == 3 * 2
    finally:
        conn.close()


def test_cache_limit_pauses_the_job_with_a_note(tmp_path, generations):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        app_db.set_setting(conn, "media_cache_size_limit_bytes", "3000")
        media._cache_totals.clear()
        _start(client, lib)
        assert library_prewarm.run_library(tmp_path, lib, pause_s=0) == "paused"
        status = client.get(f"/api/admin/libraries/{lib}/status").json()["prewarm"]
        assert status["state"] == "paused" and "cache" in status["note"]
    finally:
        conn.close()


def test_start_refused_when_cache_is_disabled(tmp_path):
    conn, client, lib, _ = _setup(tmp_path)
    try:
        app_db.set_setting(conn, "media_cache_size_limit_bytes", "0")
        assert _start(client, lib).status_code == 400
    finally:
        conn.close()


def test_undecodable_asset_is_counted_not_fatal(tmp_path, generations):
    conn, client, lib, package = _setup(tmp_path, count=3)
    try:
        (package / "originals" / "a1.jpg").write_bytes(b"not an image")
        _start(client, lib)
        assert library_prewarm.run_library(tmp_path, lib, pause_s=0) == "done"
        assert (
            client.get(f"/api/admin/libraries/{lib}/status").json()["prewarm"]["failed"]
            == 1
        )
    finally:
        conn.close()


def test_clear_cache_deletes_only_this_librarys_files_and_resets_the_job(
    tmp_path, generations
):
    conn, client, lib, package = _setup(tmp_path, count=3)
    other = conn.execute(
        "INSERT INTO libraries (display_name, path) VALUES ('L2', ?)",
        (str(tmp_path / "x"),),
    ).lastrowid
    conn.commit()
    try:
        other_file = (
            app_db.media_cache_dir(tmp_path) / str(other) / "aa" / "aaa" / "k.webp"
        )
        other_file.parent.mkdir(parents=True)
        other_file.write_bytes(b"x")
        _start(client, lib)
        library_prewarm.run_library(tmp_path, lib, pause_s=0)
        before = _tree(package)
        response = client.post(
            f"/api/admin/libraries/{lib}/thumbnail-cache/clear", json={}
        )
        assert response.status_code == 200
        assert (
            response.json()["freed_bytes"] > 0
            and response.json()["status"]["state"] == "idle"
        )
        assert _cache_files(tmp_path, lib) == []
        assert other_file.exists()
        assert _tree(package) == before
        assert (
            client.get(f"/api/admin/libraries/{lib}/status").json()["prewarm_progress"]
            is None
        )
        actions = [r["action"] for r in conn.execute("SELECT action FROM audit_log")]
        assert "prewarm.start" in actions and "prewarm.clear_cache" in actions
    finally:
        conn.close()


def test_prewarmed_thumb_is_served_from_the_cache(tmp_path, generations):
    conn, client, lib, _ = _setup(tmp_path, count=2)
    try:
        _start(client, lib)
        library_prewarm.run_library(tmp_path, lib, pause_s=0)
        generations.clear()
        assert client.get(f"/api/libraries/{lib}/thumb/a0?size=grid").status_code == 200
        assert (
            client.get(f"/api/libraries/{lib}/thumb/a0?size=grid2x").status_code == 200
        )
        assert generations == []
    finally:
        conn.close()


def test_hidden_assets_are_skipped(tmp_path, generations):
    conn, client, lib, _ = _setup(tmp_path, count=3)
    try:
        conn.execute("UPDATE assets SET hidden = 1 WHERE uuid = 'a1'")
        conn.commit()
        _start(client, lib)
        library_prewarm.run_library(tmp_path, lib, pause_s=0)
        assert len(_cache_files(tmp_path, lib)) == 4
    finally:
        conn.close()


@pytest.mark.parametrize(
    ("method", "suffix"),
    [
        ("post", "prewarm/start"),
        ("post", "prewarm/pause"),
        ("post", "thumbnail-cache/clear"),
    ],
)
def test_admin_only_and_csrf(tmp_path, method, suffix):
    conn, client, lib, _ = _setup(tmp_path, count=1)
    try:
        url = f"/api/admin/libraries/{lib}/{suffix}"
        assert client.post(
            url, json={}, headers={"Origin": "https://evil.example"}
        ).status_code in (400, 403)
        assert _cache_files(tmp_path, lib) == []
        client.post("/api/auth/logout")
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES ('bob', ?, 'user')",
            (session_auth.hash_password("correct-horse-battery"),),
        )
        conn.commit()
        client.post(
            "/api/auth/login",
            json={"username": "bob", "password": "correct-horse-battery"},
        )
        assert client.post(url, json={}).status_code == 403
        assert conn.execute("SELECT COUNT(*) FROM prewarm_jobs").fetchone()[0] == 0
        assert (
            client.post(f"/api/admin/libraries/9999/{suffix}", json={}).status_code
            == 403
        )
    finally:
        conn.close()


def test_a_new_worker_resumes_a_job_left_running(tmp_path, generations):
    conn, client, lib, _ = _setup(tmp_path, count=3)
    try:
        _start(client, lib)
        library_prewarm.run_library(tmp_path, lib, max_assets=1, pause_s=0)
        generations.clear()
        worker = library_prewarm.PrewarmWorker(lambda: tmp_path)  # a restarted process
        assert worker._run_one(tmp_path) is True
        assert {name for name, _ in generations} == {"a1.jpg", "a2.jpg"}
        assert worker._run_one(tmp_path) is False  # nothing left running
    finally:
        conn.close()
