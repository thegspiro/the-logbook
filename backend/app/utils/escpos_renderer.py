"""
ESC/POS label renderer, for receipt-class thermal printers.

ESC/POS is the language Epson defined and most receipt printers speak. It
matters here because the printers that use it — Epson TM series, Star, and the
many generic 58mm/80mm units — are cheap, already sit on station networks, and
several models take linerless label media, so they print an adhesive barcode
strip rather than a receipt.

Two things make it a genuinely different renderer, not a variation on ZPL:

* **Output is bytes, not text.** ZPL is printable ASCII; ESC/POS is a binary
  stream where a length prefix or a QR module size can be any byte value.
  Encoding it as UTF-8 would silently mangle every byte above 0x7F into two
  bytes and corrupt the job, so this module returns ``bytes`` and the transport
  passes them through untouched.
* **Paper has a width but no length.** A receipt printer feeds continuous
  stock, so there is no label height to lay out against and no rotation to get
  right — layout is a single top-to-bottom column, ended by a cut.

Renders the same :class:`~app.utils.label_renderer.LabelSpec` objects as the
PDF and ZPL paths, so no module needed changing to gain a second printer
language.
"""

from typing import Dict, List, Optional

from app.utils.label_renderer import (
    SYMBOLOGY_CODE128,
    SYMBOLOGY_QR,
    LabelSpec,
    code128_width_dots,
    sanitize_barcode_value,
    validate_symbology,
)
from app.utils.print_document import PrintDocument

# Receipt stock is sold by paper width, and the printable width is narrower
# than the paper: the print head does not reach the edges. These are the
# printable dot counts every 203 dpi unit of that width shares.
ESCPOS_PAPER: Dict[str, Dict[str, object]] = {
    "escpos_58mm": {
        "description": "Receipt / label roll 58mm (2.3 in)",
        "printable_dots": 384,
        "characters": 32,
    },
    "escpos_80mm": {
        "description": "Receipt / label roll 80mm (3.1 in)",
        "printable_dots": 576,
        "characters": 48,
    },
}

DEFAULT_PAPER = "escpos_80mm"

# --- ESC/POS control sequences -------------------------------------------
_ESC = b"\x1b"
_GS = b"\x1d"

_INIT = _ESC + b"@"  # ESC @ — reset to a known state
_ALIGN_CENTER = _ESC + b"a\x01"
_ALIGN_LEFT = _ESC + b"a\x00"
_SIZE_NORMAL = _GS + b"!\x00"
_SIZE_DOUBLE = _GS + b"!\x11"  # double width and height
_SIZE_DOUBLE_HEIGHT = _GS + b"!\x01"
_BOLD_ON = _ESC + b"E\x01"
_BOLD_OFF = _ESC + b"E\x00"
_LF = b"\n"

# GS k m n d1..dn — barcode. 73 selects Code 128, which unlike the older
# NUL-terminated form takes an explicit length and so can carry any byte.
_BARCODE_CODE128 = 73

# GS w n — module width in dots. Below 2 the bars stop scanning; above 6 no
# printer in this class accepts the value.
_MIN_MODULE_DOTS = 2
_MAX_MODULE_DOTS = 6

# GS ( k — the 2D barcode function group, used here for QR.
_QR_MODEL_2 = 50
_QR_ERROR_CORRECTION_M = 49  # 48..51 = L, M, Q, H
_MIN_QR_MODULE_DOTS = 3
_MAX_QR_MODULE_DOTS = 16

# Feed before cutting so the label clears the tear bar, then a partial cut.
_FEED_AND_CUT = _ESC + b"d\x03" + _GS + b"V\x42\x00"
_FEED_ONLY = _ESC + b"d\x04"


def is_escpos_paper(label_format: str) -> bool:
    return label_format in ESCPOS_PAPER


def paper_width_dots(label_format: str) -> int:
    """Printable width in dots for a receipt paper size."""
    paper = ESCPOS_PAPER.get(label_format)
    if paper is None:
        raise ValueError(
            f"Unknown receipt paper size: {label_format}. "
            f"Supported: {', '.join(ESCPOS_PAPER)}"
        )
    return int(paper["printable_dots"])


def _ascii_only(text: str) -> str:
    """Drop anything the printer's resident code page cannot render."""
    return "".join(ch for ch in text if 32 <= ord(ch) < 127)


