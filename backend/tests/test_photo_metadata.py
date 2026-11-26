"""JPEG and PNG photos lose their metadata, and none of their pixels.

Owner decision of 2026-11-26: a JPEG or PNG filed with a waiver request is
stored without its location or other metadata, and is not re-compressed.
Pinned, without a database:

* every fixture decodes to exactly the same pixels before and after;
* nothing of the GPS, XMP, IPTC, comments, thumbnails, MPF or trailer
  survives: the raw output is searched for each one's bytes;
* the colour profile, a CMYK file's Adobe segment and a minimal orientation
  are kept, so the photo still looks and stands as it did;
* a photo that already carries no metadata comes out unchanged;
* a file that cannot be walked is refused with a 400, and a few hundred
  one-byte mutations of each fixture give only a result or that 400, in
  bounded time.

The fixtures under ``fixtures/photo-metadata`` were written once by
``generate.py`` beside them, with Pillow and the standard library:

* ``everything.jpg`` (48x32, sRGB ICC): a JFIF APP0 carrying a 2x2
  thumbnail, a JFXX thumbnail, an EXIF APP1 with Orientation 6, a GPS IFD
  (38 deg 53' 21.17" N, 77 deg 10' 43.91" W) and an IFD1 JPEG thumbnail, an
  XMP APP1 with ``exif:GPSLatitude``/``GPSLongitude``, an extended-XMP APP1,
  a real MPF APP2 pointing at a second picture after EOI, a FlashPix APP2,
  APP13 IPTC naming a city, an APP15, a COM, and a Motion Photo trailer;
* ``progressive.jpg`` (40x24): progressive, EXIF with GPS and Orientation 6,
  and a COM and an APP13 between its first and second scans;
* ``cmyk-adobe.jpg`` (24x24): CMYK with Pillow's APP14 Adobe, and EXIF with
  GPS and Orientation 6;
* ``everything.png`` (24x16): iCCP, eXIf with GPS and Orientation 6, iTXt
  XMP with GPS, tEXt, zTXt, tIME, a private ``prVt`` chunk, and bytes after
  IEND.
"""

import io
import random
import struct
import time
import zlib
from pathlib import Path

import pytest
from PIL import Image, ImageCms

from app.core.error_codes import CodedHTTPException
from app.utils.mime_validation import detect_mime_type
from app.utils.photo_metadata import UNREADABLE, strip_photo_metadata

pytestmark = pytest.mark.unit

FIXTURES = Path(__file__).parent / "fixtures" / "photo-metadata"
JPEGS = ["everything.jpg", "progressive.jpg", "cmyk-adobe.jpg"]
ALL = JPEGS + ["everything.png"]

LATITUDE_SECONDS = (2117, 100)
LONGITUDE_SECONDS = (4391, 100)
#: Bytes that only the metadata carries.
JPEG_LEFTOVERS = [
    b"GPS",
    b"MARKER",
    b"Springfield",
    b"8BIM",
    b"Photoshop",
    b"http://ns.adobe.com",
    b"JFXX",
    b"MPF",
    b"FPXR",
    b"MotionPhoto",
    b"TestCam",
]
PNG_LEFTOVERS = [
    b"GPS",
    b"MARKER",
    b"XML:com.adobe.xmp",
    b"tEXt",
    b"zTXt",
    b"iTXt",
    b"tIME",
    b"prVt",
    b"TRAILER",
    b"TestCam",
]


def _fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def _mime(name: str) -> str:
    return "image/png" if name.endswith(".png") else "image/jpeg"


def _strip(name: str) -> bytes:
    return strip_photo_metadata(_fixture(name), _mime(name))


def _pixels(content: bytes) -> tuple:
    # Not the format: the original with an MPF segment opens as MPO.
    image = Image.open(io.BytesIO(content))
    return image.mode, image.size, image.tobytes()


def _rationals(pairs, endian: str) -> list[bytes]:
    return [struct.pack(endian + "II", *pair) for pair in pairs]


def _segments(jpeg: bytes) -> list[tuple[int, bytes]]:
    """The marker segments before the first SOS."""
    pos, out = 2, []
    while jpeg[pos + 1] != 0xDA:
        (length,) = struct.unpack_from(">H", jpeg, pos + 2)
        out.append((jpeg[pos + 1], jpeg[pos + 4 : pos + 2 + length]))
        pos += 2 + length
    return out


def _chunks(png: bytes) -> list[bytes]:
    pos, out = 8, []
    while pos < len(png):
        (length,) = struct.unpack_from(">I", png, pos)
        out.append(png[pos + 4 : pos + 8])
        pos += 12 + length
    return out


