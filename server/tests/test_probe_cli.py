"""P0.4: the probe CLI reports library facts and refuses unsupported versions."""

import logging

from photos_viewer import libraries, probe
from photos_viewer.libraries import unsupported_version_message
from tests.fixtures import build_fixture_library


def test_probe_reports_library_facts(tmp_path, capsys, caplog):
    package_path = build_fixture_library(tmp_path)

    with caplog.at_level(logging.WARNING, logger="osxphotos"):
        exit_code = probe.main([str(package_path)])
    out = capsys.readouterr().out

    assert exit_code == 0
    assert f"library_path: {package_path}" in out
    assert "db_version: 5001" in out
    assert "photos_version: 5" in out
    assert "asset_count: 2" in out
    assert "open_mode: copy" in out
    assert "could not find search db" not in caplog.text


def test_probe_rejects_unsupported_version(tmp_path, monkeypatch, capsys):
    # The fixture's real, osxphotos-detected version (5) is legitimate --
    # there's no model version osxphotos' own `get_photos_version_from_model`
    # reports that this server's SUPPORTED_PHOTOS_VERSIONS doesn't already
    # cover, since unrecognized model versions clamp *up* to the latest
    # version osxphotos knows rather than coming back as something new. So
    # the only honest way to exercise the rejection path without mocking the
    # opener is to narrow the accepted set itself and let open_library_readonly
    # run for real against a real fixture.
    package_path = build_fixture_library(tmp_path)
    monkeypatch.setattr(libraries, "SUPPORTED_PHOTOS_VERSIONS", frozenset({12}))

    exit_code = probe.main([str(package_path)])
    err = capsys.readouterr().err

    assert exit_code == 1
    assert err.strip() == unsupported_version_message(5)


def test_probe_usage_error_on_bad_args(capsys):
    assert probe.main([]) == 2
    assert probe.main(["a", "b"]) == 2
