"""
History media files: what is accepted, and the photo copies everyone sees.

Owner decisions (2026-11-13):

* Photos are JPEG, PNG or WebP up to 20 MB; audio is MP3, M4A, WAV or FLAC
  and video MP4 or WebM, up to 55 MB (under the 60 MB every nginx
  configuration and the request-size middleware allow).
* TIFF is refused, as it is everywhere else on the platform: a complex format
  with a history of decoder vulnerabilities. Scans are converted to JPEG or
  PNG before upload.
* The original is stored exactly as received, encrypted like every stored
  file, and only ``history.manage`` downloads it.
* Every photo anyone else sees is a re-encoded WebP copy, turned upright from
  the camera's orientation and with its location and camera data stripped.
* Audio and video get the same treatment through ffmpeg: members hear and
  see a copy whose streams are copied unchanged (no re-encoding) with every
  global and per-stream tag, chapter, subtitle and data track dropped, so a
  phone's recording location does not reach them. A video also gets a poster
  frame for its thumbnail, and both record their length.
* Without ffmpeg (a bare host that skipped the package) an audio or video
  upload is refused, never stored unstripped. Photos still work.
"""

import io
import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Optional

from PIL import Image, ImageOps, UnidentifiedImageError

from app.models.history import MediaKind
from app.services.file_storage_service import FileRules

MB = 1024 * 1024
PHOTO_MAX_BYTES = 20 * MB
AV_MAX_BYTES = 55 * MB

#: The same ceiling ``app.utils.image_processing`` applies: a 20 MB file can
#: still declare a decompression bomb's worth of pixels.
MAX_PIXELS = 25_000_000

DISPLAY_MAX = (2048, 2048)
THUMBNAIL_MAX = (400, 400)
_WEBP_QUALITY = 85

_PHOTO_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
_AUDIO_TYPES = {
    "audio/mpeg": ".mp3",
    "audio/x-m4a": ".m4a",
    "audio/mp4": ".m4a",
    "audio/x-wav": ".wav",
    "audio/wav": ".wav",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
}
_VIDEO_TYPES = {"video/mp4": ".mp4", "video/webm": ".webm"}

_PHOTO_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".webp"})
_AUDIO_EXTENSIONS = frozenset({".mp3", ".m4a", ".wav", ".flac"})
_VIDEO_EXTENSIONS = frozenset({".mp4", ".webm"})

PHOTO_RULES = FileRules(
    allowed_types=_PHOTO_TYPES,
    max_bytes=PHOTO_MAX_BYTES,
    description="JPEG, PNG or WebP",
    keep_consistent_extension=True,
    allowed_extensions=_PHOTO_EXTENSIONS,
)
AV_RULES = FileRules(
    allowed_types={**_AUDIO_TYPES, **_VIDEO_TYPES},
    max_bytes=AV_MAX_BYTES,
    description="MP3, M4A, WAV, FLAC, MP4 or WebM",
    keep_consistent_extension=True,
    allowed_extensions=_AUDIO_EXTENSIONS | _VIDEO_EXTENSIONS,
)

#: What the upload screen offers, and the largest file it lets through.
ACCEPTED_EXTENSIONS = _PHOTO_EXTENSIONS | _AUDIO_EXTENSIONS | _VIDEO_EXTENSIONS


def extension_of(filename: Optional[str]) -> str:
    return os.path.splitext(filename or "")[1].lower()


def rules_for(filename: Optional[str]) -> Optional[FileRules]:
    """The rules a file is held to, chosen by its name; None for a name the
    archive does not accept at all. The contents decide afterwards."""
    extension = extension_of(filename)
    if extension in _PHOTO_EXTENSIONS:
        return PHOTO_RULES
    if extension in _AUDIO_EXTENSIONS | _VIDEO_EXTENSIONS:
        return AV_RULES
    return None


def kind_for(mime_type: str, extension: str) -> MediaKind:
    """Photo, audio or video, from the detected type. An M4A some libmagic
    builds call video/mp4 is audio: the extension, already checked against
    the contents, says which."""
    if mime_type in _PHOTO_TYPES:
        return MediaKind.PHOTO
    if mime_type in _AUDIO_TYPES or extension in _AUDIO_EXTENSIONS:
        return MediaKind.AUDIO
    return MediaKind.VIDEO


