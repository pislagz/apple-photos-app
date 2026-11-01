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
        snapshot[rel] = ("dir", stat.st_mtime_ns) if path.is_dir() else (stat.st_size, stat.st_mtime_ns)
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
    package_path = build_fixture_library(tmp_path)
    copy_of_copy2 = shutil.copy2

    def corrupt_the_copy(src, dst, *args, **kwargs):
        copy_of_copy2(src, dst, *args, **kwargs)
        if pathlib.Path(dst).name == "Photos.sqlite":
            pathlib.Path(dst).write_bytes(b"not a sqlite database")

    with unittest.mock.patch.object(libraries.shutil, "copy2", side_effect=corrupt_the_copy):
        with pytest.raises(Exception):
            open_library_readonly(package_path)


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