def _clean(fmt: str) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (16, 12), (10, 120, 200)).save(out, format=fmt)
    return out.getvalue()


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


class TestPixelsAreUnchanged:
    @pytest.mark.parametrize("name", ALL)
    def test_the_decoded_image_is_identical(self, name):
        original = _fixture(name)
        stripped = _strip(name)
        assert _pixels(stripped) == _pixels(original)
        assert len(stripped) < len(original)
        assert detect_mime_type(stripped) == _mime(name)

    @pytest.mark.parametrize("name", ["everything.jpg", "cmyk-adobe.jpg"])
    def test_the_compressed_scan_is_copied_byte_for_byte(self, name):
        original = _fixture(name)
        stripped = _strip(name)
        scan = stripped[stripped.index(b"\xff\xda") :]
        # The primary image's scan through its EOI; an embedded thumbnail
        # has scans of its own, so search rather than take the first.
        assert scan in original

    def test_the_progressive_scans_survive_without_what_sat_between_them(self):
        stripped = _strip("progressive.jpg")
        original = _fixture("progressive.jpg")
        assert stripped.count(b"\xff\xda") == original.count(b"\xff\xda") > 1
        assert b"BETWEEN-SCANS" not in stripped
        assert stripped.endswith(b"\xff\xd9")


class TestMetadataIsGone:
    @pytest.mark.parametrize("name", JPEGS)
    def test_nothing_of_a_jpegs_metadata_remains(self, name):
        stripped = _strip(name)
        for leftover in JPEG_LEFTOVERS:
            assert leftover not in stripped, leftover
        for endian in "<>":
            for packed in _rationals([LATITUDE_SECONDS, LONGITUDE_SECONDS], endian):
                assert packed not in stripped
        markers = [marker for marker, _ in _segments(stripped)]
        assert 0xFE not in markers
        assert not any(0xE3 <= m <= 0xED or m == 0xEF for m in markers)

    def test_the_thumbnails_and_the_second_picture_are_gone(self):
        original = _fixture("everything.jpg")
        stripped = _strip("everything.jpg")
        # One SOI and one EOI: no embedded JPEG, and nothing after the end.
        assert original.count(b"\xff\xd8\xff") > 1
        assert stripped.count(b"\xff\xd8") == 1
        assert stripped.endswith(b"\xff\xd9")
        jfif = [p for m, p in _segments(stripped) if m == 0xE0]
        assert len(jfif) == 1
        assert jfif[0].startswith(b"JFIF\x00")
        assert jfif[0][12:] == b"\x00\x00"
        assert len(jfif[0]) == 14
        assert getattr(Image.open(io.BytesIO(stripped)), "n_frames", 1) == 1

    def test_nothing_of_a_pngs_metadata_remains(self):
        stripped = _strip("everything.png")
        for leftover in PNG_LEFTOVERS:
            assert leftover not in stripped, leftover
        for packed in _rationals([LATITUDE_SECONDS, LONGITUDE_SECONDS], "<"):
            assert packed not in stripped
        assert stripped.endswith(_png_chunk(b"IEND", b""))
        assert _chunks(stripped) == [b"IHDR", b"eXIf", b"iCCP", b"IDAT", b"IEND"]


class TestWhatIsKept:
    @pytest.mark.parametrize("name", ALL)
    def test_the_orientation_alone_is_kept(self, name):
        exif = Image.open(io.BytesIO(_strip(name))).getexif()
        assert dict(exif) == {0x0112: 6}
        assert len(exif.get_ifd(0x8825)) == 0

    @pytest.mark.parametrize("name", ["everything.jpg", "everything.png"])
    def test_the_colour_profile_is_kept(self, name):
        original = Image.open(io.BytesIO(_fixture(name))).info["icc_profile"]
        kept = Image.open(io.BytesIO(_strip(name))).info["icc_profile"]
        assert kept == original
        ImageCms.ImageCmsProfile(io.BytesIO(kept))

    def test_a_cmyk_files_adobe_segment_is_kept(self):
        original = [p for m, p in _segments(_fixture("cmyk-adobe.jpg")) if m == 0xEE]
        kept = [p for m, p in _segments(_strip("cmyk-adobe.jpg")) if m == 0xEE]
        assert kept == original
        assert kept[0].startswith(b"Adobe")

    @pytest.mark.parametrize("fmt", ["JPEG", "PNG"])
    def test_a_photo_with_no_metadata_comes_out_unchanged(self, fmt):
        clean = _clean(fmt)
        assert strip_photo_metadata(clean, f"image/{fmt.lower()}") == clean

    def test_an_upright_orientation_is_not_written_back(self):
        out = io.BytesIO()
        exif = Image.Exif()
        exif[0x0112] = 1
        Image.new("RGB", (8, 8)).save(out, format="JPEG", exif=exif)
        stripped = strip_photo_metadata(out.getvalue(), "image/jpeg")
        assert b"Exif" not in stripped

    def test_a_broken_exif_means_no_orientation_not_a_refusal(self):
        jpeg = _clean("JPEG")
        tiff = b"MM\x00\x2a\xff\xff\xff\xff"  # IFD0 far past the end
        broken = (
            b"\xff\xe1" + struct.pack(">H", 2 + 6 + len(tiff)) + b"Exif\x00\x00" + tiff
        )
        stripped = strip_photo_metadata(jpeg[:2] + broken + jpeg[2:], "image/jpeg")
        assert stripped == jpeg