@dataclass(frozen=True)
class PhotoCopies:
    display: bytes
    thumbnail: bytes
    width: int
    height: int


class UnreadableMedia(ValueError):
    """The file passed the type check but its contents could not be used."""


class UnreadableImage(UnreadableMedia):
    pass


class UnreadableRecording(UnreadableMedia):
    pass


class MediaToolMissing(RuntimeError):
    """ffmpeg is not installed, so audio and video cannot be stripped."""

    def __init__(self) -> None:
        super().__init__(
            "Audio and video uploads need ffmpeg, which is not installed on this "
            "server. Photos can still be uploaded."
        )


def _webp(image: Image.Image, bound: tuple[int, int]) -> bytes:
    copy = image.copy()
    copy.thumbnail(bound, Image.Resampling.LANCZOS)
    out = io.BytesIO()
    # exif=b"" and no icc_profile/xmp: nothing from the original's metadata
    # is written, whatever Pillow carried in ``info``.
    copy.save(out, format="WEBP", quality=_WEBP_QUALITY, method=4, exif=b"")
    return out.getvalue()


def make_photo_copies(content: bytes) -> PhotoCopies:
    """The viewing copy and thumbnail of an accepted photo.

    Blocking (Pillow): call through ``asyncio.to_thread``. Runs only on bytes
    that already passed the type check and the malware scan.
    """
    try:
        with Image.open(io.BytesIO(content)) as probe:
            width, height = probe.size
            if width * height > MAX_PIXELS:
                raise UnreadableImage(
                    f"The image is {width}×{height} pixels; the archive accepts up "
                    f"to {MAX_PIXELS // 1_000_000} million"
                )
            probe.verify()
        with Image.open(io.BytesIO(content)) as image:
            # First frame of an animated WebP.
            image.seek(0)
            upright = ImageOps.exif_transpose(image)
            if upright.mode not in ("RGB", "RGBA"):
                upright = upright.convert("RGBA" if "A" in upright.mode else "RGB")
            upright.info = {}
            return PhotoCopies(
                display=_webp(upright, DISPLAY_MAX),
                thumbnail=_webp(upright, THUMBNAIL_MAX),
                width=upright.width,
                height=upright.height,
            )
    except UnreadableImage:
        raise
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise UnreadableImage("This image could not be read") from exc
    except Image.DecompressionBombError as exc:
        raise UnreadableImage("The image is too large to read safely") from exc


# ----------------------------------------------------------------------
# Audio and video (ffmpeg)
# ----------------------------------------------------------------------

FFMPEG_TIMEOUT_SECONDS = 120

#: The demuxer for each accepted extension. Forcing it (rather than letting
#: ffmpeg probe) is a safety invariant: a probed file can be read as a playlist
#: or concat script (the HLS-in-AVI class of local file disclosure), and
#: neither demuxer is reachable when the format is named. Together with
#: ``-protocol_whitelist file`` and a private working directory, ffmpeg can
#: read nothing but the one file written for it.
_DEMUXERS = {
    ".mp3": "mp3",
    ".m4a": "mov",
    ".mp4": "mov",
    ".wav": "wav",
    ".flac": "flac",
    ".webm": "matroska",
}

_POSTER_AT_SECONDS = 1.0


@dataclass(frozen=True)
class AvCopies:
    cleaned: bytes
    poster: Optional[bytes]
    duration_seconds: Optional[int]
    width: Optional[int]
    height: Optional[int]


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _run(args: list[str], cwd: str) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(
            args,
            cwd=cwd,
            capture_output=True,
            timeout=FFMPEG_TIMEOUT_SECONDS,
            check=False,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired as exc:
        raise UnreadableRecording("This recording took too long to read") from exc


def _input_args(extension: str) -> list[str]:
    return ["-protocol_whitelist", "file", "-f", _DEMUXERS[extension], "-i"]


def _probe(workdir: str, source: str, extension: str) -> dict:
    result = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            *_input_args(extension),
            source,
        ],
        workdir,
    )
    if result.returncode != 0:
        raise UnreadableRecording("This recording could not be read")
    try:
        parsed = json.loads(result.stdout or b"{}")
    except ValueError as exc:
        raise UnreadableRecording("This recording could not be read") from exc
    return parsed if isinstance(parsed, dict) else {}


