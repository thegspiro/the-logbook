"""HEIC photos filed with a waiver request are stored as JPEG.

Owner decision of 2026-11-26: a phone's HEIC photo is decoded with pi-heif
and stored as a JPEG, so the request page can show it and any browser can
open it. The decoding runs in a child process of its own, because libheif is
native code that a crafted file can crash. Pinned, without a database:

* a HEIC becomes a JPEG, upright: the fixtures are stored landscape with a
  90-degree rotation, red on the left, and must come out portrait with red on
  top;
* nothing of the photo's metadata survives: the EXIF (with its GPS block) and
  the XMP (with GPS coordinates) are gone; the colour profile is kept;
* a file that cannot be decoded is refused with a 400, never passed through,
  and that includes a file that crashes the decoder outright: the crash takes
  down the child, never this process;
* a photo with more pixels than the module's own cap is refused before it is
  decoded, and the cap takes an iPhone's default 24-megapixel photo and
  refuses a 48-megapixel one;
* the JPEG is brought under the size limit by one lower-quality attempt, and
  refused when that is not enough;
* the child runs no application code, gets a minimal environment, and runs
  one conversion at a time.

The fixtures were made once with pillow-heif 1.9.0, which is not a dependency
of this project. pillow-heif moves an EXIF orientation into the container's
rotation (``irot``) and drops the EXIF tag, so both files carry their
rotation the way libheif applies it and no EXIF orientation at all:

* ``oriented-gps.heic`` (894 bytes): a 32x16 image, left half red and right
  half blue, saved with EXIF orientation 6 and an EXIF GPS block
  (38°53'N 77°10'W);
* ``gps-xmp-icc.heic`` (1875 bytes): the same picture and EXIF, plus an XMP
  packet holding ``exif:GPSLatitude="38,53.0N"`` and
  ``exif:GPSLongitude="77,10.0W"``, and an sRGB ICC profile.

The three ``corrupt-*.heic`` files are ``oriented-gps.heic`` with one byte
changed, each found by an independent review:

* ``corrupt-segfault.heic``: offset 178, 0x69 -> 0xA3. ``pi_heif.open_heif``
  segfaults on it, which in-process took the whole backend down;
* ``corrupt-infe-v4.heic``: offset 147, 0x02 -> 0x04, an ``infe`` box version
  libheif does not support. It raised ``SyntaxError``, which escaped as a 500;
* ``corrupt-exif-header.heic``: offset 733, 0x4D -> 0x23, turning the EXIF
  ``MM`` byte order into ``M#``. It decoded, then Pillow's EXIF parser raised
  ``SyntaxError`` inside ``exif_transpose``. The EXIF is no longer parsed at
  all, so this one now converts.
"""

import ast
import asyncio
import io
import sys
from pathlib import Path

import pi_heif
import pytest
from PIL import Image

from app.core.error_codes import CodedHTTPException, ErrorCode
from app.utils import heic_to_jpeg as converter
from app.utils.heic_to_jpeg import MAX_PIXELS, heic_to_jpeg
from app.utils.mime_validation import detect_mime_type

pytestmark = pytest.mark.unit

FIXTURES = Path(__file__).parent / "fixtures" / "heic"
HEIC = (FIXTURES / "oriented-gps.heic").read_bytes()
WITH_XMP = (FIXTURES / "gps-xmp-icc.heic").read_bytes()
CORRUPT = {
    name: (FIXTURES / f"corrupt-{name}.heic").read_bytes()
    for name in ("segfault", "infe-v4", "exif-header")
}
# A stand-in worker's output: the smallest bytes that pass the JPEG check.
TINY_JPEG = "b'\\xff\\xd8\\xff\\xd9'"


def _corrupt_body() -> bytes:
    """The header and metadata intact, the picture itself overwritten."""
    start = HEIC.find(b"mdat") + 4
    return HEIC[:start] + b"\xff" * (len(HEIC) - start)


def _open(jpeg: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(jpeg))
    image.load()
    return image


def _assert_upright(jpeg: bytes) -> None:
    image = _open(jpeg).convert("RGB")
    assert image.size == (16, 32)
    top = image.getpixel((8, 4))
    bottom = image.getpixel((8, 27))
    assert top[0] > 200, top
    assert top[2] < 60, top
    assert bottom[2] > 200, bottom
    assert bottom[0] < 60, bottom


