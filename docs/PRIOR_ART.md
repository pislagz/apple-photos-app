# Prior art

Researched 2026-10-31. File-level notes below come from a shallow clone of each repository's default branch on that date. Re-check upstream before relying on a detail. Do not vendor these trees, and do not paste their source into this repo.

Licenses, as of that clone: photokit-api, xpoz, and osxphotos are MIT. libre-photos is ISC. MIT and ISC allow reuse only if you keep their copyright notice on any substantial portion you actually copy. Prefer reimplementing the idea in this project's own code. A short pattern description in this file is not a license to drop their files in `server/`.

Verdict: nothing found that matches the full spec (multiple `.photoslibrary` files + per-user library ACL + admin panel + iOS 17 / Sequoia Photos-style UI). Search covered GitHub mainly; Reddit/HN and commercial products (Synology Photos, PhotoStructure, Plex/Jellyfin, Ente, Lychee, Piwigo) were not checked in depth.

## Closest matches (borrow ideas, don't fork)

### photokit-api

<https://github.com/bjwalsh93/photokit-api> — MIT, last push noted Mar 2026 in the original survey. FastAPI over osxphotos: originals, thumbnails, previews, search (date, album, person, keyword). Bearer-secret auth. No UI. Binds localhost. Single auto-detected library. Includes batch delete, which this app must not carry over.

Layout worth knowing:

| Path | Role |
| --- | --- |
| `src/photokit_api/server/app.py` | `create_app()`. Mounts routers, CORS, auth middleware. `GET /health` is unauthenticated. |
| `src/photokit_api/server/routes/assets.py` | `GET /assets`, `GET /assets/{uuid}`, `DELETE /assets/batch`. |
| `src/photokit_api/server/routes/images.py` | `GET /assets/{uuid}/original`, `/thumb` (256 px), `/medium` (1024 px). |
| `src/photokit_api/server/routes/albums.py` | `GET /albums`, `GET /albums/{uuid}/assets`. |
| `src/photokit_api/server/routes/stats.py` | `GET /stats`, `POST /reload`. |
| `src/photokit_api/db.py` | The only module that talks to osxphotos. Routes stay thin. |
| `src/photokit_api/server/auth.py` | Single shared bearer secret, created on first run, mode `0600`. |
| `src/photokit_api/photokit.py` | PhotoKit writes via pyobjc. macOS only. |
| `src/photokit_api/cli.py` | `serve --port --host --no-auth --library PATH`. Default host `127.0.0.1`, default library is "whatever Photos.app opened last". |

Borrow:

- Split "read the library" from "serve HTTP". `db.py`'s module docstring says routes never touch `Photos.sqlite` themselves. Keep that boundary. In this app the reader also enforces the read-only open, and a second module checks the session's library assignments before the reader is reached.
- `GET /assets/{uuid}/original` uses `FileResponse` on `PhotoInfo.path`, with a 404 when the file is missing (`ismissing` / cloud-only). Do the same, and add HTTP Range, which their handler does not set explicitly.
- Thumbnails: `get_asset_thumb_path` uses `photo.path_derivatives` when present, and images.py falls back to a Pillow resize. Register pillow-heif the way `images.py` does (`register_heif_opener`) so HEIC opens on Linux. Their sizes are 256 and 1024. Ours are grid ~300, grid2x ~600, preview ~1600, cached on disk.
- osxphotos `path_derivatives` is sorted largest file first, so the last entry is the small master thumb (`…_4_5005_c.jpeg`). That is a reasonable grid source. Use a larger derivative, or a generated preview, for the 1600 px size.
- `QueryOptions` fields they pass (`photos`, `movies`, `favorite`, `hidden`, `screenshot`, `from_date`, `to_date`, `album`, `keyword`, `person`) plus lat/lng radius are a good checklist for the indexer's columns. Search runs against `app.db`, not against a live `PhotosDB.query` on each request.
- Albums: `PhotosDB.album_info` gives `uuid`, `title`, `photos`, and `folder_names`. That is the folder tree, without hand-written SQL.
- `GET /health` stays unauthenticated. `POST /reload` is the rough shape of admin "re-index", but ours is per library and admin-only.
- `--library PATH` is the right constructor argument. Calling `PhotosDB()` with no path opens the system library. This app always passes a registered path.

Leave behind:

