"""
Parsers for a Zebra printer's replies to ``~HI`` and ``~HQES``.

Why this exists: opening a TCP socket to port 9100 proves almost nothing. The
connection succeeds against a printer that is switched on but out of labels,
against a printer whose IP was reassigned to somebody's laptop, and against a
device that speaks no ZPL at all. Every one of those looks like a successful
print. Asking the printer to identify itself and report its faults is the only
way to tell the difference.

Everything here is deliberately conservative, for one reason: **a wrong
specific diagnosis is worse than no diagnosis.** "Out of ribbon" sends a
quartermaster looking for a ribbon a direct-thermal printer does not have.
So a reply that does not match the expected shape yields ``None`` rather than a
guess, and a printer that reports a fault whose bit is not recognised is
reported as a generic fault rather than being silently dropped. The bits named
below are the common ones and are the only ones claimed by name.
"""

import re
from typing import Dict, List, Optional

# ~HQES error bitmask (the low-order group), Zebra's documented flags. Only the
# faults a station can actually act on are named; anything else falls through
# to the generic "reports an error" path so it is never lost or mislabelled.
_ERROR_FLAGS = (
    (0x00000001, "Out of labels"),
    (0x00000002, "Out of ribbon"),
    (0x00000004, "Printhead open"),
    (0x00000008, "Cutter fault"),
    (0x00000010, "Printhead over temperature"),
)

_WARNING_FLAGS = (
    (0x00000001, "Media needs calibrating"),
    (0x00000002, "Printhead needs cleaning"),
    (0x00000004, "Printhead needs replacing"),
)

# "ERRORS:  1 00000000 00000005" — flag, high group, low group.
_STATUS_LINE = re.compile(
    r"^(ERRORS|WARNINGS):\s+(\d)\s+([0-9A-Fa-f]{8})\s+([0-9A-Fa-f]{8})\s*$"
)

# "ZTC ZD420-203dpi ZPL" — the resolution the printer reports for itself.
_DPI = re.compile(r"(\d{3,4})\s*dpi", re.IGNORECASE)

# "V93.20.15Z"
_FIRMWARE = re.compile(r"\bV[\d.]+[A-Z]?\b")

# A reply is only treated as an identity line if it looks like one; a stray
# banner from some other service must not be reported as a printer model.
_IDENTITY_HINT = re.compile(r"dpi|ZPL", re.IGNORECASE)


def _clean_lines(raw: str) -> List[str]:
    """Split a reply into lines with the STX/ETX framing removed."""
    text = raw.replace("\x02", "\n").replace("\x03", "\n")
    return [line.strip() for line in text.splitlines() if line.strip()]


def parse_host_identification(raw: str) -> Optional[Dict[str, object]]:
    """Model, firmware and resolution from a ``~HI`` reply, or None.

    None means "this did not look like a Zebra identity line" — which the
    caller reports as *the printer did not identify itself*, not as an
    absence of information.
    """
    for line in _clean_lines(raw):
        if not _IDENTITY_HINT.search(line):
            continue
        fields = [field.strip() for field in line.split(",")]
        model = fields[0] if fields and fields[0] else None
        if not model:
            continue

        dpi_match = _DPI.search(line)
        firmware_match = _FIRMWARE.search(line)
        return {
            "model": model,
            "firmware": firmware_match.group(0) if firmware_match else None,
            "dpi": int(dpi_match.group(1)) if dpi_match else None,
        }
    return None


def _decode_flags(mask: int, table) -> List[str]:
    return [label for bit, label in table if mask & bit]


def parse_error_status(raw: str) -> Optional[Dict[str, List[str]]]:
    """Errors and warnings from a ``~HQES`` reply, or None if absent.

    ``~HQES`` is not on older firmware, so None means "this printer did not
    tell us", which is reported as unknown rather than as healthy.
    """
    errors: List[str] = []
    warnings: List[str] = []
    seen = False

    for line in _clean_lines(raw):
        match = _STATUS_LINE.match(line)
        if not match:
            continue
        seen = True
        kind, flag, _high, low = match.groups()
        mask = int(low, 16)
        table = _ERROR_FLAGS if kind == "ERRORS" else _WARNING_FLAGS
        decoded = _decode_flags(mask, table)

        # The flag says something is wrong even when no bit we recognise is
        # set — report it generically rather than dropping it on the floor.
        if flag == "1" and not decoded:
            decoded = [
                (
                    "Printer reports an error"
                    if kind == "ERRORS"
                    else "Printer reports a warning"
                )
            ]

        if kind == "ERRORS":
            errors.extend(decoded)
        else:
            warnings.extend(decoded)

    if not seen:
        return None
    return {"errors": errors, "warnings": warnings}


def summarize(raw: str) -> Dict[str, object]:
    """Fold a raw reply into the shape the API returns.

    Never includes the raw text: the transport reads from an
    administrator-supplied address, and echoing whatever came back to a client
    is exactly the banner-grab this feature must not become.
    """
    identity = parse_host_identification(raw)
    status = parse_error_status(raw)

    return {
        "responded": bool(raw.strip()),
        "identified": identity is not None,
        "model": identity["model"] if identity else None,
        "firmware": identity["firmware"] if identity else None,
        "reported_dpi": identity["dpi"] if identity else None,
        "errors": status["errors"] if status else [],
        "warnings": status["warnings"] if status else [],
        "status_available": status is not None,
    }