def _worker(tmp_path: Path, body: str) -> str:
    script = tmp_path / "worker.py"
    script.write_text(body, encoding="utf-8")
    return str(script)


def test_the_fixtures_are_what_a_phone_hands_over():
    assert detect_mime_type(HEIC) == "image/heic"
    assert detect_mime_type(WITH_XMP) == "image/heic"
    # The metadata tests below are only meaningful while the input has it.
    source = pi_heif.open_heif(io.BytesIO(WITH_XMP)).info
    assert b"GPSLatitude" in source["xmp"]
    assert source["icc_profile"]
    assert source["exif"]


async def test_a_heic_becomes_a_jpeg():
    jpeg = await heic_to_jpeg(HEIC)
    assert detect_mime_type(jpeg) == "image/jpeg"
    assert _open(jpeg).format == "JPEG"


@pytest.mark.parametrize("content", [HEIC, WITH_XMP], ids=["exif", "xmp-icc"])
async def test_the_photo_comes_out_upright(content):
    _assert_upright(await heic_to_jpeg(content))


async def test_no_location_or_other_metadata_is_kept():
    jpeg = await heic_to_jpeg(WITH_XMP)
    image = _open(jpeg)
    assert "exif" not in image.info
    assert len(image.getexif()) == 0
    assert "xmp" not in image.info
    # Neither segment, nor anything from inside them, is in the bytes.
    assert b"Exif\x00\x00" not in jpeg
    assert b"http://ns.adobe.com/xap/1.0/" not in jpeg
    for leaked in (b"GPSLatitude", b"GPSLongitude", b"38,53", b"77,10", b"TestMake"):
        assert leaked not in jpeg, leaked


async def test_the_colour_profile_is_kept():
    source = pi_heif.open_heif(io.BytesIO(WITH_XMP)).info["icc_profile"]
    assert _open(await heic_to_jpeg(WITH_XMP)).info.get("icc_profile") == source