def _duration(probe: dict) -> Optional[int]:
    # ffprobe reports the duration as a decimal string, or leaves it out of a
    # stream it cannot time.
    raw = (probe.get("format") or {}).get("duration")
    if not isinstance(raw, (str, int, float)):
        return None
    try:
        seconds = float(raw)
    except ValueError:
        return None
    return round(seconds) if seconds >= 0 else None


def make_av_copies(content: bytes, extension: str, kind: MediaKind) -> AvCopies:
    """The members' copy of an accepted recording, its poster frame (video
    only, best effort) and its length.

    Blocking (subprocess): call through ``asyncio.to_thread``. Runs only on
    bytes that already passed the type check and the malware scan.
    """
    if extension not in _DEMUXERS or kind == MediaKind.PHOTO:
        raise UnreadableRecording("This file is not a recording the archive accepts")
    if not ffmpeg_available():
        raise MediaToolMissing()
    with tempfile.TemporaryDirectory(prefix="history-av-") as workdir:
        source = f"in{extension}"
        cleaned = f"out{extension}"
        with open(os.path.join(workdir, source), "wb") as handle:
            handle.write(content)
        probe = _probe(workdir, source, extension)
        streams = [s for s in probe.get("streams") or [] if isinstance(s, dict)]
        video = [s for s in streams if s.get("codec_type") == "video"]
        audio = [s for s in streams if s.get("codec_type") == "audio"]
        if kind == MediaKind.VIDEO and not video:
            raise UnreadableRecording("This video has no picture")
        if kind == MediaKind.AUDIO and not audio:
            raise UnreadableRecording("This recording has no sound")

        # Audio keeps only its sound: an MP3's embedded cover art is a video
        # stream and can be a photo with its own metadata.
        maps = (
            ["-map", "0:v", "-map", "0:a?"]
            if kind == MediaKind.VIDEO
            else ["-map", "0:a"]
        )
        extra = ["-movflags", "+faststart"] if _DEMUXERS[extension] == "mov" else []
        result = _run(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                *_input_args(extension),
                source,
                *maps,
                "-dn",
                "-sn",
                "-map_metadata",
                "-1",
                "-map_chapters",
                "-1",
                "-c",
                "copy",
                "-fflags",
                "+bitexact",
                "-flags:v",
                "+bitexact",
                "-flags:a",
                "+bitexact",
                *extra,
                cleaned,
            ],
            workdir,
        )
        cleaned_path = os.path.join(workdir, cleaned)
        if result.returncode != 0 or not os.path.exists(cleaned_path):
            raise UnreadableRecording("This recording could not be read")
        with open(cleaned_path, "rb") as handle:
            cleaned_bytes = handle.read()

        poster = None
        width = height = None
        duration = _duration(probe)
        if kind == MediaKind.VIDEO:
            first = video[0]
            width = first.get("width") if isinstance(first.get("width"), int) else None
            height = (
                first.get("height") if isinstance(first.get("height"), int) else None
            )
            poster = _poster(workdir, source, extension, duration)
        return AvCopies(
            cleaned=cleaned_bytes,
            poster=poster,
            duration_seconds=duration,
            width=width,
            height=height,
        )


def _poster(
    workdir: str, source: str, extension: str, duration: Optional[int]
) -> Optional[bytes]:
    """A thumbnail from an early frame, or None: a video without one shows the
    generic icon rather than failing the upload."""
    at = _POSTER_AT_SECONDS if duration is None or duration > 2 else 0.0
    frame = "poster.png"
    result = _run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-ss",
            str(at),
            *_input_args(extension),
            source,
            "-frames:v",
            "1",
            "-map_metadata",
            "-1",
            frame,
        ],
        workdir,
    )
    path = os.path.join(workdir, frame)
    if result.returncode != 0 or not os.path.exists(path):
        return None
    try:
        with Image.open(path) as image:
            image.load()
            if image.width * image.height > MAX_PIXELS:
                return None
            still = image.convert("RGB")
            still.info = {}
            return _webp(still, THUMBNAIL_MAX)
    except (UnidentifiedImageError, OSError, ValueError):
        return None
