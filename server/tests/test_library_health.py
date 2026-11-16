"""#461: a connected drive whose library keeps going "broken".

Each test reproduces one way a library on a connected drive used to end up
"not mounted", "unreadable", in an error state, or hidden from its users, and
checks the server now names the real cause, keeps serving the last good index,
and recovers by itself."""

import datetime
import errno
import logging
import os
import pathlib
import shutil
import sqlite3
import time

import pytest

from photos_viewer import (
    app_db,
    indexer,
    libraries,
    library_health,
    library_watch,
    search_index,
)
from tests.fixtures import build_fixture_library
from tests.test_library_admin import _admin_client


@pytest.fixture(autouse=True)
def _fast_retries(monkeypatch):
    monkeypatch.setattr(libraries, "COPY_RETRY_SECONDS", 0)


def _add(tmp_path, client, conn):
    package = build_fixture_library(tmp_path / "Volumes" / "Photos")
    added = client.post("/api/admin/libraries", json={"path": str(package)}).json()
    app_db.set_setting(conn, "library_stable_minutes", "0")
    return package, added["id"]


def _row(conn, lib):
    return conn.execute("SELECT * FROM libraries WHERE id = ?", (lib,)).fetchone()


def _counts(conn, lib):
    return (
        conn.execute(
            "SELECT COUNT(*) FROM assets WHERE library_id = ?", (lib,)
        ).fetchone()[0],
        conn.execute(
            "SELECT COUNT(*) FROM asset_people JOIN assets ON assets.id = asset_id WHERE library_id = ?",
            (lib,),
        ).fetchone()[0],
        conn.execute(
            "SELECT COUNT(*) FROM asset_albums JOIN assets ON assets.id = asset_id WHERE library_id = ?",
            (lib,),
        ).fetchone()[0],
    )


def _photos_writes(package: pathlib.Path, pk: int = 2) -> sqlite3.Connection:
    """What Photos does to an open library: a WAL write to the same files.
    The connection stays open, like Photos', so the WAL is not merged."""
    conn = sqlite3.connect(str(package / "database" / "Photos.sqlite"))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        "UPDATE ZGENERICASSET SET ZFAVORITE = 1 - ZFAVORITE WHERE Z_PK = ?", (pk,)
    )
    conn.commit()
    return conn


def _deny(monkeypatch, package: pathlib.Path, err: int, *, on: str = "stat"):
    """Simulate macOS privacy (TCC) or a failing drive for paths in the
    package: `stat` or `open` fails with `err`."""
    real_stat, real_open = os.stat, os.open

    def inside(path) -> bool:
        try:
            return pathlib.Path(os.fspath(path)).is_relative_to(package)
        except TypeError:
            return False

    def fake_stat(path, *args, **kwargs):
        if on == "stat" and inside(path):
            raise OSError(err, os.strerror(err), os.fspath(path))
        return real_stat(path, *args, **kwargs)

    def fake_open(path, *args, **kwargs):
        if inside(path):
            raise OSError(err, os.strerror(err), os.fspath(path))
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(library_health.os, "stat", fake_stat)
    monkeypatch.setattr(library_health.os, "open", fake_open)


# --- probe_path: telling the causes apart ----------------------------------


def test_permission_denied_on_stat_is_not_reported_as_unmounted(tmp_path, monkeypatch):
    package = tmp_path / "Lib.photoslibrary"
    (package / "database").mkdir(parents=True)
    _deny(monkeypatch, package, errno.EPERM)

    probe = library_health.probe_path(package)

    assert probe.code == library_health.NO_PERMISSION
    assert probe.errno == errno.EPERM
    assert library_health.exists(package) is False  # never raises


def test_privacy_block_on_open_is_no_permission(tmp_path, monkeypatch):
    # TCC typically lets `stat` through and refuses opening files.
    package = tmp_path / "Lib.photoslibrary"
    (package / "database").mkdir(parents=True)
    (package / "database" / "Photos.sqlite").write_bytes(b"x")
    _deny(monkeypatch, package, errno.EACCES, on="open")

    assert library_health.probe_path(package).code == library_health.NO_PERMISSION


def test_drive_io_error_is_a_drive_error(tmp_path, monkeypatch):
    package = tmp_path / "Lib.photoslibrary"
    package.mkdir()
    _deny(monkeypatch, package, errno.EIO)

    assert library_health.probe_path(package).code == library_health.DRIVE_ERROR


