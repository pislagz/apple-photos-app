"""P1.18: the access-control test from CLAUDE.md.

User A is assigned only library L1, user B only library L2. Every
`/api/libraries/{library_id}/...` route is enumerated from the app itself (not
a hand-kept list), so a route added later is exercised automatically. Each is
called against the other user's library with that library's real asset uuids
and must return nothing: 404 for a signed-in user who isn't assigned, 401 for a
disabled account or a revoked session. "Nothing" is checked on the response
bytes too, not just the status: no marker bytes planted in the victim's files,
no victim uuid or filename, no image or video content type.

Each user also reads their own library through the very same requests, so the
negative checks cannot pass vacuously (e.g. because a route was misspelled).
"""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from photos_viewer import app_db, media, session_auth
from photos_viewer.main import create_app

VALID_PASSWORD = "correct-horse-battery"
LIBRARY_PREFIX = "/api/libraries/{library_id}"
PHOTO, HIDDEN = "photo", "hidden"


class World:
    """Two libraries on disk and in `app.db`, each with a normal and a hidden
    asset. Everything that identifies a library (uuid, filename, file bytes)
    carries that library's name so a leak is recognisable in a response."""

    def __init__(self, tmp_path):
        self.app = create_app()
        self.conn = app_db.connect(tmp_path / "data")
        self.app.dependency_overrides[session_auth.get_db] = lambda: self.conn
        self.app.dependency_overrides[session_auth.get_media_cache_dir] = lambda: (
            tmp_path / "media_cache"
        )
        self.libraries: dict[str, dict] = {}
        for name in ("L1", "L2"):
            self.libraries[name] = self._build_library(tmp_path, name)

    def _build_library(self, tmp_path, name):
        root = tmp_path / f"{name}.photoslibrary"
        originals = root / "originals"
        originals.mkdir(parents=True)
        self.conn.execute(
            "INSERT INTO libraries (display_name, path) VALUES (?, ?)",
            (name, str(root)),
        )
        library_id = self.conn.execute(
            "SELECT id FROM libraries WHERE display_name = ?", (name,)
        ).fetchone()["id"]
        marker = f"SECRET-{name}".encode()
        assets = {}
        for kind, hidden in ((PHOTO, 0), (HIDDEN, 1)):
            uuid = f"{name}-{kind}-uuid"
            filename = f"{name}-{kind}-private.jpg"
            original, edited = originals / filename, originals / f"edited-{filename}"
            for path in (original, edited):
                Image.new("RGB", (400, 300), color=(10, 20, 30)).save(
                    path, format="JPEG"
                )
                # Trailing bytes after the JPEG end marker: Pillow still decodes it,
                # and a native download leaks the marker.
                with path.open("ab") as handle:
                    handle.write(marker)
            video = originals / f"{name}-{kind}.mov"
            video.write_bytes(b"video-" + marker)
            self.conn.execute(
                "INSERT INTO assets (library_id, uuid, filename, date_created, hidden, "
                "path_original, path_edited, path_live_photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    library_id,
                    uuid,
                    filename,
                    "2024-01-01T00:00:00",
                    hidden,
                    str(original),
                    str(edited),
                    str(video),
                ),
            )
            assets[kind] = {"uuid": uuid, "filename": filename}
        self.conn.commit()
        return {"id": library_id, "marker": marker, "assets": assets}

    def user(self, username, *, role="user", library=None):
        self.conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (username, session_auth.hash_password(VALID_PASSWORD), role),
        )
        self.conn.commit()
        user_id = self.conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()["id"]
        if library:
            self.conn.execute(
                "INSERT INTO library_assignments (user_id, library_id) VALUES (?, ?)",
                (user_id, self.libraries[library]["id"]),
            )
            self.conn.commit()
        return user_id

    def login(self, username, *, unlock_hidden=True):
        client = TestClient(self.app, base_url="https://testserver")
        response = client.post(
            "/api/auth/login", json={"username": username, "password": VALID_PASSWORD}
        )
        assert response.status_code == 200, response.text
        if unlock_hidden:
            # Unlock the hidden album so only the library check, not the
            # hidden lock, can be what refuses the request.
            unlock = client.post(
                "/api/auth/reconfirm-password", json={"password": VALID_PASSWORD}
            )
            assert unlock.status_code == 204, unlock.text
        return client