- `DELETE /assets/batch` and the whole of `photokit.py`. `delete_assets` calls `PHAssetChangeRequest.deleteAssets_` inside `performChangesAndWait_error_`. `set_favorite` writes the favorite flag the same way. Both require macOS and mutate Photos. This app is strictly read-only and runs on Linux. Do not port those functions, their tests, or a disable-flag around them.
- The process-lifetime singleton `PhotosDB()` in `db.py`. It loads one auto-detected library and holds every `PhotoInfo` for the life of the process. We have several libraries, each terabytes of media. Open osxphotos to build or refresh the `app.db` index, then serve pages from that index.
- `list_assets` runs `db.query(opts)`, then filters and sorts the full match list in Python, then slices `offset:offset+limit`. That will not paginate a large library. Cursor-paginate `app.db`.
- One global bearer secret, `--no-auth`, and localhost binding. We use per-user Argon2id passwords and HttpOnly session cookies, over Tailscale Serve. Their auth middleware also leaves `/docs` open. Do not expose interactive API docs on the tailnet without a session.
- `AssetModel` includes `path` and `path_edited`. Do not return filesystem paths to the browser.
- The project name and the PhotoKit write path. Reading is osxphotos. PhotoKit is out.

### xpoz

<https://github.com/muxcmux/xpoz> — MIT, last push Jan 2023. Rust (actix + async-graphql) and a Svelte gallery. Photos 6.0 or newer, Mac or Linux. Album-centric, one library path, no People, Map, or timeline found. Useful as a cautionary schema reader and as a sketch of admin-versus-allow-list, not as a UI to clone.

How it reads the Photos database:

- `src/default_config.yml` points `photos.database` at `…/database/Photos.sqlite` and comments that it is opened read-only. Media dirs: `originals`, `resources/renders`, `resources/derivatives`, `resources/derivatives/masters`.
- `src/main.rs` `configure()` opens that file with sqlx `SqliteConnectOptions::read_only(true)`. A second pool is the app's own `xpoz.sqlite`. `Databases` holds `{ photos, app }`. Keeping those files apart is the right split. Our `app.db` must also live outside every `.photoslibrary`.
- It does not call osxphotos and it does not read a Photos version number. Schema drift is handled, partly, by loading Core Data's `Z_PRIMARYKEY` (`Z_ENT`, `Z_NAME`, `Z_SUPER`) in `src/db/entities.rs`.
- `src/db/assets.rs` `album_join_tables` looks up the `Album` and `Asset` entity ids and builds `Z_{id}ASSETS`, `Z_{albumId}ALBUMS`, and `Z_FOK_{assetId}ASSETS`. Those ids move between Photos versions, which is why they are not constants.
- Column names are still hardcoded for the Photos 5+ single-database model: `ZASSET`, `ZGENERICALBUM`, `ZUUID`, `ZDATECREATED`, `ZDIRECTORY`, `ZFILENAME`, `ZLATITUDE`, `ZTRASHEDSTATE`, and so on (`src/db/assets.rs`, `src/db/albums.rs`). Dates use the Cocoa offset: `datetime(ZDATECREATED,'unixepoch','31 years','localtime')`. The README requires Photos.app >= 6.0. Anything newer than what that SQL expects just breaks. This is the main reason this project uses osxphotos instead of SQL.

Admin and share links:

- `migrations/V1__create_tokens.sql` creates the app table: name, session-bound flag, admin flag, session id, secret, and a JSON album allow-list.
- GraphQL `me`, list, create, update, and delete live in `src/db/mod.rs`. Mutations check `admin` and return 401 otherwise.
- `src/db/albums.rs` `base_select` adds `ZUUID IN (…)` when the caller has an allow-list. Every album read goes through that filter. That is the idea to keep: an allow-list checked on every read. Ours is users × libraries, stored in `app.db`, checked before any asset, thumb, original, or zip is touched.
- Login is `GET /auth?<secret>` (`src/auth/mod.rs`), which stores the secret in the cookie session. `/share.html` is on the unauthenticated path list. The admin UI is `frontend/src/routes/AccessTokens.svelte`. Public share links are out of scope for this app. One-time invite links in the spec create accounts. They do not publish photos.
- Their filenames use a substring this repo's runner will not read. Describe the pattern here. Do not recreate those filenames. See `CLAUDE.md`.

File serving:

- `GET /asset/{variant}/{uuid}` in `src/services/files.rs`. Variants: `thumb`, `render`, `resized`, `video`, otherwise original.
- `Asset::first_in_path` globs `{directory}/{uuid}*.{jpeg,mov,mp4,jpg,png,gif}` under the derivative dirs. That matches where Photos stores edited renders and thumbs. Prefer osxphotos `path_edited` and `path_derivatives` over reimplementing the glob, and treat this list as the places to look when a path is missing.
- `src/transcoder.rs` and `media.transcode_videos` write browser-playable MP4s next to the app, and the config comment says originals are left intact. Video transcodes for inline playback belong in the thumbnail/cache volume, never inside the `.photoslibrary`.

