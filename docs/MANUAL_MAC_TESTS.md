# Manual checks on a real library

CI does not run this file. CI uses the synthetic fixture on Linux. Do this when a Mac with the real libraries is available, and again on Linux once that volume is mounted there.

Leave every `.photoslibrary` unchanged. Before the probe, record `find` output (paths, sizes, mtimes) for the package, or at least for `database/`. After the probe, diff it. A new `-wal`, `-shm`, journal, or mtime change is a failure.

For each library:

| Library display name | Path | Host (macOS or Linux) | osxphotos version | `db_version` | `photos_version` | Asset count | Open mode (copy / ro / immutable) | Package unchanged? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | macOS | | | | | | | |
| | | Linux | | | | | | | |

Notes to fill if they happen:

- Photos.app had the library open.
- `SQLITE_CANTOPEN` until the sqlite files were copied out of the package.
- Unsupported `photos_version`. The admin-facing error string:
- Referenced originals whose bookmark does not resolve on Linux.
- HEIC, RAW, or an edited render that decodes on macOS and fails on the Pillow / ffmpeg path.
- Mount type (APFS, HFS+ read-only, exFAT, SMB, other). APFS on Linux is expected to be awkward. Prefer exFAT, HFS+ read-only, or a network share.

Also, once Phase 1 exists, on the Mac only:

- Sign in as user A and as user B. A's libraries do not appear for B, including by pasting a URL.
- Download one original and one edited file. The package listing is still unchanged.
- Generate a grid thumb. The new file is under the data dir, not inside the library.
- "Drive not mounted" shows the admin warning when the volume is ejected.
- With the host blocked from the internet, the grid, a download, and (once Phase 2 exists) the map still load. The browser shows only same-origin requests. Place labels match the library. No tile request leaves the machine.