def test_unmounted_volume_vs_a_missing_package(tmp_path):
    volume = tmp_path / "Volumes" / "Photos"
    volume.mkdir(parents=True)
    assert (
        library_health.probe_path(volume / "Lib.photoslibrary").code
        == library_health.LIBRARY_MISSING
    )
    assert (
        library_health.probe_path(
            tmp_path / "Volumes" / "Gone" / "Lib.photoslibrary"
        ).code
        == library_health.NOT_MOUNTED
    )


def test_volume_remounted_as_name_1_is_found(tmp_path):
    renamed = tmp_path / "Volumes" / "Photos 1" / "Lib.photoslibrary"
    renamed.mkdir(parents=True)

    probe = library_health.probe_path(
        tmp_path / "Volumes" / "Photos" / "Lib.photoslibrary"
    )

    assert probe.code == library_health.VOLUME_RENAMED
    assert probe.renamed_to == renamed


def test_classify_names_the_cause():
    assert (
        library_health.classify(PermissionError(errno.EPERM, "x"))
        == library_health.NO_PERMISSION
    )
    assert (
        library_health.classify(OSError(errno.ENOSPC, "x")) == library_health.TEMP_FULL
    )
    assert (
        library_health.classify(sqlite3.OperationalError("database is locked"))
        == library_health.PHOTOS_BUSY
    )
    assert (
        library_health.classify(library_health.LibraryBusyError("x"))
        == library_health.PHOTOS_BUSY
    )
    assert (
        library_health.classify(sqlite3.DatabaseError("file is not a database"))
        == library_health.UNREADABLE
    )
    wrapped = RuntimeError("walk failed")
    wrapped.__cause__ = OSError(errno.EIO, "x")
    assert library_health.classify(wrapped) == library_health.DRIVE_ERROR


# --- the admin page and the users while a drive misbehaves -------------------


def test_status_with_no_permission_is_not_a_500_and_users_keep_their_photos(
    tmp_path, monkeypatch, caplog
):
    conn, client = _admin_client(tmp_path)
    try:
        package, lib = _add(tmp_path, client, conn)
        _deny(monkeypatch, package, errno.EPERM)

        with caplog.at_level(logging.WARNING, logger="photos_viewer.library_health"):
            assert library_watch.check_library(conn, lib) == "unavailable"
            response = client.get(f"/api/admin/libraries/{lib}/status")

        assert response.status_code == 200
        codes = [w["code"] for w in response.json()["warnings"]]
        assert codes == ["no_permission"]
        assert "Full Disk Access" in response.json()["warnings"][0]["message"]
        assert _row(conn, lib)["missing_since"] is None
        assert client.get(f"/api/libraries/{lib}/assets").status_code == 200
        assert any(
            "code=no_permission" in r.message and "errno=EPERM" in r.message
            for r in caplog.records
        )
    finally:
        conn.close()


