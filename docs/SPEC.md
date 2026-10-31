# Project: Private Photos Viewer

Multiple `.photoslibrary` files → web app for iPhone (PWA, iOS 17 Photos style) and desktop (macOS Sequoia Photos style), over Tailscale.

The server runs on macOS and on Linux. Both are first-class. See [Platforms](#platforms).

## Goal

Build a self-hosted, read-only web app that lets several people browse and download photos and videos from Apple Photos libraries stored as `.photoslibrary` packages on one drive. Access is remote, over Tailscale, from:

- **iPhone:** an installable PWA that looks and feels like the pre-iOS 18 (iOS 17) Photos app.
- **Desktop browser** (Safari, Chrome, Firefox on Mac or PC): a layout that looks and feels like the macOS Sequoia (macOS 15) Photos app.

Both use the same login. Admins also get an admin panel to register library files and control which user can see which library. It's for personal and family use only.

## Context and constraints

- Several separate `.photoslibrary` packages on one drive, none of them the macOS System Photo Library. They total several terabytes, all originals are local, and there's no iCloud.
- PhotoKit is not used. It only reaches the System Photo Library, and it does not exist on Linux. Libraries are read directly from disk with [osxphotos](https://github.com/RhetTbull/osxphotos), which opens any library by path on macOS and on Linux.
- **Strictly read-only.** Never write to, migrate, repair, or open-for-write any library package or its database. Open the database read-only (`mode=ro`), immutable, or as a copy that lives outside the package. Detect when Photos.app has the same library open and show a warning.
- Access only over the Tailscale tailnet, with HTTPS through Tailscale Serve. Nothing is exposed publicly.
- **No outbound network at runtime.** The server and the browser client make zero outbound requests. They only serve clients that connect in over the LAN or Tailscale. See [No outbound network](#no-outbound-network).
- No paid Apple Developer account, so the iPhone side is a PWA added from Safari, with no native app.
- Out of scope: editing, deleting, uploading, public share links, Memories, Featured Photos.

## No outbound network

At runtime the app never connects to the internet on its own. That covers the Python server, background jobs, the web client, and the service worker. Installing packages during a build or a developer setup may use the network. A running process may not.

- **Map.** No online tile servers and no CDN tiles. The basemap is a self-hosted offline vector file, a Protomaps PMTiles archive, read from disk and served by this server (HTTP Range). MapLibre GL JS is the renderer. Fonts, glyphs, and sprites are bundled with the app and served from the same origin. The admin sets the path to the PMTiles file. If that path is empty or the file is missing, the map still shows clustered photos from GPS stored in the library and can filter the grid, on a blank background, and it does not request tiles from anywhere else.
- **Place names.** Labels come only from place data already in the libraries (`PhotoInfo.place` and related osxphotos fields). No online geocoding, and no call out to fill in a missing name.
- **Web assets.** No CDNs, Google Fonts, analytics, telemetry, crash reporting, update checks, or external avatars. JavaScript, CSS, and fonts are bundled at build time.
- **Content-Security-Policy.** `default-src 'self'`. Images may add `blob:` and `data:` where a preview or a decoded frame needs them. `connect-src` is `'self'` only, so a tile, glyph, API, or WebSocket target on another host cannot load. `font-src`, `script-src`, and `style-src` stay on `'self'`. `worker-src` may add `blob:` if the map library needs a blob worker. `object-src 'none'`. `base-uri 'self'`. `frame-ancestors 'none'`.
- **Service worker.** It caches same-origin requests only. A request to any other origin is not fetched and not stored.
- **Python dependencies.** osxphotos is used as a library (`PhotosDB`, `PhotoInfo`), not via its CLI. Do not call its update check or download helpers (`get_latest_version`, `check_version`, `selfupdate`, `download_url_to_dir`). Set `OSXPHOTOS_NO_VERSION_CHECK=1` for the process. Do not add an optional dependency that performs network I/O when imported or while serving.
- **Docker.** Document and support a run with outbound egress blocked (an internal Docker network, or a firewall rule that drops connections the container initiates). Clients on the tailnet can still open inbound connections. The app must be fully usable in that configuration, including the map when a local PMTiles file is mounted.

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
  - Generate lazily, with a resumable background pre-warm job per library that reports progress.
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
- `GET /api/libraries/:lib/map?bbox=&zoom=`: clustered GPS points. The basemap is not this response. It is a same-origin range read of the local PMTiles file.
- `GET /api/libraries/:lib/search?q=`: by date, place, person, album name, or camera.
- `POST /api/libraries/:lib/zip`: builds a zip of selected originals for desktop batch download and streams it.
- `GET /api/health`
- Admin API under `/api/admin/*`: users, libraries, assignments, sessions, jobs, audit log, and settings.

## Accounts, authentication, and admin panel

### Model

- Roles: `admin` and `user`.
- Admins register library files and assign each user to one or more libraries. Users see only their assigned libraries. An admin sees a library's photos only if they assign it to themselves.

### Authentication

- Username and password, hashed with Argon2id. Passkeys (WebAuthn) in a later phase.
- Secure, HttpOnly, SameSite=Strict session cookies. Long lifetime for the installed PWA, shorter for desktop by default (configurable). "Remember me" and logout.
- Rate-limit logins and lock out temporarily after repeated failures.
- Never trust library ids from the client without checking the session's assignments.
- Optional extra layer: allow only listed tailnet identities, using the `Tailscale-User-Login` header.
- Login screen styled to match the platform: a centered card on desktop and a full-screen form on iPhone.

### Admin panel (desktop-first web UI, admin role only)

- **Libraries**
  - Add a library by browsing or typing a path on the drive, with validation that it exists, is a `.photoslibrary`, has a supported version, and is readable.
  - Set display name; rename; remove (removing only drops it from the app and never touches files).
  - Status for each library: asset, video, and People counts, total size, last index time, thumbnail pre-warm progress, and warnings like "Photos.app has this library open", "unsupported version", or "drive not mounted".
  - Actions: re-index, start or pause pre-warm, clear thumbnail cache.
  - Default edited-or-original setting.
- **Users**
  - Create, edit, disable, and delete accounts; set or reset passwords; create one-time invite links; set the role.
  - **Access matrix:** users as rows and libraries as columns, with a checkbox for each pair, to grant or revoke access quickly.
- **Sessions:** list active sessions by user, device, and last seen, and revoke them.
- **Audit log:** logins, failed logins, library access, and downloads, filterable by user, library, and date, with export to CSV.
- **Settings:** session lifetimes, allowed tailnet identities, thumbnail sizes and quality, the zip size limit, and the path to the local PMTiles file.
- **First run:** a one-time setup screen to create the admin account.
- Styled to fit the macOS Sequoia look: a System Settings-like sidebar and grouped forms.

## Front end

- TypeScript, Vite, and React or Svelte. One codebase with two layouts:
  - **Mobile layout** (iPhone, iOS 17 style): used on narrow touch screens and when installed as a PWA.
  - **Desktop layout** (macOS Sequoia style): used on wide screens with a pointer.
  - Detect by viewport width and pointer type, and let users override in settings.
- Shared: API client, auth, virtualized grid engine (TanStack Virtual or similar) for tens of thousands of items, viewer logic, and Cache Storage for thumbnails.
- PWA manifest and service worker, standalone mode, iOS status bar styling, and icons. The service worker caches same-origin requests only. The server sends the Content-Security-Policy in [No outbound network](#no-outbound-network).
- Follow system light and dark mode, using the `-apple-system` / `system-ui` font and SF Symbols-like icons (use a free icon set with a similar style, not Apple's assets).

### Mobile layout: iOS 17 Photos

- Translucent bottom tab bar: Library, Albums, People, Map. Search is optional.
- Library tab with a Years, Months, Days, All Photos segmented control and a date header that stays pinned while scrolling.
- Square-cropped grid with pinch-to-zoom between column counts.
- Full-screen viewer:
  - Swipe between photos, pinch and double-tap zoom, swipe down to dismiss.
  - Info panel with date, camera details, location mini-map, and People in the photo.
  - Video streaming, and Live Photo playback on press.
- Albums tab with My Albums, folders, and smart albums (Favorites, Videos, Selfies, Live Photos, Panoramas, Screenshots, Recently Added).
- People tab with circular face thumbnails and names.
- Map tab using MapLibre GL JS and the local PMTiles basemap from [No outbound network](#no-outbound-network), showing clustered thumbnail pins. No online tiles.
- Library switcher for users with several libraries, for example in the top bar or a profile sheet, plus logout.

Apple's own iOS 17 tab bar is Library, For You, Albums, Search. This app's bar is Library, Albums, People, Map. Match Apple's spacing and materials, and follow this spec for which tabs exist. For You, Memories, and Featured Photos are out of scope. Reference images are indexed in `docs/design-refs/README.md`.

### Desktop layout: macOS Sequoia Photos

- **Window structure:** a collapsible left sidebar, a main content area, and a toolbar at the top styled like a macOS window toolbar with translucent materials.
- **Sidebar:**
  - Library switcher at the top for users with several libraries.
  - Sections: Library, Favorites, Recently Saved/Added, Map, People, Media Types (Videos, Selfies, Live Photos, Portrait, Panoramas, Screenshots, RAW), Albums with the folder tree, and smart albums.
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
- **Keyboard:**
  - Arrow keys to move, Space or Enter to open, Esc to close.
  - ⌘A to select all, ⌘F to search.
  - Left and right arrows in the viewer.
  - `+` and `-` to zoom.
- **Viewer:** opens in the main area with a filmstrip at the bottom, zoom and pan, and a right-side Info panel with date, camera and EXIF, file name and size, map, people, and albums. Videos and Live Photos play inline.
- **Map:** full content area with the same local PMTiles basemap and clustered thumbnails. Clicking a cluster filters the grid. The same blank-basemap fallback applies when no tile file is configured.
- **People:** grid of circular faces with names, opening a person's photos.
- **Right-click menu:** Download original, Download edited, Copy link (within the app only, never public), and Show in album.

Sequoia's sidebar order changed between macOS 15.0 and 15.4. The screenshots show both. Build the sidebar described in this spec. Use the screenshots for spacing, type, and icon weight. Memories, Featured Photos, Trips, Recently Deleted, Projects, and Shared Albums appear in the screenshots and are out of scope here.

## Downloading

- **iPhone:**
  - The viewer shows the full image as a plain `<img>`, with a JPEG fallback when HEIC can't be shown. Long-pressing it and choosing "Save to Photos" saves it to the gallery.
  - Multi-select, then Save, calls the Web Share API (`navigator.share({ files })`) for "Save N Images". Split large batches and warn about size.
  - Fallback download links save to Files.
- **Desktop:**
  - Single download of the original or edited file.
  - Multi-select downloads as a streamed zip, with a size limit set in settings and a progress indicator.
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
  - Outbound network: the server suite fails if any socket connects to a host other than localhost (`pytest-socket`). The production web build fails if JS, CSS, or HTML contains an absolute `http://` or `https://` URL to an external host, and a test asserts the Content-Security-Policy header.
  - Optional manual pass on a real library on a Mac (`docs/MANUAL_MAC_TESTS.md`), including a pass with internet egress blocked.

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
   - The no-outbound-network rule, the PMTiles file, and how to run Docker with egress blocked.
   - Linux mount caveats (APFS, exFAT, HFS+, network share).
   - Updating osxphotos after macOS updates.
4. Phased plan:
   - Phase 0: Verify osxphotos opens each library's Photos version on both macOS and Linux, without writing into the package. Linux CI uses a synthetic fixture.
   - Phase 1: Auth, the admin panel (libraries, users, and the access matrix), the Library grid and viewer on both layouts, and downloads. The Linux media backend, Dockerfile, and launchd plist land in this phase.
   - Phase 2: Albums, People, Map, and search.
   - Phase 3: Passkeys, zip and pre-warm tuning, polish, and animations.
