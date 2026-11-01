# Tasks

Each heading is one issue. Do them in order inside a phase. Acceptance criteria are the bullets under the heading. `docs/SPEC.md` is the behavior. `docs/PRIOR_ART.md` is the prior art. `CLAUDE.md` is the constraint list.

Phase 0 is the gate. Phase 1 is the first usable viewer. Later phases add screens, they do not relax read-only or the access-control test.

## Phase 0 — Open a library on Linux and on macOS

### P0.1 Record which Photos versions osxphotos supports

- Install osxphotos in the Linux dev environment (Python 3.12).
- Copy its README support table into a short comment or constant next to the version check, with the osxphotos version pin.
- Acceptance: the note names the installed osxphotos version and the Photos generations it claims. An unknown `photos_version` is a distinct error string the admin UI can show, covered by a unit test that does not need a real library.

### P0.2 Synthetic fixture

- Add a tiny library the test suite can open on Linux. No personal photos, no `*.photoslibrary` from a real Mac, no thumbnail of a real person.
- Build it in test setup under a temp directory. `*.sqlite` and `*.photoslibrary` are gitignored on purpose. Commit a fixture only behind a narrow `.gitignore` exception, after checking it contains no real library bytes.
- Acceptance: `PhotosDB(dbfile=…)` on the fixture returns `db_version` and `photos_version` under `pytest` on Linux.

### P0.3 Read-only open

- Implement one function that opens a library for indexing.
- It copies `Photos.sqlite` plus existing `-wal` and `-shm` to a temp directory outside the package, then calls `PhotosDB(dbfile=copy, library_path=package)`. If the copy path fails, fall back to `mode=ro` directly against the package and record which mode was used.
- `immutable=1` was considered and dropped: osxphotos' `sqlite_open_ro` always resolves `dbfile` to a path and builds its own `mode=ro` URI from it, so a caller of `PhotosDB(dbfile=...)` has no way to ask it for `immutable=1`. There is no third tier; see the docstring in `photos_viewer/libraries.py`.
- It never calls osxphotos repair/recover helpers.
- Acceptance: a test snapshots the fixture directory (names, sizes, mtimes), opens it, and snapshots again. The snapshots match. The test runs on Linux.

### P0.4 Version probe

- A CLI or `python -m` entry prints library path, `db_version`, `photos_version`, asset count, and the open mode.
- Unsupported versions exit non-zero with the P0.1 error string.
- Acceptance: CI runs the probe on the fixture. `docs/MANUAL_MAC_TESTS.md` is filled in with a row per real library for macOS and for Linux (or "volume not mounted", which does not count as a pass).

### P0.5 Linux import check

- Acceptance: the server environment's installed packages do not include pyobjc or PhotoKit, and importing the reader on Linux does not import `osxphotos.photokit`. A test or a one-line CI step asserts that.

### P0.6 osxphotos makes no outbound connection

- Call `PhotosDB` and `PhotoInfo` only. Do not call `osxphotos.utils.get_latest_version`, `osxphotos.cli.common.check_version`, `osxphotos.cli.selfupdate`, `osxphotos.cli.version`, or `download_url_to_dir`, and do not run the osxphotos CLI. Those paths GET PyPI or an arbitrary URL. See `docs/PRIOR_ART.md`.
- Set `OSXPHOTOS_NO_VERSION_CHECK=1` for the probe and for every later server process.
- Acceptance: the probe test runs under `pytest-socket` with only localhost allowed. Any other connection fails the test. A comment next to the reader lists the forbidden osxphotos helpers.

## Phase 1 — Sign in, administer, browse Library, download

### P1.0 Phase 0 leftovers (from the PR #7 review)

