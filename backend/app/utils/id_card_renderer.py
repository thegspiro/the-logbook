"""
CR80 member ID card renderer.

Plastic ID card printers — Zebra ZC/ZXP, HID Fargo, Evolis, Magicard, Entrust
Datacard and the rest — do not share a command language the way label printers
share ZPL, but every one of them ships an operating-system driver that accepts
an ordinary print job at CR80 size (3.375 x 2.125 in, ISO/IEC 7810 ID-1). A PDF
whose page *is* one card is therefore the format that reaches all of them: the
officer opens it, picks the card printer, prints at 100% / actual size, and the
driver handles ribbon panels, duplexing and the rest.

One page per card side. When the back is requested, pages alternate front,
back, front, back — the order a duplex card printer consumes them in, and the
order someone flipping cards by hand on a single-sided printer needs too.

Everything is drawn in black on white. The most common ribbon in a fire
station's printer is monochrome (K), and a layout that leans on colour prints
as a grey smear on it; black-only prints identically on K and YMCKO ribbons.
"""

import base64
import binascii
import logging
from dataclasses import dataclass, field
from io import BytesIO
from typing import List, Optional, Tuple

from app.utils.label_renderer import (
    SYMBOLOGY_CODE128,
    SYMBOLOGY_QR,
    draw_qr,
    fit_code128,
    fit_qr_size,
    sanitize_barcode_value,
    validate_symbology,
)

logger = logging.getLogger(__name__)

# ISO/IEC 7810 ID-1, the size every card printer and every badge holder takes.
CR80_LONG_EDGE_INCH = 3.375
CR80_SHORT_EDGE_INCH = 2.125

ORIENTATION_LANDSCAPE = "landscape"
ORIENTATION_PORTRAIT = "portrait"
ORIENTATIONS = (ORIENTATION_LANDSCAPE, ORIENTATION_PORTRAIT)

SIDES_FRONT = "front"
SIDES_BOTH = "both"
SIDES = (SIDES_FRONT, SIDES_BOTH)

# Card printers that cannot print edge to edge leave roughly a millimetre and a
# half unprinted, and a badge holder's window covers about as much again.
_MARGIN_INCH = 0.1

# Badge photos are a 3:4 head-and-shoulders crop, the shape every badge holder
# window and every ID photo convention expects.
_PHOTO_ASPECT = 3 / 4

# Uploaded member photos are already capped at 512x512 by the upload endpoint;
# a logo is not. Bound the decode so a huge logo cannot stall a print job.
_MAX_IMAGE_PIXELS = 4096 * 4096


@dataclass
class IdCardDepartment:
    """What every card in one print job shares."""

    name: str
    logo: Optional[str] = None
    return_lines: List[str] = field(default_factory=list)


@dataclass
class IdCardSpec:
    """One member's card, already resolved to display-ready values."""

    name: str
    barcode_value: str
    title: Optional[str] = None
    station: Optional[str] = None
    member_number: Optional[str] = None
    member_since: Optional[str] = None
    photo: Optional[str] = None


def validate_orientation(orientation: str) -> str:
    if orientation not in ORIENTATIONS:
        raise ValueError(
            f"Unknown card orientation: {orientation}. "
            f"Supported: {', '.join(ORIENTATIONS)}"
        )
    return orientation


def validate_sides(sides: str) -> str:
    if sides not in SIDES:
        raise ValueError(
            f"Unknown card sides option: {sides}. Supported: {', '.join(SIDES)}"
        )
    return sides