Leave behind:

- Hand-written Photos SQL, entity-id join tables, and the Photos 6-era column list.
- The cookie signer in `main.rs` is a hard-coded `[0; 32]` key. Generate a real session secret and keep it out of git.
- Default bind `0.0.0.0:1234`, secret in the query string, GraphiQL left on (`server.graphiql: true`), and public album share links.
- Svelte gallery (`frontend/src/routes/Album.svelte`, `Albums.svelte`). It is album-only and not an iOS 17 or Sequoia clone. The UI is ours. See `docs/design-refs/`.

### libre-photos

<https://github.com/kfatehi/libre-photos> — ISC, abandoned 2016. Serves one library via `--library <path>` and a small web client.

The only idea to take is the copy workaround:

- `bin/libre-photos` passes `--copy` through to `src/photo-library.js`.
- When `opts.copy` is set, that file copies `database/Library.apdb` and `database/ImageProxies.apdb` to `/tmp/library.apdb` and `/tmp/imageproxies.apdb`, then opens the copies with Sequelize. The README says this is for `SQLITE_CANTOPEN` on a network filesystem or NAS, and that the server must be restarted to see later edits.
- Those `.apdb` files and the `RKMaster` / `RKImageProxyState` models are the Aperture-era layout (Masters, Thumbnails). Modern libraries use `database/Photos.sqlite`, `originals/`, and `resources/derivatives`. Do not copy this schema or this client.

For this app: if `mode=ro` on the live `Photos.sqlite` fails with `SQLITE_CANTOPEN`, or if opening it would create `-wal` / `-shm` inside the package, copy `Photos.sqlite` and any `-wal` and `-shm` to a temp directory outside the library and open that. Pass `library_path=` as the real package so `PhotoInfo.path` still points at the originals. Do not copy `originals/` or `resources/`. Restart or re-index to notice a newer database, the same limitation libre-photos documents. osxphotos already copies only when `sqlite_db_is_locked` is true (`osxphotos/photosdb/photosdb.py`). Phase 0 has to prove that path, and the forced-copy path, leave the package unchanged. See the osxphotos section.

## Building block

### osxphotos

<https://github.com/RhetTbull/osxphotos> — MIT, very active (push 2026-10-29, about 4k stars at the original survey). Reads any library by path: People with names, albums, places, edited versions, Live Photos. Query and export work on Linux, which is what makes a Docker deployment real.

Use the Python API. Do not shell out to the CLI for requests. Do not import `osxphotos.photokit` or `osxphotos.photoscript_utils`. `osxphotos/platform.py` loads the Photos framework only when `sys.platform == "darwin"` and pyobjc happens to be installed. Leave pyobjc off our dependency list so that import never matters.

Open:

```python
from osxphotos import PhotosDB

db = PhotosDB(dbfile="/path/to/Library.photoslibrary")
# or, after copying the sqlite files outside the package:
db = PhotosDB(
    dbfile="/tmp/viewer-XXXX/Photos.sqlite",
    library_path="/path/to/Library.photoslibrary",
)
```

`PhotosDB()` with no `dbfile` searches for the last library Photos.app opened. That is the system library. Never call it that way.

`db.library_path`, `db.db_path`, `db.db_version`, and `db.photos_version` are the values Phase 0 prints. `photos_version` is the Photos app generation that created the library (5 Catalina, 6 Big Sur, …, 10 Sequoia). The README table on main at clone time marked Photos 2.0 through 12.0 as supported, and said shared albums on macOS 26 are not fully supported and Tahoe is only lightly tested. Read the table in the installed package during Phase 0. Refuse an unsupported version with an admin error. Log both version numbers.

Read-only, from the clone of main:

- `PhotosDB.get_db_connection` calls `sqlite_open_ro`.
- `osxphotos/sqlite_utils.py` `sqlite_open_ro` connects with `file://…?mode=ro` (`uri=True`). That forbids SQL writes.
- `mode=ro` is not `immutable=1`. On a WAL database SQLite can still try to create a `-shm` file beside `Photos.sqlite`. On a network mount or a read-only APFS/FUSE mount that becomes `SQLITE_CANTOPEN`. This is the libre-photos failure mode.
- If `sqlite_db_is_locked` is true, `_find_database` copies the database to a temp file and uses the copy. If it is not locked, osxphotos opens the file inside the package.
- `sqlite_open_ro_with_temp_copy` copies `-wal` and `-shm` only when the locked check fails. `sqlite_repair_db` and `sqlite_recover_db` rewrite the database. Do not call them.
- Phase 0 picks an open mode that leaves the package byte-for-byte unchanged (no new file, no mtime change) on macOS and on Linux. The expected implementation is: copy `Photos.sqlite` plus `-wal` and `-shm` to temp, then `PhotosDB(dbfile=copy, library_path=package)`. `immutable=1` is a fallback to try if a copy is impractical; it can miss the latest WAL frames, so record which mode was used.