def _clean(text: Optional[str]) -> str:
    return _ascii_only(str(text or "").strip())


def _truncate(text: str, characters: int) -> str:
    if len(text) <= characters:
        return text
    if characters <= 3:
        return text[:characters]
    return text[: characters - 3] + "..."


def _text_line(text: str, characters: int, double: bool = False) -> bytes:
    """One centred line. Double-size text fits half as many characters."""
    limit = characters // 2 if double else characters
    body = _truncate(text, limit)
    if not body:
        return b""
    prefix = _SIZE_DOUBLE if double else _SIZE_NORMAL
    return prefix + body.encode("ascii", errors="ignore") + _LF


def _escape_code128(value: str) -> bytes:
    """Encode a Code 128 payload for ``GS k``.

    The data must start with a code-set selector, and inside it a literal
    brace is written as ``{{`` — an asset tag containing "{" would otherwise be
    read as the start of a selector and silently change the encoded value.
    """
    escaped = value.replace("{", "{{")
    return b"{B" + escaped.encode("ascii", errors="ignore")


def _fit_code128_module(value: str, available_dots: int) -> int:
    for module_dots in range(_MAX_MODULE_DOTS, _MIN_MODULE_DOTS - 1, -1):
        if code128_width_dots(value, module_dots) <= available_dots:
            return module_dots
    raise ValueError(
        f"Barcode value {value!r} is too long for {available_dots} dots of "
        "paper. Use wider paper or switch to QR."
    )


def _code128(value: str, available_dots: int) -> bytes:
    module_dots = _fit_code128_module(value, available_dots)
    data = _escape_code128(value)
    if len(data) > 255:
        raise ValueError(f"Barcode value {value!r} is too long to encode")
    return (
        _GS
        + b"h\x50"  # GS h 80 — bar height in dots
        + _GS
        + b"w"
        + bytes([module_dots])
        + _GS
        + b"H\x02"  # GS H 2 — human-readable line below the bars
        + _GS
        + b"k"
        + bytes([_BARCODE_CODE128, len(data)])
        + data
    )


