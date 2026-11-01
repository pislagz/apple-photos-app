"""P0.5: PhotoKit is unavailable and unused on Linux.

PhotoKit only sees the macOS System Photo Library and doesn't exist on
Linux at all, so pyobjc may not be installed, and importing the reader
module must not pull in `osxphotos.photokit` as a side effect.

`osxphotos.photokit` ships as a `.py` file regardless of platform (so its
module *spec* is always found), but its top level does
`assert sys.platform == "darwin"` before importing pyobjc -- actually
importing it is what must fail here, not merely locating it.
"""

import importlib
import sys

import pytest

import photos_viewer.libraries  # noqa: F401  (import under test)


def test_pyobjc_is_not_installed():
    for module_name in ("objc", "Quartz", "Photos", "photoscript"):
        assert importlib.util.find_spec(module_name) is None, (
            f"{module_name} must not be installed on the Linux server"
        )


@pytest.mark.skipif(
    sys.platform == "darwin",
    reason="osxphotos.photokit imports cleanly on macOS; this guard is Linux-only",
)
def test_osxphotos_photokit_is_not_importable_on_linux():
    try:
        importlib.import_module("osxphotos.photokit")
    except Exception:
        pass
    else:
        raise AssertionError("osxphotos.photokit must not import cleanly on Linux")
    assert "osxphotos.photokit" not in sys.modules


def test_importing_the_reader_does_not_import_photokit():
    assert "osxphotos.photokit" not in sys.modules
    assert "objc" not in sys.modules
