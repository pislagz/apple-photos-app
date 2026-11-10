# CLAUDE.md

Read this file first. Then read `docs/SPEC.md` (product and technical source of truth), `docs/PRIOR_ART.md` (what to borrow, with file paths), and `docs/TASKS.md` (the order of work). Visual targets are in `docs/design-refs/README.md`.

This repository is the handoff. Phase 0 is done: `server/photos_viewer/` opens libraries read-only (temp copy of the database) on Linux and macOS, with tests and CI. The rest of the app is not implemented yet, and `web/` is a placeholder.

## Project

A self-hosted, strictly read-only viewer for several Apple `.photoslibrary` packages on one drive. People sign in over Tailscale and browse from an iPhone PWA styled like iOS 17 Photos, or a desktop browser styled like macOS Sequoia Photos. An admin registers libraries and sets which user can see which library. Downloads only. Personal and family use.

The libraries are not the macOS System Photo Library. iCloud is off. Optimize Storage is off. Originals are local. The libraries are terabytes.

## Hard constraints

- Leave every `.photoslibrary` byte-for-byte unchanged. Never write, migrate, repair, or open-for-write the package or its database. Open `Photos.sqlite` with SQLite `mode=ro`, with `immutable=1`, or as a copy of the sqlite files that lives outside the package. Phase 0 proves the package's file list and mtimes are unchanged.
- Several libraries, each opened by its own path. `PhotosDB()` with no path opens the system library. Always pass `dbfile`.
- PhotoKit is out. It only sees the System Photo Library, and it does not exist on Linux. Do not import pyobjc, photoscript, or `osxphotos.photokit`.
- The server runs on macOS and on Linux. Linux, including Docker on a NAS, is a primary target, not a later port. Details are in `docs/SPEC.md` under Platforms.
- Nothing is exposed off the tailnet. HTTPS is Tailscale Serve.
- **No outbound connections except browser-side OSM map tiles.** The server makes zero outbound requests. The only permitted external connection is the browser fetching OpenStreetMap raster tiles from `tile.openstreetmap.org` while a map view is open. `pip` and `npm` may use the network at install or build time. The server process, the test suite, and the Docker container may not. One admin-started exception, decided in Decisions 3 (D41) and gated by Decisions 5: after the admin agrees to "Map & place names", the optional Offline place names download the public GeoNames city list once from `download.geonames.org` (no photo data sent). Without that consent the server refuses the download. Full rules are in the next section and in `docs/SPEC.md`.
- Out of scope: editing, deleting, uploading, public share links, Memories, Featured Photos, writing favorites.

## Offline at runtime

No outbound connections except browser-side OSM map tiles.

- The default map uses OpenStreetMap raster tiles, `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, fetched by the browser only when a user opens a map view. MapLibre GL JS draws them. Show "© OpenStreetMap contributors" linking to `https://www.openstreetmap.org/copyright`. Follow the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/): no bulk prefetch, no server-side proxy, and no cache beyond the browser's normal HTTP cache. The policy is written out in `docs/SPEC.md`.
- Admin setting `Map tiles`: OpenStreetMap (online) / Local file / Off. Default is OpenStreetMap. Local file is an optional Protomaps PMTiles archive this server reads from disk. When Local file or Off is selected, the client makes no OSM requests. Off, and a missing local file, still show GPS clusters on a blank background.
- That OSM tile fetch is the only permitted external connection from a browser, and the OSM map is off until the admin agrees to "Map & place names" (one consent, first-run setup or Settings; no saved answer counts as not agreed). The server makes zero outbound requests apart from the admin's one-time GeoNames download (`place_names.download`), which also needs that consent.
- Place names come from osxphotos place info already in the library. No online geocoding.
- No CDNs, Google Fonts, analytics, telemetry, crash reporting, update checks, or external avatars. JS, CSS, and fonts are bundled at build time. Font stack is `system-ui` plus those bundled files. Glyphs and sprites for our own map labels are bundled too. Do not load a MapLibre demo style.
- Content-Security-Policy: `default-src 'self'`. The only external host is `https://tile.openstreetmap.org`, on `connect-src` if MapLibre fetches the tiles, or on `img-src` if they are real image requests. `connect-src` is otherwise `'self'`. `blob:` and `data:` only where images or a map worker need them.
- The service worker caches same-origin app assets. It does not intercept, cache, or prefetch OSM tiles. The browser HTTP cache is enough, and it honors the tile server's `Cache-Control`.
- Do not call osxphotos code that uses the network. On the clone reviewed for `docs/PRIOR_ART.md`, that is `osxphotos.utils.get_latest_version` (GET `https://pypi.org/pypi/osxphotos/json`), `osxphotos.cli.common.check_version`, `osxphotos.cli.selfupdate`, `osxphotos.cli.version`, and `download_url_to_dir` / template URL loading. Set `OSXPHOTOS_NO_VERSION_CHECK=1` in the server and in tests. Use `PhotosDB` and `PhotoInfo` only. Any optional dependency that performs network I/O at runtime is forbidden.
- The Docker container has no outbound egress. Inbound from the tailnet still works. The grid and downloads work with the server's internet blocked. The default basemap needs the user's browser to reach `tile.openstreetmap.org`. A fully offline basemap is the Local file setting.

