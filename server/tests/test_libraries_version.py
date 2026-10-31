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
    message = unsupported_version_message(999)
    assert "999" in message


def test_supported_versions_is_nonempty():
    assert SUPPORTED_PHOTOS_VERSIONS
