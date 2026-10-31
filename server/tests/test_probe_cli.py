"""P0.4: the probe CLI reports library facts and refuses unsupported versions."""

from photos_viewer import probe
from photos_viewer.libraries import UnsupportedPhotosVersionError, unsupported_version_message
from tests.fixtures import build_fixture_library


def test_probe_reports_library_facts(tmp_path, capsys):
    package_path = build_fixture_library(tmp_path)

    exit_code = probe.main([str(package_path)])
    out = capsys.readouterr().out

    assert exit_code == 0
    assert f"library_path: {package_path}" in out
    assert "db_version: 5001" in out
    assert "photos_version: 5" in out
    assert "asset_count: 0" in out
    assert "open_mode: copy" in out


def test_probe_rejects_unsupported_version(monkeypatch, capsys):
    def raise_unsupported(_package_path):
        raise UnsupportedPhotosVersionError(unsupported_version_message(999))

    monkeypatch.setattr(probe, "open_library_readonly", raise_unsupported)

    exit_code = probe.main(["/some/Library.photoslibrary"])
    err = capsys.readouterr().err

    assert exit_code == 1
    assert err.strip() == unsupported_version_message(999)


def test_probe_usage_error_on_bad_args(capsys):
    assert probe.main([]) == 2
    assert probe.main(["a", "b"]) == 2
