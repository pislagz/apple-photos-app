"""One interface -- `generate()` -- turns a source file into grid, grid2x,
or preview bytes. It never touches a `.photoslibrary`: callers pass in a
path already resolved by `libraries.py`/`indexer.py`, and this module only
reads that path and any sibling derivative paths.

Backend order, per `docs/SPEC.md`'s Platforms section: a large-enough
`path_derivatives` entry first (so a HEIC/RAW original often never needs
decoding at all), then `sips`/`qlmanage` on Darwin when present, then
Pillow + pillow-heif everywhere, then ffmpeg for a video still, then the
optional `rawpy` for RAW. `sips`/`qlmanage` are a Darwin fast path, never
required -- the Linux fallback chain below has to work on its own.

`get_or_generate()` adds an on-disk cache under the data dir. Its key is
library id + asset uuid + size + the mtime of whichever file is actually
used -- the original, or a derivative when the original is missing (an
iCloud library with "Optimize Mac Storage" keeps no local original) --
not the caller's `assets.id`, since P1.6 re-indexes by delete-and-reinsert
and that id is not stable across a re-index. The resolved pixel size and
encoder quality are part of the key too, so a settings change invalidates
stale cache entries instead of serving them forever.
"""

from __future__ import annotations

import dataclasses
import hashlib
import io
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Sequence

import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

# grid ~300, grid2x ~600, preview ~1600 (docs/SPEC.md, docs/TASKS.md P1.7).
# These are only the defaults -- `library_assets.py` passes the admin's
# configured `size_px`/`quality` (P1.12A) and falls back to these when no
# setting has been saved yet.
SIZES: dict[str, int] = {"grid": 300, "grid2x": 600, "preview": 1600}
DEFAULT_QUALITY = 82
DEFAULT_CACHE_SIZE_LIMIT_BYTES = 5 * 1024**3

_RAW_EXTENSIONS = {
    ".cr2",
    ".cr3",
    ".nef",
    ".arw",
    ".orf",
    ".rw2",
    ".raf",
    ".dng",
    ".pef",
    ".srw",
}
# A video's `path_derivatives` entry, when present, is a pre-rendered JPEG
# poster frame -- decode it like any other image instead of paying for an
# ffmpeg still extraction.
_POSTER_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif"}

_SUBPROCESS_TIMEOUT_SECONDS = 30


class MediaBackendError(Exception):
    """No decoder available could produce an image for this asset.

    Raised per-asset, never left to propagate as a process crash -- a
    caller serving a grid of many assets must be able to catch this for
    one and keep going.
    """


@dataclasses.dataclass(frozen=True)
class GeneratedImage:
    data: bytes
    content_type: str  # "image/webp" or "image/jpeg"

    @property
    def extension(self) -> str:
        return "webp" if self.content_type == "image/webp" else "jpg"


def generate(
    source_path: str | pathlib.Path,
    size: str,
    *,
    derivatives: Sequence[str | pathlib.Path] = (),
    is_video: bool = False,
    size_px: int | None = None,
    quality: int = DEFAULT_QUALITY,
) -> GeneratedImage:
    """Decode `source_path` (or a sufficiently large derivative) and return
    WebP (or JPEG, if WebP encoding isn't available) bytes sized for `size`."""
    if size not in SIZES:
        raise ValueError(f"unknown size {size!r}; expected one of {sorted(SIZES)}")
    target_px = size_px if size_px is not None else SIZES[size]
    source_path = pathlib.Path(source_path)
    chosen = _resolve_source(
        source_path,
        [pathlib.Path(d) for d in derivatives],
        target_px,
        is_video=is_video,
    )
    return _generate_from_chosen(chosen, target_px, quality, is_video=is_video)


def _generate_from_chosen(
    chosen: pathlib.Path, target_px: int, quality: int, *, is_video: bool
) -> GeneratedImage:
    image = _decode(chosen, is_video=is_video, target_px=target_px)
    return _resize_and_encode(image, target_px, quality=quality)


def to_jpeg(source_path: str | pathlib.Path, *, is_video: bool = False) -> bytes:
    """Decode `source_path` and return full-resolution JPEG bytes, for a
    `?format=jpeg` original download (e.g. a HEIC original on a client that
    can't display HEIC). Unlike `generate()`, this never resizes -- a
    download is expected at the original's own resolution."""
    image = _decode(pathlib.Path(source_path), is_video=is_video)
    with image:
        oriented = ImageOps.exif_transpose(image) or image
        if oriented.mode not in ("RGB", "L"):
            oriented = oriented.convert("RGB")
        buffer = io.BytesIO()
        oriented.save(buffer, format="JPEG", quality=92)
        return buffer.getvalue()


