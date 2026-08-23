"""
Native ZPL II label renderer for Zebra (and ZPL-compatible) label printers.

The PDF renderer in :mod:`app.utils.label_renderer` produces a page a driver
then rasterizes; this one emits the printer's own command language, which the
printer executes directly. That distinction is the whole point of this module:
a PDF sent through a Zebra driver is scaled by whatever the print dialog last
had selected, and a barcode scaled to 94% stops scanning while still looking
correct to the person holding it. ZPL carries its dimensions in printer dots,
so there is no scaling stage to get wrong.

Renders the same :class:`~app.utils.label_renderer.LabelSpec` objects the PDF
path uses, so every module that can print a label already produces the input
this needs.
"""

from typing import List, Optional

from app.utils.label_renderer import (
    LABEL_FORMATS,
    MIN_BAR_WIDTH_INCH,
    LabelSpec,
    sanitize_barcode_value,
)

# Resolutions Zebra ships. 203 dpi ("standard") and 300 dpi ("high") cover
# essentially every desktop unit; 600 dpi appears on some industrial models.
SUPPORTED_DPI = (203, 300, 600)

# ^MD accepts a relative darkness adjustment in this range. Outside it the
# printer rejects the whole format rather than clamping.
MIN_DARKNESS = -30
MAX_DARKNESS = 30

# ^BY module width is capped at 10 dots by the ZPL spec.
_MAX_MODULE_DOTS = 10

# Code 128 symbol widths, in modules, using subset B (11 modules per
# character). ^BC auto-switches to subset C for digit pairs, which is
# *narrower* — so sizing against subset B never overflows the label, it only
# leaves a numeric barcode fractionally left of centre.
_MODULES_PER_CHAR = 11
_MODULES_START_STOP = 11 + 13  # start (11) + stop pattern with terminator (13)
_MODULES_CHECKSUM = 11
_QUIET_ZONE_MODULES = 10  # per side, the Code 128 spec minimum

# Font 0 is proportional; 0.55x the character height is the average advance and
# is what the truncation estimate below is built on.
_AVG_CHAR_WIDTH_RATIO = 0.55


def _escape_zpl(text: str) -> str:
    """Escape ZPL's three control characters for use inside ``^FD`` data.

    ``^`` and ``~`` start commands, so an item named "Ladder ^ Hook" would
    otherwise truncate the field and feed the remainder to the parser as
    commands. Emitted as ``_XX`` hex sequences, which requires ``^FH`` on the
    field. The escape character itself is escaped first, or escaping ``^`` to
    ``_5E`` would then have its own underscore re-escaped.
    """
    return text.replace("_", "_5F").replace("^", "_5E").replace("~", "_7E")


def _ascii_only(text: str) -> str:
    """Drop characters the printer's resident font cannot render.

    A degree sign or smart quote pasted from a spec sheet prints as garbage on
    a resident-font-only printer, so it is removed rather than shown wrong.
    """
    return "".join(ch for ch in text if 32 <= ord(ch) < 127)


def _clean_text(text: Optional[str]) -> str:
    return _ascii_only(str(text or "").strip())


def _truncate(text: str, font_height: int, max_width_dots: int) -> str:
    """Trim text to what fits on one line at ``font_height`` dots."""
    if not text:
        return ""
    char_width = max(1.0, font_height * _AVG_CHAR_WIDTH_RATIO)
    max_chars = int(max_width_dots / char_width)
    if max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    if max_chars <= 3:
        return text[:max_chars]
    return text[: max_chars - 3] + "..."


def code128_width_dots(value: str, module_dots: int) -> int:
    """Printed width of a Code 128 symbol, quiet zones included."""
    modules = (
        _MODULES_START_STOP
        + _MODULES_CHECKSUM
        + _MODULES_PER_CHAR * len(value)
        + 2 * _QUIET_ZONE_MODULES
    )
    return modules * module_dots


def _fit_module_width(value: str, available_dots: int, dpi: int) -> int:
    """Widest module width whose symbol still fits, or raise if none does.

    The floor is the same 5 mil X-dimension the PDF renderer enforces, but
    expressed in this printer's dots — so it rises with resolution instead of
    letting a 600 dpi printer emit a 1.7 mil barcode that nothing can read.
    Sharing the constant is what keeps the two output paths agreeing on which
    labels are printable at all.
    """
    min_module = max(1, round(MIN_BAR_WIDTH_INCH * dpi))
    for module_dots in range(_MAX_MODULE_DOTS, min_module - 1, -1):
        if code128_width_dots(value, module_dots) <= available_dots:
            return module_dots
    raise ValueError(f"Barcode value {value!r} is too long for the selected label size")


def resolve_label_size(
    label_format: str,
    custom_width: Optional[float] = None,
    custom_height: Optional[float] = None,
) -> tuple:
    """Resolve a label format key to (width_inches, height_inches).

    Sheet formats (Avery grids) are rejected: a thermal printer has no page to
    lay a grid on, and silently printing 30 labels one per roll-label would
    waste the roll before anyone noticed.
    """
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
        return custom_width, custom_height

    fmt = LABEL_FORMATS.get(label_format)
    if not fmt:
        raise ValueError(f"Unknown label format: {label_format}")
    if fmt.get("type") != "thermal":
        raise ValueError(
            f"Label format {label_format!r} is a paper sheet layout and cannot "
            "be sent to a label printer. Choose a thermal label size."
        )
    return fmt["width"], fmt["height"]