def _jpeg_without_sos() -> bytes:
    jpeg = _clean("JPEG")
    return jpeg[: jpeg.index(b"\xff\xda")] + b"\xff\xd9"


def _png_with_bad_crc() -> bytes:
    png = bytearray(_clean("PNG"))
    png[8 + 8 + 13] ^= 0xFF  # IHDR's CRC
    return bytes(png)


MALFORMED = [
    ("image/jpeg", b"not a jpeg at all"),
    ("image/jpeg", b"\xff\xd8"),
    ("image/jpeg", _clean("JPEG")[:200]),
    ("image/jpeg", _clean("JPEG")[:-2]),
    ("image/jpeg", _jpeg_without_sos()),
    # A segment length of 1, and one running past the end.
    ("image/jpeg", b"\xff\xd8\xff\xe1\x00\x01" + b"\x00" * 50),
    ("image/jpeg", b"\xff\xd8\xff\xe1\xff\xf0" + b"\x00" * 50),
    # SOS before any frame header.
    ("image/jpeg", b"\xff\xd8\xff\xda\x00\x02\x00\x00\xff\xd9"),
    # A reserved marker.
    ("image/jpeg", b"\xff\xd8\xff\x02\x00\x04\x00\x00" + _clean("JPEG")[2:]),
    ("image/png", b"\x89PNG\r\n\x1a\x0a"),
    ("image/png", b"\x89PNG\r\n\x1a\x00" + _clean("PNG")[8:]),
    ("image/png", _clean("PNG")[:-12]),
    ("image/png", _png_with_bad_crc()),
    ("image/png", _clean("PNG")[:8] + b"\xff\xff\xff\xffIHDR" + b"\x00" * 30),
    # The first chunk is not IHDR.
    (
        "image/png",
        _clean("PNG")[:8]
        + _png_chunk(b"gAMA", b"\x00\x00\xb1\x8f")
        + _clean("PNG")[8:],
    ),
]


def _outcome(content: bytes, mime: str) -> str:
    """ "stored" or "refused"; any other exception propagates and fails the
    test, which is the point."""
    try:
        result = strip_photo_metadata(content, mime)
    except CodedHTTPException as refused:
        return "refused" if refused.status_code == 400 else "other"
    if not isinstance(result, bytes) or len(result) > len(content):
        return "other"
    return "stored"


class TestUnreadableFilesAreRefused:
    @pytest.mark.parametrize(("mime", "content"), MALFORMED)
    def test_a_malformed_file_is_a_400(self, mime, content):
        with pytest.raises(CodedHTTPException) as refused:
            strip_photo_metadata(content, mime)
        assert refused.value.status_code == 400
        assert refused.value.detail == UNREADABLE

    @pytest.mark.parametrize("name", ALL)
    def test_one_byte_mutations_give_a_result_or_the_refusal(self, name):
        original = _fixture(name)
        rng = random.Random(name)
        started = time.monotonic()
        outcomes = {"stored": 0, "refused": 0}
        for _ in range(300):
            mutated = bytearray(original)
            mutated[rng.randrange(len(mutated))] = rng.randrange(256)
            outcome = _outcome(bytes(mutated), _mime(name))
            assert outcome in outcomes
            outcomes[outcome] += 1
        assert time.monotonic() - started < 10
        assert outcomes["refused"] > 0
        assert outcomes["stored"] > 0

    def test_a_long_run_of_fill_bytes_ends(self):
        jpeg = _clean("JPEG")
        flood = jpeg[:2] + b"\xff" * 1_000_000
        with pytest.raises(CodedHTTPException):
            strip_photo_metadata(flood, "image/jpeg")
        assert strip_photo_metadata(jpeg[:2] + b"\xff" * 1000 + jpeg[3:], "image/jpeg")

    def test_another_type_is_a_programming_error(self):
        with pytest.raises(ValueError, match="Not a JPEG or PNG"):
            strip_photo_metadata(b"%PDF-1.4", "application/pdf")
