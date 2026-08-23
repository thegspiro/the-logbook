"""
Shared barcode-label renderer.

Module-neutral: it renders a list of :class:`LabelSpec` (a title, a resolved
barcode value, optional asset/serial subtitles and one extra info line) to a
print-ready PDF. Each domain (inventory, apparatus, members, ...) builds its
own specs from its own records, so the rendering/format logic lives in one
place. Supports Avery sheet layout and thermal/roll-fed label sizes (Dymo,
Rollo, generic), with auto-rotation for roll-fed printers.
"""

from dataclasses import dataclass, field
from io import BytesIO
from typing import Any, Dict, Optional

# 5 mil is the minimum X-dimension commonly readable by handheld scanners and
# one dot at 203 dpi thermal resolution — narrower cannot be printed at all.
# Public because the ZPL renderer sizes against the same physical floor; two
# copies of this number would be free to drift into disagreeing about which
# labels are printable.
MIN_BAR_WIDTH_INCH = 0.005

# Symbologies a label can carry. Code 128 is the default and what the scan
# lookup has always read; QR earns its place on small square stock, where a
# Code 128 long enough to hold an asset id does not physically fit (a 10-char
# value needs ~1.65" of width at a scannable module size).
SYMBOLOGY_CODE128 = "code128"
SYMBOLOGY_QR = "qr"
SYMBOLOGIES = (SYMBOLOGY_CODE128, SYMBOLOGY_QR)

# Error-correction level for QR. M recovers ~15% of the symbol, which is the
# usual trade for a label that will live on equipment that gets scuffed —
# without the size penalty H (~30%) costs on a small tag.
QR_ERROR_CORRECTION = "M"

# Below this the symbol stops being reliably readable by a phone camera.
MIN_QR_SIZE_INCH = 0.3

# Code 128 symbol geometry, in modules, using subset B (11 modules per
# character). Encoders auto-switch to subset C for digit pairs, which is
# *narrower* — so sizing against subset B never overflows a label, it only
# leaves a numeric barcode fractionally left of centre.
#
# This lives here rather than in a language renderer because it is a property
# of the symbology, not of ZPL or ESC/POS: both size their barcodes from it,
# and two copies would be free to disagree about which values fit.
_MODULES_PER_CHAR = 11
_MODULES_START_STOP = 11 + 13  # start (11) + stop pattern with terminator (13)
_MODULES_CHECKSUM = 11
_QUIET_ZONE_MODULES = 10  # per side, the Code 128 spec minimum


def code128_width_dots(value: str, module_dots: int) -> int:
    """Printed width of a Code 128 symbol, quiet zones included."""
    modules = (
        _MODULES_START_STOP
        + _MODULES_CHECKSUM
        + _MODULES_PER_CHAR * len(value)
        + 2 * _QUIET_ZONE_MODULES
    )
    return modules * module_dots


def validate_symbology(symbology: str) -> str:
    """Return *symbology* if supported, else raise ValueError."""
    if symbology not in SYMBOLOGIES:
        raise ValueError(
            f"Unknown barcode symbology: {symbology}. "
            f"Supported: {', '.join(SYMBOLOGIES)}"
        )
    return symbology


def _draw_qr(canvas_obj, value: str, x: float, y: float, size: float) -> None:
    """Draw a QR symbol with its lower-left corner at (x, y), *size* square.

    QrCodeWidget reports its own natural bounds, so the drawing is scaled to
    the requested square rather than the module count being guessed at.
    """
    from reportlab.graphics import renderPDF
    from reportlab.graphics.barcode import qr
    from reportlab.graphics.shapes import Drawing

    widget = qr.QrCodeWidget(value, barLevel=QR_ERROR_CORRECTION)
    bounds = widget.getBounds()
    natural_w = bounds[2] - bounds[0]
    natural_h = bounds[3] - bounds[1]
    drawing = Drawing(
        size, size, transform=[size / natural_w, 0, 0, size / natural_h, 0, 0]
    )
    drawing.add(widget)
    renderPDF.draw(drawing, canvas_obj, x, y)


def sanitize_barcode_value(raw: str) -> str:
    """Normalize a Code128 value without changing its identity.

    Returning an empty string for any non-ASCII input prevents a label from
    encoding only part of a stored identifier, which would not scan back to
    the originating record.
    """
    value = raw.strip()
    return value if value and all(ord(ch) < 128 for ch in value) else ""


