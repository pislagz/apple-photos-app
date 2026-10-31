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
- It copies `Photos.sqlite` plus existing `-wal` and `-shm` to a temp directory outside the package, then calls `PhotosDB(dbfile=copy, library_path=package)`. If the copy path fails, try `mode=ro` or `immutable=1` and record which.
- It never calls osxphotos repair/recover helpers.
- Acceptance: a test snapshots the fixture directory (names, sizes, mtimes), opens it, and snapshots again. The snapshots match. The test runs on Linux.

### P0.4 Version probe

- A CLI or `python -m` entry prints library path, `db_version`, `photos_version`, asset count, and the open mode.
- Unsupported versions exit non-zero with the P0.1 error string.
- Acceptance: CI runs the probe on the fixture. `docs/MANUAL_MAC_TESTS.md` is filled in with a row per real library for macOS and for Linux (or "volume not mounted", which does not count as a pass).

### P0.5 Linux import check

- Acceptance: the server environment's installed packages do not include pyobjc or PhotoKit, and importing the reader on Linux does not import `osxphotos.photokit`. A test or a one-line CI step asserts that.

## Phase 1 — Sign in, administer, browse Library, download

### P1.1 Project skeleton that actually runs

- `pyproject.toml` at the repo root, package in `server/photos_viewer/`. Vite + React + TypeScript (`strict`) under `web/`.
- `ruff`, `pytest`, and `npm test` run on Linux.
- GitHub Actions on `ubuntu-latest` runs both. No macOS runner.
- Acceptance: `GET /api/health` returns ok locally and in CI. `npm test` has a passing placeholder until P1.11.

### P1.2 `app.db` schema

- Tables for users, sessions, libraries, assignments, the asset index, thumbnail-cache rows, and the audit log. File lives outside any `.photoslibrary` (`PHOTOS_VIEWER_DATA_DIR`).
- Acceptance: migrations apply on an empty directory. A test creates the file under `tmp_path` and never in the repo.

### P1.3 Passwords, sessions, first admin

- Argon2id password hashes. HttpOnly, Secure, SameSite=Strict session cookie. Configurable lifetimes, longer for the PWA, shorter for desktop, plus "Remember me".
- Rate-limit login failures and lock out for a cool-off.
- First-run screen creates the single admin, then disables itself.
- Logout and session revoke work.
- Acceptance: tests cover wrong password, lockout, logout, and cookie flags. No file in the repo has `token` or `credential` in its name.

### P1.4 Optional tailnet allow-list

- Setting: a list of Tailscale identities. When non-empty, requests must present a matching `Tailscale-User-Login` header.
- Acceptance: empty list allows any session that is otherwise valid. A non-matching header is rejected. Test uses a fake header, no real tailnet.

### P1.5 Library registry

- Admin adds a library by path. Validate: path exists, name ends in `.photoslibrary`, probe from P0.4 succeeds, process can read it.
- Display name, rename, remove. Remove deletes rows in `app.db` only.
- Status: asset, video, and people counts, total size, last index time, pre-warm progress, warnings (Photos.app has it open, unsupported version, drive not mounted).
- Acceptance: bad path, unsupported version, and a missing mount each produce a specific message. Removing a library leaves the package on disk (test on the fixture).

### P1.6 Index into `app.db`

- Walk osxphotos once per library and store the fields `docs/PRIOR_ART.md` lists (identity, dates, flags, people, albums, place, paths, derivative paths).
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
- Users: create, edit, disable, delete, set password, set role, one-time invite link that creates an account and then dies.
- Access matrix: users × libraries, one checkbox each.
- Sessions: user, device, last seen, revoke.
- Audit log: filter by user, library, date. CSV export.
- Settings: session lifetimes, tailnet allow-list, thumb size and quality, zip limit (stored now, honored in Phase 3).
- Acceptance: a non-admin gets 403 on `/api/admin/*` and cannot open the screens. Checkbox changes persist and affect P1.8 immediately.

### P1.11 Web shell, both layouts

- Viewport width and pointer detection, with a per-user override.
- Login: full-screen form on the mobile layout, centered card on desktop.
- PWA manifest, service worker, standalone display, status-bar styling, original icons (not Apple's).
- Mobile tab bar shows Library, Albums, People, Map. Only Library is active. The other three are visible and disabled.
- Desktop sidebar shows the spec's sections. Only Library is active.
- Light and dark follow the system. Font is `system-ui`.
- Acceptance: a layout test (or a component test with a mocked viewport) renders both shells. Resizing switches layout. The override sticks.

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

- Mobile: swipe between items, pinch and double-tap zoom, swipe down to dismiss. Filmstrip as in the iOS 17 reference. Info sheet with date, camera, people names, albums, and a location line. Map tiles can wait for Phase 2.
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
- README sections: install on both OSes, Tailscale Serve, first admin, add library, assign access, install the PWA, read-only rules, Linux mount caveats, updating osxphotos.
- Acceptance: `docker compose config` succeeds in CI. A compose comment or a test mounts a fixture read-only and the probe still runs. The image does not contain a real library.

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

- `GET …/map?bbox=&zoom=` returns clusters, not every point at low zoom.
- MapLibre, OSM-style tiles, in the mobile Map tab and the desktop content area. Choosing a cluster filters the grid.
- Info panel gains a small map. Location edits are impossible.
- Acceptance: an asset with null location is absent from clusters. Bounding-box queries stay inside the caller's library.

### P2.4 Search

- `GET …/search?q=` matches date, place name, person, album title, and camera fields stored in the index.
- Desktop search field and optional mobile search.
- Acceptance: a query cannot return another library's asset. Empty query returns an empty page, not the whole library.

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