## Privacy

The git repo must never contain a real photo, a real `.photoslibrary`, a copy of `Photos.sqlite` from a real library, thumbnails of real photos, `app.db`, or a filled-in `.env`. The images in `docs/design-refs/` are UI references supplied for this handoff. They stay in that folder. The app does not import them, and they are not a sample library.

Tests use a small synthetic fixture with no personal media. `.gitignore` already ignores `*.photoslibrary`, `app.db`, caches, thumbnails, and `.env`.

## Where development runs

Development happens on a Linux box. `pytest` and the web tests have to pass here.

`sips` and `qlmanage` are macOS-only. They are an optional backend, used only when `sys.platform == "darwin"` and the binary is on `PATH`. The Linux path, and the fallback everywhere, is Pillow + pillow-heif, optional rawpy, and ffmpeg. Tests call that fallback. They do not skip when `sips` is missing.

A real library is not mounted in CI. The synthetic fixture is the stand-in. Opening each real library on macOS, and on Linux once the volume is mounted, is the manual checklist in `docs/MANUAL_MAC_TESTS.md`. Phase 0 is done only when both the Linux fixture run and that checklist have been recorded.

## Stack

Decisions already made in `docs/SPEC.md`, plus one choice the spec left open:

| Area | Choice |
| --- | --- |
| Server | Python 3.12+, FastAPI, Uvicorn |
| Library reader | osxphotos, by path, read-only or a temp copy |
| App data | SQLite `app.db` outside every library |
| Images | Platform interface. Derivatives first. Then `sips`/`qlmanage` on Mac, otherwise Pillow, pillow-heif, optional rawpy, ffmpeg |
| Web | TypeScript, Vite, React. The spec allows Svelte. Use React so TanStack Virtual stays in its primary ecosystem. Decide nothing else and do not mix frameworks. |
| Grid | TanStack Virtual |
| Map (Phase 2) | MapLibre GL JS. Default basemap is browser-fetched OSM raster tiles. Optional local PMTiles. Glyphs for our labels are bundled. |
| Auth | Argon2id passwords, HttpOnly SameSite=Strict session cookies. Passkeys in Phase 3. |
| Hosting | `launchd` on macOS. Docker with read-only library mounts on Linux. Tailscale Serve in front of both. |

## Filenames the runner can read

The Claude runner denies reads of any path that contains the substrings `token` or `credential`. A file or directory with either word in its name cannot be opened, edited, or reviewed in this environment.

Name session code `session_auth.py`, `sessions.ts`, or similar. `tokens.py`, `credentials.ts`, and a `routes/tokens/` directory are unreadable here.

This is a tooling rule. It is independent of the product. Prior art discusses other projects' auth filenames in `docs/PRIOR_ART.md`. Do not recreate those filenames in this repo.

## Repository layout

```
CLAUDE.md                 this handoff
README.md                 overview for humans
pytest.ini                mirrors server pytest config (socket ban) for runs from the repo root
.github/workflows/ci.yml  server tests + probe on ubuntu-latest and macos-latest
.env.example              variable names only
.editorconfig
.gitignore
docs/SPEC.md              product source of truth
docs/PRIOR_ART.md         file-level borrow/avoid notes
docs/TASKS.md             phase checklist with acceptance criteria
docs/MANUAL_MAC_TESTS.md  real-library checklist, not part of CI
docs/design-refs/         iOS 17 and Sequoia screenshots, plus an index
server/pyproject.toml     Python packaging and pytest config
server/photos_viewer/     Python package, added in Phase 0 and Phase 1
server/tests/             pytest suite and the synthetic fixture library
server/README.md          packaging plan
web/                      Vite app, added in Phase 1
web/README.md
deploy/                   Dockerfile, compose, launchd plist, added in Phase 1
```

Python packaging lives in `server/pyproject.toml`; there is no root `pyproject.toml`. The import package is `server/photos_viewer/`. The web app stays under `web/`. Build output is served by the server. Data directories (`data/`, thumbnail cache, temp sqlite copies) stay outside the libraries and outside git.

## Phases

Work in order. Each phase is a set of issues in `docs/TASKS.md`.

**Phase 0.** Verify osxphotos opens a library and reports its Photos version, on Linux and on macOS, with zero writes into the package. Linux CI uses the synthetic fixture. Real libraries use the manual checklist, on a Mac and again on Linux when the drive is mounted.

**Phase 1.** Auth, admin panel (libraries, users, access matrix), Library grid and viewer on both layouts, single-item downloads (and the iPhone save / share-sheet flow). Includes the Linux media backend, the Dockerfile, and the launchd plist. Albums, People, Map, and search can show as disabled chrome so the frame matches the references. They do not have to return data yet.

