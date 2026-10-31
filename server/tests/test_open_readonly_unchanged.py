"""P0.3: opening a library for indexing never writes into the package.

Snapshots the fixture package's file names, sizes, and mtimes, opens it via
`open_library_readonly`, then snapshots again. The package must be
byte-for-byte unchanged -- no new `-wal`/`-shm`/journal file, no mtime drift.
"""

import pathlib

from photos_viewer.libraries import open_library_readonly
from tests.fixtures import build_fixture_library


def _snapshot(package_path: pathlib.Path) -> dict:
    return {
        str(path.relative_to(package_path)): (stat.st_size, stat.st_mtime_ns)
        for path in sorted(package_path.rglob("*"))
        if path.is_file()
        for stat in (path.stat(),)
    }


def test_package_unchanged_after_open(tmp_path):
    package_path = build_fixture_library(tmp_path)

    before = _snapshot(package_path)
    opened = open_library_readonly(package_path)
    after = _snapshot(package_path)

    assert opened.open_mode == "copy"
    assert before == after
