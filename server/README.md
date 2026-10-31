# Server

Python 3.12 package. FastAPI and Uvicorn. Not created yet. Phase 0 and Phase 1 in `docs/TASKS.md` build it. Behavior is `docs/SPEC.md`. The reader follows `docs/PRIOR_ART.md`.

`pyproject.toml` lives at the repo root so `pip install -e ".[dev]"` works from a fresh clone. The package itself lives here:

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
- No outbound egress at runtime. Publish the port on the Tailscale address (or bind localhost and let Tailscale Serve on the host proxy it). Drop connections the container initiates: either a Docker network with no route to the public internet, or a firewall rule on the container subnet. Established replies to inbound clients still flow. The running app must not resolve or contact a tile host, a font host, a package index, or an update server. Mount the PMTiles file the same way as the data volume, read-only.

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
pip install -e ".[dev]"
uvicorn photos_viewer.main:app --reload
pytest
```

These do not work until P1.1.