def cache_key(
    library_id: int,
    asset_uuid: str,
    size: str,
    source_path: str | pathlib.Path,
    source_mtime_ns: int,
    size_px: int,
    quality: int,
) -> str:
    # `source_path` is part of the key, not just its mtime: an edit or a
    # revert (P1.17b) can swap which file backs an asset_uuid between two
    # requests whose mtimes happen to land in the same filesystem tick, and
    # mtime alone would then serve one file's cached bytes for the other.
    raw = f"{library_id}:{asset_uuid}:{size}:{source_path}:{source_mtime_ns}:{size_px}:{quality}".encode()
    return hashlib.sha256(raw).hexdigest()


def get_or_generate(
    cache_dir: str | pathlib.Path,
    *,
    library_id: int,
    asset_uuid: str,
    size: str,
    source_path: str | pathlib.Path,
    derivatives: Sequence[str | pathlib.Path] = (),
    is_video: bool = False,
    size_px: int | None = None,
    quality: int = DEFAULT_QUALITY,
    cache_size_limit_bytes: int | None = None,
) -> GeneratedImage:
    """Like `generate()`, but checks an on-disk cache under `cache_dir`
    first and writes a generated result back to it. Resolves the source
    file once -- the same `chosen` path backs both the cache key (its
    mtime) and, on a miss, the decode -- instead of probing derivatives
    twice per request."""
    if size not in SIZES:
        raise ValueError(f"unknown size {size!r}; expected one of {sorted(SIZES)}")
    target_px = size_px if size_px is not None else SIZES[size]
    source_path = pathlib.Path(source_path)
    derivative_paths = [pathlib.Path(d) for d in derivatives]
    chosen = _resolve_source(
        source_path, derivative_paths, target_px, is_video=is_video
    )
    try:
        source_mtime_ns = chosen.stat().st_mtime_ns
    except OSError as exc:
        raise MediaBackendError(
            f"No usable original or derivative file for asset {asset_uuid}"
        ) from exc
    key = cache_key(
        library_id, asset_uuid, size, chosen, source_mtime_ns, target_px, quality
    )
    cache_dir = pathlib.Path(cache_dir)
    if cache_size_limit_bytes == 0:
        # A limit of 0 means "no cache": neither read nor write.
        return _generate_from_chosen(chosen, target_px, quality, is_video=is_video)
    cached = _read_cache(cache_dir, library_id, asset_uuid, key)
    if cached is not None:
        return cached
    result = _generate_from_chosen(chosen, target_px, quality, is_video=is_video)
    _write_cache(cache_dir, library_id, asset_uuid, key, result.extension, result.data)
    if cache_size_limit_bytes is not None:
        _note_cache_write(
            cache_dir,
            cache_size_limit_bytes,
            _cache_file(cache_dir, library_id, asset_uuid, key, result.extension),
        )
    return result


def get_or_generate_jpeg(
    cache_dir: str | pathlib.Path,
    *,
    library_id: int,
    asset_uuid: str,
    source_path: str | pathlib.Path,
    is_video: bool = False,
    cache_size_limit_bytes: int | None = None,
) -> bytes:
    """Like `get_or_generate()`, but for `to_jpeg()`'s full-resolution
    `?format=jpeg` conversion -- same on-disk cache, keyed on the
    original's own mtime, no derivative selection (a download is always
    the original, never a smaller derivative)."""
    source_path = pathlib.Path(source_path)
    try:
        source_mtime_ns = source_path.stat().st_mtime_ns
    except OSError as exc:
        raise MediaBackendError(f"No usable file for asset {asset_uuid}") from exc
    key = cache_key(
        library_id, asset_uuid, "jpeg-full", source_path, source_mtime_ns, 0, 92
    )
    if cache_size_limit_bytes == 0:
        return to_jpeg(source_path, is_video=is_video)
    cache_dir = pathlib.Path(cache_dir)
    cached_path = _cache_file(cache_dir, library_id, asset_uuid, key, "jpg")
    if cached_path.exists():
        _touch_cache_file(cached_path)
        return cached_path.read_bytes()
    data = to_jpeg(source_path, is_video=is_video)
    _write_cache(cache_dir, library_id, asset_uuid, key, "jpg", data)
    if cache_size_limit_bytes is not None:
        _note_cache_write(cache_dir, cache_size_limit_bytes, cached_path)
    return data