@pytest.fixture
def world(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    w = World(tmp_path)
    try:
        yield w
    finally:
        w.conn.close()


def library_routes(app):
    """(path template, method) for every library-scoped route, read from the app."""
    found = []
    for route in session_auth.leaf_routes(app.routes):
        path = getattr(route, "path", "")
        if path.startswith(LIBRARY_PREFIX):
            for method in sorted(getattr(route, "methods", None) or ()):
                if method not in ("HEAD", "OPTIONS"):
                    found.append((path, method))
    return found


def requests_for(path, method, library):
    """Concrete (url, kwargs) requests for one route template against `library`.

    Path params are filled from the library's real asset uuids, so a
    refusal can only come from access control, never from an unknown id. A
    route with a parameter we cannot fill fails the test loudly instead of
    being skipped."""
    out = []
    for asset in library["assets"].values():
        values = {"library_id": library["id"], "asset_id": asset["uuid"]}
        names = set(re.findall(r"{(\w+)}", path))
        assert names <= set(values), (
            f"{path}: no value for path params {names - set(values)}"
        )
        url = path.format(**values)
        # Media routes: every variant a client could ask for.
        if "/thumb/" in path:
            variants = [{"params": {"size": size}} for size in media.SIZES]
        elif "/original/" in path:
            variants = [
                {"params": {"version": version, "format": fmt}, "headers": headers}
                for version in ("original", "edited")
                for fmt in ("native", "jpeg")
                for headers in ({}, {"Range": "bytes=0-9"})
            ]
        elif path.endswith("/search"):
            variants = [{"params": {"q": "test"}}]
        elif path.endswith("/zip"):
            ids = [a["uuid"] for a in library["assets"].values()]
            variants = [
                {"json": {"asset_ids": ids, "format": fmt}}
                for fmt in ("native", "jpeg")
            ]
        elif path.endswith("/updated-note/dismiss"):
            variants = [{"json": {"run_id": 1}}]
        else:
            variants = [{}]
        out.extend((url, {"method": method, **variant}) for variant in variants)
        if "{asset_id}" not in path:
            break  # asset-independent route: one URL is enough
    return out


def assert_nothing_returned(response, victim, label):
    assert response.status_code in (401, 404), f"{label}: {response.status_code}"
    body = response.content
    assert victim["marker"] not in body, f"{label}: file bytes leaked"
    for asset in victim["assets"].values():
        assert asset["uuid"].encode() not in body, f"{label}: asset uuid leaked"
        assert asset["filename"].encode() not in body, f"{label}: filename leaked"
    content_type = response.headers.get("content-type", "")
    assert not content_type.startswith(
        ("image/", "video/", "application/octet-stream")
    ), label


def attack(client, world, victim_name, *, expected):
    victim = world.libraries[victim_name]
    routes = library_routes(world.app)
    assert routes, "no library routes found; the enumeration is broken"
    count = 0
    for path, method in routes:
        for url, kwargs in requests_for(path, method, victim):
            response = client.request(url=url, **kwargs)
            assert_nothing_returned(response, victim, f"{method} {url} {kwargs}")
            assert response.status_code == expected, (
                f"{method} {url} {kwargs}: {response.status_code}"
            )
            count += 1
    return count


def read_own(client, world, own_name):
    """Same requests as `attack`, against a library the caller may read."""
    own = world.libraries[own_name]
    for path, method in library_routes(world.app):
        for url, kwargs in requests_for(path, method, own):
            response = client.request(url=url, **kwargs)
            # A jpeg transcode is generated whole, so it ignores Range and answers 200.
            ranged_native = (
                kwargs.get("headers") and kwargs["params"].get("format") == "native"
            )
            expected = (206,) if ranged_native else (200, 206)
            assert response.status_code in expected, (
                f"{method} {url} {kwargs}: {response.status_code}"
            )
            assert response.content, f"{method} {url}: empty body"


def test_route_enumeration_covers_the_known_routes(world):
    """Guards the enumeration itself: if the app stopped exposing these,
    the loops below would silently test nothing."""
    templates = {path for path, _ in library_routes(world.app)}
    for suffix in (
        "/assets",
        "/hidden",
        "/summary",
        "/albums",
        "/people",
        "/map",
        "/search",
        "/assets/{asset_id}",
        "/thumb/{asset_id}",
        "/original/{asset_id}",
        "/livephoto/{asset_id}/video",
        "/zip",
    ):
        assert LIBRARY_PREFIX + suffix in templates


def test_each_user_can_read_their_own_library(world):
    world.user("alice", library="L1")
    world.user("bob", library="L2")
    read_own(world.login("alice"), world, "L1")
    read_own(world.login("bob"), world, "L2")


@pytest.mark.parametrize(
    ("user", "own", "victim"), [("alice", "L1", "L2"), ("bob", "L2", "L1")]
)
def test_a_user_gets_nothing_from_the_other_users_library(world, user, own, victim):
    world.user("alice", library="L1")
    world.user("bob", library="L2")
    client = world.login(user)
    assert attack(client, world, victim, expected=404) > 0
    read_own(client, world, own)  # still works, so the 404s were not a broken session


def test_a_user_cannot_read_a_foreign_asset_through_their_own_library_id(world):
    """The asset uuid is the other library's; the library id is the caller's own."""
    world.user("alice", library="L1")
    client = world.login("alice")
    own, victim = world.libraries["L1"], world.libraries["L2"]
    for path, method in library_routes(world.app):
        if "{asset_id}" not in path:
            continue
        for _url, kwargs in requests_for(path, method, victim):
            for asset in victim["assets"].values():
                url = path.format(library_id=own["id"], asset_id=asset["uuid"])
                response = client.request(url=url, **kwargs)
                assert_nothing_returned(response, victim, f"{method} {url}")
                assert response.status_code == 404


def test_zip_of_foreign_asset_ids_through_own_library_404s(world):
    world.user("alice", library="L1")
    client = world.login("alice")
    own, victim = world.libraries["L1"], world.libraries["L2"]
    foreign = [a["uuid"] for a in victim["assets"].values()]
    mixed = [next(iter(own["assets"].values()))["uuid"], *foreign]
    for ids in (foreign, mixed):
        response = client.post(
            f"/api/libraries/{own['id']}/zip", json={"asset_ids": ids}
        )
        assert_nothing_returned(response, victim, "zip foreign ids")
        assert response.status_code == 404


@pytest.mark.parametrize("victim", ["L1", "L2"])
def test_an_admin_who_has_not_assigned_the_library_to_themselves_gets_nothing(
    world, victim
):
    world.user("root", role="admin")
    client = world.login("root")
    assert attack(client, world, victim, expected=404) > 0
    # Admin routes still work for them, so this is a library check, not a dead session.
    assert client.get("/api/admin/users").status_code == 200


def test_an_admin_assigned_only_to_l1_gets_nothing_from_l2(world):
    world.user("root", role="admin", library="L1")
    client = world.login("root")
    read_own(client, world, "L1")
    attack(client, world, "L2", expected=404)


@pytest.mark.parametrize("target", ["L1", "L2"])
def test_a_disabled_user_gets_nothing_even_from_their_own_library(world, target):
    user_id = world.user("alice", library="L1")
    world.user("bob", library="L2")
    client = world.login("alice")
    read_own(client, world, "L1")
    world.conn.execute("UPDATE users SET disabled = 1 WHERE id = ?", (user_id,))
    world.conn.commit()
    assert attack(client, world, target, expected=401) > 0


@pytest.mark.parametrize("target", ["L1", "L2"])
def test_a_revoked_session_gets_nothing_even_from_its_own_library(world, target):
    user_id = world.user("alice", library="L1")
    world.user("bob", library="L2")
    client = world.login("alice")
    read_own(client, world, "L1")
    session_auth.revoke_sessions_for_user(world.conn, user_id)
    assert attack(client, world, target, expected=401) > 0


@pytest.mark.parametrize("target", ["L1", "L2"])
def test_an_anonymous_client_gets_nothing(world, target):
    client = TestClient(world.app, base_url="https://testserver")
    assert attack(client, world, target, expected=401) > 0


def test_non_admin_gets_403_on_admin_routes(world):
    world.user("alice", library="L1")
    client = world.login("alice")
    admin_paths = [
        (route.path, method)
        for route in session_auth.leaf_routes(world.app.routes)
        if getattr(route, "path", "").startswith("/api/admin/")
        for method in getattr(route, "methods", ())
        if method not in ("HEAD", "OPTIONS")
    ]
    assert admin_paths
    for path, method in admin_paths:
        url = re.sub(r"{\w+}", "1", path)
        response = client.request(method, url, json={})
        assert response.status_code == 403, f"{method} {path}: {response.status_code}"