@pytest.mark.parametrize(
    "content",
    [
        HEIC[: len(HEIC) // 2],
        HEIC[:100],
        _corrupt_body(),
        CORRUPT["segfault"],
        CORRUPT["infe-v4"],
    ],
    ids=[
        "truncated",
        "header-only",
        "corrupt-picture",
        "crashes-the-decoder",
        "unsupported-infe",
    ],
)
async def test_a_photo_that_cannot_be_read_is_refused(content):
    # libmagic still calls each of these HEIC, so the type check lets them in.
    assert detect_mime_type(content) == "image/heic"
    with pytest.raises(CodedHTTPException) as refused:
        await heic_to_jpeg(content)
    assert refused.value.status_code == 400
    assert refused.value.error_code == ErrorCode.UPLD_TYPE_NOT_ALLOWED
    assert "couldn't read this photo" in refused.value.detail
    assert "JPEG" in refused.value.detail


async def test_a_photo_with_broken_exif_converts_without_it():
    # The EXIF is discarded, so it is never parsed: a file whose EXIF header
    # is damaged is still a readable photo, and comes out upright and clean.
    jpeg = await heic_to_jpeg(CORRUPT["exif-header"])
    _assert_upright(jpeg)
    assert b"Exif\x00\x00" not in jpeg


async def test_this_process_survives_a_decoder_crash():
    with pytest.raises(CodedHTTPException):
        await heic_to_jpeg(CORRUPT["segfault"])
    # Still here, and still converting.
    _assert_upright(await heic_to_jpeg(HEIC))


def test_the_pixel_cap_takes_a_24_megapixel_photo_and_refuses_48():
    # Measured: the child's peak is about 193 MB at 24 MP and 360 MB at 48 MP,
    # against a backend container limited to 768 MB (384 MB minimal).
    assert 5712 * 4284 <= MAX_PIXELS < 8064 * 6048


async def test_a_photo_over_the_pixel_cap_is_refused():
    # 16 x 32 = 512 pixels; a cap below that stands in for a 9440 x 9440
    # bomb, which decodes to over 600 MB.
    with pytest.raises(CodedHTTPException) as refused:
        await heic_to_jpeg(HEIC, max_pixels=511)
    assert refused.value.status_code == 400
    assert "too large" in refused.value.detail
    assert "smaller copy" in refused.value.detail


async def test_the_cap_does_not_follow_pillows_global_limit(monkeypatch):
    # Other code in the same worker raises Image.MAX_IMAGE_PIXELS (the logo
    # validator doubles it); the conversion's cap must not move with it.
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", None)
    assert converter.MAX_PIXELS == MAX_PIXELS
    with pytest.raises(CodedHTTPException):
        await heic_to_jpeg(HEIC, max_pixels=511)


async def test_one_lower_quality_attempt_brings_it_under_the_limit():
    first = await heic_to_jpeg(HEIC)
    smaller = await heic_to_jpeg(HEIC, max_bytes=len(first) - 1)
    assert len(smaller) < len(first)
    _assert_upright(smaller)


async def test_a_photo_still_over_the_limit_is_refused():
    with pytest.raises(CodedHTTPException) as refused:
        await heic_to_jpeg(HEIC, max_bytes=64)
    assert refused.value.status_code == 400
    assert refused.value.error_code == ErrorCode.UPLD_TOO_LARGE
    assert "once converted to JPEG" in refused.value.detail


async def test_a_conversion_that_runs_too_long_is_stopped(tmp_path, monkeypatch):
    worker = _worker(tmp_path, "import time\ntime.sleep(30)\n")
    monkeypatch.setattr(converter, "WORKER", worker)
    with pytest.raises(CodedHTTPException) as refused:
        await heic_to_jpeg(HEIC, timeout=0.5)
    assert refused.value.status_code == 400


async def test_a_missing_decoder_is_a_503_not_the_members_fault(tmp_path, monkeypatch):
    worker = _worker(
        tmp_path, f"import sys\nsys.exit({converter.EXIT_DECODER_MISSING})\n"
    )
    monkeypatch.setattr(converter, "WORKER", worker)
    with pytest.raises(CodedHTTPException) as refused:
        await heic_to_jpeg(HEIC)
    assert refused.value.status_code == 503
    assert refused.value.error_code == ErrorCode.UPLD_VALIDATION_UNAVAILABLE


async def test_output_that_is_not_a_jpeg_is_refused(tmp_path, monkeypatch):
    worker = _worker(tmp_path, "import sys\nsys.stdout.buffer.write(b'not a jpeg')\n")
    monkeypatch.setattr(converter, "WORKER", worker)
    with pytest.raises(CodedHTTPException) as refused:
        await heic_to_jpeg(HEIC)
    assert refused.value.status_code == 400


async def test_the_child_gets_no_secrets_from_the_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PASSWORD", "not-a-real-secret")
    seen = tmp_path / "env.txt"
    worker = _worker(
        tmp_path,
        "import os, sys\n"
        f"open({str(seen)!r}, 'w').write(chr(10).join(sorted(os.environ)))\n"
        f"sys.stdout.buffer.write({TINY_JPEG})\n",
    )
    monkeypatch.setattr(converter, "WORKER", worker)
    await heic_to_jpeg(HEIC)
    names = set(seen.read_text().split())
    assert "DB_PASSWORD" not in names
    assert names <= {"PATH", "LANG", "LC_ALL", "LC_CTYPE", "MALLOC_ARENA_MAX"}


async def test_one_conversion_runs_at_a_time(tmp_path, monkeypatch):
    log = tmp_path / "log.txt"
    worker = _worker(
        tmp_path,
        "import sys, time\n"
        f"log = open({str(log)!r}, 'a')\n"
        "log.write('start ')\n"
        "log.flush()\n"
        "time.sleep(0.3)\n"
        "log.write('end ')\n"
        "log.flush()\n"
        f"sys.stdout.buffer.write({TINY_JPEG})\n",
    )
    monkeypatch.setattr(converter, "WORKER", worker)
    await asyncio.gather(heic_to_jpeg(HEIC), heic_to_jpeg(HEIC))
    assert log.read_text().split() == ["start", "end", "start", "end"]


def test_the_worker_runs_no_application_code():
    """The child parses hostile bytes. It imports nothing of ``app``, so a
    crash or a compromise there reaches none of the application's state."""
    source = Path(converter.WORKER).read_text(encoding="utf-8")
    imported = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            imported |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert "pi_heif" in imported
    assert imported - set(sys.stdlib_module_names) <= {"pi_heif", "PIL"}