Indexing fields, all on `PhotoInfo` unless noted:

| Need | API |
| --- | --- |
| Id, names | `uuid`, `filename`, `original_filename`, `title`, `description` |
| Dates | `date`, `date_added`, `date_modified` |
| Original file | `path` (None when `ismissing`) |
| Edited JPEG/render | `path_edited`, `hasadjustments`, `uti_edited` |
| Live Photo video | `live_photo`, `path_live_photo` (normal case is a sibling `*_3.mov`), `path_edited_live_photo` |
| RAW | `path_raw`, `uti_raw` |
| Derivatives | `path_derivatives` — list of paths, largest file first. Modern libraries: `resources/derivatives/{uuid[0]}/` and `resources/derivatives/masters/{uuid[0]}/{uuid}_4_5005_c.jpeg` |
| Pixels and file | `width`, `height`, `original_filesize`, `uti`, `uti_original` |
| Flags for smart albums | `favorite`, `hidden`, `screenshot`, `selfie`, `portrait`, `panorama`, `ismovie`, `isphoto`, `hdr`, `slow_mo`, `burst` |
| People | `persons` (sorted names), `person_info` (`PersonInfo.uuid`, `.name`, `.display_name`, `.facecount`, `.keyphoto`), `face_info` |
| Library-wide people | `PhotosDB.person_info` |
| Albums | `albums`, `album_info` (`AlbumInfo.uuid`, `.title`, `.folder_names`, `.photos` in Photos' sort order) |
| Folder tree | `PhotosDB.folder_info`, `PhotosDB.album_info` |
| Place | `location` → `(lat, lon)` or `(None, None)`; `place` → `PlaceInfo5.name`, `.names`, `.country_code`, `.address_str` |
| Camera | `exif_info` |

`AlbumInfo` is a user album or a folder-adjacent object. Smart albums in the spec (Favorites, Videos, Selfies, Live Photos, Panoramas, Screenshots, RAW, Recently Added) are mostly queries on the flags above, plus `date_added` for Recently Added. Confirm during Phase 2 whether a given library also surfaces those as albums. Build them from the index either way.

`PhotosDB.query(QueryOptions)` and `PhotosDB.get_photo(uuid)` are for the indexer and for tests. A request path that calls `query()` and then slices the list will not survive these libraries. photokit-api does that. We index into `app.db` and paginate there.

Linux, from the osxphotos README on that clone:

- Tested on Ubuntu and macOS. The Python query and export API works on Linux. macOS-only CLI commands are hidden there.
- The same database can be read on a different OS than the one that created it.
- `platform.py` uses NFD filenames on macOS and NFC on Linux (`osxphotos/unicode.py`). Trust osxphotos' path properties rather than joining strings yourself.
- Resolving a referenced file from a bookmark (`resolve_bookmark_path`) is macOS-only. If `path` is None for a referenced asset on Linux, mark the asset unavailable.
- Install hiccups on Linux are documented (`InvalidVersion` from a distro pip). `uv` is the fallback the README suggests. Python range they declare is `>=3.10,<=3.14`. This project targets 3.12.

Memory: constructing `PhotosDB` builds large in-memory maps of every asset. That is acceptable for an index job. It is not acceptable as a per-request cache of several libraries. Drop the object when the index transaction commits, or keep at most a short-lived reader for the library currently being indexed.

## Rejected alternatives

- Immich / PhotoPrism and similar: no direct `.photoslibrary` reading. They need `osxphotos export`, which doubles terabytes of storage and drops People names and albums unless those are written into metadata. Already rejected.
- PhotoKit / System Photo Library / one macOS user per library: dealbreaker. photokit-api's write module is this idea. It stays rejected.
- xpoz's direct SQL: it is how "read Photos.sqlite" looks without osxphotos, and it is pinned to an old schema. Use it as a map of table names when debugging osxphotos, not as the implementation.

## UI

No polished iOS 17 Photos or macOS Sequoia Photos web clone turned up. The UI is our own work (TanStack Virtual grid, MapLibre map), matched to `docs/design-refs/` and `docs/SPEC.md`. xpoz's Svelte album viewer is not a reference for layout.
