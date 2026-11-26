"""Turn a phone's HEIC photo into a JPEG with nothing of its metadata.

Owner decision of 2026-11-26: a HEIC photo filed with a waiver request is
stored as a JPEG, so the request page can show it and any browser can open
it. Decoding is done by pi-heif, the decode-only build of pillow-heif whose
wheels bundle libheif and libde265 under the LGPLv3. pillow-heif itself was
ruled out: its binary wheels include the x265 encoder and are GPLv2 as a
whole, which this MIT project cannot ship in its images.

What comes out:

* **Upright.** libheif applies the container's rotation and mirroring as it
  decodes, and pi-heif then resets the EXIF orientation to 1 so it is not
  applied twice. ``exif_transpose`` runs anyway, for a file whose EXIF still
  names an orientation the container does not carry.
* **No metadata at all.** An iPhone photo's EXIF holds where it was taken.
  The JPEG is written from the pixels with no EXIF and no XMP; only the
  colour profile is kept, since without it a Display P3 photo shifts colour.
* **Within the size the member was promised.** A photo that fit under the
  limit as HEIC can be larger as JPEG; quality steps down until it fits.

CPU-bound: a 12-megapixel photo takes a noticeable fraction of a second.
Call it through ``asyncio.to_thread``.
"""

import io
from typing import Optional

import pi_heif
from PIL import Image, ImageOps

from app.core.error_codes import CodedHTTPException, ErrorCode

#: Pillow's own default, used when something has set ``Image.MAX_IMAGE_PIXELS``
#: to None: switching off the global check must not switch off this one.
DEFAULT_MAX_PIXELS = 89_478_485

_QUALITIES = (85, 75, 65, 55)

UNREADABLE = (
    "We couldn't read this photo. Save it as a JPEG and try again "
    "(on an iPhone, choose Most Compatible under Settings, Camera, Formats)."
)


def _refuse(detail: str) -> CodedHTTPException:
    return CodedHTTPException(
        status_code=400,
        detail=detail,
        error_code=ErrorCode.UPLD_TYPE_NOT_ALLOWED,
    )


def heic_to_jpeg(content: bytes, max_bytes: Optional[int] = None) -> bytes:
    """The photo in *content* as JPEG bytes, or a 400 when it cannot be
    decoded, has more pixels than Pillow allows, or cannot be brought under
    *max_bytes*."""
    limit = Image.MAX_IMAGE_PIXELS or DEFAULT_MAX_PIXELS
    try:
        heif = pi_heif.open_heif(io.BytesIO(content))
        width, height = heif.size
    except (ValueError, EOFError, OSError, RuntimeError, IndexError):
        raise _refuse(UNREADABLE)
    # Checked on the declared size, before a single pixel is decoded:
    # ``to_pillow`` builds the image with ``frombytes``, which does not apply
    # Pillow's decompression-bomb check the way ``Image.open`` does.
    if width * height > limit:
        raise _refuse(
            "This photo is too large to accept. Save a smaller copy as a JPEG "
            "and try again."
        )
    try:
        decoded = heif.to_pillow()
        upright = ImageOps.exif_transpose(decoded)
        pixels = upright.convert("RGB")
    except (ValueError, EOFError, OSError, RuntimeError):
        raise _refuse(UNREADABLE)
    icc_profile = decoded.info.get("icc_profile")

    for quality in _QUALITIES:
        out = io.BytesIO()
        options: dict = {"format": "JPEG", "quality": quality, "optimize": True}
        if icc_profile:
            options["icc_profile"] = icc_profile
        # Nothing else is passed: Pillow writes EXIF and XMP to a JPEG only
        # when they are given to save(), so the photo's own are left behind.
        pixels.save(out, **options)
        jpeg = out.getvalue()
        if max_bytes is None or len(jpeg) <= max_bytes:
            return jpeg
    limit_mb = (max_bytes or 0) // (1024 * 1024)
    raise CodedHTTPException(
        status_code=400,
        detail=(
            f"This photo is over {limit_mb}MB once converted to JPEG. "
            "Save a smaller copy and try again."
        ),
        error_code=ErrorCode.UPLD_TOO_LARGE,
    )