def render_zpl(
    specs: List[LabelSpec],
    label_format: str = "zebra_2x1",
    custom_width: Optional[float] = None,
    custom_height: Optional[float] = None,
    dpi: int = 203,
    darkness: Optional[int] = None,
    copies: int = 1,
) -> str:
    """Render label specs to a ZPL II program.

    Returns one ``^XA``/``^XZ`` format per spec, concatenated. Raises
    ValueError for an unknown/unsupported format, an unsupported resolution,
    or a barcode value too long for the label.
    """
    if not specs:
        raise ValueError("At least one label is required")
    if dpi not in SUPPORTED_DPI:
        raise ValueError(
            f"Unsupported printer resolution: {dpi}. "
            f"Supported: {', '.join(str(d) for d in SUPPORTED_DPI)}"
        )
    if copies < 1 or copies > 50:
        raise ValueError("copies must be between 1 and 50")
    if darkness is not None and not MIN_DARKNESS <= darkness <= MAX_DARKNESS:
        raise ValueError(f"darkness must be between {MIN_DARKNESS} and {MAX_DARKNESS}")

    width_in, height_in = resolve_label_size(label_format, custom_width, custom_height)

    width_dots = int(round(width_in * dpi))
    height_dots = int(round(height_in * dpi))
    padding = max(4, int(round(0.06 * dpi)))
    content_width = width_dots - 2 * padding

    out = []
    for spec in specs:
        out.append(
            _render_one(
                spec,
                width_dots=width_dots,
                height_dots=height_dots,
                padding=padding,
                content_width=content_width,
                dpi=dpi,
                darkness=darkness,
                copies=copies,
            )
        )
    return "".join(out)


def _render_one(
    spec: LabelSpec,
    width_dots: int,
    height_dots: int,
    padding: int,
    content_width: int,
    dpi: int,
    darkness: Optional[int],
    copies: int,
) -> str:
    barcode_value = sanitize_barcode_value(str(spec.barcode_value).strip())
    if not barcode_value:
        raise ValueError(f"Label {spec.name!r} has no Code128-compatible barcode value")

    scale = dpi / 203.0
    name_height = max(14, int(round(min(28, height_dots * 0.13))))
    info_height = max(10, int(round(name_height * 0.72)))
    gap = max(2, int(round(3 * scale)))

    lines = []
    y = padding

    name = _truncate(_clean_text(spec.name) or "Label", name_height, content_width)
    lines.append(
        f"^FO{padding},{y}^A0N,{name_height},{name_height}"
        f"^FB{content_width},1,0,C,0^FH^FD{_escape_zpl(name)}^FS"
    )
    y += name_height + gap

    # Asset tag and serial repeat the barcode value often enough that showing
    # them unconditionally wastes the one line a 1" label has to spare.
    info_parts = []
    asset_tag = _clean_text(spec.asset_tag)
    serial = _clean_text(spec.serial_number)
    if asset_tag and asset_tag != barcode_value:
        info_parts.append(f"Asset: {asset_tag}")
    if serial and serial != barcode_value:
        info_parts.append(f"S/N: {serial}")
    if info_parts:
        info = _truncate(" | ".join(info_parts), info_height, content_width)
        lines.append(
            f"^FO{padding},{y}^A0N,{info_height},{info_height}"
            f"^FB{content_width},1,0,C,0^FH^FD{_escape_zpl(info)}^FS"
        )
        y += info_height + gap

    extra = _clean_text(spec.extra)
    if extra:
        extra_text = _truncate(extra, info_height, content_width)
        lines.append(
            f"^FO{padding},{y}^A0N,{info_height},{info_height}"
            f"^FB{content_width},1,0,C,0^FH^FD{_escape_zpl(extra_text)}^FS"
        )
        y += info_height + gap

    module_dots = _fit_module_width(barcode_value, content_width, dpi)
    barcode_width = code128_width_dots(barcode_value, module_dots)

    # The human-readable interpretation line prints below the bars and is part
    # of the symbol's footprint, so it has to come out of the height budget or
    # it prints past the bottom edge of the label.
    interpretation_height = max(12, int(round(18 * scale)))
    available_height = height_dots - padding - y - interpretation_height
    min_bar_height = int(round(20 * scale))
    if available_height < min_bar_height:
        raise ValueError(
            "Label is too small for the selected content. "
            "Use a larger label or remove the extra info line."
        )
    # A 6" label would otherwise give the bars four inches of height, which
    # scans no better and leaves the text stranded at the top.
    bar_height = min(available_height, max(min_bar_height, int(height_dots * 0.4)))

    barcode_x = padding + max(0, (content_width - barcode_width) // 2)
    lines.append(f"^BY{module_dots},2.5,{bar_height}")
    # ^FH here too: a caret or tilde inside an asset tag survives
    # sanitize_barcode_value (it only strips non-ASCII) and would otherwise be
    # parsed as the start of a command instead of encoded into the symbol.
    lines.append(
        f"^FO{barcode_x},{y}^BCN,{bar_height},Y,N,N"
        f"^FH^FD{_escape_zpl(barcode_value)}^FS"
    )

    header = ["^XA", "^CI28", f"^PW{width_dots}", f"^LL{height_dots}", "^LH0,0"]
    if darkness is not None:
        header.append(f"^MD{darkness}")

    footer = []
    if copies > 1:
        footer.append(f"^PQ{copies},0,0,N")
    footer.append("^XZ")

    return "".join(header + lines + footer)
