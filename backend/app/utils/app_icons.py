"""Render a department's logo into the assets an installed web app shows.

A progressive web app takes its home-screen icon from the web app manifest at
install time, and iOS ignores the manifest entirely — it reads its icon and its
launch images from ``<link>`` tags in ``index.html``. Both are fixed URLs,
fetched by the browser's install machinery before anyone signs in, so the only
way a department's own logo can reach them is for the server to render it into
the exact geometries the manifest and ``index.html`` already declare.

Everything in this module is pure: it takes the stored logo string and returns
PNG bytes. The database lookup and the caching live in
``app.services.branding_service``.

Two composition rules here are platform constraints rather than taste:

* A **maskable** icon is cropped by Android to a circle, a squircle or a
  rounded square of the launcher's choosing. Only a circle of 80% diameter is
  guaranteed to survive, so the logo is fitted to the square inscribed in that
  circle. That looks smaller than the plain icon and is the point — a crest
  fitted edge to edge loses its corners on a round launcher.
* An **apple-touch icon** is composited onto black by iOS wherever it is
  transparent. A department crest drawn in dark ink on a transparent
  background therefore disappears, so this one variant gets an opaque plate
  even though the manifest icons keep their transparency.
"""

import base64
import math
import re
from dataclasses import dataclass
from io import BytesIO
from typing import Optional

from loguru import logger
from PIL import Image

# The stored logo is whatever a browser's FileReader produced. The settings
# screen caps its picker at 2 MB and onboarding runs its upload through
# ImageValidator, but this module reads the column rather than any one writer,
# so it enforces its own ceiling instead of trusting either.
MAX_LOGO_BYTES = 4 * 1024 * 1024

# Matches image_processing.MAX_INPUT_PIXELS. A small file can still decode to
# an enormous bitmap, which is the decompression-bomb shape.
MAX_LOGO_PIXELS = 25_000_000

# Raster formats Pillow can be trusted to decode. SVG is absent because Pillow
# cannot read it at all; listing the rest explicitly keeps a format nobody
# reviewed from becoming reachable when Pillow adds a plugin.
DECODABLE_FORMATS = frozenset({"PNG", "JPEG", "WEBP", "GIF", "BMP"})

_DATA_URI_PREFIX = re.compile(r"^data:image/[a-z0-9.+-]+;base64,", re.IGNORECASE)

# Diameter of a maskable icon's guaranteed-visible circle, as a fraction of the
# icon's width (w3c/manifest-app-info). The inscribed square is what a
# rectangular logo can occupy without any launcher clipping a corner.
MASKABLE_SAFE_FRACTION = 0.8 / math.sqrt(2)

# Opaque white behind a logo that would otherwise be transparent.
PLATE_COLOR = (255, 255, 255, 255)

# Matches the manifest's background_color and the splash images
# frontend/scripts/generate-pwa-assets.mjs produces, so a branded launch screen
# blends into first paint exactly as the shipped one does.
SPLASH_BACKGROUND = (15, 23, 42, 255)

# Also from generate-pwa-assets.mjs: the mark occupies 38% of the shortest edge,
# which keeps it clear of a notch, a home indicator and the rounded corners.
SPLASH_LOGO_FRACTION = 0.38


@dataclass(frozen=True)
class IconVariant:
    """One square icon the manifest or index.html asks for by URL."""

    size: int
    # Fraction of the canvas edge the logo may occupy.
    content_fraction: float
    # Composite onto opaque white rather than leaving the canvas transparent.
    plate: bool


ICON_VARIANTS: dict[str, IconVariant] = {
    "192": IconVariant(size=192, content_fraction=1.0, plate=False),
    "512": IconVariant(size=512, content_fraction=1.0, plate=False),
    "maskable-512": IconVariant(
        size=512, content_fraction=MASKABLE_SAFE_FRACTION, plate=True
    ),
    # 0.88 rather than the full canvas: iOS rounds the corners of this icon,
    # and a crest drawn to the edge loses its outline to that radius.
    "apple-touch": IconVariant(size=180, content_fraction=0.88, plate=True),
}

# Device pixel geometries of the apple-touch-startup-image links in
# frontend/index.html. iOS has no scaling fallback — a launch image is used only
# by a device whose geometry matches exactly — so rendering an arbitrary
# requested size would burn CPU on an image no device will ever ask for again.
# test_branded_pwa_assets.py holds this set against index.html.
SPLASH_GEOMETRIES: frozenset[tuple[int, int]] = frozenset(
    {
        (640, 1136),
        (750, 1334),
        (828, 1792),
        (1170, 2532),
        (1179, 2556),
        (1206, 2622),
        (1242, 2208),
        (1284, 2778),
        (1290, 2796),
        (1320, 2868),
        (1536, 2048),
        (1620, 2160),
        (1640, 2360),
        (2048, 2732),
    }
)


