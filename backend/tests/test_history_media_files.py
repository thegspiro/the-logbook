"""History media files, without a database: what is accepted, the photo
copies everyone sees, and the byte ranges a player asks for."""

import io

import pytest
from PIL import Image

from app.models.history import MediaKind
from app.services import file_storage_service as file_storage
from app.services import history_media_files as media_files

pytestmark = pytest.mark.unit


def _jpeg_with_metadata(size=(300, 100), orientation=6) -> bytes:
    image = Image.new("RGB", size, "red")
    exif = image.getexif()
    exif[0x0112] = orientation
    exif[0x010F] = "CameraMaker"
    exif[0x0110] = "CameraModel"
    exif[0x8825] = {1: "N", 2: (40.0, 1.0, 2.0), 3: "W", 4: (75.0, 1.0, 2.0)}
    out = io.BytesIO()
    image.save(out, "JPEG", exif=exif.tobytes())
    return out.getvalue()


class TestWhatIsAccepted:
    @pytest.mark.parametrize(
        ("name", "rules"),
        [
            ("scan.TIF", media_files.PHOTO_RULES),
            ("photo.jpeg", media_files.PHOTO_RULES),
            ("interview.m4a", media_files.AV_RULES),
            ("parade.webm", media_files.AV_RULES),
            ("letter.pdf", None),
            ("noextension", None),
        ],
    )
    def test_rules_follow_the_name(self, name, rules):
        assert media_files.rules_for(name) is rules

    def test_the_limits_are_the_owners(self):
        assert media_files.PHOTO_RULES.max_bytes == 20 * 1024 * 1024
        assert media_files.AV_RULES.max_bytes == 55 * 1024 * 1024

    @pytest.mark.parametrize(
        ("mime", "extension", "kind"),
        [
            ("image/tiff", ".tif", MediaKind.PHOTO),
            ("audio/mpeg", ".mp3", MediaKind.AUDIO),
            # Some libmagic builds call an M4A video/mp4.
            ("video/mp4", ".m4a", MediaKind.AUDIO),
            ("video/mp4", ".mp4", MediaKind.VIDEO),
            ("video/webm", ".webm", MediaKind.VIDEO),
        ],
    )
    def test_kind_is_read_from_the_contents(self, mime, extension, kind):
        assert media_files.kind_for(mime, extension) == kind


class TestPhotoCopies:
    def test_copies_are_upright_and_carry_no_location_or_camera(self):
        copies = media_files.make_photo_copies(_jpeg_with_metadata())
        for data in (copies.display, copies.thumbnail):
            image = Image.open(io.BytesIO(data))
            assert image.format == "WEBP"
            assert dict(image.getexif()) == {}
            assert "exif" not in image.info
        # Orientation 6 is "rotate 90°": the 300×100 sensor image stands up.
        assert (copies.width, copies.height) == (100, 300)

    def test_the_thumbnail_is_bounded(self):
        image = Image.new("RGB", (3000, 1500))
        out = io.BytesIO()
        image.save(out, "PNG")
        copies = media_files.make_photo_copies(out.getvalue())
        thumb = Image.open(io.BytesIO(copies.thumbnail))
        display = Image.open(io.BytesIO(copies.display))
        assert max(thumb.size) == 400
        assert max(display.size) == 2048

    def test_a_multi_page_tiff_shows_its_first_page(self):
        out = io.BytesIO()
        Image.new("RGB", (64, 32)).save(
            out, "TIFF", save_all=True, append_images=[Image.new("RGB", (8, 8))]
        )
        assert media_files.make_photo_copies(out.getvalue()).width == 64

    def test_too_many_pixels_is_refused(self, monkeypatch):
        monkeypatch.setattr(media_files, "MAX_PIXELS", 100)
        out = io.BytesIO()
        Image.new("RGB", (20, 20)).save(out, "PNG")
        with pytest.raises(media_files.UnreadableImage, match="million"):
            media_files.make_photo_copies(out.getvalue())

    def test_a_broken_image_is_refused(self):
        with pytest.raises(media_files.UnreadableImage, match="could not be read"):
            media_files.make_photo_copies(b"\x89PNG\r\n\x1a\nnot really")


class TestByteRanges:
    @pytest.mark.parametrize(
        ("header", "expected"),
        [
            (None, None),
            ("bytes=0-99", (0, 99)),
            ("bytes=100-", (100, 999)),
            ("bytes=-100", (900, 999)),
            ("bytes=900-5000", (900, 999)),
            ("bytes=0-0", (0, 0)),
            # Several ranges, another unit, or nonsense: the whole file.
            ("bytes=0-1,5-6", None),
            ("items=0-5", None),
            ("bytes=abc", None),
            ("bytes=9-3", None),
        ],
    )
    def test_a_range_is_read(self, header, expected):
        assert file_storage.parse_byte_range(header, 1000) == expected

    @pytest.mark.parametrize("header", ["bytes=1000-", "bytes=5000-6000", "bytes=-0"])
    def test_past_the_end_is_not_satisfiable(self, header):
        with pytest.raises(file_storage.RangeNotSatisfiable):
            file_storage.parse_byte_range(header, 1000)

    def test_a_slice_spans_chunk_boundaries(self):
        chunks = iter([b"abcd", b"efgh", b"ijkl"])
        assert b"".join(file_storage._slice(chunks, 2, 9)) == b"cdefghij"

    def test_a_slice_stops_reading_once_it_has_its_bytes(self):
        read = []

        def chunks():
            for chunk in (b"abcd", b"efgh", b"ijkl"):
                read.append(chunk)
                yield chunk

        assert b"".join(file_storage._slice(chunks(), 0, 1)) == b"ab"
        assert read == [b"abcd"]
