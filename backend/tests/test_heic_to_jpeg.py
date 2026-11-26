"""HEIC photos filed with a waiver request are stored as JPEG.

Owner decision of 2026-11-26: a phone's HEIC photo is decoded with pi-heif
and stored as a JPEG, so the request page can show it and every browser can
open it. Pinned, without a database:

* a HEIC becomes a JPEG, upright: the fixture is stored landscape with a
  90-degree rotation, red on the left, and must come out portrait with red on
  top;
* nothing of the photo's metadata survives: the fixture carries a GPS block,
  and the JPEG has no EXIF and no XMP at all;
* a file that cannot be decoded is refused with a 400, never passed through;
* Pillow's decompression-bomb limit applies, so a photo larger than
  ``Image.MAX_IMAGE_PIXELS`` is refused before it is decoded.

``tests/fixtures/heic/oriented-gps.heic`` (894 bytes) was made once with
pillow-heif 1.9.0, which is not a dependency of this project: a 32x16 image,
left half red and right half blue, saved with EXIF orientation 6 and a GPS
block (38°53'N 77°10'W). pillow-heif turns the orientation into the
container's rotation and resets the EXIF tag to 1, as an iPhone's file
carries it.
"""

import io
from pathlib import Path

import pytest
from PIL import Image

from app.core.error_codes import CodedHTTPException, ErrorCode
from app.utils.heic_to_jpeg import heic_to_jpeg
from app.utils.mime_validation import detect_mime_type

pytestmark = pytest.mark.unit

FIXTURE = Path(__file__).parent / "fixtures" / "heic" / "oriented-gps.heic"
HEIC = FIXTURE.read_bytes()


def _corrupt_body() -> bytes:
    """The header and metadata intact, the picture itself overwritten."""
    start = HEIC.find(b"mdat") + 4
    return HEIC[:start] + b"\xff" * (len(HEIC) - start)


def _open(jpeg: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(jpeg))
    image.load()
    return image


def test_the_fixture_is_what_a_phone_hands_over():
    assert detect_mime_type(HEIC) == "image/heic"


def test_a_heic_becomes_a_jpeg():
    jpeg = heic_to_jpeg(HEIC)
    assert detect_mime_type(jpeg) == "image/jpeg"
    assert _open(jpeg).format == "JPEG"


def test_the_photo_comes_out_upright():
    image = _open(heic_to_jpeg(HEIC)).convert("RGB")
    assert image.size == (16, 32)
    top = image.getpixel((8, 4))
    bottom = image.getpixel((8, 27))
    assert top[0] > 200, top
    assert top[2] < 60, top
    assert bottom[2] > 200, bottom
    assert bottom[0] < 60, bottom


def test_no_location_or_other_metadata_is_kept():
    jpeg = heic_to_jpeg(HEIC)
    image = _open(jpeg)
    assert "exif" not in image.info
    assert len(image.getexif()) == 0
    assert "xmp" not in image.info
    # Belt and braces: neither an EXIF nor an XMP segment is in the bytes.
    assert b"Exif\x00\x00" not in jpeg
    assert b"http://ns.adobe.com/xap/1.0/" not in jpeg


@pytest.mark.parametrize(
    "content",
    [HEIC[: len(HEIC) // 2], HEIC[:100], _corrupt_body()],
    ids=["truncated", "header-only", "corrupt-picture"],
)
def test_a_photo_that_cannot_be_read_is_refused(content):
    # libmagic still calls each of these HEIC, so the type check lets them in.
    assert detect_mime_type(content) == "image/heic"
    with pytest.raises(CodedHTTPException) as refused:
        heic_to_jpeg(content)
    assert refused.value.status_code == 400
    assert refused.value.error_code == ErrorCode.UPLD_TYPE_NOT_ALLOWED
    assert "couldn't read this photo" in refused.value.detail
    assert "JPEG" in refused.value.detail


def test_a_photo_over_the_pixel_limit_is_refused(monkeypatch):
    # 16 x 32 = 512 pixels; a limit below that stands in for a 20 000 x 20 000
    # bomb, which would take seconds and gigabytes to build for real.
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 511)
    with pytest.raises(CodedHTTPException) as refused:
        heic_to_jpeg(HEIC)
    assert refused.value.status_code == 400
    assert "too large" in refused.value.detail
