# Manual checks on a real library

CI does not run this file. CI uses the synthetic fixture on Linux. Do this when a Mac with the real libraries is available, and again on Linux once that volume is mounted there.

Leave every `.photoslibrary` unchanged. Before the probe, record `find` output (paths, sizes, mtimes) for the *whole* package, not just `database/` -- the probe isn't trusted to only touch the database, so the snapshot shouldn't assume it either. After the probe, diff it. A new `-wal`, `-shm`, journal, new file, new directory, or mtime change is a failure.

`stat -f %m` only has 1-second resolution, so a write that lands inside the same second as the snapshot could be missed. `database/*.sqlite*` is small enough to also hash: `shasum -a 256 "LIBRARY"/database/*.sqlite* > /tmp/before.sha256`, repeat after, and diff that too, as a check `stat`'s resolution can't give you.

## Commands

Run on each host (macOS, then Linux once the drive is mounted there), once per library. Replace `LIBRARY` with the full path to the `.photoslibrary` package.

```bash
# 0. Set up the server env (first time on this host only).
cd server
python3.12 -m venv .venv
source .venv/bin/activate
pip install osxphotos==0.77.2 pytest pytest-socket

# 1. Record osxphotos' version -- goes in the "osxphotos version" column.
python -c "import osxphotos; print(osxphotos.__version__)"

# 2. Snapshot the whole package before touching it: path, size, mtime for
# every file and directory, sorted so the diff in step 4 is stable. Keep
# this output. Also hash the sqlite files, since `stat -f %m`'s 1-second
# resolution can miss a write that lands in the same second as the snapshot.
find "LIBRARY" -exec stat -f '%N %z %m' {} + | sort > /tmp/before.txt   # macOS
find "LIBRARY" -exec stat -c '%n %s %Y' {} + | sort > /tmp/before.txt   # Linux
shasum -a 256 "LIBRARY"/database/*.sqlite* | sort > /tmp/before.sha256

# 3. Run the probe. OSXPHOTOS_NO_VERSION_CHECK=1 matches what the server
# sets in production (see CLAUDE.md "Offline at runtime") -- osxphotos must
# not phone PyPI even here. Record every printed line: library_path,
# db_version, photos_version, asset_count, open_mode. A refused version
# exits 1 and prints the admin-facing message instead -- record that text
# verbatim in the Notes column.
OSXPHOTOS_NO_VERSION_CHECK=1 python -m photos_viewer.probe "LIBRARY"

# 4. Snapshot again the same way as step 2, into /tmp/after.txt and
# /tmp/after.sha256, then diff both. No output at all is the only passing
# result.
diff /tmp/before.txt /tmp/after.txt
diff /tmp/before.sha256 /tmp/after.sha256
```

Fill in "Package unchanged?" from step 4's two diffs: "yes" only if both printed nothing. Fill in "Open mode" from step 3's `open_mode` line -- `copy` is the expected mode; `ro` means the temp copy failed (should not happen on a normal Mac filesystem, but can happen on some network/exFAT Linux mounts) and is worth a Notes entry explaining why.

For each library:

| Library display name | Path | Host (macOS or Linux) | osxphotos version | `db_version` | `photos_version` | Asset count | Open mode (copy / ro) | Package unchanged? | Notes |
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
- With the server blocked from the internet, the grid and a download still load, and the server makes no outbound connection. Place labels match the library.
- Once Phase 2 exists, opening the map in the default OpenStreetMap mode requests only `tile.openstreetmap.org` tiles for the visible view, and the credit "© OpenStreetMap contributors" is on screen. Switching the admin setting to Local file or Off stops those requests. With the browser also blocked from the internet, Local file (or Off) still shows the clusters.
