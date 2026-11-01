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

## CSRF and `tailscale serve`

Every state-changing request (including login) is rejected unless its `Origin` header matches the server's own origin. `tailscale serve` breaks the naive version of that check: it terminates HTTPS and renames Host to the tailnet name, so the browser's Origin (`https://<machine>.<tailnet>.ts.net`) never matches what the server would see on its plain-HTTP loopback socket -- unless the scheme gets fixed up first.

uvicorn's `--proxy-headers` is on by default, and by default it trusts exactly the peer `tailscale serve` connects from (`--forwarded-allow-ips=127.0.0.1,::1`). That means plain, no-flags `uvicorn photos_viewer.main:app` already does the right thing on bare metal:

```bash
tailscale serve --bg 8000
uvicorn photos_viewer.main:app --host 127.0.0.1 --port 8000
```

uvicorn's own `ProxyHeadersMiddleware` rewrites the request's scheme from `X-Forwarded-Proto` before any of this app's code runs; `tailscale serve` forwards the original Host header unchanged, so `request.url` already reads as the real `https://<machine>.ts.net` origin. This is the recommended mechanism -- nothing in `session_auth.py` has to parse a forwarded header itself.

In Docker, `tailscale serve` runs on the host and proxies to the container's published port, typically from the Docker bridge gateway rather than loopback, so the above does *not* apply unmodified -- that peer isn't trusted by default and its address isn't fixed across hosts. Use the explicit override for the CSRF Origin check, and tell uvicorn to trust the gateway so `X-Forwarded-For` is honored:

```bash
PHOTOS_VIEWER_PUBLIC_ORIGINS=https://myhost.tailxyz.ts.net \
  uvicorn photos_viewer.main:app --host 0.0.0.0 --port 8000 --forwarded-allow-ips=172.17.0.1
```

`172.17.0.1` is Docker's default bridge gateway; check `docker network inspect bridge` (or your compose network) for the real address, since it is not guaranteed across hosts. `--forwarded-allow-ips` also accepts `*` to trust whatever peer connects, which is safe only when the container has no other inbound route (see "Docker" below -- published only on the tailnet address, no public port). `--forwarded-allow-ips` has an env-var equivalent (`UVICORN_FORWARDED_ALLOW_IPS`) for compose files that prefer `environment:` over `command:`.

`PHOTOS_VIEWER_PUBLIC_ORIGINS` (comma-separated `scheme://host[:port]`) is validated at startup: an entry that fails to parse logs a `WARNING` naming the variable and the bad value and is dropped; if every entry fails to parse, the app refuses to start rather than silently falling back to same-origin-only checking.

### The per-client login-lockout bucket, and `PHOTOS_VIEWER_TRUSTED_PROXIES`

Separately from the CSRF check, the login route also tracks failed attempts per client (`MAX_FAILED_LOGIN_ATTEMPTS_PER_IP`), to slow down a flood of guesses from one caller without touching the per-username lockout everyone else's login still depends on. That counter is keyed on `request.client.host` -- which `--forwarded-allow-ips` is what makes equal to the real tailnet device's address, same as above.

If `--forwarded-allow-ips` is *not* pointed at the Docker bridge gateway (the out-of-the-box default, since the gateway's address isn't known in advance), every request looks like it comes from that one gateway address, and the per-client bucket becomes shared: 30 failed logins from any one device lock out everyone else behind the proxy for 15 minutes. This is the same problem loopback already has by default -- solved there by keying on the `Tailscale-User-Login` header instead, when the direct peer is loopback.

