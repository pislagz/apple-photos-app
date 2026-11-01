"""Phase 0 probe: open a `.photoslibrary` read-only and report what osxphotos sees.

    python -m photos_viewer.probe /path/to/Library.photoslibrary

Prints the library path, `db_version`, `photos_version`, asset count, and
which open mode was used ("copy" or "ro"). Exits non-zero, printing the
admin-facing error string, if the library's Photos database generation
isn't one this osxphotos pin supports.
"""

from __future__ import annotations

import sys

from .libraries import UnsupportedPhotosVersionError, open_library_readonly


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: python -m photos_viewer.probe /path/to/Library.photoslibrary", file=sys.stderr)
        return 2

    try:
        opened = open_library_readonly(argv[0])
    except UnsupportedPhotosVersionError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    with opened:
        db = opened.db
        print(f"library_path: {opened.library_path}")
        print(f"db_version: {db.db_version}")
        print(f"photos_version: {db.photos_version}")
        print(f"asset_count: {len(db)}")
        print(f"open_mode: {opened.open_mode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
