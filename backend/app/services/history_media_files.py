"""
History media files: what is accepted, and the photo copies everyone sees.

Owner decisions (2026-11-13):

* Photos are JPEG, PNG, WebP or TIFF up to 20 MB; audio is MP3, M4A, WAV or
  FLAC and video MP4 or WebM, up to 55 MB (under the 60 MB every nginx
  configuration and the request-size middleware allow).
* The original is stored exactly as received, encrypted like every stored
  file, and only ``history.manage`` downloads it.
* Every photo anyone else sees is a re-encoded WebP copy, turned upright from
  the camera's orientation and with its location and camera data stripped.
* TIFF is accepted as an archival master despite the platform's general
  refusal of the format: it is decoded only here, on the server, under the
  pixel cap, and never handed to a browser. A multi-page TIFF shows its first
  page; every page stays in the original.
* Audio and video are served as uploaded. Stripping their metadata needs
  ffmpeg, which the owner chose not to add, so a phone recording may still
  carry where it was made; the screens say so.
"""

import io
import os
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
    "image/tiff": ".tif",
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

_PHOTO_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"})
_AUDIO_EXTENSIONS = frozenset({".mp3", ".m4a", ".wav", ".flac"})
_VIDEO_EXTENSIONS = frozenset({".mp4", ".webm"})

PHOTO_RULES = FileRules(
    allowed_types=_PHOTO_TYPES,
    max_bytes=PHOTO_MAX_BYTES,
    description="JPEG, PNG, WebP or TIFF",
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


class UnreadableImage(ValueError):
    pass


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
            # First frame of a multi-page TIFF or an animated WebP.
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
