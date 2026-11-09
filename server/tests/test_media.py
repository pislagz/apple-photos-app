"""P1.7: the media backend.

CI has no `sips`/`qlmanage` (Linux), so these tests exercise the Pillow +
pillow-heif fallback exclusively -- the acceptance criterion is that it
alone can turn the synthetic fixture's HEIC asset into a grid image.
"""

from __future__ import annotations

import io
import os
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
    key_before = media.cache_key(
        1, "asset-uuid", "grid", source_path, source_path.stat().st_mtime_ns, media.SIZES["grid"], media.DEFAULT_QUALITY
    )

    # A re-index that re-fetches a changed original touches its mtime; the
    # cache key must follow it rather than serving stale bytes keyed only by
    # the (re-indexed, no-longer-stable) `assets.id`.
    new_mtime_ns = source_path.stat().st_mtime_ns + 1_000_000_000
    os.utime(source_path, ns=(new_mtime_ns, new_mtime_ns))
    key_after = media.cache_key(
        1, "asset-uuid", "grid", source_path, source_path.stat().st_mtime_ns, media.SIZES["grid"], media.DEFAULT_QUALITY
    )

    assert key_before != key_after


def test_get_or_generate_cache_key_changes_with_quality(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    source_path = tmp_path / "plain.jpg"
    Image.new("RGB", (800, 600)).save(source_path, format="JPEG")
    mtime_ns = source_path.stat().st_mtime_ns

    key_default = media.cache_key(1, "asset-uuid", "grid", source_path, mtime_ns, media.SIZES["grid"], media.DEFAULT_QUALITY)
    key_other_quality = media.cache_key(1, "asset-uuid", "grid", source_path, mtime_ns, media.SIZES["grid"], 40)

    assert key_default != key_other_quality


def test_get_or_generate_cache_key_changes_with_source_path(tmp_path):
    # Two different files for the same asset_uuid (e.g. an edited render vs
    # the original, P1.17b) must not collide even if their mtimes coincide.
    original_path = tmp_path / "original.jpg"
    edited_path = tmp_path / "edited.jpg"
    original_path.touch()
    edited_path.touch()
    mtime_ns = original_path.stat().st_mtime_ns
    os.utime(edited_path, ns=(mtime_ns, mtime_ns))

    key_original = media.cache_key(1, "asset-uuid", "grid", original_path, mtime_ns, media.SIZES["grid"], media.DEFAULT_QUALITY)
    key_edited = media.cache_key(1, "asset-uuid", "grid", edited_path, mtime_ns, media.SIZES["grid"], media.DEFAULT_QUALITY)

    assert key_original != key_edited


def test_get_or_generate_with_missing_original_uses_a_sufficient_derivative(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    missing_original = tmp_path / "optimized_away.heic"
    derivative = tmp_path / "derivative.jpg"
    Image.new("RGB", (800, 600), color=(7, 8, 9)).save(derivative, format="JPEG")
    cache_dir = tmp_path / "cache"

    result = media.get_or_generate(
        cache_dir,
        library_id=1,
        asset_uuid="asset-uuid",
        size="grid",
        source_path=missing_original,
        derivatives=[derivative],
    )

    decoded = Image.open(io.BytesIO(result.data))
    assert max(decoded.size) <= media.SIZES["grid"]
    cached_files = [path for path in cache_dir.rglob("*") if path.is_file()]
    assert len(cached_files) == 1

    second = media.get_or_generate(
        cache_dir,
        library_id=1,
        asset_uuid="asset-uuid",
        size="grid",
        source_path=missing_original,
        derivatives=[derivative],
    )
    assert second.data == result.data
    assert [path for path in cache_dir.rglob("*") if path.is_file()] == cached_files


def test_get_or_generate_with_missing_original_and_no_derivative_raises_media_backend_error(tmp_path):
    missing_original = tmp_path / "optimized_away.heic"
    cache_dir = tmp_path / "cache"

    with pytest.raises(media.MediaBackendError, match="asset-uuid"):
        media.get_or_generate(
            cache_dir, library_id=1, asset_uuid="asset-uuid", size="grid", source_path=missing_original
        )

    assert not cache_dir.exists()


def test_pick_source_skips_a_decompression_bomb_derivative_and_falls_back_to_original(tmp_path, monkeypatch):
    monkeypatch.setattr(media.Image, "MAX_IMAGE_PIXELS", 10)
    original = tmp_path / "original.jpg"
    Image.new("RGB", (400, 300)).save(original, format="JPEG")
    bomb_derivative = tmp_path / "derivative_bomb.jpg"
    Image.new("RGB", (400, 300)).save(bomb_derivative, format="JPEG")

    picked = media._pick_source(original, [bomb_derivative], target_px=media.SIZES["grid"])

    assert picked == original


def test_generate_raises_a_clean_error_for_a_decompression_bomb_source(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    monkeypatch.setattr(media.Image, "MAX_IMAGE_PIXELS", 10)
    source_path = tmp_path / "plain.jpg"
    Image.new("RGB", (400, 300)).save(source_path, format="JPEG")

    with pytest.raises(media.MediaBackendError, match="large"):
        media.generate(source_path, "grid")


def test_video_poster_derivative_is_preferred_over_ffmpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    video_path = tmp_path / "IMG_0005.MOV"
    video_path.write_bytes(b"not a real video file")
    poster = tmp_path / "IMG_0005_poster.jpeg"
    Image.new("RGB", (800, 600), color=(9, 9, 9)).save(poster, format="JPEG")

    result = media.generate(video_path, "grid", derivatives=[poster], is_video=True)

    decoded = Image.open(io.BytesIO(result.data))
    assert max(decoded.size) <= media.SIZES["grid"]


def test_missing_original_falls_back_to_the_largest_insufficient_derivative(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    missing_original = tmp_path / "optimized_away.heic"
    smaller = tmp_path / "derivative_small.jpg"
    Image.new("RGB", (100, 80)).save(smaller, format="JPEG")
    larger = tmp_path / "derivative_larger.jpg"
    Image.new("RGB", (300, 200)).save(larger, format="JPEG")

    picked = media._pick_source(missing_original, [smaller, larger], target_px=media.SIZES["preview"])

    assert picked == larger


def test_write_cache_is_atomic_and_leaves_no_temp_files(tmp_path):
    cache_dir = tmp_path / "cache"

    media._write_cache(cache_dir, 1, "abcd-uuid", "deadbeef", "jpg", b"some bytes")

    files = list(cache_dir.rglob("*"))
    assert [path for path in files if path.is_file()] == [media._cache_file(cache_dir, 1, "abcd-uuid", "deadbeef", "jpg")]
    assert media._cache_file(cache_dir, 1, "abcd-uuid", "deadbeef", "jpg").read_bytes() == b"some bytes"


def test_evict_if_needed_removes_oldest_files_first(tmp_path):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    oldest = cache_dir / "oldest.jpg"
    newest = cache_dir / "newest.jpg"
    oldest.write_bytes(b"x" * 100)
    newest.write_bytes(b"y" * 100)
    os.utime(oldest, ns=(1_000_000_000, 1_000_000_000))
    os.utime(newest, ns=(2_000_000_000, 2_000_000_000))

    media._evict_if_needed(cache_dir, size_limit_bytes=150)

    assert not oldest.exists()
    assert newest.exists()


def test_get_or_generate_evicts_the_older_entry_when_over_the_cache_size_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    cache_dir = tmp_path / "cache"
    first_source = tmp_path / "first.jpg"
    Image.new("RGB", (800, 600), color=(1, 1, 1)).save(first_source, format="JPEG")
    second_source = tmp_path / "second.jpg"
    Image.new("RGB", (800, 600), color=(2, 2, 2)).save(second_source, format="JPEG")

    media.get_or_generate(cache_dir, library_id=1, asset_uuid="first", size="grid", source_path=first_source)
    first_cached = next(path for path in cache_dir.rglob("*") if path.is_file())
    one_entry_limit = first_cached.stat().st_size + 10

    media.get_or_generate(
        cache_dir,
        library_id=1,
        asset_uuid="second",
        size="grid",
        source_path=second_source,
        cache_size_limit_bytes=one_entry_limit,
    )

    cached_files = [path for path in cache_dir.rglob("*") if path.is_file()]
    assert len(cached_files) == 1
    assert not first_cached.exists()


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


def test_cache_limit_zero_neither_reads_nor_writes_the_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(media.shutil, "which", lambda _name: None)
    cache_dir = tmp_path / "cache"
    source = tmp_path / "a.jpg"
    Image.new("RGB", (800, 600), color=(1, 1, 1)).save(source, format="JPEG")

    result = media.get_or_generate(
        cache_dir, library_id=1, asset_uuid="a", size="grid", source_path=source, cache_size_limit_bytes=0
    )
    data = media.get_or_generate_jpeg(
        cache_dir, library_id=1, asset_uuid="a", source_path=source, cache_size_limit_bytes=0
    )

    assert result.data and data
    assert not cache_dir.exists() or not [p for p in cache_dir.rglob("*") if p.is_file()]