def _fit_code128(
    code128, value: str, initial_width: float, max_width: float, bar_height: float
):
    """Build a barcode without shrinking modules below the scanner-safe floor.

    Quiet zones are pinned to the Code 128 spec minimum of 10 modules per
    side; reportlab's default is max(0.25", 10 modules), and a quarter inch
    per side consumes half of a 1x1" thermal label before any bars print.
    ``barcode.width`` therefore reflects the true printed footprint, so
    callers compare it against the label's usable width directly.
    """
    from reportlab.lib.units import inch

    minimum_width = MIN_BAR_WIDTH_INCH * inch

    def build(bar_width: float):
        return code128.Code128(
            value,
            barWidth=bar_width,
            barHeight=bar_height,
            quiet=1,
            lquiet=10 * bar_width,
            rquiet=10 * bar_width,
        )

    bar_width = max(initial_width, minimum_width)
    barcode = build(bar_width)
    while barcode.width > max_width and bar_width > minimum_width:
        bar_width = max(minimum_width, bar_width - 0.001 * inch)
        barcode = build(bar_width)
    if barcode.width > max_width:
        raise ValueError(
            f"Barcode value {value!r} is too long for the selected label size"
        )
    return barcode


def _fit_qr_size(available_height: float, available_width: float) -> float:
    """Largest square that fits the space left for the symbol.

    A QR version 2 symbol is 25 modules plus 4 modules of quiet zone per side;
    at the 10 mil module a phone camera needs, that is a hair over 0.3", which
    is the floor below which the symbol is refused rather than printed
    unreadably small.
    """
    from reportlab.lib.units import inch

    size = min(available_height, available_width)
    if size < MIN_QR_SIZE_INCH * inch:
        raise ValueError(
            "Label is too small for a QR code. Use a larger label, remove the "
            "extra info line, or switch to Code 128."
        )
    return size


# Supported label formats. ``type`` is "sheet" (Avery grid) or "thermal"
# (one label per page at the exact size). ``auto_rotate`` is the default for
# roll-fed printers that feed narrow-edge first.
LABEL_FORMATS: Dict[str, Dict[str, Any]] = {
    "letter": {
        "description": "Standard letter (8.5x11) - Avery 5160, 3x10 grid",
        "type": "sheet",
        "auto_rotate": False,
    },
    "dymo_30252": {
        "description": "Dymo 30252 Address Label (1.125 x 3.5 in)",
        "width": 3.5,
        "height": 1.125,
        "type": "thermal",
        "auto_rotate": False,
    },
    "dymo_30256": {
        "description": "Dymo 30256 Shipping Label (2.3125 x 4 in)",
        "width": 4.0,
        "height": 2.3125,
        "type": "thermal",
        "auto_rotate": False,
    },
    "dymo_30334": {
        "description": "Dymo 30334 Multi-Purpose Label (2.25 x 1.25 in)",
        "width": 2.25,
        "height": 1.25,
        "type": "thermal",
        "auto_rotate": False,
    },
    "dymo_30336": {
        "description": "Dymo 30336 Small Multipurpose Label (2.125 x 1 in)",
        "width": 2.125,
        "height": 1.0,
        "type": "thermal",
        "auto_rotate": False,
    },
    "rollo_4x6": {
        "description": "Rollo 4x6 Shipping Label (4 x 6 in)",
        "width": 4.0,
        "height": 6.0,
        "type": "thermal",
        "auto_rotate": True,
    },
    "rollo_2x1": {
        "description": "Rollo / Thermal 2x1 Label (2 x 1 in)",
        "width": 2.0,
        "height": 1.0,
        "type": "thermal",
        "auto_rotate": True,
    },
    # Zebra stock. Sizes overlap the Rollo entries on purpose: a preset is
    # picked by matching the box the labels came in, and a quartermaster
    # holding Zebra 2x1 stock should not have to know it is the same size as
    # a Rollo roll. These are also the sizes the ZPL path prints natively.
    "zebra_2x1": {
        "description": "Zebra 2x1 Asset Label (2 x 1 in)",
        "width": 2.0,
        "height": 1.0,
        "type": "thermal",
        "auto_rotate": True,
    },
    "zebra_3x1": {
        "description": "Zebra 3x1 Label (3 x 1 in)",
        "width": 3.0,
        "height": 1.0,
        "type": "thermal",
        "auto_rotate": True,
    },
    "zebra_4x2": {
        "description": "Zebra 4x2 Label (4 x 2 in)",
        "width": 4.0,
        "height": 2.0,
        "type": "thermal",
        "auto_rotate": True,
    },
    "zebra_4x6": {
        "description": "Zebra 4x6 Shipping Label (4 x 6 in)",
        "width": 4.0,
        "height": 6.0,
        "type": "thermal",
        "auto_rotate": True,
    },
    "thermal_1x1": {
        "description": "Thermal 1x1 Square Label (1 x 1 in)",
        "width": 1.0,
        "height": 1.0,
        "type": "thermal",
        "auto_rotate": True,
    },
}


