"""History media files, without a database: what is accepted, the photo
copies everyone sees, the stripped copies of recordings, and the byte ranges
a player asks for.

The recording tests run the real ffmpeg, which the image and CI install
(``.github/scripts/install-system-deps.sh``): what is under test is what
ffmpeg actually writes, not what the code asks it for."""

import io
import json
import os
import subprocess
import tempfile

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


def _ffmpeg_made(extension: str, *inputs_and_options: str) -> bytes:
    """A small recording made by ffmpeg itself, carrying whatever metadata the
    options give it."""
    with tempfile.TemporaryDirectory() as workdir:
        target = os.path.join(workdir, f"made{extension}")
        subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", *inputs_and_options, target],
            check=True,
            timeout=60,
        )
        with open(target, "rb") as handle:
            return handle.read()


def _phone_video() -> bytes:
    """Three seconds of picture and sound, tagged the way a phone tags one."""
    return _ffmpeg_made(
        ".mp4",
        *("-f", "lavfi", "-i", "testsrc=size=320x240:rate=10"),
        *("-f", "lavfi", "-i", "sine=frequency=440"),
        *("-t", "3", "-c:v", "libx264", "-c:a", "aac"),
        *("-metadata", "location=+40.7128-074.0060/"),
        *("-metadata", "title=Kitchen table"),
        *("-metadata:s:a:0", "handler_name=PhoneMicrophone"),
        *("-movflags", "+use_metadata_tags"),
    )


def _tagged_mp3_with_cover() -> bytes:
    """An MP3 with ID3 tags and an embedded cover picture (a video stream)."""
    with tempfile.TemporaryDirectory() as workdir:
        cover = os.path.join(workdir, "cover.png")
        Image.new("RGB", (32, 32), "green").save(cover)
        return _ffmpeg_made(
            ".mp3",
            *("-f", "lavfi", "-i", "sine=frequency=330"),
            *("-i", cover),
            *("-t", "2", "-map", "0:a", "-map", "1:v", "-c:v", "png"),
            *("-disposition:v", "attached_pic"),
            *("-metadata", "artist=Chief Smith"),
            *("-metadata", "comment=Recorded at 12 Elm Street"),
        )


def _probe(content: bytes, extension: str) -> dict:
    with tempfile.TemporaryDirectory() as workdir:
        path = os.path.join(workdir, f"probe{extension}")
        with open(path, "wb") as handle:
            handle.write(content)
        result = subprocess.run(
            [
                "ffprobe",
                *("-v", "error", "-print_format", "json"),
                *("-show_format", "-show_streams", path),
            ],
            capture_output=True,
            check=True,
            timeout=60,
        )
        return json.loads(result.stdout)


#: Tags a muxer writes for itself; nothing in them came from the device.
_MUXER_TAGS = {
    "major_brand",
    "minor_version",
    "compatible_brands",
    "language",
    "handler_name",
    "vendor_id",
    "encoder",
}


def _foreign_tags(probe: dict) -> dict:
    tags = dict((probe.get("format") or {}).get("tags") or {})
    for stream in probe.get("streams") or []:
        tags.update(stream.get("tags") or {})
    found = {k: v for k, v in tags.items() if k.lower() not in _MUXER_TAGS}
    # A muxer names its own handlers; a device's own name must not survive.
    found.update(
        {
            k: v
            for k, v in tags.items()
            if k.lower() == "handler_name" and v not in ("SoundHandler", "VideoHandler")
        }
    )
    return found