- `docs/MANUAL_MAC_TESTS.md`: before the before/after snapshot, tell the tester to quit Photos.app (and wait a minute so `photoanalysisd` settles). Say that a difference only in `Photos.sqlite-wal`/`-shm` while Photos was running does not count against the viewer.
- `server/tests/test_open_readonly_unchanged.py` (`test_copy_replays_a_real_uncheckpointed_wal_change`): also open a copy of `Photos.sqlite` alone (no `-wal`/`-shm`) and assert `ZFAVORITE == 0`, proving the change lives only in the WAL.
- Acceptance: both changes in; the suite still passes with sockets disabled.
- Done: `docs/MANUAL_MAC_TESTS.md` has the quit-Photos.app step; `test_copy_replays_a_real_uncheckpointed_wal_change` in `server/tests/test_open_readonly_unchanged.py` also opens the lone copied `Photos.sqlite` and asserts `ZFAVORITE == 0`.

### P1.1 Project skeleton that actually runs

- Python packaging stays in `server/pyproject.toml` (created in Phase 0), package in `server/photos_viewer/`. Add a `[build-system]` so `pip install -e "./server[dev]"` works from the repo root, and add FastAPI, Uvicorn and the other server deps there. Don't add a root `pyproject.toml`; the root `pytest.ini` mirrors the server pytest config (socket ban) for runs from the repo root, so keep the two in sync.
- Vite + React + TypeScript (`strict`) under `web/`.
- `ruff`, `pytest`, and `npm test` run on Linux.
- Extend the existing `.github/workflows/ci.yml`: keep the `server` job on `ubuntu-latest` and `macos-latest` (tests + probe), and add a `web` job on `ubuntu-latest` for `npm ci`, `npm test` and the build, plus the check that the build output has no external URLs except the OSM tile host and copyright link.
- Acceptance: `GET /api/health` returns ok locally and in CI. `npm test` has a passing placeholder until P1.11.
- Done: `server/pyproject.toml` has `[build-system]` and the new deps; `web/` is a Vite + React + TS (`strict`) skeleton with a passing `App.test.tsx` placeholder; `.github/workflows/ci.yml` has a `web` job (`npm ci`, `npm test`, build, external-URL check via `scripts/check_external_urls.mjs`) alongside the existing `server` job, which now also runs `ruff check .` and upgrades `pip` before `pip install -e "./server[dev]"` (issue #10: an old `pip` crashed on osxphotos' `platform_release` markers on some kernels).

### P1.2 `app.db` schema

- Tables for users, sessions, libraries, assignments, the asset index, thumbnail-cache rows, and the audit log. File lives outside any `.photoslibrary` (`PHOTOS_VIEWER_DATA_DIR`).
- Acceptance: migrations apply on an empty directory. A test creates the file under `tmp_path` and never in the repo.
- Done: `server/photos_viewer/app_db.py` (`connect()`, `migrate()`, `_MIGRATIONS`); `server/tests/test_app_db.py`. Issue #10 follow-up: each migration (plus the `PRAGMA user_version` bump) runs inside one `BEGIN IMMEDIATE` transaction, rolled back whole on any error, with `user_version` re-read after the lock is held.
- Issue #12 follow-up (PR #11 review, D): `migrate()` reads `user_version` without a lock first and returns immediately when nothing is pending; `BEGIN IMMEDIATE` only runs, with a re-read, when a migration actually needs to apply. `data_dir_from_env()` is the one place `PHOTOS_VIEWER_DATA_DIR` is read, shared by `session_auth.get_db` and the new `admin` CLI (P1.3).

### P1.3 Passwords, sessions, first admin

- Argon2id password hashes. HttpOnly, Secure, SameSite=Strict session cookie. Configurable lifetimes, longer for the PWA, shorter for desktop, plus "Remember me".
- Rate-limit login failures and lock out for a cool-off.
- First-run screen creates the single admin, then disables itself.
- Logout and session revoke work.
- Acceptance: tests cover wrong password, lockout, logout, and cookie flags. No file in the repo has `token` or `credential` in its name.
- Done: `server/photos_viewer/session_auth.py`; `server/tests/test_session_auth.py`. New env vars (`PHOTOS_VIEWER_DATA_DIR`, `PHOTOS_VIEWER_SESSION_LIFETIME_DESKTOP_SECONDS`, `PHOTOS_VIEWER_SESSION_LIFETIME_PWA_SECONDS`, `PHOTOS_VIEWER_REMEMBER_ME_LIFETIME_SECONDS`, `PHOTOS_VIEWER_COOKIE_SECURE`) still need adding to `.env.example` as a follow-up -- that file was not reachable from this session.
- Issue #10 follow-up (PR #9 review): first-run admin setup is one `BEGIN IMMEDIATE` transaction; usernames and passwords have pydantic length limits and usernames are case-normalized; a missing or disabled username still runs an Argon2 verify against a fixed dummy hash (no timing tell); lockout only counts failures for usernames that exist, plus a looser per-IP limit, both pruned by age; `require_session` dependency and `GET /api/auth/me`; `lookup_session` joins `users`, rejects disabled accounts, prunes expired sessions, and throttles `last_seen_at` writes; CSRF guard (`application/json` + same-host `Origin`) on every POST route; Argon2id parameters pinned with rehash-on-login.
- Issue #12 follow-up (PR #11 review, A-H): per-client lockout keys on the `Tailscale-User-Login` header when the request is loopback (every request behind `tailscale serve`), and is skipped for loopback with no such header, so one shared tailnet address can no longer lock out everyone (A). Expired-session pruning is throttled to about once a minute via a module-level timestamp instead of running on every request (B). Unknown usernames get the same lockout mechanics as real ones but in a separate row set (`login_failures.user_exists`), so probing a made-up name can never later lock out a real account created with that name, and a 429 doesn't disclose which case it is (C). `app_db.migrate()` reads `user_version` lock-free first and only takes `BEGIN IMMEDIATE` when a migration is actually pending (D, see P1.2). The CSRF `Origin` check compares scheme, host, and port (E). Login validates only the 1024-char maximum, not the 12-char setup minimum, so a short wrong password is rejected the same way (401, via lockout + Argon2) as any other (F). New admin-only `POST /api/admin/users/{username}/unlock` clears a username's lockout (G) -- P1.10's admin UI should add an "Unlock" button that calls it (see P1.10). New `python -m photos_viewer.admin unlock <username> [--clear-ip-limits]` CLI (`server/photos_viewer/admin.py`) works directly on `app.db`, no server needed, for an admin locked out of the UI itself (H); see `server/README.md` for the `docker exec` form. Tests: `server/tests/test_session_auth.py`, `server/tests/test_app_db.py`, `server/tests/test_admin_cli.py`.

### Backlog (from Phase 1a reviews)

Not blocking; pick up when convenient.

- Trim the long per-peer-ceiling paragraph in `server/README.md`; it duplicates `docs/SPEC.md`.
- Make the per-peer ceiling (`MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER`) configurable instead of a hard-coded 10x the per-IP limit.
- Watch `test_ip_lockout_key_is_the_forwarded_address_through_the_real_proxy_headers_middleware` for flakiness (it failed once with 200 instead of 429).
- P1.5 (PR #29 review): resolve library paths (`Path.resolve()`) before the duplicate check in `library_admin.py`, so `.../x/../Lib.photoslibrary` can't register the same library twice.
- P1.5: `_total_size_bytes` walks the whole package on every `GET .../status`; cache it or take it from the P1.6 index.
- P1.5: a folder named `X.photoslibrary` that isn't a real library gets the probe's raw "could not open ... as a Photos library: <exception>" message; give it a friendlier one.
- P1.5: `library_admin.py` imports the private `session_auth._reject_cross_site_requests`; make it public.
- P1.5: fixture `.photoslibrary` temp dirs are left behind in `/tmp` after tests or live runs; clean them up.
- P1.5 (PR #31 review): `library_is_locked` uses `immutable=1`, which skips SQLite locking, so it can't detect most real locks Photos.app holds; the "Photos.app has it open" warning is best-effort only. Revisit if it matters.
- P1.5: `DELETE /api/admin/libraries/{id}` returns 415 unless the request sends a JSON content-type, even with no body; the CSRF guard should allow body-less requests.

### P1.4 Optional tailnet allow-list

- Setting: a list of Tailscale identities. When non-empty, requests must present a matching `Tailscale-User-Login` header.
- Acceptance: empty list allows any session that is otherwise valid. A non-matching header is rejected. Test uses a fake header, no real tailnet.
- Done: `app_db.py` migration 7 adds a generic `settings` key/value table (`get_setting`/`set_setting`). `session_auth.py`: `get_allowed_tailnet_identities`/`set_allowed_tailnet_identities` store the list as JSON under `allowed_tailnet_identities`; `_trusted_tailscale_user_login` only reads the header from a loopback or `PHOTOS_VIEWER_TRUSTED_PROXIES` peer, reusing the P1.3 trust boundary, so an untrusted peer's header can never satisfy the list; `_enforce_tailnet_allowlist` (403 on a non-matching or missing header, no-op when the list is empty) runs inside `require_session` (so every route built on it, including `require_admin`, is covered) and is added explicitly to `/api/setup/admin` and `/api/auth/login`, which run before a session exists. `/api/health` is untouched and stays open. New admin-only, API-only `GET`/`PUT /api/admin/settings/tailnet-allowlist` (P1.10's admin UI will add the form). Tests in `server/tests/test_session_auth.py` use a fake `tailscale-user-login` header, no real tailnet.

### P1.5 Library registry

- Admin adds a library by path. Validate: path exists, name ends in `.photoslibrary`, probe from P0.4 succeeds, process can read it.
- Display name, rename, remove. Remove deletes rows in `app.db` only.
- Status: asset, video, and people counts, total size, last index time, pre-warm progress, warnings (Photos.app has it open, unsupported version, drive not mounted).
- Acceptance: bad path, unsupported version, and a missing mount each produce a specific message. Removing a library leaves the package on disk (test on the fixture).

### P1.6 Index into `app.db`

- Walk osxphotos once per library and store the fields `docs/PRIOR_ART.md` lists (identity, dates, flags, people, albums, place, paths, derivative paths).
- Place names and coordinates stored here come from `PhotoInfo.place` and `PhotoInfo.location` only. No geocoding client is imported.
- Re-index when the sqlite file changes or an admin asks.
- Do not keep `PhotosDB` as a process-wide singleton. Do not call `PhotosDB.query` on the request path.
- Acceptance: indexing the fixture is idempotent. A second run with an unchanged sqlite does not duplicate rows. Request handlers read `app.db` only (assert with a test double, or by closing the library path after index).

### P1.7 Media backend

- One interface: given a source path and a size, return WebP or JPEG bytes.
- Try `path_derivatives` first when a derivative is large enough for that size.
- On Darwin, if `sips` or `qlmanage` exists, they may handle the file. Otherwise Pillow + pillow-heif. ffmpeg extracts a video still. rawpy is optional and used when installed for RAW.
- Cache under the data dir, never inside the library. Sizes: grid ~300, grid2x ~600, preview ~1600.
- Acceptance: CI generates a grid image from a synthetic HEIC or JPEG in the fixture without `sips`. A missing decoder returns a clear error for that asset and does not fail the process.

### P1.8 Assignment guard

- One dependency used by every `/api/libraries/{lib}/…` route. It loads the session, checks the assignment, and 404s otherwise.
- Acceptance: the P1.16 test is wired to this dependency so a new route cannot forget it. A route added without the dependency fails a router audit test (every library route includes the dependency).

### P1.9 Read API for Library

- `GET /api/me`
- `GET /api/libraries/{lib}/assets` with cursor and limit, plus `album`, `person`, `type`, `from`, `to` accepted even if album and person return empty until Phase 2.
- `GET /api/libraries/{lib}/summary` (counts by year, month, day)
- `GET /api/libraries/{lib}/assets/{id}`
- `GET /api/libraries/{lib}/thumb/{id}?size=`
- `GET /api/libraries/{lib}/original/{id}?version=original|edited&format=native|jpeg` with Range.
- `GET /api/libraries/{lib}/livephoto/{id}/video`
- `GET /api/health`
- Acceptance: pagination is stable when new rows are inserted above the cursor. Original Range returns 206. Edited version 404s when `path_edited` is absent. JPEG format transcodes HEIC through the media backend.

### P1.10 Admin UI

- Desktop, System Settings-like sidebar: Libraries, Users, Sessions, Audit log, Settings.
- Users: create, edit, disable, delete, set password, set role, one-time invite link that creates an account and then dies. Unlock: an "Unlock" action on a locked-out user, calling `POST /api/admin/users/{username}/unlock` (server-side done, issue #12 G) -- the UI button itself is still to do.
- Access matrix: users × libraries, one checkbox each.
- Sessions: user, device, last seen, revoke.
- Audit log: filter by user, library, date. CSV export.
- Settings: session lifetimes, tailnet allow-list, thumb size and quality, zip limit (stored now, honored in Phase 3), and map tiles: OpenStreetMap (online) / Local file / Off, plus an optional PMTiles path (stored now, used in P2.3). Default is OpenStreetMap.
- Acceptance: a non-admin gets 403 on `/api/admin/*` and cannot open the screens. Checkbox changes persist and affect P1.8 immediately.

### P1.11 Web shell, both layouts

- Viewport width and pointer detection, with a per-user override.
- Login: full-screen form on the mobile layout, centered card on desktop.
- Handle a 403 "tailnet identity not allowed" (P1.4 allow-list) with a clear refused-access message on the login screen and app shell, not a generic error. Same for a 429 lockout.
- PWA manifest, service worker, standalone display, status-bar styling, original icons (not Apple's).
- JS, CSS, and fonts ship in the build. No CDN script, no Google Fonts stylesheet, no analytics, telemetry, crash reporting, update check, or avatar host.
- The service worker caches same-origin app requests only. It does not intercept, cache, or prefetch `tile.openstreetmap.org`. OSM tile caching is the browser HTTP cache, so `Cache-Control` from the tile server is what limits retention. A service-worker tile cache would outlive those headers and fill as the user pans.
- Mobile tab bar shows Library, Albums, People, Map. Only Library is active. The other three are visible and disabled.
- Desktop sidebar shows the spec's sections. Only Library is active.
- Light and dark follow the system. Font is `system-ui` plus files bundled with the app.
- Acceptance: a layout test (or a component test with a mocked viewport) renders both shells. Resizing switches layout. The override sticks. A unit test shows the service worker caches a same-origin thumbnail URL and does not call `cache.put` for `https://tile.openstreetmap.org/0/0/0.png`.

### P1.12 Mobile Library

- Years, Months, Days, All Photos. Pinned date header while scrolling.
- Square-cropped virtualized grid. Pinch changes column count.
- Days can use a large leading cell plus a row of squares, as in `docs/design-refs/ios17-library-days.png`. All Photos is a uniform square grid.
- Acceptance: a fixture of a few hundred indexed rows scrolls without loading originals (network or image-src assertion). Date header updates with the topmost group.

### P1.13 Desktop Library

- Toolbar: Years, Months, All Photos, zoom slider, search field (UI only until Phase 2), download, Info toggle.
- Grid: aspect-ratio or square, date headers, hover heart (display of the favorite flag, not a write) and video duration.
- Selection: click, modifier-click, shift-range, drag. Count in the toolbar.
- Keyboard: arrows, Space/Enter open, Esc closes, ⌘A, ⌘F, +/−.
- Acceptance: keyboard and selection tests on the desktop layout. Zoom changes the thumb size requested (`grid` vs `grid2x`).

### P1.14 Viewer

- Mobile: swipe between items, pinch and double-tap zoom, swipe down to dismiss. Filmstrip as in the iOS 17 reference. Info sheet with date, camera, people names, albums, and a location line taken from the indexed place fields. The mini-map waits for Phase 2 and uses the same map-tiles setting as the Map tab.
- Desktop: filmstrip, zoom and pan, right-hand info panel with the same fields plus file name and size.
- Video plays inline. Live Photo plays on press (mobile) and inline (desktop).
- No edit control, no delete control, no favorite write.
- Acceptance: opening an item does not request the original until the viewer asks for the preview or the original. Live Photo video request is the live-photo route, not the original still.

### P1.15 Downloads

- iPhone: full image in an `<img>`, JPEG fallback when the browser cannot show HEIC. Document the long-press "Save to Photos" behavior. Multi-select uses `navigator.share({ files })`, splits large batches, and falls back to download links.
- Desktop: one file, original or edited, from the viewer and the context menu. "Copy link" copies an in-app URL.
- Every download writes an audit row (user, library, asset, version, time).
- Acceptance: tests see the audit row. A download of library L2 by user A is 404 and writes no success row. Zip is not in this phase.

### P1.16 Access-control test

- The scenario in `CLAUDE.md`: user A / library L1, user B / library L2, every library route, thumbs, originals, live video.
- Also: admin with no self-assignment, disabled user, revoked session.
- Acceptance: the test is in CI and fails if any of those calls returns a body, a thumb, or a file.

### P1.17 Packaging

- `launchd` plist documented and checked in: uvicorn, data dir, KeepAlive, logs.
- `Dockerfile` and `docker-compose.yml`: non-root user, library volumes mounted `:ro`, data volume read-write, temp dir for sqlite copies, ffmpeg and libheif available. Container root can be read-only if `/tmp` is a tmpfs.
- No outbound egress from the container. Document both a compose network with no route to the public internet and a firewall rule that drops connections the container initiates. Inbound from the Tailscale address still works. The container must not reach a tile host, a package index, or an update server. The browser, not the container, fetches OSM tiles when the setting is OpenStreetMap. Mount an optional PMTiles file read-only for the Local file setting.
- README sections: install on both OSes, Tailscale Serve, first admin, add library, assign access, install the PWA, read-only rules, the offline rule, Linux mount caveats, updating osxphotos (that update is a maintainer step on a network, not a runtime check).
- Acceptance: `docker compose config` succeeds in CI. A compose comment or a test mounts a fixture read-only and the probe still runs. The image does not contain a real library. The README's egress section is specific enough that someone can block internet egress and still open the app from the tailnet.

### P1.18 Content-Security-Policy

- Every HTML response, and API responses, carry a Content-Security-Policy.
- `default-src 'self'`. `font-src 'self'`. `script-src 'self'`. `style-src 'self'`. `img-src 'self' blob: data:`. `worker-src 'self' blob:` only if the map worker needs a blob worker. `object-src 'none'`. `base-uri 'self'`. `frame-ancestors 'none'`.
- The only external host is `https://tile.openstreetmap.org`. Put it on `connect-src` when MapLibre fetches tile bytes, or on `img-src` when the tiles are image requests. `connect-src` is otherwise `'self'`. No other external host on any directive.
- Acceptance: a test loads `/` and one API response and checks those directives. Exactly one external host appears, and it is `tile.openstreetmap.org`.

### P1.19 Suite-wide outbound-connection tests

- The whole server test suite runs under `pytest-socket`, allowing only localhost (`127.0.0.1` and `::1`). The plugin stays on for every test module. `pip install` and `npm install` happen before the suite, outside the plugin.
- After `npm run build`, a check scans `web/dist` JS, CSS, and HTML. The only absolute external URLs allowed are `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (the fetched tile template) and `https://www.openstreetmap.org/copyright` (the attribution `href`, never fetched). Any other external host fails the check. Localhost URLs are allowed.
- Acceptance: CI runs both checks. A test that opens a socket to an external host fails. A hosted URL other than those two, left in the production bundle, fails. The copyright string is an `href` only.

## Phase 2 — Albums, People, Map, search

### P2.1 Albums

- `GET /api/libraries/{lib}/albums` returns the folder tree from `folder_info` / `album_info`, plus smart albums built from index flags: Favorites, Videos, Selfies, Live Photos, Portrait, Panoramas, Screenshots, RAW, Recently Added.
- Mobile Albums tab and desktop Albums group, including the folder tree.
- Acceptance: fixture albums round-trip parent folders. A smart album count matches a direct SQL count on the index. Still 404 across users.

### P2.2 People

- `GET …/people` and `…/people/{id}/assets`. Circular crops from face data where osxphotos provides it, names underneath.
- Mobile People tab and desktop People section.
- Acceptance: an unnamed face is omitted or grouped as untitled, consistently. Opening a person shows only their assets. No write API for renaming.

### P2.3 Map

- `GET …/map?bbox=&zoom=` returns clusters, not every point at low zoom. The server does not fetch tiles while handling it.
- Default basemap is OpenStreetMap raster tiles at `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. MapLibre requests a tile only while a map view is mounted. Opening Library, Albums, or People does not request tiles.
- Attribution "© OpenStreetMap contributors" is visible and links to `https://www.openstreetmap.org/copyright`. No bulk prefetch and no server-side tile cache. Policy: <https://operations.osmfoundation.org/policies/tiles/>, summarized in `docs/SPEC.md`.
- Admin setting `Map tiles`: OpenStreetMap (online) / Local file / Off. Default OpenStreetMap. Local file serves a PMTiles archive from disk with HTTP Range, and the client then makes no request to `tile.openstreetmap.org`. Off, and a missing or unreadable local file, show clusters on a blank background and make no tile request. Local mode does not fall back to OSM.
- Glyphs and sprites for our labels are bundled. The style is ours, not a MapLibre demo style.
- Info panel gains a small map on the same setting, with the same attribution. Location edits are impossible. If OSM tiles fail to load, clusters remain on a blank background. The client does not try a second tile host.
- Acceptance: an asset with null location is absent from clusters. Bounding-box queries stay inside the caller's library. A browser test in OSM mode sees tile requests only after the map view opens, and only to `tile.openstreetmap.org`. The same test in Local file mode and in Off mode sees none. The server socket test still passes during all three. A tiny local PMTiles fixture returns a range response from this app.

### P2.4 Search

- `GET …/search?q=` matches date, place name, person, album title, and camera fields stored in the index.
- Place strings are the ones indexed in P1.6. Search does not geocode.
- Desktop search field and optional mobile search.
- Acceptance: a query cannot return another library's asset. Empty query returns an empty page, not the whole library. The search module imports no HTTP client.

### P2.5 Place names stay inside the library

- Display names on the map, in search, and on the info panel are `PhotoInfo.place` fields (name, address, country) copied into `app.db` at index time.
- Acceptance: a photo with GPS and no place record shows coordinates or "Unknown place", and the test process makes no socket connection while rendering that label. A photo with a place record shows that record's text unchanged.

## Phase 3 — Passkeys, zip, pre-warm, polish

### P3.1 Passkeys

- WebAuthn registration and login beside the password. Passwords still work.
- Acceptance: a ceremony can be tested with a virtual authenticator. Session cookie flags match P1.3.

### P3.2 Streamed zip

- `POST /api/libraries/{lib}/zip` streams selected originals. Settings cap the total bytes. Progress is visible. HEIC-to-JPEG is an option.
- Acceptance: over-limit is a 413 with no partial file left in the library package (zip is written to the response or to the data dir). Audit row per zip. Cross-user selection 404s.

### P3.3 Pre-warm

- Resumable background job per library, pause and resume, progress on the library status card, clear-cache action.
- Acceptance: killing the process mid-job resumes without regenerating finished thumbs. Pause stops new work. Cache files live under the data dir.

### P3.4 Polish

- Motion on the tab bar, viewer dismiss, and desktop sidebar collapse, matched to the references in spirit and implemented with our own CSS.
- Desktop keyboard path and focus rings audited. Alt text from title or date.
- Accessibility pass and a layout check at a phone width and a desktop width.
- Acceptance: the access-control test still passes. No Apple icons, fonts, or trademarks added.

## Done means

- Phase 0 probe recorded for the fixture in CI and for each real library on the manual checklist.
- User A cannot read user B's libraries through any route.
- A directory listing of each real `.photoslibrary` is unchanged after indexing, thumb generation, download, and zip.
- `pytest` and `npm test` pass on Linux with no `sips` and no real library.
- The server suite fails on any connection that is not localhost.
- The production web build's only external URLs are the OSM tile template and the OSM copyright href, and responses send the Content-Security-Policy from P1.18.