def is_known_label_format(label_format: str) -> bool:
    return label_format == "custom" or label_format in LABEL_FORMATS


@dataclass
class LabelSpec:
    """One label to print, already resolved to display-ready values.

    ``barcode_value`` must be non-empty (callers resolve a fallback). ``extra``
    is a single pre-built info line (e.g. "Station 1 | PPE"). ``asset_tag`` and
    ``serial_number`` are shown as "Asset:"/"S/N:" sub-identifiers only when they
    differ from the barcode value.
    """

    name: str
    barcode_value: str
    asset_tag: Optional[str] = None
    serial_number: Optional[str] = None
    extra: Optional[str] = None
    meta: Dict[str, Any] = field(default_factory=dict)


def render_labels(
    specs: list,
    label_format: str = "letter",
    custom_width: Optional[float] = None,
    custom_height: Optional[float] = None,
    auto_rotate: Optional[bool] = None,
    symbology: str = SYMBOLOGY_CODE128,
) -> BytesIO:
    """Render label specs to a PDF for the given format.

    Raises ValueError on an unknown format or missing custom dimensions.
    """
    if not specs:
        raise ValueError("At least one label is required")
    validate_symbology(symbology)
    for spec in specs:
        if not sanitize_barcode_value(str(spec.barcode_value).strip()):
            raise ValueError(
                f"Label {spec.name!r} has no Code128-compatible barcode value"
            )

    if label_format == "custom":
        if custom_width is None or custom_height is None:
            raise ValueError(
                "custom_width and custom_height are required for custom format"
            )
        if not 0.5 <= custom_width <= 8 or not 0.5 <= custom_height <= 11:
            raise ValueError(
                "custom label dimensions must be 0.5-8 inches wide and "
                "0.5-11 inches high"
            )
        rotate = auto_rotate if auto_rotate is not None else True
        return _render_thermal(specs, custom_width, custom_height, rotate, symbology)

    fmt = LABEL_FORMATS.get(label_format)
    if not fmt:
        raise ValueError(
            f"Unknown label format: {label_format}. "
            f"Available: {', '.join(LABEL_FORMATS.keys())}, custom"
        )

    if fmt["type"] == "sheet":
        return _render_sheet(specs, symbology)
    rotate = auto_rotate if auto_rotate is not None else fmt.get("auto_rotate", False)
    return _render_thermal(specs, fmt["width"], fmt["height"], rotate, symbology)


def _render_sheet(specs: list, symbology: str = SYMBOLOGY_CODE128) -> BytesIO:
    """Avery 5160 layout: 3 columns x 10 rows, each label 2.625" x 1"."""
    from reportlab.graphics.barcode import code128
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.pdfgen import canvas

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    page_w, page_h = letter

    cols = 3
    rows = 10
    label_w = 2.625 * inch
    label_h = 1.0 * inch
    margin_x = (page_w - cols * label_w) / 2
    margin_y = 0.5 * inch
    labels_per_page = cols * rows
    padding = 0.06 * inch

    for idx, spec in enumerate(specs):
        if idx > 0 and idx % labels_per_page == 0:
            c.showPage()

        pos = idx % labels_per_page
        col = pos % cols
        row = pos // cols

        x = margin_x + col * label_w
        y = page_h - margin_y - (row + 1) * label_h

        barcode_value = sanitize_barcode_value(spec.barcode_value)
        usable_w = label_w - 2 * padding
        y_cursor = y + label_h - padding

        c.setFont("Helvetica-Bold", 7)
        max_name_chars = int(usable_w / (7 * 0.5))
        name = spec.name[:max_name_chars] + (
            "..." if len(spec.name) > max_name_chars else ""
        )
        y_cursor -= 7
        c.drawString(x + padding, y_cursor, name)

        info_parts = []
        if spec.asset_tag and spec.asset_tag != barcode_value:
            info_parts.append(f"Asset: {spec.asset_tag}")
        if spec.serial_number and spec.serial_number != barcode_value:
            info_parts.append(f"S/N: {spec.serial_number}")
        if info_parts:
            c.setFont("Helvetica", 5.5)
            y_cursor -= 5.5 + 2
            c.drawString(x + padding, y_cursor, "  |  ".join(info_parts))

        if spec.extra:
            c.setFont("Helvetica", 5)
            y_cursor -= 5 + 1
            max_extra = int(usable_w / (5 * 0.5))
            c.drawString(x + padding, y_cursor, spec.extra[:max_extra])

        symbol_bottom = y + padding + 8
        if symbology == SYMBOLOGY_QR:
            size = _fit_qr_size(y_cursor - symbol_bottom - 2, usable_w)
            _draw_qr(c, barcode_value, x + (label_w - size) / 2, symbol_bottom, size)
        else:
            bar_height = 0.35 * inch
            bar_width_unit = 0.008 * inch
            barcode_obj = _fit_code128(
                code128, barcode_value, bar_width_unit, usable_w, bar_height
            )
            barcode_x = x + (label_w - barcode_obj.width) / 2
            barcode_obj.drawOn(c, barcode_x, symbol_bottom)

        c.setFont("Courier", 5.5)
        c.drawCentredString(x + label_w / 2, y + padding + 1, barcode_value)

    c.save()
    buf.seek(0)
    return buf


