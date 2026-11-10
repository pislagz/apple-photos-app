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


def test_suite_blocks_sockets_to_external_hosts():
    # Relies on the suite-wide pytest-socket addopts (pytest.ini and
    # server/pyproject.toml); a public address must be refused before any
    # packet leaves the machine.
    import pytest
    from pytest_socket import SocketConnectBlockedError

    with pytest.raises(SocketConnectBlockedError):
        socket.create_connection(("93.184.216.34", 80), timeout=1)


def test_suite_still_allows_loopback_sockets():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        with socket.create_connection(server.getsockname(), timeout=1):
            pass


def test_only_the_admin_place_name_download_imports_an_http_client():
    """P1.21, D41: the server's single outbound path is `place_names.download`
    (an admin's one-time GeoNames fetch). No other module may import a client
    library, so nothing else can dial out."""
    import ast
    import pathlib

    import photos_viewer

    clients = {
        "urllib.request",
        "http.client",
        "httpx",
        "requests",
        "aiohttp",
        "socket",
    }
    allowed = {"place_names.py": {"urllib.request"}}
    offenders = {}
    for path in pathlib.Path(photos_viewer.__file__).parent.glob("*.py"):
        found = set()
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Import):
                found |= {a.name for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module:
                found.add(node.module)
                found |= {f"{node.module}.{a.name}" for a in node.names}
        extra = (found & clients) - allowed.get(path.name, set())
        if extra:
            offenders[path.name] = extra
    assert offenders == {}