def _decode_image(data_uri: Optional[str], crop_aspect: Optional[float] = None):
    """A stored data-URI image as a reportlab ``ImageReader``, or ``None``.

    Photos and logos live in the database as ``data:image/...;base64,`` strings.
    A card is still worth printing without its picture, so an image that will
    not decode — an SVG logo, a truncated upload — is logged and left off
    rather than failing the whole batch.
    """
    if not data_uri or not data_uri.startswith("data:image/") or "," not in data_uri:
        return None
    from PIL import Image, UnidentifiedImageError
    from reportlab.lib.utils import ImageReader

    try:
        raw = base64.b64decode(data_uri.split(",", 1)[1], validate=False)
        image = Image.open(BytesIO(raw))
        if image.width * image.height > _MAX_IMAGE_PIXELS:
            logger.warning("ID card image skipped: %sx%s", image.width, image.height)
            return None
        image.load()
    except (binascii.Error, UnidentifiedImageError, OSError, ValueError) as e:
        logger.warning("ID card image could not be decoded: %s", e)
        return None

    # Transparent logos would otherwise print their transparent pixels black.
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.split()[-1])
        image = background
    elif image.mode != "RGB":
        image = image.convert("RGB")

    if crop_aspect:
        width, height = image.size
        if width / height > crop_aspect:
            new_width = int(height * crop_aspect)
            left = (width - new_width) // 2
            image = image.crop((left, 0, left + new_width, height))
        else:
            new_height = int(width / crop_aspect)
            # Bias the crop upward: a head-and-shoulders photo cropped dead
            # centre loses the top of the head before it loses the chest.
            top = max(0, (height - new_height) // 4)
            image = image.crop((0, top, width, top + new_height))
    return ImageReader(image)


def _fit_font(
    c, text: str, font: str, max_size: float, min_size: float, width: float
) -> Tuple[str, float]:
    """The largest size in range at which *text* fits, truncating if none does."""
    size = max_size
    while size > min_size and c.stringWidth(text, font, size) > width:
        size -= 0.5
    if c.stringWidth(text, font, size) <= width:
        return text, size
    ellipsis = "…"
    while text and c.stringWidth(text + ellipsis, font, size) > width:
        text = text[:-1]
    return (text.rstrip() + ellipsis if text else ""), size


def _draw_line(c, text, font, max_size, min_size, x, y, width, centered=False):
    fitted, size = _fit_font(c, text, font, max_size, min_size, width)
    c.setFont(font, size)
    if centered:
        c.drawCentredString(x + width / 2, y, fitted)
    else:
        c.drawString(x, y, fitted)


def _draw_photo(c, photo, x, y, w, h):
    """The photo, or an empty frame to show where one belongs."""
    if photo is not None:
        c.drawImage(photo, x, y, width=w, height=h, preserveAspectRatio=False)
    c.setLineWidth(0.5)
    c.rect(x, y, w, h, stroke=1, fill=0)


def _draw_code128(c, value, x, y, width, bar_height, centered=True):
    """Bars with the human-readable value beneath, inside *width* from *x*."""
    from reportlab.graphics.barcode import code128
    from reportlab.lib.units import inch

    barcode = fit_code128(code128, value, 0.012 * inch, width, bar_height)
    bar_x = x + (width - barcode.width) / 2 if centered else x
    barcode.drawOn(c, bar_x, y + 7)
    c.setFont("Courier", 6)
    c.drawCentredString(bar_x + barcode.width / 2, y, value)


def _draw_qr_symbol(c, value, x, y, max_w, max_h):
    size = fit_qr_size(max_h, max_w)
    draw_qr(c, value, x + (max_w - size) / 2, y, size)
    return size


def _detail_lines(spec: IdCardSpec) -> List[Tuple[str, str, float]]:
    """(text, font, size) for the lines under the name, in display order."""
    lines: List[Tuple[str, str, float]] = []
    if spec.title:
        lines.append((spec.title, "Helvetica", 7.5))
    if spec.station:
        lines.append((spec.station, "Helvetica", 7))
    if spec.member_number:
        lines.append((f"No. {spec.member_number}", "Helvetica-Bold", 7))
    if spec.member_since:
        lines.append((f"Member since {spec.member_since}", "Helvetica", 6.5))
    return lines


def _draw_header(c, dept: IdCardDepartment, logo, x, top, width, centered):
    """Department logo and name across the top. Returns the y below it."""
    logo_size = 20 if not centered else 22
    if centered:
        if logo is not None:
            c.drawImage(
                logo,
                x + (width - logo_size) / 2,
                top - logo_size,
                width=logo_size,
                height=logo_size,
                preserveAspectRatio=True,
                anchor="c",
            )
            name_y = top - logo_size - 9
        else:
            name_y = top - 10
        _draw_line(c, dept.name, "Helvetica-Bold", 10, 6, x, name_y, width, True)
        rule_y = name_y - 5
    else:
        text_x = x
        if logo is not None:
            c.drawImage(
                logo,
                x,
                top - logo_size,
                width=logo_size,
                height=logo_size,
                preserveAspectRatio=True,
                anchor="c",
            )
            text_x = x + logo_size + 5
        name_y = top - logo_size / 2 - 3.5
        _draw_line(
            c, dept.name, "Helvetica-Bold", 10, 6, text_x, name_y, x + width - text_x
        )
        rule_y = top - logo_size - 3
    c.setLineWidth(0.75)
    c.line(x, rule_y, x + width, rule_y)
    return rule_y


def _front_landscape(c, spec, dept, logo, symbology, include_code, page_w, page_h):
    from reportlab.lib.units import inch

    m = _MARGIN_INCH * inch
    usable_w = page_w - 2 * m
    body_top = _draw_header(c, dept, logo, m, page_h - m, usable_w, False) - 4

    photo_w = 0.85 * inch
    photo_h = photo_w / _PHOTO_ASPECT
    _draw_photo(
        c,
        _decode_image(spec.photo, _PHOTO_ASPECT),
        m,
        body_top - photo_h,
        photo_w,
        photo_h,
    )

    text_x = m + photo_w + 8
    text_w = page_w - m - text_x
    y = body_top - 12
    _draw_line(c, spec.name, "Helvetica-Bold", 12, 7, text_x, y, text_w)
    y -= 12
    for text, font, size in _detail_lines(spec):
        _draw_line(c, text, font, size, 5.5, text_x, y, text_w)
        y -= size + 3

    if not include_code:
        return
    if symbology == SYMBOLOGY_QR:
        qr_box = min(0.65 * inch, y - m)
        _draw_qr_symbol(c, spec.barcode_value, page_w - m - qr_box, m, qr_box, qr_box)
    else:
        strip_top = body_top - photo_h - 3
        _draw_code128(c, spec.barcode_value, m, m, usable_w, max(10, strip_top - m - 8))


def _front_portrait(c, spec, dept, logo, symbology, include_code, page_w, page_h):
    from reportlab.lib.units import inch

    m = _MARGIN_INCH * inch
    usable_w = page_w - 2 * m
    body_top = _draw_header(c, dept, logo, m, page_h - m, usable_w, True) - 5

    photo_w = 1.0 * inch
    photo_h = photo_w / _PHOTO_ASPECT
    _draw_photo(
        c,
        _decode_image(spec.photo, _PHOTO_ASPECT),
        (page_w - photo_w) / 2,
        body_top - photo_h,
        photo_w,
        photo_h,
    )

    y = body_top - photo_h - 12
    _draw_line(c, spec.name, "Helvetica-Bold", 11, 7, m, y, usable_w, True)
    y -= 10
    for text, font, size in _detail_lines(spec):
        _draw_line(c, text, font, size, 5.5, m, y, usable_w, True)
        y -= size + 2.5

    if not include_code:
        return
    code_top = y + 3
    if symbology == SYMBOLOGY_QR:
        box = min(0.6 * inch, code_top - m)
        _draw_qr_symbol(c, spec.barcode_value, m, m, usable_w, box)
    else:
        _draw_code128(
            c, spec.barcode_value, m, m, usable_w, min(0.3 * inch, code_top - m - 8)
        )


def _wrap_return_lines(lines: List[str], width: float) -> List[Tuple[str, str]]:
    """Return-address lines wrapped to *width*, as (text, font) pairs.

    Wrapped rather than shrunk or truncated: an address that loses its last
    words is an address the card cannot be posted back to.
    """
    from reportlab.lib.utils import simpleSplit

    wrapped: List[Tuple[str, str]] = []
    for i, line in enumerate(lines):
        font = "Helvetica-Bold" if i == 0 else "Helvetica"
        for part in simpleSplit(line, font, _RETURN_FONT_SIZE, width) or [""]:
            wrapped.append((part, font))
    return wrapped


_RETURN_FONT_SIZE = 7
_RETURN_LEADING = 8.5


def _back(c, spec, dept, symbology, orientation, page_w, page_h):
    """The scannable code, large, and where to send a card somebody finds."""
    from reportlab.lib.units import inch

    m = _MARGIN_INCH * inch
    usable_w = page_w - 2 * m

    if symbology == SYMBOLOGY_QR and orientation == ORIENTATION_LANDSCAPE:
        box = page_h - 2 * m
        size = _draw_qr_symbol(c, spec.barcode_value, m, m, box, box)
        text_x = m + size + 8
        text_w = page_w - m - text_x
        lines = _wrap_return_lines(dept.return_lines, text_w)
        y = page_h / 2 + (len(lines) * _RETURN_LEADING) / 2 - _RETURN_FONT_SIZE
        for text, font in lines:
            c.setFont(font, _RETURN_FONT_SIZE)
            c.drawString(text_x, y, text)
            y -= _RETURN_LEADING
        return

    y = page_h - m - 8
    for text, font in _wrap_return_lines(dept.return_lines, usable_w):
        c.setFont(font, _RETURN_FONT_SIZE)
        c.drawCentredString(page_w / 2, y, text)
        y -= _RETURN_LEADING
    code_top = y - 2
    if symbology == SYMBOLOGY_QR:
        _draw_qr_symbol(c, spec.barcode_value, m, m, usable_w, code_top - m)
    else:
        _draw_code128(
            c, spec.barcode_value, m, m, usable_w, min(0.5 * inch, code_top - m - 8)
        )


def render_id_cards(
    cards: List[IdCardSpec],
    department: IdCardDepartment,
    orientation: str = ORIENTATION_LANDSCAPE,
    sides: str = SIDES_FRONT,
    symbology: str = SYMBOLOGY_CODE128,
) -> BytesIO:
    """Render *cards* to a CR80 PDF, one card side per page.

    Raises ValueError on an unknown option, an empty batch, or a code that
    cannot be encoded or does not fit, naming the member so the officer
    knows which record to fix.
    """
    from reportlab.lib.units import inch
    from reportlab.pdfgen import canvas

    validate_orientation(orientation)
    validate_sides(sides)
    validate_symbology(symbology)
    if not cards:
        raise ValueError("No members to print ID cards for")

    if orientation == ORIENTATION_LANDSCAPE:
        page_w, page_h = CR80_LONG_EDGE_INCH * inch, CR80_SHORT_EDGE_INCH * inch
        draw_front = _front_landscape
    else:
        page_w, page_h = CR80_SHORT_EDGE_INCH * inch, CR80_LONG_EDGE_INCH * inch
        draw_front = _front_portrait

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_w, page_h))
    c.setTitle("Member ID cards")
    logo = _decode_image(department.logo)
    include_back = sides == SIDES_BOTH

    for spec in cards:
        value = sanitize_barcode_value(spec.barcode_value)
        if not value:
            raise ValueError(f"{spec.name} has no code that can be printed on a card")
        spec = IdCardSpec(**{**spec.__dict__, "barcode_value": value})
        try:
            draw_front(
                c, spec, department, logo, symbology, not include_back, page_w, page_h
            )
            c.showPage()
            if include_back:
                _back(c, spec, department, symbology, orientation, page_w, page_h)
                c.showPage()
        except ValueError as e:
            raise ValueError(f"ID card for {spec.name}: {e}") from e

    c.save()
    buf.seek(0)
    return buf
