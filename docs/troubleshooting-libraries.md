# Troubleshooting a library that keeps going "broken"

This page is for the person who runs the server, usually on a Mac with the
libraries on an external drive. It explains what each library status on the
admin page means and what to check. (#461)

## What the admin page says, and what to do

| Status | Message | What it means | What to do |
| --- | --- | --- | --- |
| Waiting for Photos | "Photos on the Mac is updating this library. It will refresh when Photos is done." | Photos.app, or a Photos background process (`photolibraryd`, `photoanalysisd`), is writing to the library. This is normal after an import or while Photos analyses faces and scenes. | Nothing. Everyone keeps seeing the photos as they were. The library refreshes once Photos has been quiet for the stability window (Settings, default 10 minutes), or after one hour of constant changes at the latest. Quitting Photos speeds this up. |
| Not found | "The drive with this library isn't connected." | The folder that holds the library is gone, so the drive is not mounted. | Connect the drive. The library comes back by itself. |
| Not found | "The drive is connected, but the Mac now shows it as /Volumes/Name 1." | macOS mounted the drive under a new name. This usually happens after the drive was unplugged without ejecting, or after sleep. | Eject the drive and connect it again, so it gets its normal name back. Or press **Replace with ...** to point the library at the new place. |
| Not found | "The drive is connected, but the library isn't where it used to be." | The drive is there, but the `.photoslibrary` is not at the registered path. Someone moved or renamed it. | Move it back, or use **Replace** to choose the new location. |
| No permission | "This app lost permission to read the drive." | macOS privacy settings (TCC) now block the server. This often happens after a macOS update. The drive is fine. | System Settings > Privacy & Security > **Full Disk Access**: allow the app that runs the server (Terminal, iTerm, `python3`, or the launchd job's binary). Also check **Files and Folders** > Removable Volumes. Restart the server afterwards. |
| Needs attention | "The drive is connected but isn't answering." | Reading from the drive failed with an I/O error or a timeout. The disk might have been spinning up, or it might be failing. | Wait. The app retries by itself. If this keeps happening, run Disk Utility > First Aid on the drive. |
| Needs attention | "The server's disk is too full to read this library." | The server copies `Photos.sqlite` (it can be several GB) to its temp folder before it reads it. There wasn't enough free space. The app then reads the database in place, read-only. | Free space on the disk that holds the temp folder (`$TMPDIR`, `/tmp` in Docker), or point `TMPDIR` at a bigger disk. |
| Needs attention | "This library's database can't be read." | Photos.sqlite is damaged or only half copied. | Open the library once in Photos on the Mac, quit Photos, then press **Check for changes**. |

None of these states removes anything. The last good index stays in `app.db`.
When the cause is gone, the library recovers on its own. Failed attempts are
retried after 5, 10, 20 ... minutes, at most every 6 hours. **Check now** in
Settings skips the wait.

## What to check on the Mac

```bash
# Is the drive mounted, and under which name? Look for "Name 1".
ls -la /Volumes
mount | grep /Volumes

# Can the server's user read the library? "Operation not permitted" means
# privacy (Full Disk Access). "No such file" means the path or the name changed.
ls -la "/Volumes/<Drive>/<Library>.photoslibrary/database/"

# Is Photos (or one of its background processes) using the library right now?
pgrep -lf 'Photos|photolibraryd|photoanalysisd'
lsof +D "/Volumes/<Drive>/<Library>.photoslibrary/database" 2>/dev/null | head

# What Photos' background processes did in the last hour.
log show --last 1h --predicate 'process == "photolibraryd"' --style compact | tail -50
log show --last 1h --predicate 'process == "photoanalysisd"' --style compact | tail -50

# Did the drive disconnect or remount?
log show --last 1h --predicate 'eventMessage CONTAINS[c] "unmount" OR eventMessage CONTAINS[c] "disk arbitration"' --style compact | tail -50

# Free space in the temp folder the server copies Photos.sqlite into.
df -h "${TMPDIR:-/tmp}"
```

## What to send when reporting a problem

The server writes one line per failure to its log. With launchd that is the
`StandardErrorPath` file from the plist. With Docker it is `docker logs`.

```bash
grep 'library problem:' /path/to/server.log | tail -50
```

Each line looks like this:

```
library problem: id=2 phase=apply code=photos_busy errno=- path=/Volumes/Photos/Family.photoslibrary detail=Photos.sqlite changed while it was being copied (3 tries) ... (next try after 2026-11-16T10:05:00Z)
```

- `code` is the cause: `photos_busy`, `no_permission`, `drive_not_mounted`, `volume_renamed`, `library_missing`, `drive_error`, `temp_full`, `unreadable`, `unsupported_version`, or `incomplete`.
- `errno` is the operating system's error, for example `EPERM` (privacy), `ENOENT` (not there), `EIO` (drive error), or `ENOSPC` (disk full).
- `phase` is what the server was doing: `check` (the regular look at the drive), `apply` or `index` (reading a changed library), `reindex`, `admin` (Check for changes), or `copy` (copying `Photos.sqlite`).

Send these lines, the output of `ls -la /Volumes`, and the admin page's status
text.
