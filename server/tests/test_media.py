"""P1.7: the media backend.

CI has no `sips`/`qlmanage` (Linux), so these tests exercise the Pillow +
pillow-heif fallback exclusively -- the acceptance criterion is that it
alone can turn the synthetic fixture's HEIC asset into a grid image.
"""

from __future__ import annotations

import io
import pathlib

import pytest
from PIL import Image

from photos_viewer import libraries, media
from tests.fixtures import build_closed_fixture_library, build_fixture_library


def _snapshot(package_path: pathlib.Path) -> dict:
    snapshot = {}
    for path in sorted(package_path.rglob("*")):
        rel = str(path.relative_to(package_path))
        stat = path.stat()
        snapshot[rel] = ("dir", stat.st_mtime_ns) if path.is_dir() else (stat.st_size, stat.st_mtime_ns)
    return snapshot


def test_generate_grid_image_from_fixture_heic_without_sips(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    package_path = build_fixture_library(tmp_path)
    with libraries.open_library_readonly(package_path) as opened:
        source_path = opened.db.photos()[0].path

    result = media.generate(source_path, "grid")

    assert result.content_type in ("image/webp", "image/jpeg")
    decoded = Image.open(io.BytesIO(result.data))
    assert decoded.format in ("WEBP", "JPEG")
    assert max(decoded.size) <= media.SIZES["grid"]


def test_generate_from_a_plain_jpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    source_path = tmp_path / "plain.jpg"
    Image.new("RGB", (800, 600), color=(10, 20, 30)).save(source_path, format="JPEG")

    result = media.generate(source_path, "grid2x")

    decoded = Image.open(io.BytesIO(result.data))
    assert max(decoded.size) == media.SIZES["grid2x"]


def test_derivative_preferred_when_large_enough(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    original = tmp_path / "original.jpg"
    Image.new("RGB", (4000, 3000), color=(1, 2, 3)).save(original, format="JPEG")
    small_derivative = tmp_path / "derivative_small.jpg"
    Image.new("RGB", (400, 300), color=(4, 5, 6)).save(small_derivative, format="JPEG")

    picked = media._pick_source(original, [small_derivative], target_px=media.SIZES["grid"])

    assert picked == small_derivative


def test_derivative_too_small_falls_back_to_original(tmp_path):
    original = tmp_path / "original.jpg"
    Image.new("RGB", (4000, 3000)).save(original, format="JPEG")
    tiny_derivative = tmp_path / "derivative_tiny.jpg"
    Image.new("RGB", (50, 40)).save(tiny_derivative, format="JPEG")

    picked = media._pick_source(original, [tiny_derivative], target_px=media.SIZES["preview"])

    assert picked == original


def test_missing_raw_decoder_raises_a_clear_error_without_crashing(tmp_path):
    raw_path = tmp_path / "IMG_0002.CR2"
    raw_path.write_bytes(b"not a real raw file")

    with pytest.raises(media.MediaBackendError, match="rawpy"):
        media.generate(raw_path, "grid")


def test_missing_video_decoder_raises_a_clear_error_without_crashing(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    video_path = tmp_path / "IMG_0003.MOV"
    video_path.write_bytes(b"not a real video file")

    with pytest.raises(media.MediaBackendError, match="ffmpeg"):
        media.generate(video_path, "grid", is_video=True)


def test_unreadable_image_raises_a_clear_error_without_crashing(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    bogus_path = tmp_path / "IMG_0004.HEIC"
    bogus_path.write_bytes(b"not an image at all")

    with pytest.raises(media.MediaBackendError):
        media.generate(bogus_path, "grid")


def test_get_or_generate_caches_under_the_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    source_path = tmp_path / "plain.jpg"
    Image.new("RGB", (800, 600)).save(source_path, format="JPEG")
    cache_dir = tmp_path / "cache"

    first = media.get_or_generate(
        cache_dir, library_id=1, asset_uuid="asset-uuid", size="grid", source_path=source_path
    )
    cached_files = list(cache_dir.rglob("*"))
    assert any(path.is_file() for path in cached_files)

    second = media.get_or_generate(
        cache_dir, library_id=1, asset_uuid="asset-uuid", size="grid", source_path=source_path
    )

    assert second.data == first.data
    assert second.content_type == first.content_type


def test_get_or_generate_cache_key_changes_with_source_mtime(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    source_path = tmp_path / "plain.jpg"
    Image.new("RGB", (800, 600)).save(source_path, format="JPEG")
    cache_dir = tmp_path / "cache"

    media.get_or_generate(cache_dir, library_id=1, asset_uuid="asset-uuid", size="grid", source_path=source_path)
    key_before = media.cache_key(1, "asset-uuid", "grid", source_path.stat().st_mtime_ns)

    # A re-index that re-fetches a changed original touches its mtime; the
    # cache key must follow it rather than serving stale bytes keyed only by
    # the (re-indexed, no-longer-stable) `assets.id`.
    new_mtime_ns = source_path.stat().st_mtime_ns + 1_000_000_000
    import os

    os.utime(source_path, ns=(new_mtime_ns, new_mtime_ns))
    key_after = media.cache_key(1, "asset-uuid", "grid", source_path.stat().st_mtime_ns)

    assert key_before != key_after


def test_generating_images_never_writes_inside_the_photoslibrary(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    package_path = build_closed_fixture_library(tmp_path)
    before = _snapshot(package_path)

    with libraries.open_library_readonly(package_path) as opened:
        source_path = opened.db.photos()[0].path
        media.generate(source_path, "grid")
        media.generate(source_path, "preview")

    after = _snapshot(package_path)
    assert before == after
