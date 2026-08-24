"""
Parsers for what a printer says about itself — ZPL (``~HI`` / ``~HQES``) and
ESC/POS (``DLE EOT``).

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

Bit tables: ZPL from the ~HQES error/warning nibble tables in the ZPL II
Programming Guide; ESC/POS from the DLE EOT n=2/3/4 tables in Epson's ESC/POS
command reference. Neither is guessed, and neither should be extended from a
symptom without checking the table it came from.
"""

import re
from typing import Dict, List, Optional, Sequence

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
    (0x00000008, "Labels nearly out"),
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


def _unrecognized(mask: int, table) -> bool:
    """Whether *mask* sets any bit the table does not name.

    Recognising one bit must not make a partly understood mask look fully
    decoded: a roll that is nearly out *and* some condition this table has no
    name for would otherwise be reported as only the first.
    """
    known = 0
    for bit, _label in table:
        known |= bit
    return bool(mask & ~known)


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
        kind, flag, high, low = match.groups()
        mask = int(low, 16)
        table = _ERROR_FLAGS if kind == "ERRORS" else _WARNING_FLAGS
        decoded = _decode_flags(mask, table)

        # The high group holds conditions this table does not name, so a bit
        # there is an unnamed fault exactly like an unnamed bit in the low
        # group. It is gated on the flag digit because the flag is the
        # printer's own answer to "is anything wrong": without that gate, a
        # unit that parks something benign in the high group would report a
        # fault on every single query.
        high_set = flag == "1" and int(high, 16) != 0

        # Something is wrong that this table cannot name — the flag is set with
        # no recognised bit at all, recognised bits are mixed with unrecognised
        # ones, or the condition is in the group this table does not cover.
        # Reported generically rather than dropped on the floor.
        if (flag == "1" and not decoded) or _unrecognized(mask, table) or high_set:
            decoded.append(
                "Printer reports an error"
                if kind == "ERRORS"
                else "Printer reports a warning"
            )

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


# --- ESC/POS -------------------------------------------------------------
#
# A DLE EOT reply is a single byte whose fixed bits are defined by the spec:
# bit 0 and bit 7 are always 0, bits 1 and 4 are always 1. Checking that shape
# is what distinguishes a real status byte from whatever an unrelated service
# happened to send back, so a byte that fails it is treated as no answer
# rather than decoded into a confident wrong diagnosis.
_ESCPOS_FIXED_MASK = 0b10010011
_ESCPOS_FIXED_VALUE = 0b00010010

# Offline status (DLE EOT 2). Bit 5 is "printing stops due to paper end" — the
# same condition the paper-roll query reports, not a separate jam, so it is
# labelled to match rather than sending someone to look for one.
# Bit 3 (0x08) is "paper being fed by the FEED button" — a normal transient
# state, not a fault, so it is deliberately not decoded here.
_ESCPOS_COVER_OPEN = 0x04
_ESCPOS_PAPER_STOP = 0x20
_ESCPOS_ERROR = 0x40

# Error cause status (DLE EOT 3). Without this a cutter jam arrives only as the
# generic error bit above, which tells a watch desk nothing it can act on.
_ESCPOS_CUTTER_ERROR = 0x08
_ESCPOS_UNRECOVERABLE = 0x20
_ESCPOS_AUTO_RECOVERABLE = 0x40

# Bits 1 and 4 are the fixed pattern and bits 0 and 7 are already rejected by
# is_escpos_status_byte, so bit 2 is the only one this table cannot name.
# Epson's n=3 table defines bits 3, 5 and 6 and nothing else; some third-party
# firmware puts a fault of its own in bit 2. Naming it would be a guess, and a
# wrong specific diagnosis is worse than a vague true one — but a set bit still
# means something is wrong, so it is reported generically rather than letting a
# faulted printer read as healthy.
_ESCPOS_ERROR_CAUSE_KNOWN = (
    _ESCPOS_FIXED_VALUE
    | _ESCPOS_CUTTER_ERROR
    | _ESCPOS_UNRECOVERABLE
    | _ESCPOS_AUTO_RECOVERABLE
)

# Paper roll status (DLE EOT 4). Both bits of each pair are set together; the
# spec defines the pair, so both are required rather than either.
_ESCPOS_PAPER_NEAR_END = 0x0C
_ESCPOS_PAPER_END = 0x60


def _dedupe(items: List[str]) -> List[str]:
    """Drop repeats, keeping first-seen order."""
    seen = set()
    out = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def is_escpos_status_byte(reply: bytes) -> bool:
    """Whether *reply* has the fixed bit pattern of a DLE EOT answer."""
    if len(reply) != 1:
        return False
    return (reply[0] & _ESCPOS_FIXED_MASK) == _ESCPOS_FIXED_VALUE


def summarize_escpos(replies: Sequence[bytes]) -> Dict[str, object]:
    """Fold DLE EOT replies (offline, error cause, paper roll) into the API shape.

    A printer that answers with a valid status byte has proved it speaks
    ESC/POS, which is the identification this language offers — there is no
    equivalent of ZPL's ~HI carrying a model name, so ``model`` stays null
    rather than being invented.

    The three queries overlap on purpose: an out-of-paper printer sets a bit in
    two of them and a cutter jam sets the generic error bit in a third. Each
    byte is decoded on its own and the findings are then deduplicated, so an
    overlap reads as one fault rather than two.
    """
    offline = replies[0] if len(replies) > 0 else b""
    error_cause = replies[1] if len(replies) > 1 else b""
    paper = replies[2] if len(replies) > 2 else b""

    errors: List[str] = []
    warnings: List[str] = []
    known = False

    if is_escpos_status_byte(paper):
        known = True
        value = paper[0]
        if value & _ESCPOS_PAPER_END == _ESCPOS_PAPER_END:
            errors.append("Out of paper")
        elif value & _ESCPOS_PAPER_NEAR_END == _ESCPOS_PAPER_NEAR_END:
            warnings.append("Paper is nearly out")

    if is_escpos_status_byte(error_cause):
        known = True
        value = error_cause[0]
        if value & _ESCPOS_CUTTER_ERROR:
            errors.append("Cutter fault")
        if value & _ESCPOS_UNRECOVERABLE:
            errors.append("Unrecoverable fault — the printer needs power cycling")
        if value & _ESCPOS_AUTO_RECOVERABLE:
            errors.append("Recoverable fault — clear it and the printer resumes")
        if value & ~_ESCPOS_ERROR_CAUSE_KNOWN:
            errors.append("Printer reports an error")

    if is_escpos_status_byte(offline):
        known = True
        value = offline[0]
        specific: List[str] = []
        if value & _ESCPOS_COVER_OPEN:
            specific.append("Cover is open")
        if value & _ESCPOS_PAPER_STOP:
            specific.append("Out of paper")
        # The generic error bit is only worth reporting when nothing named it.
        # "Nothing" means this byte *and* the error-cause byte: a cutter jam
        # sets both, and reporting it twice — once by name, once as "an error"
        # — reads as two faults.
        if value & _ESCPOS_ERROR and not specific and not errors:
            specific.append("Printer reports an error")
        errors.extend(specific)

    responded = bool(offline or error_cause or paper)
    return {
        "responded": responded,
        "identified": known,
        "model": None,
        "firmware": None,
        "reported_dpi": None,
        "errors": _dedupe(errors),
        "warnings": _dedupe(warnings),
        "status_available": known,
    }