def test_status_offers_the_renamed_volume(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package, lib = _add(tmp_path, client, conn)
        renamed_volume = package.parent.with_name("Photos 1")
        shutil.move(package.parent, renamed_volume)

        body = client.get(f"/api/admin/libraries/{lib}/status").json()

        assert [w["code"] for w in body["warnings"]] == ["volume_renamed"]
        assert "Photos 1" in body["warnings"][0]["message"]
        assert body["suggestion"]["path"] == str(renamed_volume / package.name)
    finally:
        conn.close()


def test_status_poll_does_not_copy_the_database(tmp_path, monkeypatch):
    conn, client = _admin_client(tmp_path)
    try:
        _package, lib = _add(tmp_path, client, conn)

        def boom(*_a, **_k):
            raise AssertionError("status must not open the library")

        monkeypatch.setattr(libraries, "open_library_readonly", boom)
        monkeypatch.setattr("photos_viewer.library_admin.open_library_readonly", boom)

        response = client.get(f"/api/admin/libraries/{lib}/status")

        assert response.status_code == 200
        assert response.json()["warnings"] == []
    finally:
        conn.close()


# --- Photos writing to the library in place ---------------------------------


def test_photos_writing_in_place_keeps_serving_and_says_so(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package, lib = _add(tmp_path, client, conn)
        before = _counts(conn, lib)
        writer = _photos_writes(package)
        try:
            app_db.set_setting(conn, "library_stable_minutes", "10")
            assert library_watch.check_library(conn, lib) == "pending"
            assert _row(conn, lib)["in_place_since"] is not None

            # Not "Being updated": everyone keeps the last good index.
            assert client.get(f"/api/libraries/{lib}/assets").status_code == 200
            assert client.get("/api/me").json()["libraries"][0]["updating"] is False
            status = client.get(f"/api/admin/libraries/{lib}/status").json()
            assert status["updating"] is False
            assert [w["code"] for w in status["warnings"]] == ["photos_busy"]
            assert "Photos on the Mac is updating" in status["warnings"][0]["message"]

            # Photos settles: the change is applied like any other.
            app_db.set_setting(conn, "library_stable_minutes", "0")
            assert library_watch.check_library(conn, lib) == "applied"
            assert _counts(conn, lib) == before
            row = _row(conn, lib)
            assert row["in_place_since"] is None and row["pending_signature"] is None
        finally:
            writer.close()
    finally:
        conn.close()


def test_photos_never_settling_is_indexed_after_the_max_wait(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        package, lib = _add(tmp_path, client, conn)
        app_db.set_setting(conn, "library_stable_minutes", "10")
        start = datetime.datetime.now(datetime.UTC)
        writers = []
        try:
            for minute in range(0, 61, 15):
                writers.append(_photos_writes(package))
                now = start + datetime.timedelta(minutes=minute)
                assert library_watch.check_library(conn, lib, now=now) == "pending"
            # Changed again 1 minute ago, but it has been changing for > 1 hour.
            late = start + datetime.timedelta(
                minutes=library_watch.IN_PLACE_MAX_WAIT_MINUTES + 1
            )
            assert library_watch.observe(conn, lib, now=late) == "stable"
        finally:
            for writer in writers:
                writer.close()
    finally:
        conn.close()


def test_copy_torn_by_a_checkpoint_is_retried_then_reported_busy(tmp_path, monkeypatch):
    package = build_fixture_library(tmp_path)
    ticks = iter(range(1000))
    monkeypatch.setattr(libraries, "_stat_key", lambda _p: next(ticks))
    before = set(pathlib.Path(libraries.tempfile.gettempdir()).glob("photos_viewer_*"))

    with pytest.raises(library_health.LibraryBusyError):
        libraries.open_library_readonly(package)

    after = set(pathlib.Path(libraries.tempfile.gettempdir()).glob("photos_viewer_*"))
    assert after - before == set()  # no temp copy left behind


def test_copy_succeeds_when_photos_stops_writing_mid_retry(tmp_path, monkeypatch):
    package = build_fixture_library(tmp_path)
    values = iter([1, 2, 3, 3])  # torn once, then clean
    monkeypatch.setattr(libraries, "_stat_key", lambda _p: next(values))

    with libraries.open_library_readonly(package) as opened:
        assert opened.open_mode == "copy"


def test_photos_busy_during_apply_keeps_the_index_and_backs_off(tmp_path, monkeypatch):
    conn, client = _admin_client(tmp_path)
    try:
        package, lib = _add(tmp_path, client, conn)
        before = _counts(conn, lib)
        writer = _photos_writes(package)
        try:
            real = libraries.open_library_readonly

            def busy(_path):
                raise library_health.LibraryBusyError("changed while copying")

            monkeypatch.setattr(libraries, "open_library_readonly", busy)
            results = [library_watch.check_library(conn, lib) for _ in range(3)]
            assert results == ["pending", "not_ready", "waiting"]

            row = _row(conn, lib)
            assert row["index_state"] != "error"
            assert row["problem_code"] == "photos_busy"
            assert row["retry_after"] is not None
            assert _counts(conn, lib) == before
            assert client.get(f"/api/libraries/{lib}/assets").status_code == 200
            status = client.get(f"/api/admin/libraries/{lib}/status").json()
            assert [w["code"] for w in status["warnings"]] == ["photos_busy"]

            # Photos is done; the backoff ends (or the admin presses Check now).
            monkeypatch.setattr(libraries, "open_library_readonly", real)
            assert library_watch.check_library(conn, lib) == "waiting"
            assert (
                library_watch.check_library(conn, lib, ignore_backoff=True) == "applied"
            )
            row = _row(conn, lib)
            assert row["problem_code"] is None and row["retry_after"] is None
        finally:
            writer.close()
    finally:
        conn.close()


def test_backoff_doubles_and_caps(tmp_path):
    conn, client = _admin_client(tmp_path)
    try:
        _package, lib = _add(tmp_path, client, conn)
        now = datetime.datetime(2026, 11, 16, tzinfo=datetime.UTC)
        delays = []
        for _ in range(9):
            library_watch.record_problem(
                conn, lib, "photos_busy", "x", phase="apply", now=now
            )
            retry = datetime.datetime.fromisoformat(_row(conn, lib)["retry_after"])
            delays.append(int((retry - now).total_seconds() // 60))
        assert delays == [5, 10, 20, 40, 80, 160, 320, 360, 360]
    finally:
        conn.close()


# --- copying a big Photos.sqlite --------------------------------------------


def test_not_enough_temp_space_opens_in_place_read_only(tmp_path, monkeypatch, caplog):
    package = build_fixture_library(tmp_path)
    monkeypatch.setattr(libraries, "_free_bytes", lambda _d: 1024)

    with (
        caplog.at_level(logging.WARNING, logger="photos_viewer.library_health"),
        libraries.open_library_readonly(package) as opened,
    ):
        assert opened.open_mode == "ro"
        assert len(list(opened.db.photos())) > 0

    assert any("code=temp_full" in r.message for r in caplog.records)


def test_disk_full_mid_copy_falls_back_too(tmp_path, monkeypatch):
    package = build_fixture_library(tmp_path)
    real_copy = libraries.shutil.copy2

    def full(src, dst, *a, **k):
        # sendfile reports ENOSPC with the *source* as filename.
        raise OSError(errno.ENOSPC, "No space left on device", str(src))

    monkeypatch.setattr(libraries.shutil, "copy2", full)
    with libraries.open_library_readonly(package) as opened:
        assert opened.open_mode == "ro"
    monkeypatch.setattr(libraries.shutil, "copy2", real_copy)


def test_unreadable_source_is_reported_not_papered_over(tmp_path, monkeypatch):
    package = build_fixture_library(tmp_path)

    def denied(src, dst, *a, **k):
        raise PermissionError(errno.EPERM, "Operation not permitted", str(src))

    monkeypatch.setattr(libraries.shutil, "copy2", denied)
    with pytest.raises(PermissionError) as info:
        libraries.open_library_readonly(package)
    assert library_health.classify(info.value) == library_health.NO_PERMISSION


def test_permission_lost_during_apply_never_marks_the_library_broken(
    tmp_path, monkeypatch
):
    conn, client = _admin_client(tmp_path)
    try:
        package, lib = _add(tmp_path, client, conn)
        before = _counts(conn, lib)
        writer = _photos_writes(package)
        try:

            def denied(_path):
                raise PermissionError(
                    errno.EPERM, "Operation not permitted", str(package)
                )

            monkeypatch.setattr(libraries, "open_library_readonly", denied)
            assert library_watch.check_library(conn, lib) == "pending"
            assert library_watch.check_library(conn, lib) == "not_ready"
            row = _row(conn, lib)
            assert row["index_state"] != "error"
            assert row["problem_code"] == "no_permission"
            assert _counts(conn, lib) == before
            assert client.get(f"/api/libraries/{lib}/assets").status_code == 200
        finally:
            writer.close()
    finally:
        conn.close()


def test_stale_temp_copies_are_cleaned_up(tmp_path, monkeypatch):
    monkeypatch.setattr(libraries.tempfile, "tempdir", str(tmp_path))
    old = tmp_path / "photos_viewer_old"
    fresh = tmp_path / "photos_viewer_fresh"
    other = tmp_path / "something_else"
    for d in (old, fresh, other):
        d.mkdir()
    long_ago = time.time() - 3 * 24 * 3600
    os.utime(old, (long_ago, long_ago))
    os.utime(other, (long_ago, long_ago))

    assert libraries.cleanup_stale_tempdirs() == 1
    assert not old.exists() and fresh.exists() and other.exists()


# --- a failed walk never damages the last good index ------------------------


def test_walk_failing_after_a_committed_batch_keeps_people_and_albums(
    tmp_path, monkeypatch
):
    conn, client = _admin_client(tmp_path)
    try:
        _package, lib = _add(tmp_path, client, conn)
        before = _counts(conn, lib)
        assert before[1] > 0 and before[2] > 0
        people_ids = [r[0] for r in conn.execute("SELECT id FROM people")]

        monkeypatch.setattr(indexer, "INDEX_BATCH_SIZE", 1)
        calls = {"n": 0}
        real_put = search_index.put

        def failing_put(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise OSError(errno.EIO, "Input/output error")
            return real_put(*args, **kwargs)

        monkeypatch.setattr(search_index, "put", failing_put)
        conn.execute("UPDATE libraries SET reindex_needed = 1 WHERE id = ?", (lib,))
        conn.commit()

        assert library_watch.check_library(conn, lib) == "ok"

        assert _counts(conn, lib) == before
        assert [r[0] for r in conn.execute("SELECT id FROM people")] == people_ids
        row = _row(conn, lib)
        assert row["reindex_needed"] == 1  # tried again later
        assert row["problem_code"] == "drive_error"
        assert row["index_state"] != "error"

        monkeypatch.setattr(search_index, "put", real_put)
        assert (
            library_watch.check_library(conn, lib, ignore_backoff=True) == "reindexed"
        )
        assert _counts(conn, lib) == before
    finally:
        conn.close()
