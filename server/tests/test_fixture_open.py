"""P0.2: the synthetic fixture opens under osxphotos on Linux."""

from osxphotos import PhotosDB

from tests.fixtures import build_fixture_library


def test_fixture_reports_version_and_opens(tmp_path):
    package_path = build_fixture_library(tmp_path)
    sqlite_path = package_path / "database" / "Photos.sqlite"

    db = PhotosDB(dbfile=str(sqlite_path))

    assert db.db_version == "5001"
    assert db.photos_version == 5
    assert len(db) == 2  # one visible asset row plus the permanent hidden one (#85)