`PHOTOS_VIEWER_TRUSTED_PROXIES` (comma-separated IPs and/or CIDRs, e.g. `172.17.0.1` or `172.18.0.0/16`) extends that same `Tailscale-User-Login`-keyed treatment to other peers this server should treat as "the known reverse proxy, not a real caller" -- a code-level safety net for the Docker case above when `--forwarded-allow-ips` isn't set to the gateway's actual address (or can't be, e.g. it varies at deploy time). Unlike `PHOTOS_VIEWER_PUBLIC_ORIGINS`, *any* invalid entry here fails startup outright, not just "every entry invalid": a typo'd address would otherwise look like it's working right up until the first burst of failed logins locks out the whole tailnet.

**A trusted peer must not be reachable by anything else.** Trusting an address for `Tailscale-User-Login` means *any* request that arrives from that address is treated as "the proxy forwarding a real tailnet user," header and all. If the container's published port is also reachable from the host's own LAN (or from any process on the host), that caller can set `Tailscale-User-Login` to whatever it wants and get its own lockout bucket -- same risk as the `--forwarded-allow-ips=*` case above, and the same fix: publish the port only on `127.0.0.1` (when `tailscale serve` runs on the host and proxies to the container) or on the tailnet interface's own address, never on `0.0.0.0` or a LAN-reachable interface, so `tailscale serve` is the only route in. In compose or `docker run` terms, that is the host-address-qualified ports form, e.g. `127.0.0.1:8000:8000`, not a bare `8000:8000`. As a second layer, `MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER` caps the *combined* failed-login count across every `Tailscale-User-Login` value (and the no-header fallback, see below) seen from one trusted peer's address within the lockout window, ten times looser than the per-client limit -- so even a caller that can reach a trusted peer and rotates the header on every attempt eventually trips a ceiling, instead of buying an unlimited number of fresh buckets. A trusted peer's request with *no* `Tailscale-User-Login` header at all is not given loopback's "skip the per-client limit entirely" treatment either, since (unlike loopback) it can be reached by more than the proxy -- it gets its own bucket keyed on the peer's address, still subject to that same per-peer ceiling.

Configuring neither is the documented "it still works, just coarser" case: logins succeed, but the per-client bucket is shared across every device behind the gateway. Configuring `--forwarded-allow-ips` correctly is the complete fix (also corrects the CSRF Origin check's and the audit log's idea of the caller's address) and is the default this doc recommends; `PHOTOS_VIEWER_TRUSTED_PROXIES` is for when that isn't possible.

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

Example compose shape, to be made real in P1.17. Build context is the repo root, where the Dockerfile will live under `deploy/`. The `internal` flag below is the no-egress example. When Tailscale Serve runs on the host instead, drop `internal`, publish the port host-address-qualified as shown commented out below (never a bare `8000:8000`, which would also publish on the LAN -- see the trusted-peer warning above), and keep an egress drop in the host firewall.

`172.17.0.1` (used above, and in `PHOTOS_VIEWER_TRUSTED_PROXIES`'s own example) is only the *default* bridge network's gateway. A compose file that names its own network, like `viewer` below, gets a different, host-dependent subnet unless pinned -- so this example pins one with `ipam` and points `UVICORN_FORWARDED_ALLOW_IPS` at that subnet's gateway, not at `172.17.0.1`. Run `docker network inspect <project>_viewer` to confirm the actual gateway if you don't pin it yourself.

```yaml
services:
  viewer:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    read_only: true
    tmpfs: [/tmp]
    networks: [viewer]
    # ports: ["127.0.0.1:8000:8000"]  # only when tailscale serve runs on the host, not in the no-egress example above
    volumes:
      - /mnt/photos/Family.photoslibrary:/libraries/family.photoslibrary:ro
      # Optional. Used only when the admin sets Map tiles to Local file.
      - /mnt/photos/map.pmtiles:/data/map.pmtiles:ro
      - viewer-data:/data
    environment:
      PHOTOS_VIEWER_DATA_DIR: /data
      OSXPHOTOS_NO_VERSION_CHECK: "1"
      # tailscale serve on the host reaches this container from the Docker
      # bridge gateway, not loopback -- see "CSRF and tailscale serve"
      # above for both of these and why they default to unset otherwise.
      # 172.28.0.1 is the gateway of the `viewer` network's pinned subnet
      # below, not the default bridge's 172.17.0.1 (see the note above).
      PHOTOS_VIEWER_PUBLIC_ORIGINS: https://myhost.tailxyz.ts.net
      UVICORN_FORWARDED_ALLOW_IPS: 172.28.0.1
volumes:
  viewer-data:
networks:
  viewer:
    internal: true
    ipam:
      config:
        - subnet: 172.28.0.0/24
          gateway: 172.28.0.1
```

## Commands to grow into

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e "./server[dev]"   # from the repo root
uvicorn photos_viewer.main:app --reload
pytest
```

These do not work until P1.1.
