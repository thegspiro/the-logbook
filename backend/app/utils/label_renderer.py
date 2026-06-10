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

_MIN_BAR_WIDTH_INCH = 0.0075


def sanitize_barcode_value(raw: str) -> str:
    """Strip non-ASCII characters that Code128 cannot encode."""
    return "".join(ch for ch in raw if ord(ch) < 128)


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
) -> BytesIO:
    """Render label specs to a PDF for the given format.

    Raises ValueError on an unknown format or missing custom dimensions.
    """
    if label_format == "custom":
        if not custom_width or not custom_height:
            raise ValueError(
                "custom_width and custom_height are required for custom format"
            )
        rotate = auto_rotate if auto_rotate is not None else True
        return _render_thermal(specs, custom_width, custom_height, rotate)

    fmt = LABEL_FORMATS.get(label_format)
    if not fmt:
        raise ValueError(
            f"Unknown label format: {label_format}. "
            f"Available: {', '.join(LABEL_FORMATS.keys())}, custom"
        )

    if fmt["type"] == "sheet":
        return _render_sheet(specs)
    rotate = auto_rotate if auto_rotate is not None else fmt.get("auto_rotate", False)
    return _render_thermal(specs, fmt["width"], fmt["height"], rotate)


def _render_sheet(specs: list) -> BytesIO:
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

        quiet_zone = 10 * _MIN_BAR_WIDTH_INCH * inch
        bar_height = 0.35 * inch
        bar_width_unit = 0.008 * inch
        barcode_obj = code128.Code128(
            barcode_value, barWidth=bar_width_unit, barHeight=bar_height
        )
        max_barcode_width = usable_w - 2 * quiet_zone
        while (
            barcode_obj.width > max_barcode_width
            and bar_width_unit > _MIN_BAR_WIDTH_INCH * inch
        ):
            bar_width_unit -= 0.001 * inch
            barcode_obj = code128.Code128(
                barcode_value, barWidth=bar_width_unit, barHeight=bar_height
            )
        barcode_x = x + (label_w - barcode_obj.width) / 2
        barcode_obj.drawOn(c, barcode_x, y + padding + 8)

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

        quiet_zone = 10 * _MIN_BAR_WIDTH_INCH * inch
        min_bar = _MIN_BAR_WIDTH_INCH * inch

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

        max_barcode_width = self_w * 0.9 - 2 * quiet_zone

        barcode_obj = code128.Code128(
            barcode_value, barWidth=bar_width_unit, barHeight=bar_height
        )
        while barcode_obj.width > max_barcode_width and bar_width_unit > min_bar:
            bar_width_unit -= 0.001 * inch
            barcode_obj = code128.Code128(
                barcode_value, barWidth=bar_width_unit, barHeight=bar_height
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

        barcode_x = padding + (self_w - barcode_obj.width) / 2
        barcode_y = padding + barcode_text_size + 4
        barcode_obj.drawOn(c, barcode_x, barcode_y)

        c.setFont("Courier", barcode_text_size)
        c.drawCentredString(content_w / 2, padding + 1, barcode_value)

        if needs_rotation:
            c.restoreState()

    c.save()
    buf.seek(0)
    return buf
