"""Unit tests for the pure helpers in indexer.py."""
import hashlib
import os
from datetime import datetime

from PIL import Image

import indexer


class _FakeTag:
    """exifread returns tag objects whose str() yields the value. Mimic that."""
    def __init__(self, value):
        self._v = value

    def __str__(self):
        return self._v


def test_parse_exif_date_uses_datetime_original_first():
    tags = {
        "EXIF DateTimeOriginal": _FakeTag("2024:05:01 12:30:45"),
        "Image DateTime": _FakeTag("2030:01:01 00:00:00"),
    }
    ts = indexer.parse_exif_date(tags)
    assert ts == datetime(2024, 5, 1, 12, 30, 45).timestamp()


def test_parse_exif_date_falls_back_to_image_datetime():
    tags = {"Image DateTime": _FakeTag("2024:05:01 12:30:45")}
    ts = indexer.parse_exif_date(tags)
    assert ts == datetime(2024, 5, 1, 12, 30, 45).timestamp()


def test_parse_exif_date_returns_zero_when_no_tags():
    assert indexer.parse_exif_date({}) == 0.0


def test_parse_exif_date_returns_zero_on_malformed_value():
    tags = {"EXIF DateTimeOriginal": _FakeTag("not-a-date")}
    assert indexer.parse_exif_date(tags) == 0.0


def test_thumbnail_sizes_contract():
    """Frontend strips and main view are coupled to these names — guard them."""
    assert indexer.THUMBNAIL_SIZES == {"strip": 256, "main": 1600}


def _make_jpeg(path, size, orientation_tag):
    """Write a tiny JPEG at `path` whose EXIF declares the given orientation.

    The image is a wide rectangle (size[0] > size[1]). When orientation=6
    (rotate 90 CW), a viewer that honors EXIF must show it as portrait.
    """
    img = Image.new("RGB", size, color=(255, 0, 0))
    exif = img.getexif()
    exif[0x0112] = orientation_tag  # 0x0112 = Orientation
    img.save(path, "JPEG", exif=exif)


def test_generate_thumbnails_applies_exif_orientation(tmp_path):
    src = tmp_path / "rotated.jpg"
    _make_jpeg(src, size=(400, 200), orientation_tag=6)  # rotate 90 CW → portrait
    content_hash = hashlib.sha256(src.read_bytes()).hexdigest()

    indexer.generate_thumbnails(str(src), content_hash, str(tmp_path))

    strip_path = tmp_path / indexer.THUMBNAIL_DIR / f"{content_hash}_strip.jpg"
    assert strip_path.exists()
    with Image.open(strip_path) as thumb:
        # After applying orientation 6, the image is taller than it is wide.
        assert thumb.height > thumb.width


def test_generate_thumbnails_skips_when_present_unless_forced(tmp_path):
    src = tmp_path / "img.jpg"
    _make_jpeg(src, size=(200, 200), orientation_tag=1)
    content_hash = hashlib.sha256(src.read_bytes()).hexdigest()

    assert indexer.generate_thumbnails(str(src), content_hash, str(tmp_path)) is True
    # Second call without force is a no-op (returns False)
    assert indexer.generate_thumbnails(str(src), content_hash, str(tmp_path)) is False
    # With force=True it regenerates and reports True again.
    strip_path = tmp_path / indexer.THUMBNAIL_DIR / f"{content_hash}_strip.jpg"
    first_mtime = strip_path.stat().st_mtime_ns
    os.utime(strip_path, ns=(first_mtime - 1_000_000_000, first_mtime - 1_000_000_000))
    indexer.generate_thumbnails(str(src), content_hash, str(tmp_path), force=True)
    assert strip_path.stat().st_mtime_ns > first_mtime - 1_000_000_000