def asset_cache_dir(
    cache_dir: pathlib.Path, library_id: int, asset_uuid: str
) -> pathlib.Path:
    """`<library_id>/<uuid[:2]>/<uuid>/`: every cache file of one asset lives
    in one directory, so the indexer can purge a removed or changed asset
    without knowing its cache keys. Earlier flat `<key[:2]>/<key>.<ext>`
    entries are simply never read again and age out through the LRU."""
    asset_uuid = asset_uuid.split(":", 1)[0]
    if not asset_uuid:
        # An empty uuid would resolve to the whole library's cache dir, and
        # purge_asset_cache would rmtree it.
        raise ValueError("asset uuid must not be empty")
    return cache_dir / str(library_id) / asset_uuid[:2] / asset_uuid


def purge_asset_cache(
    cache_dir: pathlib.Path, library_id: int, asset_uuid: str
) -> None:
    asset_dir = asset_cache_dir(cache_dir, library_id, asset_uuid)
    shutil.rmtree(asset_dir, ignore_errors=True)
    _prune_empty_parents(asset_dir.parent, cache_dir)


def purge_library_cache(cache_dir: pathlib.Path, library_id: int) -> int:
    """Delete one library's cache files (`<cache_dir>/<library_id>/`), nothing
    else; returns the bytes freed. Other libraries' entries are untouched."""
    root = cache_dir / str(library_id)
    freed = 0
    with _cache_lock:
        if root.is_dir():
            freed = sum(size for _, size, _ in _scan_cache(root)[0])
            shutil.rmtree(root, ignore_errors=True)
        # Forget the running total; the next write rescans and corrects it.
        _cache_totals.pop(cache_dir, None)
    return freed


def cache_total_bytes(cache_dir: pathlib.Path) -> int | None:
    """The running cache size this process tracks, or None before the first
    write-with-a-limit has scanned it."""
    with _cache_lock:
        return _cache_totals.get(cache_dir)


def _cache_file(
    cache_dir: pathlib.Path, library_id: int, asset_uuid: str, key: str, extension: str
) -> pathlib.Path:
    return asset_cache_dir(cache_dir, library_id, asset_uuid) / f"{key}.{extension}"


def _read_cache(
    cache_dir: pathlib.Path, library_id: int, asset_uuid: str, key: str
) -> GeneratedImage | None:
    for content_type, extension in (("image/webp", "webp"), ("image/jpeg", "jpg")):
        path = _cache_file(cache_dir, library_id, asset_uuid, key, extension)
        if path.exists():
            _touch_cache_file(path)
            return GeneratedImage(data=path.read_bytes(), content_type=content_type)
    return None


def _write_cache(
    cache_dir: pathlib.Path,
    library_id: int,
    asset_uuid: str,
    key: str,
    extension: str,
    data: bytes,
) -> None:
    """Write via a temp file in the same directory plus `os.replace()`, so
    a concurrent reader of this cache path never observes a partial file."""
    path = _cache_file(cache_dir, library_id, asset_uuid, key, extension)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=path.suffix)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(tmp_name, path)
    except BaseException:
        pathlib.Path(tmp_name).unlink(missing_ok=True)
        raise


# Evict down to this fraction of the limit, not to the limit itself, so a cache
# sitting at its limit rescans once per batch of writes rather than every write.
_EVICT_LOW_WATER = 0.9

# Per cache dir, the running byte total since this process's first scan. Writes
# add to it; only crossing the limit pays for a directory scan (which also
# corrects drift from purges or another process). Guarded by `_cache_lock`,
# which also serialises scan-and-delete so two evictions can't double-count.
_cache_totals: dict[pathlib.Path, int] = {}
# When each total was last learned from a real scan. With several worker
# processes each total only counts its own writes, so a total older than
# this is rescanned rather than incremented: overshoot is bounded by what the
# other workers write in one interval, not unbounded until the limit is hit.
_cache_scanned_at: dict[pathlib.Path, float] = {}
_CACHE_RESCAN_SECONDS = 30.0
_cache_lock = threading.Lock()


def _prune_empty_parents(directory: pathlib.Path, cache_dir: pathlib.Path) -> None:
    """Remove `directory` and its empty parents up to, not including, the
    library dir directly under `cache_dir`. `rmdir` refuses a non-empty dir,
    which is also what makes this safe against a concurrent write."""
    try:
        relative = directory.relative_to(cache_dir)
    except ValueError:
        return
    if len(relative.parts) < 2:
        return
    library_dir = cache_dir / relative.parts[0]
    while directory != library_dir:
        try:
            directory.rmdir()
        except OSError:
            return
        directory = directory.parent


def _touch_cache_file(path: pathlib.Path) -> None:
    """Record a cache read in the file's mtime so eviction is least-recently-
    *used*, not least-recently-written. A failure (read-only mount) only costs
    LRU accuracy."""
    try:
        os.utime(path)
    except OSError:
        pass


