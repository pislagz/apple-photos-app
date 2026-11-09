"""P1.19: the checked-in launchd plist, Dockerfile and compose file hold the
guarantees the README promises. No Docker needed; CI also runs
`docker compose config` on the real file."""

import os
import pathlib
import plistlib
import stat

import yaml

from photos_viewer import probe
from tests.fixtures import build_fixture_library

DEPLOY = pathlib.Path(__file__).resolve().parents[2] / "deploy"


def _names(package_path: pathlib.Path) -> dict:
    return {
        str(p.relative_to(package_path)): p.stat().st_mtime_ns
        for p in package_path.rglob("*")
    }


def _compose() -> dict:
    return yaml.safe_load((DEPLOY / "docker-compose.yml").read_text())


def test_plist_is_valid_and_keeps_server_alive():
    plist = plistlib.loads((DEPLOY / "com.photosviewer.plist").read_bytes())
    args = plist["ProgramArguments"]
    assert args[0].endswith("/.venv/bin/uvicorn")
    assert "photos_viewer.main:app" in args
    assert plist["KeepAlive"] is True
    env = plist["EnvironmentVariables"]
    assert env["OSXPHOTOS_NO_VERSION_CHECK"] == "1"
    assert env["PHOTOS_VIEWER_DATA_DIR"]
    assert plist["StandardOutPath"].startswith(env["PHOTOS_VIEWER_DATA_DIR"])
    assert plist["StandardErrorPath"].startswith(env["PHOTOS_VIEWER_DATA_DIR"])


def test_compose_hardening_and_egress():
    compose = _compose()
    svc = compose["services"]["viewer"]
    assert svc["read_only"] is True
    assert any(str(t).startswith("/tmp") for t in svc["tmpfs"])
    assert svc["user"].split(":")[0] != "0"
    assert svc["cap_drop"] == ["ALL"]

    # No route to the internet, and nothing published on a LAN interface.
    assert compose["networks"]["viewer"]["internal"] is True
    assert "ports" not in svc
    assert svc["environment"]["OSXPHOTOS_NO_VERSION_CHECK"] == "1"


def test_compose_mounts_libraries_read_only_and_data_read_write():
    volumes = _compose()["services"]["viewer"]["volumes"]
    by_target = {
        v.rsplit(":", 2)[-2] if v.endswith(":ro") else v.split(":")[-1]: v.endswith(
            ":ro"
        )
        for v in volumes
    }
    assert by_target["/libraries"] is True
    assert by_target["/tiles"] is True
    assert by_target["/data"] is False


def test_dockerfile_non_root_and_no_library_copied():
    text = (DEPLOY / "Dockerfile").read_text()
    assert "ffmpeg" in text and "libheif" in text
    assert "\nUSER viewer" in text
    assert "photoslibrary" not in "".join(
        line for line in text.splitlines() if line.startswith("COPY")
    )
    ignore = (DEPLOY.parent / ".dockerignore").read_text()
    for pattern in ("**/*.photoslibrary", "**/app.db", ".env"):
        assert pattern in ignore


def test_probe_runs_on_a_read_only_mounted_fixture(tmp_path, capsys):
    # Stands in for a `:ro` bind mount: strip write bits from the package.
    package_path = build_fixture_library(tmp_path)
    before = _names(package_path)
    paths = sorted(package_path.rglob("*"), reverse=True) + [package_path]
    for path in paths:
        path.chmod(path.stat().st_mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))
    try:
        assert probe.main([str(package_path)]) == 0
        assert "open_mode: copy" in capsys.readouterr().out
        assert _names(package_path) == before
    finally:
        for path in [package_path, *package_path.rglob("*")]:
            path.chmod(path.stat().st_mode | stat.S_IWUSR)
    assert os.path.exists(package_path)
