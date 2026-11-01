"""P0.1: an unsupported Photos database generation is a distinct, admin-facing error.

Doesn't need a real or fixture library -- `check_supported_version` only
looks at the `photos_version` value osxphotos would have already parsed out
of `Z_METADATA`.
"""

from photos_viewer.libraries import (
    SUPPORTED_PHOTOS_VERSIONS,
    UnsupportedPhotosVersionError,
    check_supported_version,
    unsupported_version_message,
)


def test_known_version_is_accepted():
    check_supported_version(5)  # must not raise


def test_unknown_version_raises_distinct_error():
    try:
        check_supported_version(999)
    except UnsupportedPhotosVersionError as exc:
        assert str(exc) == unsupported_version_message(999)
    else:
        raise AssertionError("expected UnsupportedPhotosVersionError")


def test_unsupported_message_names_the_version():
    assert "999" in unsupported_version_message(999)
    # photos_version is a float for these three intermediate model-version
    # ranges (see get_photos_version_from_model in osxphotos' installed
    # photosdb_utils.py) -- the message has to name those distinctly too,
    # not round or stringify them into an adjacent supported version.
    assert "9.6" in unsupported_version_message(9.6)
    assert "11.1" in unsupported_version_message(11.1)


def test_supported_versions_is_nonempty():
    assert SUPPORTED_PHOTOS_VERSIONS


def test_supported_versions_matches_osxphotos_table_names():
    # Mirrors osxphotos._constants._DB_TABLE_NAMES's keys for the pinned
    # 0.77.2 release (see server/pyproject.toml and photos_viewer/libraries.py's
    # module docstring) -- the set this server accepts should be exactly the
    # set osxphotos has Photos-version table mappings for, not a superset or
    # subset of it.
    from osxphotos._constants import _DB_TABLE_NAMES

    assert SUPPORTED_PHOTOS_VERSIONS == frozenset(_DB_TABLE_NAMES.keys())


def test_known_fractional_versions_are_accepted():
    for version in (9.6, 9.9, 11.1):
        check_supported_version(version)  # must not raise