def _scan_cache(
    cache_dir: pathlib.Path,
) -> tuple[list[tuple[int, int, pathlib.Path]], int]:
    entries: list[tuple[int, int, pathlib.Path]] = []
    total = 0
    for path in cache_dir.rglob("*"):
        try:
            stat = path.stat()
        except OSError:
            continue
        if not path.is_file() or path.name.startswith(".tmp-"):
            continue
        entries.append((stat.st_mtime_ns, stat.st_size, path))
        total += stat.st_size
    return entries, total


def _note_cache_write(
    cache_dir: pathlib.Path, size_limit_bytes: int, written: pathlib.Path
) -> None:
    """Account for a just-written file and evict only when over the limit. The
    first write per process scans once to learn the total (that scan already
    includes `written`); later writes are O(1) until the limit is crossed."""
    with _cache_lock:
        now = time.monotonic()
        if (
            cache_dir not in _cache_totals
            or now - _cache_scanned_at.get(cache_dir, 0.0) >= _CACHE_RESCAN_SECONDS
        ):
            _cache_totals[cache_dir] = _scan_cache(cache_dir)[1]
            _cache_scanned_at[cache_dir] = now
        else:
            try:
                _cache_totals[cache_dir] += written.stat().st_size
            except OSError:
                return
        if _cache_totals[cache_dir] > size_limit_bytes:
            _evict_locked(cache_dir, size_limit_bytes, _EVICT_LOW_WATER, keep=written)


def _evict_if_needed(
    cache_dir: pathlib.Path, size_limit_bytes: int, low_water: float = 1.0
) -> None:
    """Delete the least-recently-used cache files (oldest mtime; reads touch
    it) until the cache is at most `size_limit_bytes * low_water`. The
    `thumbnail_cache` app.db table is unused: the file mtime already orders
    use without an index to keep in sync."""
    with _cache_lock:
        _evict_locked(cache_dir, size_limit_bytes, low_water, keep=None)


def _evict_locked(
    cache_dir: pathlib.Path,
    size_limit_bytes: int,
    low_water: float,
    *,
    keep: pathlib.Path | None,
) -> None:
    entries, total = _scan_cache(cache_dir)
    _cache_totals[cache_dir] = total
    _cache_scanned_at[cache_dir] = time.monotonic()
    if total <= size_limit_bytes:
        return
    target = int(size_limit_bytes * low_water)
    entries.sort(key=lambda entry: entry[0])
    for _, entry_size, path in entries:
        if total <= target:
            break
        if path == keep:
            continue
        try:
            path.unlink()
        except OSError:
            continue
        total -= entry_size
        _prune_empty_parents(path.parent, cache_dir)
    _cache_totals[cache_dir] = total


def _resolve_source(
    original: pathlib.Path,
    derivatives: Sequence[pathlib.Path],
    target_px: int,
    *,
    is_video: bool,
) -> pathlib.Path:
    """The file `_decode()` will actually read. For a video, a poster-image
    derivative (a pre-rendered JPEG frame) when one decodes cleanly,
    otherwise the video itself for ffmpeg. For a photo, the smallest
    sufficient derivative, falling back to the original -- or, when the
    original is missing and no derivative is big enough either, the
    largest derivative available. The result may not exist on disk --
    callers that need an existing file check that themselves."""
    if is_video:
        for candidate in derivatives:
            if candidate.suffix.lower() not in _POSTER_EXTENSIONS:
                continue
            try:
                with Image.open(candidate):
                    pass
            except (OSError, Image.DecompressionBombError):
                continue
            return candidate
        return original
    return _pick_source(original, derivatives, target_px)


def _pick_source(
    original: pathlib.Path, derivatives: Sequence[pathlib.Path], target_px: int
) -> pathlib.Path:
    """The first derivative whose longest edge covers `target_px`, probing
    each candidate at most once and stopping as soon as one is sufficient.
    Falls back to `original` when it exists, otherwise to the largest
    derivative seen (an "Optimize Mac Storage" asset with no local
    original keeps only derivatives); falls back to `original` either way
    when nothing else is usable, so `_decode()` raises a clean error."""
    largest: tuple[int, pathlib.Path] | None = None
    for candidate in derivatives:
        try:
            with Image.open(candidate) as probe:
                max_dim = max(probe.size)
        except (OSError, Image.DecompressionBombError):
            continue
        if max_dim >= target_px:
            return candidate
        if largest is None or max_dim > largest[0]:
            largest = (max_dim, candidate)
    if original.exists():
        return original
    if largest is not None:
        return largest[1]
    return original


