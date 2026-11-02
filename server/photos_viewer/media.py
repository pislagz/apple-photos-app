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
and that id is not stable across a re-index.
"""

from __future__ import annotations

import dataclasses
import hashlib
import io
import pathlib
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Sequence

import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

# grid ~300, grid2x ~600, preview ~1600 (docs/SPEC.md, docs/TASKS.md P1.7).
SIZES: dict[str, int] = {"grid": 300, "grid2x": 600, "preview": 1600}

_RAW_EXTENSIONS = {".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".raf", ".dng", ".pef", ".srw"}

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
) -> GeneratedImage:
    """Decode `source_path` (or a sufficiently large derivative) and return
    WebP (or JPEG, if WebP encoding isn't available) bytes sized for `size`."""
    if size not in SIZES:
        raise ValueError(f"unknown size {size!r}; expected one of {sorted(SIZES)}")
    source_path = pathlib.Path(source_path)
    chosen = _resolve_source(source_path, [pathlib.Path(d) for d in derivatives], size, is_video=is_video)
    image = _decode(chosen, is_video=is_video)
    return _resize_and_encode(image, SIZES[size])


def cache_key(library_id: int, asset_uuid: str, size: str, source_mtime_ns: int) -> str:
    raw = f"{library_id}:{asset_uuid}:{size}:{source_mtime_ns}".encode()
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
) -> GeneratedImage:
    """Like `generate()`, but checks an on-disk cache under `cache_dir`
    first and writes a generated result back to it."""
    if size not in SIZES:
        raise ValueError(f"unknown size {size!r}; expected one of {sorted(SIZES)}")
    source_path = pathlib.Path(source_path)
    derivative_paths = [pathlib.Path(d) for d in derivatives]
    chosen = _resolve_source(source_path, derivative_paths, size, is_video=is_video)
    try:
        source_mtime_ns = chosen.stat().st_mtime_ns
    except OSError as exc:
        raise MediaBackendError(f"No usable original or derivative file for asset {asset_uuid}") from exc
    key = cache_key(library_id, asset_uuid, size, source_mtime_ns)
    cache_dir = pathlib.Path(cache_dir)
    cached = _read_cache(cache_dir, key)
    if cached is not None:
        return cached
    result = generate(source_path, size, derivatives=derivatives, is_video=is_video)
    _write_cache(cache_dir, key, result)
    return result


def _cache_file(cache_dir: pathlib.Path, key: str, extension: str) -> pathlib.Path:
    return cache_dir / key[:2] / f"{key}.{extension}"


def _read_cache(cache_dir: pathlib.Path, key: str) -> GeneratedImage | None:
    for content_type, extension in (("image/webp", "webp"), ("image/jpeg", "jpg")):
        path = _cache_file(cache_dir, key, extension)
        if path.exists():
            return GeneratedImage(data=path.read_bytes(), content_type=content_type)
    return None


def _write_cache(cache_dir: pathlib.Path, key: str, result: GeneratedImage) -> None:
    path = _cache_file(cache_dir, key, result.extension)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(result.data)


def _resolve_source(
    original: pathlib.Path, derivatives: Sequence[pathlib.Path], size: str, *, is_video: bool
) -> pathlib.Path:
    """The file `_decode()` will actually read: the original for video (no
    derivative selection there), otherwise the smallest sufficient
    derivative, falling back to the original. The result may not exist on
    disk -- callers that need an existing file check that themselves."""
    if is_video:
        return original
    return _pick_source(original, derivatives, SIZES[size])


def _pick_source(original: pathlib.Path, derivatives: Sequence[pathlib.Path], target_px: int) -> pathlib.Path:
    """The smallest derivative whose longest edge still covers `target_px`,
    so a grid thumbnail never has to decode a multi-megapixel original.
    Falls back to `original` when no derivative is large enough (or none
    exist, or none are readable)."""
    sufficient: list[tuple[int, pathlib.Path]] = []
    for candidate in derivatives:
        try:
            with Image.open(candidate) as probe:
                max_dim = max(probe.size)
        except OSError:
            continue
        if max_dim >= target_px:
            sufficient.append((max_dim, candidate))
    if not sufficient:
        return original
    sufficient.sort(key=lambda pair: pair[0])
    return sufficient[0][1]


def _decode(path: pathlib.Path, *, is_video: bool) -> Image.Image:
    if sys.platform == "darwin":
        for tool in (_try_sips, _try_qlmanage):
            image = tool(path)
            if image is not None:
                return image
    if is_video:
        return _decode_video_still(path)
    if path.suffix.lower() in _RAW_EXTENSIONS:
        image = _try_rawpy(path)
        if image is not None:
            return image
        raise MediaBackendError(f"{path.name} is a RAW file and the optional rawpy decoder is not installed")
    try:
        image = Image.open(path)
        image.load()
        return image
    except Exception as exc:
        raise MediaBackendError(f"No decoder could open {path.name}: {exc}") from exc


def _resize_and_encode(image: Image.Image, target_px: int) -> GeneratedImage:
    with image:
        oriented = ImageOps.exif_transpose(image) or image
        if oriented.mode not in ("RGB", "L"):
            oriented = oriented.convert("RGB")
        oriented.thumbnail((target_px, target_px), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        try:
            oriented.save(buffer, format="WEBP", quality=82, method=6)
            return GeneratedImage(data=buffer.getvalue(), content_type="image/webp")
        except Exception:  # noqa: BLE001 -- any WebP encoding failure falls back to JPEG
            buffer = io.BytesIO()
            oriented.save(buffer, format="JPEG", quality=85)
            return GeneratedImage(data=buffer.getvalue(), content_type="image/jpeg")


def _run_tool(args: list[str]) -> bool:
    try:
        subprocess.run(args, check=True, capture_output=True, timeout=_SUBPROCESS_TIMEOUT_SECONDS)
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
        if not _run_tool(["sips", "-s", "format", "jpeg", str(path), "--out", str(out)]):
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
        if not _run_tool(["qlmanage", "-t", "-s", str(SIZES["preview"]), "-o", tmp, str(path)]):
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
        raise MediaBackendError(f"No video decoder (ffmpeg not found on PATH) for {path.name}")
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / "still.jpg"
        if not _run_tool(["ffmpeg", "-y", "-i", str(path), "-vframes", "1", str(out)]):
            raise MediaBackendError(f"ffmpeg could not extract a still frame from {path.name}")
        if not out.exists():
            raise MediaBackendError(f"ffmpeg produced no output for {path.name}")
        try:
            return _load_and_close(out)
        except OSError as exc:
            raise MediaBackendError(f"ffmpeg's still frame for {path.name} was unreadable: {exc}") from exc


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
