# apple-photos-app

A self-hosted, strictly read-only viewer for several Apple Photos libraries (`.photoslibrary` packages) on one drive. People sign in over Tailscale. The iPhone PWA follows iOS 17 Photos. The desktop browser follows macOS Sequoia Photos. An admin registers each library and chooses which user can open it. Downloads only.

The server runs on macOS and on Linux, including Docker. Libraries are read with [osxphotos](https://github.com/RhetTbull/osxphotos) by path. PhotoKit is not used. The app never writes into a library package. The server makes no outbound requests. The only external connection is the browser loading OpenStreetMap map tiles, and an admin can switch that off for a local tile file.


## Read these in order

1. [CLAUDE.md](CLAUDE.md) — constraints, layout, phases, how to run tests.
2. [docs/SPEC.md](docs/SPEC.md) — product and API source of truth.
3. [docs/PRIOR_ART.md](docs/PRIOR_ART.md) — photokit-api, xpoz, libre-photos, and osxphotos, with the modules worth borrowing.
4. [docs/TASKS.md](docs/TASKS.md) — phase-by-phase tasks and acceptance criteria.
5. [docs/design-refs/README.md](docs/design-refs/README.md) — screenshot index, including the macOS 15.0 and 15.4 sidebar orders.
6. [docs/MANUAL_MAC_TESTS.md](docs/MANUAL_MAC_TESTS.md) — real-library checklist. Not part of CI.


## Privacy

Do not commit a real photo, a real `.photoslibrary`, `app.db`, thumbnail caches, or a filled-in `.env`. Tests use a synthetic fixture. The images under `docs/design-refs/` are UI references only.

## Install

Libraries are never copied or modified. Register each one by path in the admin panel after first sign-in.

### macOS (native, launchd)

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e "./server"
(cd web && npm ci && npm run build)       # the server serves web/dist
mkdir -p ~/photos-viewer-data             # outside every .photoslibrary
sed "s#/Users/CHANGEME#$HOME#g" deploy/com.photosviewer.plist > ~/Library/LaunchAgents/com.photosviewer.plist
# Edit PHOTOS_VIEWER_PUBLIC_ORIGINS in that file to your Tailscale Serve URL, then:
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.photosviewer.plist
```

[`deploy/com.photosviewer.plist`](deploy/com.photosviewer.plist) runs `uvicorn photos_viewer.main:app` on `127.0.0.1:8000` from the checkout, with `KeepAlive`, `PHOTOS_VIEWER_DATA_DIR` and `OSXPHOTOS_NO_VERSION_CHECK=1` set, and stdout/stderr in `server.log` and `server.err.log` inside the data directory. Stop with `launchctl bootout gui/$(id -u)/com.photosviewer`. The app can use `sips`/`qlmanage` here; otherwise it falls back to Pillow and ffmpeg (`brew install ffmpeg`).

### Linux (Docker)

```bash
export PHOTOS_LIBRARY_DIR=/mnt/photos            # directory holding the *.photoslibrary packages
export PHOTOS_VIEWER_PUBLIC_ORIGINS=https://myhost.tailxyz.ts.net
docker compose -f deploy/docker-compose.yml up -d --build
```

[`deploy/Dockerfile`](deploy/Dockerfile) builds the web app, installs the server, ffmpeg and libheif, and runs as uid 10001. The image contains code only; `.dockerignore` keeps libraries, `app.db`, `.env` and `*.sqlite` out of the build. [`deploy/docker-compose.yml`](deploy/docker-compose.yml) has a read-only root filesystem, a `/tmp` tmpfs (sqlite copies and transcode scratch), the libraries at `/libraries` (`:ro`), an optional `/tiles` (`:ro`), and the named volume `viewer-data` at `/data` (`app.db`, thumbnails). A small `forward` sidecar (socat, TCP passthrough only) publishes the app on `127.0.0.1:8000`, because the app container itself has no route off its internal network. Register libraries by their in-container path, e.g. `/libraries/Family.photoslibrary`. Without Docker, `pip install -e ./server`, build `web/`, and run `uvicorn photos_viewer.main:app --host 127.0.0.1` under systemd.

## Tailscale Serve

HTTPS comes from Tailscale; the app is never exposed beyond the tailnet. Session cookies are `Secure`, so plain HTTP will not sign in (except `PHOTOS_VIEWER_COOKIE_SECURE=false` for local dev).

```bash
tailscale serve --bg 8000                       # proxies to 127.0.0.1:8000 (native, or the compose forwarder)
tailscale serve status                          # shows https://myhost.tailxyz.ts.net
```

Set `PHOTOS_VIEWER_PUBLIC_ORIGINS` to that URL. Do not use Tailscale Funnel. See [server/README.md](server/README.md) for CSRF and trusted-proxy details.

## First admin

Open the Serve URL. A fresh `app.db` shows the setup screen: choose the admin username and password (Argon2id). That screen only works while no user exists. Locked out later: `python -m photos_viewer.admin unlock <user>` (in Docker: `docker exec <container> ...`).

## Add a library

Admin panel → Libraries → Add. Enter the path to the `.photoslibrary` (on the machine or inside the container). The server probes it read-only, refuses an unsupported Photos version with a message, and indexes it in the background. Registering a library never changes it.

## Assign access

Admin panel → Users to create accounts, then the access matrix to tick which user sees which library. Unassigned libraries return 404 to that user. An admin sees a library's photos only after assigning it to themselves.

## Install the PWA

On iPhone, open the Serve URL in Safari → Share → Add to Home Screen. It opens full-screen with a 30-day sign-in. On desktop, use the browser directly.

## Read-only rules

- Nothing writes into a `.photoslibrary`: `Photos.sqlite` and its `-wal`/`-shm` are copied to a temp directory (or opened `mode=ro`) and the copy is read.
- Docker library mounts are `:ro`, so the kernel enforces this too. Do not remove `:ro` to "fix" a permission error.
- No editing, deleting, uploading, share links, or favorites. Downloads only.
- Only `app.db`, thumbnails and logs are written, all under the data directory.

## Offline rule

The server makes no outbound connections: no update check, no geocoding, no CDN, no telemetry; `OSXPHOTOS_NO_VERSION_CHECK=1` is set everywhere. The only external connection is the browser fetching OSM tiles from `tile.openstreetmap.org` when a map is open. Admin → Settings → Map tiles can switch to Local file (a Protomaps PMTiles file: mount it read-only at `/tiles/map.pmtiles` in Docker) or Off, after which browsers make no OSM requests.

### No outbound egress (Docker)

Two layers; use both.

1. **Compose network.** The app container (`viewer`, `172.28.0.2`) is only on the `viewer` network, which is `internal: true`: no gateway to the internet, no public DNS. Docker does not publish ports from an internal-only container and Tailscale Serve only proxies to localhost, so the `forward` sidecar joins that network (`172.28.0.3`) and an ordinary bridge, and publishes `127.0.0.1:8000` -> `viewer:8000` (plain TCP; it forwards inbound connections only). The app trusts forwarding headers only from `172.28.0.3`. If the subnet collides with an existing network (`docker network ls`), change the `172.28.0.0/24` pool, the gateway, both `ipv4_address` values, the socat target and the two forwarding variables together.
2. **Host firewall.** Drop connections the container initiates, keep replies and inbound. `DOCKER-USER` is evaluated before Docker's own rules:

```bash
sudo iptables -I DOCKER-USER -s 172.28.0.0/24 ! -d 172.28.0.0/24 -m conntrack --ctstate NEW -j DROP
sudo ip6tables -I DOCKER-USER -m conntrack --ctstate NEW -s fd00:28::/64 -j DROP   # only if you enable IPv6 on the network
```

The rule matches the internal subnet, so it catches the app container; the forwarder reaches the host through the `edge` bridge, and its only outbound connection is to `172.28.0.2`, which the rule allows. Inbound from the tailnet still works: Tailscale Serve (on the host) connects to `127.0.0.1:8000`, the forwarder connects to the app inside the subnet, and every reply is `ESTABLISHED`. Persist the rule with your distro's tool (`iptables-persistent`, or an nftables file). Check, with the stack up:

```bash
docker compose -f deploy/docker-compose.yml exec viewer python -c "import socket; socket.create_connection(('1.1.1.1', 443), 3)"   # must fail
curl -sf https://myhost.tailxyz.ts.net/api/health                                                                              # from another tailnet device: must succeed
```

If you instead drop the forwarder and publish the app's port directly (remove `internal`, e.g. `127.0.0.1:8000:8000`, never a bare `8000:8000`), the firewall rule is the only egress block, so keep it.

## Linux mount caveats

- Mount the drive read-only (`mount -o ro`) or bind with `:ro`; the app never needs write access.
- Photos packages copied from macOS: HFS+/APFS volumes need `hfsprogs`/`apfs-fuse` and are read-only on Linux anyway. exFAT/NTFS/SMB/NFS work; names are case-sensitive on ext4, so keep the copy's case intact.
- SMB/NFS: use `vers=3`+ and `ro,noserverino` if inode numbers repeat; set `uid`/`gid` (or `forceuid`) so uid 10001 can read, or mount with `file_mode=0444,dir_mode=0555`.
- The sqlite copy needs space in `/tmp` (tmpfs here is 2 GB; raise the `size=` in compose for very large `Photos.sqlite` files).
- Network mounts that are not up at boot give an empty directory: the library shows as unavailable and nothing in `app.db` is deleted. Order the mount before `docker compose up`.

## Updating osxphotos

Maintainer step, done on a machine with network access, never by the running server:

```bash
# bump the pin in server/pyproject.toml, then
pip install -e "./server[dev]" && pytest          # also: python -m photos_viewer.probe <library> per docs/MANUAL_MAC_TESTS.md
docker compose -f deploy/docker-compose.yml build  # Docker: rebuild, then up -d
```

Update the supported-versions note in `server/photos_viewer/libraries.py` if osxphotos gains a Photos generation.