def _decode(
    path: pathlib.Path, *, is_video: bool, target_px: int | None = None
) -> Image.Image:
    if sys.platform == "darwin":
        for tool in (_try_sips, _try_qlmanage):
            image = tool(path)
            if image is not None:
                return image
    if is_video and path.suffix.lower() not in _POSTER_EXTENSIONS:
        return _decode_video_still(path)
    if path.suffix.lower() in _RAW_EXTENSIONS:
        image = _try_rawpy(path)
        if image is not None:
            return image
        raise MediaBackendError(
            f"{path.name} is a RAW file and the optional rawpy decoder is not installed"
        )
    try:
        image = Image.open(path)
        if target_px is not None:
            # A no-op on formats that don't support it (the base `Image`
            # class's `draft()` does nothing); on JPEG, and on HEIC when
            # pillow-heif's opener implements it, this lets the decoder
            # produce an already-downscaled image instead of fully
            # decoding a 48MP original just to shrink it afterwards.
            image.draft("RGB", (target_px, target_px))
        image.load()
        return image
    except Image.DecompressionBombError as exc:
        raise MediaBackendError(
            f"{path.name} decoded to an unreasonably large image: {exc}"
        ) from exc
    except Exception as exc:
        raise MediaBackendError(f"No decoder could open {path.name}: {exc}") from exc


def _resize_and_encode(
    image: Image.Image, target_px: int, *, quality: int = DEFAULT_QUALITY
) -> GeneratedImage:
    with image:
        oriented = ImageOps.exif_transpose(image) or image
        if oriented.mode not in ("RGB", "L"):
            oriented = oriented.convert("RGB")
        oriented.thumbnail((target_px, target_px), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        try:
            oriented.save(buffer, format="WEBP", quality=quality, method=6)
            return GeneratedImage(data=buffer.getvalue(), content_type="image/webp")
        except Exception:  # noqa: BLE001 -- any WebP encoding failure falls back to JPEG
            buffer = io.BytesIO()
            oriented.save(buffer, format="JPEG", quality=quality)
            return GeneratedImage(data=buffer.getvalue(), content_type="image/jpeg")


def _run_tool(args: list[str]) -> bool:
    try:
        subprocess.run(
            args, check=True, capture_output=True, timeout=_SUBPROCESS_TIMEOUT_SECONDS
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return True


def _load_and_close(path: pathlib.Path) -> Image.Image:
    """Decode fully before the caller's `TemporaryDirectory` cleans the
    file up -- `Image.open` alone is lazy and only reads the header."""
    with Image.open(path) as image:
        image.load()
        return image.copy()


def _try_sips(path: pathlib.Path) -> Image.Image | None:
    if shutil.which("sips") is None:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / "out.jpg"
        if not _run_tool(
            ["sips", "-s", "format", "jpeg", str(path), "--out", str(out)]
        ):
            return None
        if not out.exists():
            return None
        try:
            return _load_and_close(out)
        except OSError:
            return None


def _try_qlmanage(path: pathlib.Path) -> Image.Image | None:
    if shutil.which("qlmanage") is None:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        if not _run_tool(
            ["qlmanage", "-t", "-s", str(SIZES["preview"]), "-o", tmp, str(path)]
        ):
            return None
        produced = pathlib.Path(tmp) / f"{path.name}.png"
        if not produced.exists():
            return None
        try:
            return _load_and_close(produced)
        except OSError:
            return None


def _decode_video_still(path: pathlib.Path) -> Image.Image:
    if shutil.which("ffmpeg") is None:
        raise MediaBackendError(
            f"No video decoder (ffmpeg not found on PATH) for {path.name}"
        )
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / "still.jpg"
        if not _run_tool(["ffmpeg", "-y", "-i", str(path), "-vframes", "1", str(out)]):
            raise MediaBackendError(
                f"ffmpeg could not extract a still frame from {path.name}"
            )
        if not out.exists():
            raise MediaBackendError(f"ffmpeg produced no output for {path.name}")
        try:
            return _load_and_close(out)
        except OSError as exc:
            raise MediaBackendError(
                f"ffmpeg's still frame for {path.name} was unreadable: {exc}"
            ) from exc


def _try_rawpy(path: pathlib.Path) -> Image.Image | None:
    try:
        import rawpy
    except ImportError:
        return None
    try:
        with rawpy.imread(str(path)) as raw:
            rgb = raw.postprocess()
    except Exception:  # noqa: BLE001 -- any rawpy failure means "try the next backend", not a crash
        return None
    return Image.fromarray(rgb)