class TestWhatIsAccepted:
    @pytest.mark.parametrize(
        ("name", "rules"),
        [
            ("photo.jpeg", media_files.PHOTO_RULES),
            # Refused like everywhere else on the platform (owner decision).
            ("scan.TIF", None),
            ("scan.tiff", None),
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
            ("image/png", ".png", MediaKind.PHOTO),
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

    def test_too_many_pixels_is_refused(self, monkeypatch):
        monkeypatch.setattr(media_files, "MAX_PIXELS", 100)
        out = io.BytesIO()
        Image.new("RGB", (20, 20)).save(out, "PNG")
        with pytest.raises(media_files.UnreadableImage, match="million"):
            media_files.make_photo_copies(out.getvalue())

    def test_a_broken_image_is_refused(self):
        with pytest.raises(media_files.UnreadableImage, match="could not be read"):
            media_files.make_photo_copies(b"\x89PNG\r\n\x1a\nnot really")


class TestRecordingCopies:
    def test_a_videos_copy_carries_no_location_or_device_tags(self):
        original = _phone_video()
        assert "location" in _probe(original, ".mp4")["format"]["tags"]

        copies = media_files.make_av_copies(original, ".mp4", MediaKind.VIDEO)

        probe = _probe(copies.cleaned, ".mp4")
        assert _foreign_tags(probe) == {}
        assert b"40.7128" not in copies.cleaned
        assert b"PhoneMicrophone" not in copies.cleaned
        # Copied, not re-encoded: both streams survive with their codecs.
        assert sorted(s["codec_name"] for s in probe["streams"]) == ["aac", "h264"]
        assert copies.duration_seconds == 3
        assert (copies.width, copies.height) == (320, 240)

    def test_a_video_gets_a_poster_with_no_metadata(self):
        copies = media_files.make_av_copies(_phone_video(), ".mp4", MediaKind.VIDEO)
        assert copies.poster is not None
        poster = Image.open(io.BytesIO(copies.poster))
        assert poster.format == "WEBP"
        assert max(poster.size) <= 400
        assert dict(poster.getexif()) == {}

    def test_audio_keeps_only_its_sound(self):
        original = _tagged_mp3_with_cover()
        assert any(
            s["codec_type"] == "video" for s in _probe(original, ".mp3")["streams"]
        )

        copies = media_files.make_av_copies(original, ".mp3", MediaKind.AUDIO)

        probe = _probe(copies.cleaned, ".mp3")
        assert [s["codec_type"] for s in probe["streams"]] == ["audio"]
        assert _foreign_tags(probe) == {}
        assert b"Chief Smith" not in copies.cleaned
        assert b"Elm Street" not in copies.cleaned
        assert copies.poster is None
        assert copies.duration_seconds == 2

    def test_a_recording_with_nothing_to_hear_is_refused(self):
        silent_video = _ffmpeg_made(
            ".mp4",
            *("-f", "lavfi", "-i", "testsrc=size=64x48:rate=5"),
            *("-t", "1", "-c:v", "libx264"),
        )
        with pytest.raises(media_files.UnreadableRecording, match="no sound"):
            media_files.make_av_copies(silent_video, ".mp4", MediaKind.AUDIO)

    def test_bytes_that_are_not_a_recording_are_refused(self):
        with pytest.raises(media_files.UnreadableRecording, match="could not be read"):
            media_files.make_av_copies(b"ID3 not really audio", ".mp3", MediaKind.AUDIO)

    def test_every_call_names_its_demuxer_and_reads_only_files(self, monkeypatch):
        """A probed input can be read as a playlist or concat script that
        points ffmpeg at another file on the server (the HLS local-file-
        disclosure class). Recent ffmpeg refuses that on its own; the forced
        demuxer and the protocol whitelist keep it refused on any build, so
        they are asserted on every call rather than left to ffmpeg's version."""
        calls = []
        real_run = media_files._run

        def recording_run(args, cwd):
            calls.append(args)
            return real_run(args, cwd)

        monkeypatch.setattr(media_files, "_run", recording_run)
        media_files.make_av_copies(_phone_video(), ".mp4", MediaKind.VIDEO)
        assert {args[0] for args in calls} == {"ffmpeg", "ffprobe"}
        for args in calls:
            at = args.index("-i")
            assert args[at - 2 : at] == ["-f", "mov"], args
            whitelist = args.index("-protocol_whitelist")
            assert args[whitelist + 1] == "file", args
            assert whitelist < at, args

    def test_a_playlist_named_like_a_recording_is_refused(self, tmp_path):
        secret = tmp_path / "secret.txt"
        secret.write_text("TOP SECRET")
        playlist = (
            "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1.0,\n"
            f"{secret}\n#EXT-X-ENDLIST\n"
        ).encode()
        with pytest.raises(media_files.UnreadableRecording):
            media_files.make_av_copies(playlist, ".mp3", MediaKind.AUDIO)

    def test_without_ffmpeg_nothing_is_attempted(self, monkeypatch):
        monkeypatch.setattr(media_files.shutil, "which", lambda name: None)
        assert media_files.ffmpeg_available() is False
        with pytest.raises(media_files.MediaToolMissing, match="ffmpeg"):
            media_files.make_av_copies(_phone_video(), ".mp4", MediaKind.VIDEO)


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
