# Server

Python 3.12 package. FastAPI and Uvicorn. Phase 0 (read-only library opening, probe CLI, tests) is done; Phase 1 in `docs/TASKS.md` builds the rest. Behavior is `docs/SPEC.md`. The reader follows `docs/PRIOR_ART.md`.

`pyproject.toml` lives here in `server/`, so `pip install -e "server[dev]"` works from a fresh clone. The package itself lives here:

```
server/photos_viewer/
  main.py                 FastAPI app, serves /api and the built web app
  session_auth.py         passwords, cookies, login lockout
  libraries.py            open a .photoslibrary read-only or via a temp sqlite copy
  index.py                osxphotos walk into app.db
  media.py                derivative, then sips/qlmanage or Pillow/ffmpeg
  routes/                 thin routers; every library route uses the assignment check
server/tests/
  fixtures/               synthetic library, built in test setup, no real photos
deploy/
  com.photosviewer.plist
  Dockerfile
  docker-compose.yml
```

Filenames must not contain `token` or `credential`. The runner cannot read those paths. See `CLAUDE.md`.

## Read-only open

`libraries.py` is the only module that may receive a `.photoslibrary` path. It copies `database/Photos.sqlite` and any `-wal` and `-shm` to a temp directory, then constructs `PhotosDB(dbfile=copy, library_path=package)`. It does not repair the database. Phase 0's test fails if the package changes.

## Media

`media.py` hides the platform. On macOS it may call `sips` or `qlmanage` when they exist. On Linux, and when they do not, it uses Pillow, pillow-heif, optional rawpy, and ffmpeg. Development and CI are Linux, so the Pillow path is the one tests hit. Usable files in `resources/derivatives` (`PhotoInfo.path_derivatives`) are preferred to a transcode. Cache files go under `PHOTOS_VIEWER_DATA_DIR`.

## Sessions

Session cookies are marked `Secure` by default (`PHOTOS_VIEWER_COOKIE_SECURE=true`), so the browser refuses to send one over plain HTTP. The deployed server is expected to sit behind HTTPS: Tailscale Serve (`tailscale serve`) or a certificate from `tailscale cert`. For local plain-HTTP development only, set `PHOTOS_VIEWER_COOKIE_SECURE=false`. The flag is never inferred from the request, since a reverse proxy can make an HTTP request look like anything.

## Locked-out admin: the `admin` CLI

`python -m photos_viewer.admin unlock <username>` clears that username's login lockout. It opens `app.db` under `PHOTOS_VIEWER_DATA_DIR` directly, with no server running, so it works even when the admin is the one locked out and the web UI's own unlock button (`POST /api/admin/users/{username}/unlock`) is unreachable:

```bash
# On the host, server stopped or not:
PHOTOS_VIEWER_DATA_DIR=/path/to/data python -m photos_viewer.admin unlock myusername

# Inside the Docker/OrbStack container, server running:
docker exec <container> python -m photos_viewer.admin unlock myusername
```

Add `--clear-ip-limits` to also clear the per-client failed-login counters (shared by every caller behind `tailscale serve`, not just this one username) when the per-IP limit, not just the per-username one, is what's tripped. Exits non-zero with a message on stderr for an unknown username.

## launchd

A plist in `deploy/`, loaded on the Mac that should run natively:

- `ProgramArguments`: the venv's `uvicorn`, `photos_viewer.main:app`, bound to the tailnet address or to localhost behind Tailscale Serve.
- `WorkingDirectory`: the checkout.
- `EnvironmentVariables`: `PHOTOS_VIEWER_DATA_DIR` pointing outside the libraries, and `OSXPHOTOS_NO_VERSION_CHECK=1`.
- `KeepAlive`: true.
- stdout and stderr to files under the data dir.

## Docker

Linux and NAS deployments use `deploy/Dockerfile` and `deploy/docker-compose.yml` at the repo root:

- Base image with Python 3.12, ffmpeg, and libheif. No pyobjc.
- Run as a non-root user.
- Each library is a bind mount with `:ro`.
- One named volume for `app.db`, thumbnails, and logs.
- `/tmp` writable (tmpfs is fine) so sqlite copies have somewhere to go. The rest of the container filesystem can be read-only.
- Do not publish the port on a public interface. Tailscale Serve terminates HTTPS on the tailnet.
- No outbound egress from the container. Publish the port on the Tailscale address (or bind localhost and let Tailscale Serve on the host proxy it). Drop connections the container initiates: either a Docker network with no route to the public internet, or a firewall rule on the container subnet. Established replies to inbound clients still flow. The container must not resolve or contact a tile host, a font host, a package index, or an update server. OSM tiles are fetched by the user's browser, not by this process. Mount an optional PMTiles file read-only for the Local file map setting.

Example compose shape, to be made real in P1.17. Build context is the repo root, where the Dockerfile will live under `deploy/`. The `internal` flag below is the no-egress example. When Tailscale Serve runs on the host instead, drop `internal` and publish only on the tailnet address, and keep an egress drop in the host firewall:

```yaml
services:
  viewer:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    read_only: true
    tmpfs: [/tmp]
    networks: [viewer]
    volumes:
      - /mnt/photos/Family.photoslibrary:/libraries/family.photoslibrary:ro
      # Optional. Used only when the admin sets Map tiles to Local file.
      - /mnt/photos/map.pmtiles:/data/map.pmtiles:ro
      - viewer-data:/data
    environment:
      PHOTOS_VIEWER_DATA_DIR: /data
      OSXPHOTOS_NO_VERSION_CHECK: "1"
volumes:
  viewer-data:
networks:
  viewer:
    internal: true
```

## Commands to grow into

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e "./server[dev]"   # from the repo root
uvicorn photos_viewer.main:app --reload
pytest
```

These do not work until P1.1.