**Phase 2.** Albums, People, Map, search.

**Phase 3.** Passkeys, streamed zip, pre-warm tuning, polish, animations. The spec's desktop multi-select zip is this phase. Phase 1 download is one file at a time, plus the iPhone Web Share API for a selection.

## Phase 0, first

Before any UI:

1. Install osxphotos on Linux and read its README support table. Record `PhotosDB.db_version` and `PhotosDB.photos_version` for the synthetic fixture.
2. Open via a temp copy of the sqlite files, or `mode=ro` / `immutable=1`, as `docs/PRIOR_ART.md` describes. Diff the package (or the fixture directory) before and after. Any new `-wal`, `-shm`, journal, or mtime change is a failure.
3. Repeat against each real library on macOS and on Linux. Refuse a version the installed osxphotos does not support, with text the admin panel can show later.
4. Confirm the Linux environment does not import PhotoKit.

## Conventions

- Python: 3.12, type hints, `ruff` format and lint, `pytest`. FastAPI routers stay thin. Only the library-reader module may touch a `.photoslibrary` path, and it may only read.
- TypeScript: `strict`, React function components, no Apple asset files. Font is `system-ui`. Icons are a free set with a similar weight (Lucide is fine). The design-ref PNGs are not icons.
- `.editorconfig` is the whitespace source of truth.
- Configuration comes from the environment. Ship updates to `.env.example` when you add a variable. Secrets stay in `.env`.
- Session cookies, not a shared bearer secret. See photokit-api in `docs/PRIOR_ART.md` for the shape to avoid.
- Foreign library and asset ids return 404, so a guess does not reveal that someone else's object exists. Use that code everywhere, including thumbs, originals, and zip.
- An admin sees a library's photos only after assigning that library to themselves.
- Comments explain a non-obvious constraint (read-only open, version refusal). They do not narrate the code.

## How to run and test

These commands are the contract to make true. They do not work yet.

```bash
# Server, from the repo root
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e "./server[dev]"
uvicorn photos_viewer.main:app --reload --host 127.0.0.1 --port 8000

# Web
cd web && npm install && npm run dev

# Tests, on Linux, no real library and no sips
pytest
cd web && npm test
```

`GET /api/health` is the liveness check. Point the synthetic fixture at the suite with an environment variable such as `PHOTOS_VIEWER_FIXTURE` once the fixture exists. CI is GitHub Actions (`.github/workflows/ci.yml`): the server job runs on `ubuntu-latest` and `macos-latest`; web jobs can be Linux only. `pytest` runs under `pytest-socket` with only localhost allowed, because the server never dials out. The production web build may contain the OSM tile URL and the OSM copyright href, and no other absolute external URL. Set `OSXPHOTOS_NO_VERSION_CHECK=1` in the server environment.

Tailscale Serve, launchd, and docker-compose are documented as the server gains them. See `server/README.md` for the packaging plan.

## Run the demo locally

A synthetic library (a few hundred generated images, no real media) plus a fresh `app.db`, served on 127.0.0.1. Everything lives in the gitignored `demo-data/`. The two logins are throwaway dev credentials printed at startup.

```bash
.venv/bin/python scripts/dev_demo.py              # build if needed, index, serve on :8000
.venv/bin/python scripts/dev_demo.py --reset      # wipe demo-data/ and rebuild
.venv/bin/python scripts/dev_demo.py --build      # also rebuild web/dist
.venv/bin/python scripts/dev_demo.py --port 8123

# With the server running, in another shell (needs Chrome, or Playwright's chromium):
cd web && npm run e2e:shots                       # DEMO_URL defaults to http://127.0.0.1:8000
```

Screenshots land in `web/e2e/screenshots/` (gitignored). `e2e:shots` is not part of `npm test` or CI. Stop the server with `kill $(cat demo-data/server.pid)`. The script sets `PHOTOS_VIEWER_COOKIE_SECURE=false` for its own server process only, so login works over plain HTTP; production defaults are unchanged.

## The access-control test

This test is in Phase 1 and stays green after every later phase.

Create user A assigned only to library L1, and user B assigned only to library L2. As A, call every library-scoped route with L2's id and with L2's asset ids: assets, summary, asset detail, each thumb size, original (both versions), live-photo video, albums, people, map, search, and zip. Expect 404 on all of them. Repeat with a disabled account and with a revoked session. As an admin who has not assigned L2 to themselves, the photo routes still 404. Admin routes 403 for a non-admin.

The test uses the synthetic fixture and two rows in `app.db`. It must not need a real library.

## Pointers

- `docs/SPEC.md` — behavior, API, layouts, platforms
- `docs/PRIOR_ART.md` — photokit-api, xpoz, libre-photos, osxphotos, with modules and endpoints
- `docs/TASKS.md` — issue-sized tasks and acceptance criteria
- `docs/design-refs/README.md` — what each screenshot shows, 15.0 vs 15.4 sidebar, missing screens
- `docs/MANUAL_MAC_TESTS.md` — real library on a Mac, optional, not CI