def _render_thermal(
    specs: list,
    width_in: float,
    height_in: float,
    auto_rotate: bool = False,
    symbology: str = SYMBOLOGY_CODE128,
) -> BytesIO:
    """One label per page at the exact size. When ``auto_rotate`` and the label
    is landscape, the page is built portrait and content rotated 90° so it reads
    correctly on roll-fed printers that feed narrow-edge first."""
    from reportlab.graphics.barcode import code128
    from reportlab.lib.units import inch
    from reportlab.pdfgen import canvas

    content_w = width_in * inch
    content_h = height_in * inch

    is_landscape = width_in > height_in
    needs_rotation = auto_rotate and is_landscape
    page_size = (content_h, content_w) if needs_rotation else (content_w, content_h)

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=page_size)
    padding = 0.08 * inch

    for idx, spec in enumerate(specs):
        if idx > 0:
            c.showPage()

        barcode_value = sanitize_barcode_value(spec.barcode_value)

        if needs_rotation:
            c.saveState()
            c.translate(content_h, 0)
            c.rotate(90)

        self_w = content_w - 2 * padding
        self_h = content_h - 2 * padding

        if is_landscape:
            name_font_size = min(8, max(5, self_h / (0.2 * inch)))
            info_font_size = max(4, name_font_size - 2)
            barcode_text_size = max(4, info_font_size)
            bar_height = min(0.4 * inch, self_h * 0.4)
            bar_width_unit = 0.01 * inch
        else:
            name_font_size = min(10, max(6, self_w / (0.4 * inch)))
            info_font_size = max(5, name_font_size - 2)
            barcode_text_size = max(5, info_font_size)
            bar_height = min(0.8 * inch, self_h * 0.3)
            bar_width_unit = 0.012 * inch

        # self_w already excludes the page padding, and the 10-module quiet
        # zones live inside barcode.width, so the bars may span it fully.
        # A QR is square and sized from the height left after the text, so it
        # is built at draw time rather than here.
        barcode_obj = (
            None
            if symbology == SYMBOLOGY_QR
            else _fit_code128(
                code128, barcode_value, bar_width_unit, self_w, bar_height
            )
        )

        y_cursor = content_h - padding

        c.setFont("Helvetica-Bold", name_font_size)
        name_max_chars = int(self_w / (name_font_size * 0.5))
        name = spec.name[:name_max_chars] + (
            "..." if len(spec.name) > name_max_chars else ""
        )
        y_cursor -= name_font_size
        if is_landscape:
            c.drawString(padding, y_cursor, name)
        else:
            c.drawCentredString(content_w / 2, y_cursor, name)

        info_parts = []
        if spec.asset_tag and spec.asset_tag != barcode_value:
            info_parts.append(f"Asset: {spec.asset_tag}")
        if spec.serial_number and spec.serial_number != barcode_value:
            info_parts.append(f"S/N: {spec.serial_number}")
        if info_parts:
            y_cursor -= info_font_size + 2
            c.setFont("Helvetica", info_font_size)
            if is_landscape:
                c.drawString(padding, y_cursor, " | ".join(info_parts))
            else:
                c.drawCentredString(content_w / 2, y_cursor, " | ".join(info_parts))

        if spec.extra:
            extra_size = max(4, info_font_size - 1)
            y_cursor -= extra_size + 1
            max_extra = int(self_w / (extra_size * 0.5))
            c.setFont("Helvetica", extra_size)
            if is_landscape:
                c.drawString(padding, y_cursor, spec.extra[:max_extra])
            else:
                c.drawCentredString(content_w / 2, y_cursor, spec.extra[:max_extra])

        barcode_y = padding + barcode_text_size + 4
        if barcode_obj is None:
            size = _fit_qr_size(y_cursor - barcode_y - 2, self_w)
            _draw_qr(c, barcode_value, padding + (self_w - size) / 2, barcode_y, size)
        else:
            barcode_x = padding + (self_w - barcode_obj.width) / 2
            barcode_obj.drawOn(c, barcode_x, barcode_y)

        c.setFont("Courier", barcode_text_size)
        c.drawCentredString(content_w / 2, padding + 1, barcode_value)

        if needs_rotation:
            c.restoreState()

    c.save()
    buf.seek(0)
    return buf
