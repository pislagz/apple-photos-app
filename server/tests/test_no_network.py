"""P0.6: opening a library makes no non-local connections.

CI runs the whole suite under pytest-socket with only localhost allowed
(see server/pyproject.toml). This test doesn't rely on that plugin's API
directly -- it guards `socket.socket.connect` itself, so it still catches a
regression in a dev environment where the plugin isn't installed.
"""

import socket

from photos_viewer.libraries import open_library_readonly
from tests.fixtures import build_fixture_library

_ALLOWED_HOSTS = {"127.0.0.1", "::1", "localhost"}


def test_opening_the_fixture_makes_no_non_local_connections(tmp_path, monkeypatch):
    package_path = build_fixture_library(tmp_path)
    real_connect = socket.socket.connect

    def guarded_connect(self, address, *args, **kwargs):
        host = address[0] if isinstance(address, tuple) else address
        if host not in _ALLOWED_HOSTS:
            raise AssertionError(f"blocked a non-local connection to {address!r}")
        return real_connect(self, address, *args, **kwargs)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)

    with open_library_readonly(package_path) as opened:
        assert opened.db.photos_version == 5
