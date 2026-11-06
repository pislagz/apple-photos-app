"""P0.3: opening a library for indexing never writes into the package.

Snapshots the fixture package's file and directory names, sizes, and
mtimes, opens it via `open_library_readonly`, then snapshots again. The
package must be byte-for-byte unchanged -- no new `-wal`/`-shm`/journal
file, no new directory, no mtime drift. Covers both the normal temp-copy
path and the narrowed in-place fallback (only a failure of the copy step
itself may fall back; a `PhotosDB` error on a successfully made copy must
propagate instead).
"""

import pathlib
import shutil
import sqlite3
import tempfile
import unittest.mock

import pytest

from photos_viewer import libraries
from photos_viewer.libraries import open_library_readonly
from tests.fixtures import build_fixture_library


def _snapshot(package_path: pathlib.Path) -> dict:
    snapshot = {}
    for path in sorted(package_path.rglob("*")):
        rel = str(path.relative_to(package_path))
        stat = path.stat()
        snapshot[rel] = (
            ("dir", stat.st_mtime_ns)
            if path.is_dir()
            else (stat.st_size, stat.st_mtime_ns)
        )
    return snapshot


def _leaked_tempdirs() -> set[pathlib.Path]:
    return set(pathlib.Path(tempfile.gettempdir()).glob("photos_viewer_*"))


def test_snapshot_detects_a_new_wal_file(tmp_path):
    # Guards the guard: if `_snapshot` stopped noticing a new file, every
    # other test in this module would pass for the wrong reason.
    package_path = build_fixture_library(tmp_path)
    before = _snapshot(package_path)

    (package_path / "database" / "Photos.sqlite-wal").write_bytes(b"new wal contents")

    after = _snapshot(package_path)
    assert before != after


def test_package_unchanged_after_open_via_copy(tmp_path):
    package_path = build_fixture_library(tmp_path)

    before = _snapshot(package_path)
    with open_library_readonly(package_path) as opened:
        assert opened.open_mode == "copy"
        after = _snapshot(package_path)

    assert before == after


def test_copy_replays_a_real_uncheckpointed_wal_change(tmp_path):
    # The fixture's `-wal` holds a real, committed-but-unmerged change (see
    # `tests.fixtures._write_uncheckpointed_wal_change`): the main db file
    # alone still says `favorite=False`, and only a reader that also has the
    # `-wal` -- which the copy step copies alongside `Photos.sqlite` -- sees
    # the new value.
    package_path = build_fixture_library(tmp_path)

    # Prove the premise: a copy of `Photos.sqlite` on its own (no `-wal`/
    # `-shm`) still has the old value. Otherwise the assertion below -- that
    # the copy step's inclusion of `-wal` is what changes the answer -- would
    # be checking nothing.
    sqlite_only_copy = tmp_path / "Photos-sqlite-only.sqlite"
    shutil.copy2(package_path / "database" / "Photos.sqlite", sqlite_only_copy)
    conn = sqlite3.connect(str(sqlite_only_copy))
    try:
        favorite = conn.execute(
            "SELECT ZFAVORITE FROM ZGENERICASSET WHERE Z_PK = 1"
        ).fetchone()[0]
    finally:
        conn.close()
    assert favorite == 0

    before = _snapshot(package_path)
    with open_library_readonly(package_path) as opened:
        assert opened.open_mode == "copy"
        photos = opened.db.photos()
        assert len(photos) == 1
        assert photos[0].favorite is True
        after = _snapshot(package_path)

    assert before == after


def test_package_unchanged_after_open_via_fallback(tmp_path, monkeypatch):
    package_path = build_fixture_library(tmp_path)

    def copy_fails(*_args, **_kwargs):
        raise OSError("simulated copy failure: read-only temp filesystem")

    monkeypatch.setattr(libraries.shutil, "copy2", copy_fails)

    before = _snapshot(package_path)
    with open_library_readonly(package_path) as opened:
        assert opened.open_mode == "ro"
        after = _snapshot(package_path)

    assert before == after


def test_photosdb_error_on_a_made_copy_is_not_swallowed_into_fallback(tmp_path):
    # A failure *after* the copy succeeds (a bad PhotosDB open) is not a copy
    # failure -- it must propagate, not trigger the in-place fallback and
    # silently open the original instead.
    before = _leaked_tempdirs()
    package_path = build_fixture_library(tmp_path)
    copy_of_copy2 = shutil.copy2

    def corrupt_the_copy(src, dst, *args, **kwargs):
        copy_of_copy2(src, dst, *args, **kwargs)
        if pathlib.Path(dst).name == "Photos.sqlite":
            pathlib.Path(dst).write_bytes(b"not a sqlite database")

    with (
        unittest.mock.patch.object(
            libraries.shutil, "copy2", side_effect=corrupt_the_copy
        ),
        pytest.raises(sqlite3.DatabaseError, match="file is not a database"),
    ):
        open_library_readonly(package_path)

    assert _leaked_tempdirs() == before


def test_no_leaked_tempdir_after_close(tmp_path):
    before = _leaked_tempdirs()
    package_path = build_fixture_library(tmp_path)

    with open_library_readonly(package_path) as opened:
        assert opened.open_mode == "copy"

    assert _leaked_tempdirs() == before


def test_no_leaked_tempdir_after_a_failed_open(tmp_path, monkeypatch):
    before = _leaked_tempdirs()
    package_path = build_fixture_library(tmp_path)
    monkeypatch.setattr(libraries, "SUPPORTED_PHOTOS_VERSIONS", frozenset())

    with pytest.raises(libraries.UnsupportedPhotosVersionError):
        open_library_readonly(package_path)

    assert _leaked_tempdirs() == before