def decode_logo(stored: Optional[str]) -> Optional[Image.Image]:
    """Decode ``Organization.logo`` into an RGBA image, or ``None``.

    Returns ``None`` — never raises — for every shape this cannot render, so a
    department with an unusable logo falls back to the shipped icons instead of
    serving a 500 to a browser that is trying to install the app.

    Only ``data:`` URIs are read. The column also accepts an external URL, and
    fetching one here would turn an unauthenticated asset request into a
    server-side request to an attacker-chosen host (SSRF); such a logo falls
    back to the shipped icons as well.
    """
    if not stored:
        return None

    match = _DATA_URI_PREFIX.match(stored)
    if not match:
        return None

    encoded = stored[match.end() :]
    # 4 base64 characters per 3 bytes: reject an oversized payload before
    # allocating the decoded copy of it.
    if len(encoded) > (MAX_LOGO_BYTES // 3 + 1) * 4:
        logger.warning("Branded app icon: stored logo exceeds {} bytes", MAX_LOGO_BYTES)
        return None

    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception:
        logger.warning("Branded app icon: stored logo is not valid base64")
        return None

    if not raw or len(raw) > MAX_LOGO_BYTES:
        return None

    try:
        # verify() leaves the instance unusable, so the image is opened twice:
        # once to prove it parses, once to actually read the pixels.
        probe = Image.open(BytesIO(raw))
        image_format = probe.format
        if image_format not in DECODABLE_FORMATS:
            logger.warning("Branded app icon: unsupported logo format {}", image_format)
            return None
        if probe.width * probe.height > MAX_LOGO_PIXELS:
            logger.warning(
                "Branded app icon: logo is {}x{} pixels; limit is {}",
                probe.width,
                probe.height,
                MAX_LOGO_PIXELS,
            )
            return None
        probe.verify()

        logo = Image.open(BytesIO(raw))
        logo.load()
        return logo.convert("RGBA")
    except Exception as exc:
        logger.warning("Branded app icon: stored logo could not be decoded: {}", exc)
        return None


def render_icon(logo: Image.Image, variant: IconVariant) -> bytes:
    """Render *logo* as the square PNG *variant* describes."""
    box = max(1, int(round(variant.size * variant.content_fraction)))
    background = PLATE_COLOR if variant.plate else (0, 0, 0, 0)
    return _compose(logo, (variant.size, variant.size), box, background)


def render_splash(logo: Image.Image, width: int, height: int) -> bytes:
    """Render *logo* as an iOS launch image of *width* x *height* device pixels."""
    box = max(1, int(round(min(width, height) * SPLASH_LOGO_FRACTION)))
    return _compose(logo, (width, height), box, SPLASH_BACKGROUND)


def _compose(
    logo: Image.Image,
    canvas_size: tuple[int, int],
    box: int,
    background: tuple[int, int, int, int],
) -> bytes:
    """Centre *logo*, scaled to fit a *box* square, on a *canvas_size* canvas."""
    scaled = logo.copy()
    # thumbnail() only shrinks, so a logo smaller than the box is enlarged
    # explicitly rather than being left as a postage stamp in the corner.
    if max(scaled.size) > box:
        scaled.thumbnail((box, box), Image.LANCZOS)
    else:
        ratio = box / max(scaled.size)
        scaled = scaled.resize(
            (
                max(1, int(round(scaled.width * ratio))),
                max(1, int(round(scaled.height * ratio))),
            ),
            Image.LANCZOS,
        )

    canvas = Image.new("RGBA", canvas_size, background)
    canvas.alpha_composite(
        scaled,
        (
            (canvas_size[0] - scaled.width) // 2,
            (canvas_size[1] - scaled.height) // 2,
        ),
    )

    output = BytesIO()
    canvas.save(output, format="PNG", optimize=True)
    return output.getvalue()


def parse_splash_geometry(geometry: str) -> Optional[tuple[int, int]]:
    """Parse a ``<width>-<height>`` path segment into a declared geometry."""
    parts = geometry.split("-")
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        return None
    size = (int(parts[0]), int(parts[1]))
    return size if size in SPLASH_GEOMETRIES else None
