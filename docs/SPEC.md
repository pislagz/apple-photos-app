# Project: Private Photos Viewer

Multiple `.photoslibrary` files → web app for iPhone (PWA, iOS 17 Photos style) and desktop (macOS Sequoia Photos style), over the home network or Tailscale.

The server runs on macOS and on Linux. Both are first-class. See [Platforms](#platforms).

## Goal

Build a self-hosted, read-only web app that lets several people browse and download photos and videos from Apple Photos libraries stored as `.photoslibrary` packages on one drive. Access is remote, over the home network (plain http, the default) or Tailscale, from:

- **iPhone:** an installable PWA that looks and feels like the pre-iOS 18 (iOS 17) Photos app.
- **Desktop browser** (Safari, Chrome, Firefox on Mac or PC): a layout that looks and feels like the macOS Sequoia (macOS 15) Photos app.

Both use the same login. Admins also get an admin panel to register library files and control which user can see which library. It's for personal and family use only.

## Context and constraints

- Several separate `.photoslibrary` packages on one drive, none of them the macOS System Photo Library. They total several terabytes, all originals are local, and there's no iCloud.
- PhotoKit is not used. It only reaches the System Photo Library, and it does not exist on Linux. Libraries are read directly from disk with [osxphotos](https://github.com/RhetTbull/osxphotos), which opens any library by path on macOS and on Linux.
- **Strictly read-only.** Never write to, migrate, repair, or open-for-write any library package or its database. Open the database read-only (`mode=ro`), immutable, or as a copy that lives outside the package. Detect when Photos.app has the same library open and show a warning.
- **Home network by default, Tailscale supported (decided 2026-11-12, #266).** The server can be opened over plain http from other devices on the LAN (`http://192.168.1.20:8000`, `http://homeserver.local:8000`) with no extra settings: the session cookie is `Secure` only when the request arrived over https (`PHOTOS_VIEWER_COOKIE_SECURE=auto`; `true`/`false` force it), and the CSRF `Origin` check accepts an Origin whose host and port equal the request's `Host` header, plus any `PHOTOS_VIEWER_PUBLIC_ORIGINS` entry. A cross-site Origin is never accepted. `X-Forwarded-Proto` and `Tailscale-User-Login` are believed only from loopback or `PHOTOS_VIEWER_TRUSTED_PROXIES`; a direct LAN client gets its own login-lockout bucket from its real address. HTTPS is optional (Tailscale Serve or any reverse proxy) and is needed for passkeys and Add to Home Screen; without it the login screen hides the passkey button and says why. Nothing is exposed publicly; do not forward the port from the internet. Where the text below says "behind tailscale serve", that is the HTTPS option.
- **No outbound connections except browser-side OSM map tiles.** The server makes zero outbound requests, with one exception: an admin's one-time download of the GeoNames city list for the optional Offline place names (below), possible only after the admin agreed to "Map & place names". The only other external connection is the browser loading OpenStreetMap tiles while a map is open, and only after that same agreement. See [No outbound network](#no-outbound-network).
- No paid Apple Developer account, so the iPhone side is a PWA added from Safari, with no native app.
- Out of scope: editing, deleting, uploading, public share links, Memories, Featured Photos.

## No outbound network

No outbound connections except browser-side OSM map tiles. The Python server, its background jobs, and Docker make zero outbound requests, apart from the admin-started GeoNames download described under Offline place names, which the server refuses (403) until the admin has agreed to "Map & place names". Installing packages during a build or a developer setup may use the network. A running server may not.

- **Map, default.** OpenStreetMap raster tiles, `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, drawn by MapLibre GL JS. The browser fetches a tile only when a user has a map view open (the main Map screen or the info-panel mini-map). The server does not fetch, proxy, or store those tiles.
- **Map & place names consent (Decisions 5, replaces the two D41 opt-ins).** One agreement covers both OpenStreetMap map data and GeoNames place names. The text: "This app works fully offline. To show the map and place names, it can download OpenStreetMap map data and place-name data (GeoNames). Nothing about your photos is sent." with an "Allow" checkbox, in a "Map & place names" section on the first-run admin setup screen and in Admin → Settings (anchor `/admin#map-place-names`). Stored as `osm_consent` (`1`/`0`); **off until the admin agrees**, and an install with no saved answer counts as not agreed. Until the question is answered the admin dashboard shows a notice with two buttons, "Allow" and "Not now" (`PUT /api/admin/place-names/consent`). "Allow" records the consent and the client then starts the GeoNames place-name download at once, showing its progress (and a Retry) like the manual button. "Not now" records `0` and hides the notice; the consent can still be changed in Settings. Saving Settings does not answer the notice: the consent row is written only when the checkbox differs from the current answer. Every answer is audited (`osm_consent_agreed`, `osm_consent_not_now`, `osm_consent_withdrawn`).
  - Map source (derived on read, never stored). With consent: OpenStreetMap tiles, drawn by the browser. A configured local PMTiles file is **not** preferred; it is only the fallback, used if the OSM tiles fail to load. Without consent: a configured, readable PMTiles file is the basemap (this server serves it with HTTP Range; no outbound connection is involved); with no usable file the map is off.
  - Not agreed: no browser contacts OpenStreetMap, the CSP names no external host, the GeoNames download is refused, the lookup is off and `place_offline` is blank. The Map view shows the local PMTiles basemap if a readable file is configured; otherwise it says the map is off and draws GPS clusters on a blank background. A missing or unreadable file counts as no file.
  - Agreed: the map is OpenStreetMap tiles (the CSP then names `tile.openstreetmap.org`), with a readable local PMTiles file as the fallback. The place-name download starts when the admin presses "Allow" on the notice; the "Download place-name data" button in Settings stays for a retry.
  - Where a photo has coordinates but no place name (Photos' own always wins): without consent the Info panel (desktop panel, iPhone Info sheet) shows the coordinates followed by a small "i" button. Hover or keyboard focus (desktop) or a tap (iPhone) shows "Place names are off because you haven't agreed to use OpenStreetMap data. You can change this in Settings." with "Settings" linking to the section; a user who is not an admin sees "An admin can change this in Settings." with no link. With consent but no name yet (download pending or failed) the coordinates show without the icon. The viewer title still falls back to the date.
- **OSM tile usage policy.** The public tile servers are a shared resource. Follow <https://operations.osmfoundation.org/policies/tiles/>.
  - Request only the tiles needed to draw the visible map. No bulk download, no background warm-up of every photo location, and no prefetch of zoom levels that are not on screen. The map library's small viewport overscan is acceptable.
  - Do not proxy the tiles through this server.
  - Cache only via the browser's normal HTTP cache, which follows the `Cache-Control` OSM sends. The service worker does not cache or prefetch these responses. A service-worker cache would keep tiles past those headers and would fill up as someone pans, which is the bulk use the policy forbids.
  - Attribution is visible on every map, including the mini-map: "© OpenStreetMap contributors", linking to <https://www.openstreetmap.org/copyright>.
  - This deployment is light personal use. If map traffic grows past that, do not agree to the consent and set a local PMTiles file instead of leaning on `tile.openstreetmap.org`.
  - No other OSM service. No Nominatim, no routing, no geocoding.
- **Offline place names (D41; gated by the Map & place names consent).** Photos with GPS but no place name saved by Photos can be named after the nearest city, resolved on this server:
  - Once the admin has agreed to "Map & place names", they press "Download place-name data" once. The server fetches the official GeoNames dump `https://download.geonames.org/export/dump/cities15000.zip` (cities of 15,000+ people, about 2 MB) into `<data dir>/geonames/cities15000.txt`. This is the **only** outbound request the server ever makes. It happens on that click only, sends no photo data, and is audited (`place_names_download`). The dataset is not committed to the repo and is not bundled in the Docker image; a container with egress blocked can instead be given the file by hand at that path. `cities1000` is a larger alternative if `cities15000` proves too coarse.
  - Lookup is local: the cities go into 1-degree grid buckets in memory and the nearest city within 100 km wins (longitude-aware ring search, date line handled). Indexing fills `assets.place_offline` for assets with GPS and no Photos name; turning the setting on or finishing the download backfills from the coordinates already in `app.db`, with no library file touched; turning it off blanks the column. No per-photo network call, and coordinates never leave the server.
  - The result lives in its own column and API field `place_offline` ("Warsaw, Poland": city name and full English country name from a bundled ISO 3166-1 table; an unknown code gives the city alone). Photos' own `place`, `place_address` and `place_country_code` always take priority; the offline name is shown only when they are empty. The search index does not use it.
  - Attribution (CC BY 4.0): "Place names from GeoNames (https://www.geonames.org), CC BY 4.0." It is shown in Admin → Settings next to the option and recorded in [ATTRIBUTION](#offline-place-names-attribution) below. There is no separate About page.
- **Place names.** Labels come only from place data already in the libraries (`PhotoInfo.place` and related osxphotos fields). No online geocoding, and no call out to fill in a missing name.
- **Web assets.** No CDNs, Google Fonts, analytics, telemetry, crash reporting, update checks, or external avatars. JavaScript, CSS, and fonts are bundled at build time. Glyphs and sprites used for our own labels are bundled and served same-origin. Do not load a hosted MapLibre style.
- **Content-Security-Policy.** `default-src 'self'`. The only external host is `https://tile.openstreetmap.org`, and it is on the policy **only while the OpenStreetMap map is on** (D41): without the consent (with or without a local file), `connect-src` is `'self'` and the header names no external host. The server reads the consent per response (cached a few seconds, dropped when Settings are saved, the notice is answered, or first-run setup runs). When it is on, MapLibre fetches raster tile bytes, so that host goes on `connect-src` and `connect-src` lists nothing else. If an implementation loads the tiles as images instead, put that host on `img-src` and leave `connect-src` as `'self'`. Do not list it on both unless a test shows both request types. `img-src` otherwise is `'self' blob: data:`. `font-src`, `script-src`, and `style-src` stay on `'self'`. `worker-src` may add `blob:` if the map library needs a blob worker. `object-src 'none'`. `base-uri 'self'`. `frame-ancestors 'none'`.
- **Service worker.** It caches same-origin app requests only. It does not intercept `tile.openstreetmap.org`. Those responses stay in the browser HTTP cache.
- **Python dependencies.** osxphotos is used as a library (`PhotosDB`, `PhotoInfo`), not via its CLI. Do not call its update check or download helpers (`get_latest_version`, `check_version`, `selfupdate`, `download_url_to_dir`). Set `OSXPHOTOS_NO_VERSION_CHECK=1` for the process. Do not add an optional dependency that performs network I/O when imported or while serving.
- **Docker.** The container has outbound egress blocked (an internal Docker network, or a firewall rule that drops connections the container initiates). Clients on the tailnet can still open inbound connections. The grid, viewer, and downloads work in that configuration. The OpenStreetMap basemap, when an admin has turned it on, needs the viewer's browser to reach `tile.openstreetmap.org`. A basemap that also works with the browser offline is the Local file setting.

## Platforms

The server process must run on both macOS and Linux, including Docker on Linux or a NAS. A Mac-only tool may be an optimization. It must not be required for the core path.

- **Media processing** goes through one interface.
  - On macOS, prefer `sips` or `qlmanage` when they are on `PATH`.
  - Everywhere else, and whenever those tools are missing, use Pillow with pillow-heif, optional rawpy, and ffmpeg for video stills.
  - Before transcoding, reuse the library's own derivative files (`resources/derivatives`, exposed by osxphotos as `PhotoInfo.path_derivatives`) when they are usable.
- **No macOS-only dependency on the core path.** Do not import PhotoKit, pyobjc, photoscript, or `osxphotos.photokit`. osxphotos' query API is the reader on both platforms.
- **Linux volume caveats.** The drive has to be readable from Linux. APFS support there is limited (read-only FUSE builds often miss compression, encryption, and snapshots). Prefer exFAT, an HFS+ volume mounted read-only, or a network share. Path lookup is case-sensitive on Linux. Some RAW, HEIC, and edited-render files decode differently than they do under `sips`. Referenced originals that osxphotos can only resolve through a macOS bookmark may be missing on Linux; show them as unavailable instead of failing the library.
- **SQLite on network and external drives.** Opening `Photos.sqlite` in place can raise `SQLITE_CANTOPEN` when SQLite wants a `-shm` sidecar the mount will not allow. Copy `Photos.sqlite` plus any `-wal` and `-shm` to a temp directory outside the package, then open the copy. Pass the real package as `library_path` so originals still resolve. See `docs/PRIOR_ART.md`.
- **Packaging.**
  - macOS: run natively as a `launchd` service.
  - Linux: a Dockerfile and a docker-compose file. Library mounts are read-only. `app.db`, the thumbnail cache, and temp database copies live on a separate writable volume.
- **Tests.** CI runs on Linux against a small synthetic fixture library. A real `.photoslibrary` is never required for CI and is never committed. An optional manual checklist for a real library on a Mac lives in `docs/MANUAL_MAC_TESTS.md`. Phase 0 runs the same version probe on macOS and on Linux.

## Architecture

A single server process that serves the API, the web app (mobile and desktop layouts), and the admin panel.

### Server

- Python 3.12+ with FastAPI and Uvicorn.
- osxphotos to read each library: assets, dates, media types, albums and folders, favorites, hidden, places and GPS, People with names and faces, EXIF and camera info, and the paths to originals, edited versions, and Live Photo videos.
- Library registry managed in the admin panel. Each library has an id, a display name, and a path on the drive. Build each library's index at registration and re-index when its database file changes or an admin asks.
- Own SQLite database (`app.db`), kept outside all libraries, for users, sessions, library assignments, the asset index, the thumbnail cache index, and the audit log.
- Thumbnails and previews:
  - Sizes: grid (about 300 px), large grid for desktop (about 600 px), and preview (about 1600 px), as WebP or JPEG, cached on disk outside the libraries.
  - Generate them through the platform interface described under [Platforms](#platforms). HEIC, RAW, and video all have to work on Linux without `sips` or `qlmanage`.
  - Use the library's own derivative files when they're usable.
  - Generate lazily, with a resumable background pre-warm job per library that reports progress. A job that had finished starts again by itself after an index run that changed something (added, removed, changed or Hidden-flag-changed assets), under the same rules as a manual start: cached and Hidden assets are skipped and it pauses at 90% of the cache limit. A job never run, paused (by an admin or by the 90% rule) or cleared is not started automatically.
- Version check: log each library's Photos database version (`PhotosDB.db_version` and `PhotosDB.photos_version`), and refuse versions osxphotos doesn't support, with a clear error in the admin panel. Re-read the installed osxphotos README for the support table; do not hard-code a stale one.

### Edits

- Per library, and overridable per user, choose whether to show the edited version or the original. The viewer offers "Download original" and "Download edited" when both exist.

## API (JSON over HTTPS)

Every endpoint requires a session, and every request is checked against the libraries assigned to that session's user.

- `GET /api/me`: current user, role, and assigned libraries.
- `GET /api/libraries/:lib/assets?cursor=&limit=&album=&person=&type=&from=&to=`: paginated assets.
- `GET /api/libraries/:lib/summary`: counts per year, month, and day.
- `GET /api/libraries/:lib/assets/:id`: full metadata, including EXIF, location, people, albums, and whether an edited version and a Live Photo video exist.
- `GET /api/libraries/:lib/thumb/:id?size=grid|grid2x|preview`
- `GET /api/libraries/:lib/original/:id?version=original|edited&format=native|jpeg`: with HTTP Range support.
- `GET /api/libraries/:lib/livephoto/:id/video`
- `GET /api/libraries/:lib/albums`: tree of folders and albums plus smart albums.
- `GET /api/libraries/:lib/albums/:id/assets`
- `GET /api/libraries/:lib/people` and `.../people/:id/assets`
- `GET /api/libraries/:lib/map?bbox=&zoom=`: clustered GPS points. This response is not the basemap. With consent the browser loads OSM raster tiles itself (a PMTiles file is only the fallback). Without consent, and with a readable PMTiles file, the basemap is a same-origin range read of that file.
- `GET /api/libraries/:lib/search?q=`: by date, place, person, album name, camera, file name, title, or description.
  - **Matching (D36).** Every term must match some field, case- and accent-insensitively, as a word prefix: place, address, person, album title, camera make or model, Apple's labels and extra search fields, file name, original file name, title, description, the capture year / ISO day (`2024`, `2024-03`, `2024-03-05`), and the month name from three letters. Hidden photos never match. A term with a character that is not a letter, digit, `_` or `-` matches nothing. File names also match on the pieces of a name split on `_` (D64): `0012` finds `IMG_0012.HEIC`.
  - **Index.** The indexer writes one FTS5 row per asset (`assets_fts`, rowid = `assets.id`) in the same batch transactions as the asset rows, so the swap is as atomic as the rest of the index; a trigger drops the row when its asset goes. A query is one `MATCH` instead of a Python scan of every photo. Measured on 250,000 synthetic assets (`scripts/bench_search.py`): a one-term search went from about 1.6 s to about 10 ms, three terms from 4.7 s to 32 ms, and no match from 7.1 s to 37 ms. Cost: about 270 bytes per asset of extra `app.db` (67 MB at 250,000 assets) and about 65 microseconds per asset to tokenise and write (about 16 s at 250,000, small beside the osxphotos walk). Existing indexes get it through the one-time re-index (D11); until a library's re-index has run, Search scans as before.
- `POST /api/libraries/:lib/zip`: builds a zip of selected originals for desktop batch download and streams it.
- `POST /api/libraries/:lib/zip/ticket` and `GET /api/libraries/:lib/zip/download?ticket=` (D47): the same zip as a plain browser download. The JSON POST validates the selection (404/413 as JSON) and returns `{ticket, total_bytes, expires_in, job}`; the page then navigates to the GET, which streams `Content-Disposition: attachment`, so the browser writes it to disk and the tab never buffers it. Why not a form POST: the CSRF rule is "state-changing requests must be `application/json`", which a form cannot send, and a signed token would have to carry up to 5,000 ids in a URL. So the ticket is a random 24-byte string held in the server's memory (single process; a restart just voids pending tickets), valid 60 seconds, single use, bound to the user and library that asked, and the GET also needs the SameSite=Strict session cookie. Foreign library, other user, expired or unknown ticket: 404.
- `GET /api/libraries/:lib/zip/report?job=` (D50): after a HEIC-as-JPEG zip, `{done, unconverted: [{id, name}]}` lists files that could not be converted and went in as originals. The job id comes from the `X-Zip-Job` header (in-page zip) or the ticket answer (browser download, which cannot read headers); the client polls until `done`. In-memory, 10 minutes after the stream ends, private to the user and library.
- `POST /api/libraries/:lib/selection-summary` (D21): `{count, photos, videos, date_first, date_last, total_bytes, place}` for up to 50,000 ids, for the desktop Info panel.
- `GET /api/health`
- Admin API under `/api/admin/*`: users, libraries, assignments, sessions, jobs, audit log, and settings.

## Accounts, authentication, and admin panel

### Model

- Roles: `admin` and `user`.
- Admins register library files and assign each user to one or more libraries. Users see only their assigned libraries. An admin sees a library's photos only if they assign it to themselves.

### Authentication

- Username and password, hashed with Argon2id. Passkeys (WebAuthn, P3.1) sign in beside the password; the password keeps working. Registering a new passkey asks for the account password again, in the same request that starts the ceremony, and counts wrong passwords toward the login lockout. See `PHOTOS_VIEWER_WEBAUTHN_RP_ID` / `PHOTOS_VIEWER_WEBAUTHN_ORIGINS` in `.env.example`.
- Secure, HttpOnly, SameSite=Strict session cookies. Long lifetime for the installed PWA, shorter for desktop by default (configurable). "Remember me" and logout.
- Rate-limit logins and lock out temporarily after repeated failures. The lockout is keyed on the username, not on who is asking, plus a looser per-client limit keyed on the real client address -- the tailnet device's own address, once uvicorn's `--proxy-headers` (on by default behind `tailscale serve`, see below) has rewritten it from `X-Forwarded-For` -- falling back to the `Tailscale-User-Login` header only when the direct peer is loopback, or is listed in `PHOTOS_VIEWER_TRUSTED_PROXIES` (so everyone behind the proxy would otherwise share one counter); trade-off: knowing a real username is enough to lock that account out for the cool-off window. An unknown username locks out the same way, in a separate counter, so a 429 never reveals which usernames are real. An admin can clear a user's lockout from the admin panel (`POST /api/admin/users/{username}/unlock`) or, with no server running, via `python -m photos_viewer.admin unlock <username>` directly against `app.db` -- the fallback for an admin who is themselves locked out.
- Never trust library ids from the client without checking the session's assignments.
- Optional extra layer: allow only listed tailnet identities, using the `Tailscale-User-Login` header.
- Login screen styled to match the platform: a centered card on desktop and a full-screen form on iPhone.
- **CSRF and `tailscale serve`.** Every state-changing request is checked for a same-origin or absent `Origin` header. `tailscale serve` reverse-proxies to the local port, preserves the Host header as the tailnet `ts.net` name, terminates HTTPS, and connects from loopback -- so without help, the browser's Origin (`https://<machine>.<tailnet>.ts.net`) never matches what the server sees on its own socket (`http://127.0.0.1:<port>`). uvicorn's `--proxy-headers` is on by default and, also by default, trusts exactly that loopback peer (`--forwarded-allow-ips=127.0.0.1,::1`): with no extra flags, plain `uvicorn photos_viewer.main:app` already rewrites the request's scheme from `X-Forwarded-Proto` before this app's code runs, and since the Host header is untouched, `request.url` ends up reading as the real public origin -- this is the recommended, default mechanism, not something this app's code has to do itself.
  - `PHOTOS_VIEWER_PUBLIC_ORIGINS` (comma-separated `scheme://host[:port]`, e.g. `https://box.tailxyz.ts.net`) is the explicit override for setups where that rewriting doesn't apply: proxy headers disabled, or the proxy's address isn't in `--forwarded-allow-ips` -- notably Docker, where `tailscale serve` runs on the host and typically reaches the container from the Docker bridge gateway, not loopback.
  - An entry that fails to parse logs a `WARNING` naming the variable and the bad value and is otherwise ignored; if every entry fails to parse, the app refuses to start rather than silently falling back to same-origin-only checking.
  - **Docker and the per-client lockout bucket.** `--forwarded-allow-ips` set to the container's actual bridge gateway (not just loopback) is the recommended default for Docker: it is what makes `request.client` (and so the per-client lockout key, the CSRF Origin check's notion of the real scheme, and the audit log) read as the real tailnet device instead of the one gateway address shared by every caller. (That gateway is only `172.17.0.1` on Docker's unnamed default bridge network; a compose file with its own named network gets a different, host-dependent address unless the network pins one with `ipam`.) When that isn't configured, or the gateway's address can't be fixed at deploy time, `PHOTOS_VIEWER_TRUSTED_PROXIES` (comma-separated IPs/CIDRs) is a code-level fallback: a listed direct peer gets the same `Tailscale-User-Login`-keyed lockout treatment loopback gets by default. Any entry that fails to parse refuses to start the app (unlike `PHOTOS_VIEWER_PUBLIC_ORIGINS`'s per-entry warn-and-drop), since a typo'd address would otherwise silently never match and only show up as everyone-locked-out later. Configuring neither is still a safe default -- logins work, only the per-client bucket is coarser.
  - **A trusted peer is a trust boundary, not just an address.** Listing a peer in `PHOTOS_VIEWER_TRUSTED_PROXIES` means any request arriving from it is treated as the reverse proxy forwarding a real tailnet user, `Tailscale-User-Login` header and all -- so that address must not be reachable by anything *other* than the proxy. Publish the container's port only on `127.0.0.1` (when `tailscale serve` runs on the host and proxies in) or on the tailnet interface's own address, never on `0.0.0.0` or a bare port mapping that is also LAN-reachable; same rule, and same reasoning, as `--forwarded-allow-ips=*` above. As defense in depth, a per-peer ceiling (`MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER`, ten times the per-client limit by default; `PHOTOS_VIEWER_MAX_FAILED_LOGINS_PER_PEER` overrides it) caps the combined failed-login count across every `Tailscale-User-Login` value -- and the no-header fallback, which a trusted peer also gets its own bucket for, unlike loopback -- seen from one peer within the lockout window. That peer is loopback by default, or a configured trusted proxy; the ceiling is not limited to the latter, since loopback's header-keyed buckets share loopback's one address exactly the same way. So a caller that can still reach that peer can't buy unlimited tries by rotating the header -- at the cost of a trade-off: roughly 300 bad attempts (by default) from one such caller lock out everyone else sharing that peer for the 15-minute window, correct passwords included. Recovery is the same admin unlock as above, with `clear_ip_limits` (API) or `--clear-ip-limits` (CLI, see `server/README.md`), which clears this counter too.

### Admin panel (desktop-first web UI, admin role only)

- **Libraries**
  - Add a library by browsing or typing a path on the drive, with validation that it exists, is a `.photoslibrary`, has a supported version, and is readable.
  - Set display name; rename; remove (removing only drops it from the app and never touches files).
  - Status for each library: asset, video, and People counts, total size, last index time, thumbnail pre-warm progress, and warnings like "Photos.app has this library open", "unsupported version", or "drive not mounted".
  - Actions: re-index, start or pause pre-warm, clear thumbnail cache.
  - **Change checks (Settings).** The server checks each library for a replaced or changed package every N minutes (1 to 10080, default 15); a changed copy must also stay unchanged for a wait time (0 to 10080 minutes, default 10) before it is re-indexed. **Manual only** turns the automatic check off (stored as an interval of 0, which older installs may already have); **Check now** runs one check-and-reindex-if-changed pass over all libraries in the background (admin only, CSRF-guarded, audited), and does nothing if a pass is already running. The wait time still applies.
  - A registered library whose file is missing: the status suggests the best unregistered `.photoslibrary` next to it, ranked by name similarity (copy suffixes like " 2" or " copy" ignored), then most recently modified, then `Photos.sqlite` size closest to the old one (stat only). The best match is prefilled in Replace and the other candidates are listed.
  - Default edited-or-original setting.
- **Users**
  - Create, edit, disable, and delete accounts; set or reset passwords; create one-time invite links; set the role.
  - **Access matrix:** users as rows and libraries as columns, with a checkbox for each pair, to grant or revoke access quickly.
- **Sessions:** list active sessions by user, device, and last seen, and revoke them.
- **Audit log:** logins, failed logins, library access, and downloads, filterable by user, library, and date, with export to CSV.
- **Settings:** session lifetimes, allowed tailnet identities, thumbnail sizes and quality, the zip size limit, and the one "Map & place names" consent (off by default, also asked on the first-run setup screen, with an admin notice, with "Allow" and "Not now" buttons, until it has been answered), plus the optional local PMTiles path under it and a "Download place-name data" button (started automatically by "Allow"; the button stays for a retry) that works only after agreeing.
- **First run:** a one-time setup screen to create the admin account.
- Styled to fit the macOS Sequoia look: a System Settings-like sidebar and grouped forms.

## Front end

- TypeScript, Vite, and React or Svelte. One codebase with two layouts:
  - **Mobile layout** (iPhone, iOS 17 style): used on narrow touch screens and when installed as a PWA.
  - **Desktop layout** (macOS Sequoia style): used on wide screens with a pointer.
  - Detect by viewport width and pointer type, and let users override in settings.
- Shared: API client, auth, virtualized grid engine (TanStack Virtual or similar) for tens of thousands of items, viewer logic, and Cache Storage for thumbnails.
- PWA manifest and service worker, standalone mode, iOS status bar styling, and icons. The service worker caches same-origin requests only and does not touch OSM tiles. The server sends the Content-Security-Policy in [No outbound network](#no-outbound-network).
- Follow system light and dark mode, using the `-apple-system` / `system-ui` font and SF Symbols-like icons (use a free icon set with a similar style, not Apple's assets).

### Mobile layout: iOS 17 Photos

- Translucent bottom tab bar: Library, Albums, More, Search.
- Library tab with a Years, Months, Days, All Photos segmented control and a date header that stays pinned while scrolling.
- Square-cropped grid with pinch-to-zoom between column counts.
- **"Library updated" note** (both layouts): after an index run that added or removed photos, a small dismissible banner at the top of the Library view, once per user: "Library updated · +N added, −M removed". The counts never include Hidden photos (a run that only changed Hidden ones shows nothing). Dismissal is stored per user on the server, so it follows them across devices; a newer run shows it again. Admin setting `show_library_updated_note` (default on) turns it off.
- Full-screen viewer:
  - Swipe between photos, pinch and double-tap zoom, swipe down to dismiss.
  - Info panel with date, camera details, location mini-map, and People in the photo. When only Apple's smaller derivative is on disk (Optimize Mac Storage), the sheet says so before download: "Only a smaller copy is on this Mac — downloads won't be the original." (`original_available: false` in the asset detail, set at index time.)
  - Video streaming, and Live Photo playback on press.
- Albums tab with only user-created albums (and shared albums, if any) — no smart albums or Media Types here, those are in More.
- More tab: People & Pets, Places (the map), Media Types (Videos, Selfies, Live Photos, Portrait, Panoramas, Screenshots, Slo-mo), and a Utilities group with Hidden (behind a confirm step, re-asked every time). No Recently Deleted or Duplicates — the app is view-only. The library switcher sits at the very bottom of this tab, since switching libraries is rare.
- People, Places, and each Media Type screen has its own stable route (e.g. `/people`, `/places`, `/media/<type>`) independent of which tab links to it, so it can move into Albums later at little cost.
- Map (inside Places) using MapLibre GL JS and the basemap from [No outbound network](#no-outbound-network), showing clustered thumbnail pins. The default basemap is OpenStreetMap raster tiles.

Apple's own iOS 17 tab bar is Library, For You, Albums, Search. This app's bar is Library, Albums, More, Search: Apple's "For You" (Memories, Featured Photos) is curated by Apple and isn't in the library, so there is no equivalent tab here. Match Apple's spacing and materials for the bar itself. Reference images are indexed in `docs/design-refs/README.md`.

### Desktop layout: macOS Sequoia Photos

- **Window structure:** a collapsible left sidebar, a main content area, and a toolbar at the top styled like a macOS window toolbar with translucent materials.
- **Sidebar:**
  - Library switcher at the top for users with several libraries.
  - Sections: Library, Favorites, Recently Saved/Added, Map, People (named people first, then unnamed face groups by photo count; all-hidden people left out), Media Types (Videos, Selfies, Live Photos, Portrait, Panoramas, Screenshots, RAW; a type with no items is not listed), Albums with the folder tree, and smart albums.
  - Collapsible groups, like Sequoia's sidebar.
  - Account menu at the bottom with the user name, an Admin entry for admins, and Log out.
- **Toolbar:**
  - Years, Months, All Photos segmented control in Library.
  - Zoom slider for grid size.
  - Search field.
  - Download button for the selection.
  - Info (ⓘ) toggle.
- **Grid:**
  - Square or aspect-ratio thumbnails with a size slider and pinch on trackpad (ctrl+wheel).
  - Date headers.
  - Hover shows a favorite heart and video duration.
- **Selection:** click, ⌘-click, ⇧-click range, and drag-select, with a selection count shown.
- **Info panel** (toolbar button): one selected photo shows its details; with 2+ selected (D21) a summary: item count (photos/videos split when both), date range ("3–9 Mar 2024"), total size, and the place if they all share one; with nothing selected, "No Selection".
- **Keyboard:**
  - Arrow keys to move, Space or Enter to open, Esc to close. Up/Down remember the column they started in, so passing through a full-width row (the Days lead photo) or a short last row returns to the same column on the next normal row. With nothing selected the first Down selects the first photo.
  - ⌘A to select all, ⌘F to search.
  - Left and right arrows in the viewer.
  - `+` and `-` to zoom.
- **Viewer:** opens in the main area with a filmstrip at the bottom, zoom and pan, and a right-side Info panel with date, camera and EXIF, file name and size, map, people, and albums, plus the same smaller-copy note when the original is not on disk. Videos and Live Photos play inline.
  - Focus (D59): while the Viewer is open, everything behind it is `inert`, so Tab cannot reach the grid, and focus returns to the thumbnail it was opened from on close; Esc still closes. The iPhone Info sheet does the same for what it covers (toolbar, filmstrip), and Info gets focus back when it closes. The HEIC fallback modal uses the same scope.
  - Title (D41): a photo's name only when a place name exists (Photos' own, else the opt-in offline name); GPS without a name uses the date, and the coordinates stay in the Info panel's Location row.
- **Map:** full content area with the same basemap source and clustered thumbnails. Clicking a cluster filters the grid. Off, or a missing local file, leaves a blank background under the clusters.
- **People:** grid of circular faces with names, opening a person's photos. Unnamed face groups follow the named people (by photo count, then group id) and are labelled "Person A", "Person B", … "Person Z", "Person AA", … (bijective base 26, like spreadsheet columns), muted. The server assigns the letters in list order, so the list and the person's page title agree and stay stable between requests (display only).
- **Right-click menu:** Download original, Download edited, Copy link (within the app only, never public), and Show in album.

Sequoia's sidebar order changed between macOS 15.0 and 15.4. The screenshots show both. Build the sidebar described in this spec. Use the screenshots for spacing, type, and icon weight. Memories, Featured Photos, Trips, Recently Deleted, Projects, and Shared Albums appear in the screenshots and are out of scope here.

## Downloading

- **iPhone:**
  - The viewer shows the full image as a plain `<img>`, with a JPEG fallback when HEIC can't be shown. Long-pressing it and choosing "Save to Photos" saves it to the gallery.
  - Multi-select, then Save, calls the Web Share API (`navigator.share({ files })`) for "Save N Images". Split large batches and warn about size.
  - Fallback download links save to Files.
- **Desktop:**
  - Single download of the original or edited file.
  - Multi-select downloads as a streamed zip, with a size limit set in settings and a progress indicator. On iPhone/iPad (any iOS browser), and on any browser when the selection is estimated above 500 MB, the zip is a normal browser download (ticket + navigation above) with a "Download started" note instead of a progress bar; below that on desktop the in-page progress bar stays. HEIC-as-JPEG keeps streaming; if some HEIC files could not be converted, a modal after the stream says "These N files stayed HEIC: a, b, c" with "Download originals of these" (a native zip of just those files) and "OK".
  - Optional "convert HEIC to JPEG" toggle.
- Log every download in the audit log.

## Non-functional requirements

- Fast first paint. The grid loads only thumbnails, never originals. Use `srcset` for desktop high-DPI screens.
- Usable over mobile data through Tailscale, with small thumbnail payloads.
- The host and drive must be awake and mounted. Document the energy settings on a Mac, and handle "drive not mounted" gracefully on both platforms.
- Accessibility: keyboard navigation on desktop, focus states, and alt text from titles or dates.
- Logging, `GET /api/health`, and graceful handling when a library is unavailable.
- Tests:
  - Access control: user A can never reach user B's libraries through any endpoint, including thumbnails, originals, and zip.
  - Indexing against a small synthetic fixture library. CI runs on Linux.
  - Layout tests for both mobile and desktop.
  - Outbound network: the server suite fails if any socket connects to a host other than localhost (`pytest-socket`). The production web build fails if JS, CSS, or HTML contains an absolute `http://` or `https://` URL whose host is not `tile.openstreetmap.org` or the OSM copyright page `www.openstreetmap.org`. A test asserts the Content-Security-Policy names that tile host only while the map is on, and no other external host ever. A test asserts that only `place_names.py` imports an HTTP client.
  - Optional manual pass on a real library on a Mac (`docs/MANUAL_MAC_TESTS.md`), including the server blocked from the internet and the OSM versus local tile modes.

## Visual references

- iOS 17 Photos (mobile) and macOS Sequoia Photos (desktop). See `docs/design-refs/` and Apple's user guides.
- Match layout, spacing, hierarchy, and behavior, but use original assets: no copying of Apple's icons, fonts, or trademarks into the app.
- iPhone guide (iOS 17): <https://support.apple.com/guide/iphone/view-photos-iph3d267610/17.0/ios/17.0>
- Mac Photos guide: <https://support.apple.com/guide/photos/welcome/mac> (select version 15).

## Deliverables

1. The Python server package with a `launchd` plist, plus a Dockerfile and docker-compose file that mount libraries read-only.
2. The web app source with mobile and desktop layouts and the admin panel; the build output is served by the server.
3. A README covering:
   - Installation on macOS and on Linux, and Tailscale Serve setup.
   - Creating the first admin.
   - Adding libraries and assigning access.
   - Installing the PWA on the iPhone.
   - The read-only safety rules.
   - The no-outbound rule, the OSM tile exception and its usage policy, the optional PMTiles file, and how to run Docker with the server's egress blocked.
   - Linux mount caveats (APFS, exFAT, HFS+, network share).
   - Updating osxphotos after macOS updates.
4. Phased plan:
   - Phase 0: Verify osxphotos opens each library's Photos version on both macOS and Linux, without writing into the package. Linux CI uses a synthetic fixture.
   - Phase 1: Auth, the admin panel (libraries, users, and the access matrix), the Library grid and viewer on both layouts, and downloads. The Linux media backend, Dockerfile, and launchd plist land in this phase.
   - Phase 2: Albums, People, Map, and search.
   - Phase 3: Passkeys, zip and pre-warm tuning, polish, and animations.

## Offline place names attribution

Place names produced by the Offline place names feature (after the Map & place names consent) come from GeoNames (<https://www.geonames.org>), licensed under Creative Commons Attribution 4.0 (<https://creativecommons.org/licenses/by/4.0/>). The dataset is downloaded by the admin at run time and is not part of this repository. The same credit is shown in Admin → Settings.