def _qr(value: str, available_dots: int) -> bytes:
    """QR via the GS ( k function group.

    The module size is chosen from the paper width rather than left at the
    printer's default, so the symbol is as large as the stock allows — a QR
    printed at the default 3 dots on 80mm paper wastes most of the width and
    reads worse for it.
    """
    payload = value.encode("ascii", errors="ignore")
    # A rough module count for a version that holds this much at correction M;
    # 33 covers the identifiers this prints and keeps the symbol inside the
    # paper. Overestimating only makes the symbol smaller, never too wide.
    estimated_modules = 33 + 8
    module_dots = max(
        _MIN_QR_MODULE_DOTS,
        min(_MAX_QR_MODULE_DOTS, available_dots // estimated_modules),
    )

    store_length = len(payload) + 3
    if store_length > 0xFFFF:
        raise ValueError(f"Value {value!r} is too long to encode as a QR code")

    return (
        # Model 2
        _GS
        + b"(k\x04\x001A"
        + bytes([_QR_MODEL_2, 0])
        # Module size
        + _GS
        + b"(k\x03\x001C"
        + bytes([module_dots])
        # Error correction level
        + _GS
        + b"(k\x03\x001E"
        + bytes([_QR_ERROR_CORRECTION_M])
        # Store the data
        + _GS
        + b"(k"
        + bytes([store_length & 0xFF, (store_length >> 8) & 0xFF])
        + b"1P0"
        + payload
        # Print what was stored
        + _GS
        + b"(k\x03\x001Q0"
    )


def render_escpos(
    specs: List[LabelSpec],
    label_format: str = DEFAULT_PAPER,
    symbology: str = SYMBOLOGY_CODE128,
    copies: int = 1,
    cut: bool = True,
) -> bytes:
    """Render label specs to an ESC/POS byte stream.

    Raises ValueError for an unknown paper size, an unsupported symbology, or
    a barcode value too wide for the paper.
    """
    if not specs:
        raise ValueError("At least one label is required")
    validate_symbology(symbology)
    if copies < 1 or copies > 50:
        raise ValueError("copies must be between 1 and 50")

    available_dots = paper_width_dots(label_format)
    characters = int(ESCPOS_PAPER[label_format]["characters"])

    out = bytearray()
    for spec in specs:
        value = sanitize_barcode_value(str(spec.barcode_value).strip())
        if not value:
            raise ValueError(
                f"Label {spec.name!r} has no Code128-compatible barcode value"
            )

        for _ in range(copies):
            out += _INIT
            out += _ALIGN_CENTER
            out += _text_line(_clean(spec.name) or "Label", characters, double=True)

            info = []
            asset_tag = _clean(spec.asset_tag)
            serial = _clean(spec.serial_number)
            if asset_tag and asset_tag != value:
                info.append(f"Asset: {asset_tag}")
            if serial and serial != value:
                info.append(f"S/N: {serial}")
            if info:
                out += _text_line(" | ".join(info), characters)

            extra = _clean(spec.extra)
            if extra:
                out += _text_line(extra, characters)

            out += _LF
            if symbology == SYMBOLOGY_QR:
                out += _qr(value, available_dots)
                # A QR carries no human-readable line of its own.
                out += _LF + _text_line(value, characters)
            else:
                out += _code128(value, available_dots)
                out += _LF

            out += _ALIGN_LEFT
            out += _FEED_AND_CUT if cut else _FEED_ONLY

    return bytes(out)


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------
#
# A roster or a check sheet is not a label: it is a column of text on
# continuous paper, as long as it needs to be. What it shares with a label is
# the transport, the status query and the printer registration, which is why it
# lives beside the label renderer rather than in a subsystem of its own.


def _pad_columns(left: str, right: str, width: int) -> str:
    """Left text and right text on one line, right-aligned to the margin.

    When the pair will not fit, the *left* is truncated: the right column
    carries a status or a count, which is the part that would be guessed at
    wrongly if it were the half that got cut.
    """
    if not right:
        return _truncate(left, width)
    room = width - len(right) - 1
    if room < 1:
        return _truncate(right, width)
    return _truncate(left, room).ljust(room) + " " + right


def _document_row(row, width: int) -> bytes:
    prefix = " " * (2 * max(0, row.indent))
    if row.checkbox:
        prefix += "[ ] "

    body = _pad_columns(_clean(row.left), _clean(row.right or ""), width - len(prefix))
    line = (prefix + body).rstrip()
    if not line:
        return b""

    encoded = line.encode("ascii", errors="ignore") + _LF
    if row.emphasis:
        return _BOLD_ON + encoded + _BOLD_OFF
    return encoded


def render_escpos_document(
    document: PrintDocument,
    label_format: str = DEFAULT_PAPER,
    cut: bool = True,
) -> bytes:
    """Render a :class:`PrintDocument` to an ESC/POS byte stream."""
    if document is None:
        raise ValueError("A document is required")

    paper = ESCPOS_PAPER.get(label_format)
    if paper is None:
        raise ValueError(
            f"Unknown receipt paper size: {label_format}. "
            f"Supported: {', '.join(ESCPOS_PAPER)}"
        )
    width = int(paper["characters"])
    rule = ("-" * width).encode("ascii")

    out = bytearray()
    out += _INIT
    out += _ALIGN_CENTER

    title = _clean(document.title) or "Document"
    out += _SIZE_DOUBLE_HEIGHT + _BOLD_ON
    out += _truncate(title, width).encode("ascii", errors="ignore") + _LF
    out += _BOLD_OFF + _SIZE_NORMAL

    subtitle = _clean(document.subtitle)
    if subtitle:
        out += _truncate(subtitle, width).encode("ascii", errors="ignore") + _LF

    out += _ALIGN_LEFT
    out += rule + _LF

    for section in document.sections:
        heading = _clean(section.heading)
        if heading:
            out += _BOLD_ON
            out += _truncate(heading.upper(), width).encode("ascii", errors="ignore")
            out += _LF + _BOLD_OFF
        for row in section.rows:
            out += _document_row(row, width)
        out += _LF

    footer = _clean(document.footer)
    if footer:
        out += rule + _LF
        out += _ALIGN_CENTER
        out += _truncate(footer, width).encode("ascii", errors="ignore") + _LF
        out += _ALIGN_LEFT

    out += _FEED_AND_CUT if cut else _FEED_ONLY
    return bytes(out)
