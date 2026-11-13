#!/usr/bin/env python
"""Run the whole app against a synthetic DEMO library, for local visual checks.

    .venv/bin/python scripts/dev_demo.py [--port 8000] [--reset] [--build]

Builds `./demo-data/` (gitignored): a generated `.photoslibrary` of a few
hundred Pillow images plus a fresh `app.db`. Provisioning goes through the
app's own HTTP API (first-run admin setup, login, create user, register the
library, grant access, wait for the index), not raw SQL. Then it serves the
API and the built web app on 127.0.0.1 until interrupted.

The passwords below are throwaway local dev credentials for a library that
holds no real media. Nothing here changes production defaults: the only
dev-only switch is `PHOTOS_VIEWER_COOKIE_SECURE=false`, set in the server
process this script starts, so a login cookie works over plain
http://127.0.0.1.
"""

from __future__ import annotations

import argparse
import colorsys
import datetime as dt
import importlib.util
import json
import os
import pathlib
import random
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEMO_DIR = ROOT / "demo-data"
LIBRARY_DIR = DEMO_DIR / "library"
DATA_DIR = DEMO_DIR / "app-data"
PID_FILE = DEMO_DIR / "server.pid"
WEB_DIR = ROOT / "web"

ADMIN = ("demo-admin", "demo-admin-pass-1")
USER = ("demo-user", "demo-user-pass-1")

SEED = 20240607
COCOA_EPOCH = dt.datetime(2001, 1, 1, tzinfo=dt.UTC)
YEARS = (2021, 2022, 2023, 2024, 2025)
EMPTY_MONTHS = {
    (2021, 1),
    (2021, 2),
    (2022, 8),
    (2023, 3),
    (2023, 4),
    (2024, 11),
    (2025, 5),
    (2025, 6),
}
SHAPES = [
    (640, 480),
    (480, 640),
    (560, 560),
    (800, 450),
]  # landscape, portrait, square, wide


