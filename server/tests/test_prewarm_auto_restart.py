"""D54: a finished pre-warm starts again after an index run that changed
something. Real index runs on the synthetic fixture, driven by hand."""

import os

from photos_viewer import library_prewarm, media
from tests.test_library_prewarm import _cache_files, generations  # noqa: F401
from tests.test_library_replacement import (
    _asset,
    _drive,
    _replace_package,
    _setup,
)


def _state(client, lib):
    return client.get(f"/api/admin/libraries/{lib}/status").json()["prewarm"]


def _start(client, lib):
    return client.post(f"/api/admin/libraries/{lib}/prewarm/start", json={})


def _finish_a_job(tmp_path, client, lib):
    assert _start(client, lib).json()["state"] == "running"
    assert library_prewarm.run_library(tmp_path, lib, pause_s=0) == "done"


def test_finished_job_restarts_and_only_warms_what_is_new(
    tmp_path,
    generations,  # noqa: F811
):
    a = [_asset(1), _asset(2)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        _finish_a_job(tmp_path, client, lib)
        before = len(_cache_files(tmp_path, lib))
        decodes = len(generations)

        # The thumb key includes the source mtime; a rebuilt fixture package
        # has fresh ones, so carry the old mtimes over like a real copy would.
        mtimes = {
            f.name: f.stat().st_mtime_ns
            for f in (package / "originals").rglob("*")
            if f.is_file()
        }
        package = _replace_package(package, a + [_asset(3), _asset(4, hidden=True)])
        for f in (package / "originals").rglob("*"):
            if f.is_file() and f.name in mtimes:
                os.utime(f, ns=(mtimes[f.name], mtimes[f.name]))
        _drive(conn, lib)

        status = _state(client, lib)
        assert status["state"] == "running"
        assert status["total"] == 3  # Hidden is not eligible
        assert library_prewarm.run_library(tmp_path, lib, pause_s=0) == "done"
        assert len(_cache_files(tmp_path, lib)) == before + 2  # grid + grid2x
        assert len(generations) == decodes + 2  # cached assets were skipped
        audit = conn.execute(
            "SELECT actor FROM audit_log WHERE action = 'prewarm.auto_restart'"
        ).fetchall()
        assert [r["actor"] for r in audit] == ["system"]
    finally:
        conn.close()


def test_never_run_prewarm_is_not_started(tmp_path):
    a = [_asset(1)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        _replace_package(package, a + [_asset(2)])
        _drive(conn, lib)
        assert _state(client, lib)["state"] == "idle"
    finally:
        conn.close()


def test_paused_job_stays_paused(tmp_path):
    a = [_asset(1)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        _start(client, lib)
        client.post(f"/api/admin/libraries/{lib}/prewarm/pause", json={})
        _replace_package(package, a + [_asset(2)])
        _drive(conn, lib)
        assert _state(client, lib)["state"] == "paused"
    finally:
        conn.close()


def test_cleared_job_is_not_restarted(tmp_path):
    a = [_asset(1)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        _finish_a_job(tmp_path, client, lib)
        client.post(f"/api/admin/libraries/{lib}/thumbnail-cache/clear", json={})
        _replace_package(package, a + [_asset(2)])
        _drive(conn, lib)
        assert _state(client, lib)["state"] == "idle"
    finally:
        conn.close()


def test_an_update_that_changed_nothing_leaves_a_finished_job_done(tmp_path):
    a = [_asset(1)]
    conn, client, _package, lib = _setup(tmp_path, a)
    try:
        _finish_a_job(tmp_path, client, lib)
        # A forced re-index of an identical library: no asset changes.
        client.post(f"/api/admin/libraries/{lib}/reindex", json={})
        assert _state(client, lib)["state"] == "done"
    finally:
        conn.close()


def test_restart_respects_the_ninety_percent_pause(tmp_path, generations):  # noqa: F811
    a = [_asset(1)]
    conn, client, package, lib = _setup(tmp_path, a)
    try:
        _finish_a_job(tmp_path, client, lib)
        used = sum(f.stat().st_size for f in _cache_files(tmp_path, lib))
        from photos_viewer import app_db

        app_db.set_setting(conn, "media_cache_size_limit_bytes", str(used + 1))
        media._cache_totals.clear()
        _replace_package(package, a + [_asset(2)])
        _drive(conn, lib)
        assert _state(client, lib)["state"] == "running"
        assert library_prewarm.run_library(tmp_path, lib, pause_s=0) == "paused"
        assert "cache" in _state(client, lib)["note"]
    finally:
        conn.close()