def _load_fixtures():
    """The test fixture builder lives beside the tests; load it by path so
    this script does not depend on `server/tests` being importable."""
    path = ROOT / "server" / "tests" / "fixtures" / "__init__.py"
    spec = importlib.util.spec_from_file_location("demo_fixtures", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["demo_fixtures"] = module
    spec.loader.exec_module(module)
    return module


def _cocoa(moment: dt.datetime) -> float:
    return (moment - COCOA_EPOCH).total_seconds()


def _render(index: int, size: tuple[int, int], rng: random.Random, fmt: str) -> bytes:
    """A hue gradient with a big number, so a screenshot shows which asset is which."""
    import io

    from PIL import Image, ImageDraw, ImageFont

    width, height = size
    hue = rng.random()
    top = tuple(int(c * 255) for c in colorsys.hsv_to_rgb(hue, 0.55, 0.95))
    bottom = tuple(
        int(c * 255) for c in colorsys.hsv_to_rgb((hue + 0.12) % 1.0, 0.75, 0.55)
    )
    image = Image.new("RGB", size, top)
    pixels = ImageDraw.Draw(image)
    for y in range(height):
        t = y / max(height - 1, 1)
        pixels.line(
            [(0, y), (width, y)],
            fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
        )
    try:
        font = ImageFont.load_default(size=max(width // 5, 24))
    except TypeError:  # Pillow < 10.1 has no sized default font
        font = ImageFont.load_default()
    pixels.text(
        (width // 2, height // 2),
        str(index),
        fill=(255, 255, 255),
        font=font,
        anchor="mm",
    )
    buffer = io.BytesIO()
    if fmt == "HEIC":
        image.save(buffer, format="HEIF", quality=55)
    else:
        image.save(buffer, format="JPEG", quality=80)
    return buffer.getvalue()


def _make_video(index: int, rng: random.Random) -> bytes | None:
    """A 2-second clip, only when ffmpeg exists; the demo works without it."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        return None
    color = f"0x{rng.randrange(0x202020, 0xE0E0E0):06x}"
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / f"v{index}.mp4"
        result = subprocess.run(
            [
                ffmpeg,
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"color=c={color}:s=640x360:d=2:r=24",
                "-pix_fmt",
                "yuv420p",
                str(out),
            ],
            capture_output=True,
            check=False,
        )
        return out.read_bytes() if result.returncode == 0 and out.exists() else None


def _moments(rng: random.Random) -> list[dt.datetime]:
    """Capture times over five years: sparse months, a few busy days, a few empty months."""
    moments: list[dt.datetime] = []
    for year in YEARS:
        for month in range(1, 13):
            if (year, month) in EMPTY_MONTHS or (year == 2025 and month > 9):
                continue
            days = sorted(rng.sample(range(1, 28), rng.choice((1, 2, 3, 4))))
            for day in days:
                count = rng.choice((1, 2, 2, 3))
                if day == days[0] and rng.random() < 0.3:
                    count = rng.randint(14, 26)  # a busy day
                for _ in range(count):
                    moments.append(
                        dt.datetime(
                            year,
                            month,
                            day,
                            rng.randint(7, 21),
                            rng.randint(0, 59),
                            rng.randint(0, 59),
                            tzinfo=dt.UTC,
                        )
                    )
    moments.sort()
    return moments


# P2.3: a few places so the map has clusters. Indexes not listed have no
# location, like photos taken with Location Services off.
_PLACES = (
    (48.8566, 2.3522),  # Paris
    (40.7128, -74.0060),  # New York
    (35.6762, 139.6503),  # Tokyo
    (-33.8688, 151.2093),  # Sydney
)


def _place_for(index: int) -> tuple[float | None, float | None]:
    if index % 4 == 0:
        return None, None
    lat, lon = _PLACES[(index // 4) % len(_PLACES)]
    # A little spread so a cluster has several distinct points.
    return lat + (index % 7) * 0.004, lon + (index % 5) * 0.004


# Scene/object labels for Search ("dog", "beach", ...): a few per photo, so
# several queries return some but not all of the library.
_DEMO_LABELS = (("Dog", 9), ("Beach", 7), ("Snow", 11), ("Sports Field", 13))


def _labels_for(index: int) -> tuple[str, ...]:
    return tuple(label for label, step in _DEMO_LABELS if index % step == 0)


def build_demo_library(dest: pathlib.Path) -> pathlib.Path:
    fixtures = _load_fixtures()
    rng = random.Random(SEED)
    assets = []
    for index, moment in enumerate(_moments(rng), start=1):
        latitude, longitude = _place_for(index)
        uuid = f"{index:08X}-DEAD-4BEE-8000-{index:012X}"
        is_video = index % 53 == 0
        data = _make_video(index, rng) if is_video else None
        if data is not None:
            size, name, uti, kind = (
                (640, 360),
                f"MOV_{index:04d}.MP4",
                "public.mpeg-4",
                1,
            )
        else:
            size = SHAPES[rng.choice((0, 0, 0, 1, 2, 3))]
            fmt = "HEIC" if index % 3 else "JPEG"
            data = _render(index, size, rng, fmt)
            name, uti, kind = (
                f"IMG_{index:04d}.{fmt}",
                "public.heic" if fmt == "HEIC" else "public.jpeg",
                0,
            )
        assets.append(
            fixtures.FixtureAsset(
                uuid=uuid,
                filename=name,
                data=data,
                uti=uti,
                kind=kind,
                created=_cocoa(moment),
                width=size[0],
                height=size[1],
                favorite=index % 17 == 0,
                hidden=index % 41 == 0,
                latitude=latitude,
                longitude=longitude,
                labels=_labels_for(index),
            )
        )
    count = len(assets)
    folders = [
        fixtures.FixtureFolder("E0000000-DEAD-4BEE-8000-000000000001", "Trips"),
        fixtures.FixtureFolder(
            "E0000000-DEAD-4BEE-8000-000000000002",
            "Europe",
            parent_uuid="E0000000-DEAD-4BEE-8000-000000000001",
        ),
        fixtures.FixtureFolder("E0000000-DEAD-4BEE-8000-000000000003", "Family"),
    ]
    albums = [
        fixtures.FixtureAlbum(
            "B0000000-DEAD-4BEE-8000-000000000001",
            "Favorites Trip",
            list(range(0, count, 11)),
            parent_uuid="E0000000-DEAD-4BEE-8000-000000000002",
        ),
        fixtures.FixtureAlbum(
            "B0000000-DEAD-4BEE-8000-000000000002",
            "Busy Days",
            list(range(5, min(count, 60))),
        ),
        fixtures.FixtureAlbum(
            "B0000000-DEAD-4BEE-8000-000000000003",
            "Road Trip",
            list(range(3, count, 19)),
            parent_uuid="E0000000-DEAD-4BEE-8000-000000000001",
        ),
        fixtures.FixtureAlbum(
            "B0000000-DEAD-4BEE-8000-000000000004",
            "Birthdays",
            list(range(7, count, 23)),
            parent_uuid="E0000000-DEAD-4BEE-8000-000000000003",
        ),
    ]
    people = [
        fixtures.FixturePerson(
            "C0000000-DEAD-4BEE-8000-000000000001",
            "Alex Demo",
            "D0000000-DEAD-4BEE-8000-000000000001",
            list(range(0, count, 9)),
        ),
        fixtures.FixturePerson(
            "C0000000-DEAD-4BEE-8000-000000000002",
            "Sam Sample",
            "D0000000-DEAD-4BEE-8000-000000000002",
            list(range(2, count, 13)),
        ),
        # Unnamed face cluster: People lists it after the named people (docs/TASKS.md P2.2).
        fixtures.FixturePerson(
            "C0000000-DEAD-4BEE-8000-000000000003",
            "Unnamed",
            "D0000000-DEAD-4BEE-8000-000000000003",
            list(range(1, count, 17)),
            named=False,
        ),
        fixtures.FixturePerson(
            "C0000000-DEAD-4BEE-8000-000000000004",
            "Unnamed",
            "D0000000-DEAD-4BEE-8000-000000000004",
            list(range(3, count, 29)),
            named=False,
        ),
    ]
    dest.mkdir(parents=True)
    return fixtures.build_library(
        dest,
        assets,
        albums=albums,
        folders=folders,
        people=people,
        package_name="Demo.photoslibrary",
    )


# ---------------------------------------------------------------- HTTP client


class _Api:
    """Minimal cookie-keeping client. Sends the server's own origin as
    `Origin`, which the cross-site check accepts without any configuration."""

    def __init__(self, base: str) -> None:
        self.base = base
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(CookieJar())
        )

    def call(self, method: str, path: str, body: dict | None = None) -> object:
        # Mutating routes insist on a JSON content type even with no body.
        if body is None and method != "GET":
            body = {}
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("Origin", self.base)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with self.opener.open(request, timeout=60) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            raise SystemExit(
                f"{method} {path} -> {exc.code}: {exc.read().decode(errors='replace')}"
            ) from exc
        return json.loads(raw) if raw else None


def _provision(base: str) -> None:
    api = _Api(base)
    status = api.call("GET", "/api/setup/status")
    assert isinstance(status, dict)
    if not status["needs_setup"]:
        print("app data already provisioned; keeping it (use --reset to rebuild)")
        return
    api.call("POST", "/api/setup/admin", {"username": ADMIN[0], "password": ADMIN[1]})
    api.call("POST", "/api/auth/login", {"username": ADMIN[0], "password": ADMIN[1]})
    user = api.call(
        "POST",
        "/api/admin/users",
        {"username": USER[0], "password": USER[1], "role": "user"},
    )
    library = api.call(
        "POST",
        "/api/admin/libraries",
        {
            "path": str(next(LIBRARY_DIR.glob("*.photoslibrary"))),
            "display_name": "Demo Library",
        },
    )
    assert isinstance(user, dict) and isinstance(library, dict)
    api.call("PUT", f"/api/admin/users/{user['id']}/libraries/{library['id']}")
    print("indexing the demo library...", flush=True)
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        info = api.call("GET", f"/api/admin/libraries/{library['id']}/status")
        assert isinstance(info, dict)
        if info["index_state"] == "error":
            raise SystemExit(f"indexing failed: {info['index_error']}")
        if info["last_indexed_at"] and info["index_state"] != "indexing":
            print(
                f"indexed {info['asset_count']} assets ({info['video_count']} videos)"
            )
            return
        time.sleep(1)
    raise SystemExit("indexing did not finish within 10 minutes")


# ------------------------------------------------------------------- process


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _stop_previous() -> None:
    """Stop a previous run of this script, found by its PID file, and only if
    that PID is still a dev_demo.py process."""
    if not PID_FILE.exists():
        return
    try:
        pid = int(PID_FILE.read_text().strip())
    except ValueError:
        return
    if not _pid_alive(pid):
        return
    try:
        cmdline = (
            pathlib.Path(f"/proc/{pid}/cmdline").read_bytes().decode(errors="replace")
        )
    except OSError:
        cmdline = "dev_demo.py"  # no /proc (macOS): trust the PID file
    if "dev_demo.py" not in cmdline:
        return
    os.kill(pid, signal.SIGTERM)
    for _ in range(50):
        if not _pid_alive(pid):
            return
        time.sleep(0.2)
    raise SystemExit(f"previous demo server (pid {pid}) did not stop")


def _build_web(force: bool) -> None:
    if (WEB_DIR / "dist" / "index.html").exists() and not force:
        return
    if not (WEB_DIR / "node_modules").exists():
        subprocess.run(["npm", "install"], cwd=WEB_DIR, check=True)
    subprocess.run(["npm", "run", "build"], cwd=WEB_DIR, check=True)


# A four-row stand-in for the GeoNames download (the demo never goes online):
# columns 1 name, 4 latitude, 5 longitude, 8 country code of cities15000.txt.
_DEMO_CITIES = (
    ("Paris", 48.85341, 2.3488, "FR"),
    ("New York City", 40.71427, -74.00597, "US"),
    ("Tokyo", 35.6895, 139.69171, "JP"),
    ("Sydney", -33.86785, 151.20732, "AU"),
)


def _write_demo_gazetteer() -> None:
    path = DATA_DIR / "geonames" / "cities15000.txt"
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for number, (name, lat, lon, country) in enumerate(_DEMO_CITIES, start=1):
        cols = [""] * 19
        cols[0], cols[1], cols[2] = str(number), name, name
        cols[4], cols[5], cols[8] = str(lat), str(lon), country
        rows.append("\t".join(cols))
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--reset", action="store_true", help="wipe demo-data/ and rebuild it"
    )
    parser.add_argument(
        "--build", action="store_true", help="rebuild web/dist even if it exists"
    )
    args = parser.parse_args()

    _stop_previous()
    if args.reset and DEMO_DIR.exists():
        shutil.rmtree(DEMO_DIR)
    DEMO_DIR.mkdir(exist_ok=True)

    if not LIBRARY_DIR.exists():
        print("generating the demo library...", flush=True)
        build_demo_library(LIBRARY_DIR)
    _write_demo_gazetteer()
    _build_web(args.build)

    env = {
        **os.environ,
        "PHOTOS_VIEWER_DATA_DIR": str(DATA_DIR),
        "OSXPHOTOS_NO_VERSION_CHECK": "1",
        # The picker in Admin > Libraries lists this folder.
        "PHOTOS_VIEWER_LIBRARIES_DIR": str(LIBRARY_DIR),
        # Dev only: the session cookie is Secure by default and a browser will
        # not send it back over plain http://127.0.0.1. Applies to this child only.
        "PHOTOS_VIEWER_COOKIE_SECURE": "false",
    }
    env.pop("PHOTOS_VIEWER_PUBLIC_ORIGINS", None)
    base = f"http://127.0.0.1:{args.port}"
    server = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "photos_viewer.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(args.port),
        ],
        env=env,
        cwd=ROOT,
    )
    PID_FILE.write_text(str(os.getpid()))

    def shutdown(*_: object) -> None:
        server.terminate()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        for _ in range(100):
            if server.poll() is not None:
                return server.returncode or 1
            try:
                urllib.request.urlopen(base + "/api/health", timeout=2).close()
                break
            except OSError:
                time.sleep(0.2)
        else:
            raise SystemExit("server did not become healthy")
        _provision(base)
        print(
            f"\nDemo ready: {base}\n  admin: {ADMIN[0]} / {ADMIN[1]}\n  user:  {USER[0]} / {USER[1]}\n"
            "(throwaway dev logins for a synthetic library). Ctrl-C or SIGTERM stops it.",
            flush=True,
        )
        return server.wait()
    finally:
        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
        PID_FILE.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
