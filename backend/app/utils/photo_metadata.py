"""Remove the location and other metadata from a JPEG or PNG, losslessly.

Owner decision of 2026-11-26: a JPEG or PNG photo filed with an attendance
waiver request is stored without its metadata, so the GPS position a phone
records is never kept. The member was told the photo is not re-compressed,
so nothing here decodes a pixel: the file is rewritten from its own segments
or chunks, minus the ones that carry metadata, and the compressed image data
is copied byte for byte. A decoder therefore produces exactly the pixels it
produced from the original.

**JPEG.** The markers from SOI to the first SOS are walked one by one.

* Kept: SOI; APP0 JFIF, rewritten without the uncompressed thumbnail it may
  carry; DQT, every SOFn, DHT, DAC, DRI, DNL, DHP, EXP; APP2
  ``ICC_PROFILE`` chunks (the colours); APP14 ``Adobe`` (a CMYK or YCCK
  file's colours depend on its transform flag); and the JPEG-LS SOF55 and
  LSE, which are image structure too.
* Dropped: APP1 (Exif, XMP, extended XMP), any other APP2 (MPF, FlashPix),
  APP3 to APP13 (APP13 is Photoshop and IPTC), APP15, COM, and an APP0 that
  is not JFIF (a JFXX thumbnail).
* Refused: any other marker. None appears in a photo a phone or a scanner
  writes, and an unknown segment can carry anything.

The entropy-coded data after each SOS is copied as it is, honouring byte
stuffing (FF00), restart markers and fill bytes. A progressive file's
tables and scans between scans are kept, and an APPn or COM between them is
dropped. Everything after the primary image's EOI is discarded: a phone puts
an MPF second picture, a Motion Photo's video or a vendor trailer there.

**PNG.** The signature is checked, then the chunks are walked. Only an
allowlist is kept (the image, its palette and transparency, and the chunks
that say how to show its colours, size and animation); everything else goes,
including eXIf, the text chunks (XMP lives in iTXt), tIME and every private
chunk. A kept chunk is copied verbatim, CRC included; a CRC that does not
match its chunk is refused. Everything after IEND is discarded.

**Orientation is kept.** A phone often stores a photo sideways and records
in EXIF how to turn it. When the dropped EXIF named an orientation other than
1, a minimal EXIF holding only that tag is written back, so the photo still
displays upright. Only that one tag is read, defensively: an EXIF that cannot
be parsed means no orientation, never a refusal.

**A file that cannot be walked is refused, never stored as filed.** A bad
signature, a length that is impossible or runs past the end, or no SOS, EOI
or IEND is a 400. The walk is a single pass that always moves forward, with
no recursion, so it ends on every input in time linear in its size; it
raises nothing but that refusal.
"""

import struct
import zlib
from typing import List, Optional

from loguru import logger

from app.core.error_codes import CodedHTTPException, ErrorCode

UNREADABLE = "We couldn't read this photo. Save it again and retry."

#: The EXIF tag holding the orientation.
ORIENTATION_TAG = 0x0112

# --------------------------------------------------------------------------
# JPEG
# --------------------------------------------------------------------------

_SOI = 0xD8
_EOI = 0xD9
_SOS = 0xDA
_APP0 = 0xE0
_APP1 = 0xE1
_APP2 = 0xE2
_APP14 = 0xEE
_COM = 0xFE

#: Segments that describe the image itself, kept wherever they appear:
#: SOF0-3, 5-7, 9-11, 13-15; DHT; DAC; DQT; DNL; DRI; DHP; EXP; and the
#: JPEG-LS SOF55 and LSE.
_STRUCTURE = frozenset(
    [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]
    + [0xC4, 0xCC, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF, 0xF7, 0xF8]
)
_FRAME_HEADERS = frozenset(
    [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]
    + [0xF7]
)

_JFIF = b"JFIF\x00"
_EXIF = b"Exif\x00\x00"
_ICC = b"ICC_PROFILE\x00"
_ADOBE = b"Adobe"
#: A JFIF APP0 payload with no thumbnail: identifier, version, units,
#: X and Y density, and a 0x0 thumbnail.
_JFIF_LENGTH = 14


class _Unreadable(Exception):
    """Internal: the walk cannot continue. *reason* is a fixed label, logged
    in place of anything from the file."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _refusal(reason: str) -> CodedHTTPException:
    # Only the fixed label: anything more would describe the member's file.
    logger.warning("Photo refused while removing its metadata: {}", reason)
    return CodedHTTPException(
        status_code=400,
        detail=UNREADABLE,
        error_code=ErrorCode.UPLD_TYPE_NOT_ALLOWED,
    )


def _segment(marker: int, payload: bytes) -> bytes:
    return b"\xff" + bytes([marker]) + struct.pack(">H", len(payload) + 2) + payload


def _orientation_from_tiff(tiff: bytes) -> Optional[int]:
    """The Orientation in IFD0 of a TIFF-structured EXIF block, or None.
    Never raises: a damaged EXIF has no orientation."""
    if len(tiff) < 8:
        return None
    order = tiff[:2]
    if order == b"II":
        endian = "<"
    elif order == b"MM":
        endian = ">"
    else:
        return None
    try:
        magic, ifd = struct.unpack_from(endian + "HI", tiff, 2)
        if magic != 42 or ifd + 2 > len(tiff):
            return None
        (count,) = struct.unpack_from(endian + "H", tiff, ifd)
        for index in range(count):
            entry = ifd + 2 + 12 * index
            if entry + 12 > len(tiff):
                return None
            tag, kind, number = struct.unpack_from(endian + "HHI", tiff, entry)
            if tag != ORIENTATION_TAG:
                continue
            # SHORT, one value, held in the first two bytes of the field.
            if kind != 3 or number != 1:
                return None
            (value,) = struct.unpack_from(endian + "H", tiff, entry + 8)
            return value if 1 <= value <= 8 else None
    except struct.error:
        return None
    return None


def _orientation_tiff(orientation: int) -> bytes:
    """A big-endian TIFF block with IFD0 holding only the orientation."""
    return (
        b"MM\x00\x2a"
        + struct.pack(">I", 8)
        + struct.pack(">H", 1)
        + struct.pack(">HHIHH", ORIENTATION_TAG, 3, 1, orientation, 0)
        + struct.pack(">I", 0)
    )


def _jfif(payload: bytes) -> bytes:
    """The APP0 JFIF payload without a thumbnail."""
    if len(payload) < _JFIF_LENGTH:
        raise _Unreadable("jpeg-short-jfif")
    return payload[: _JFIF_LENGTH - 2] + b"\x00\x00"


def _keep_app(marker: int, payload: bytes) -> bool:
    if marker == _APP2:
        return payload.startswith(_ICC)
    if marker == _APP14:
        return payload.startswith(_ADOBE)
    return False


def _marker_at(data: bytes, pos: int) -> tuple[int, int]:
    """The marker starting at *pos*, after any fill bytes: ``(marker,
    position after it)``."""
    end = len(data)
    if pos >= end or data[pos] != 0xFF:
        raise _Unreadable("jpeg-expected-marker")
    while pos < end and data[pos] == 0xFF:
        pos += 1
    if pos >= end:
        raise _Unreadable("jpeg-truncated")
    marker = data[pos]
    if marker == 0x00:
        raise _Unreadable("jpeg-expected-marker")
    return marker, pos + 1


def _payload(data: bytes, pos: int) -> tuple[bytes, int]:
    """The segment's payload after its two-byte length, and where the next
    segment starts."""
    if pos + 2 > len(data):
        raise _Unreadable("jpeg-truncated")
    (length,) = struct.unpack_from(">H", data, pos)
    if length < 2:
        raise _Unreadable("jpeg-bad-length")
    end = pos + length
    if end > len(data):
        raise _Unreadable("jpeg-segment-past-end")
    return data[pos + 2 : end], end


def _scan_end(data: bytes, pos: int) -> int:
    """Where the entropy-coded data starting at *pos* ends: the position of
    the 0xFF that begins the next real marker (the first of any fill bytes).
    FF00 is a stuffed data byte and FFD0-FFD7 a restart marker; both belong
    to the scan."""
    end = len(data)
    while True:
        found = data.find(b"\xff", pos)
        if found < 0:
            raise _Unreadable("jpeg-no-eoi")
        run = found
        while found < end and data[found] == 0xFF:
            found += 1
        if found >= end:
            raise _Unreadable("jpeg-no-eoi")
        following = data[found]
        if found == run + 1 and (following == 0x00 or 0xD0 <= following <= 0xD7):
            pos = found + 1
            continue
        if following == 0x00 or 0xD0 <= following <= 0xD7:
            # Fill bytes then a stuffed byte or a restart: not valid JPEG.
            raise _Unreadable("jpeg-bad-scan")
        return run


def _strip_jpeg(data: bytes) -> bytes:
    if len(data) < 4 or data[0] != 0xFF or data[1] != _SOI:
        raise _Unreadable("jpeg-no-soi")
    header: List[bytes] = []
    body: List[bytes] = []
    orientation: Optional[int] = None
    jfif_first = False
    seen_frame = False
    seen_scan = False
    pos = 2
    while True:
        marker, pos = _marker_at(data, pos)
        if marker == _EOI:
            if not seen_scan:
                raise _Unreadable("jpeg-no-sos")
            body.append(b"\xff\xd9")
            break
        if marker == _SOI or marker == 0x01 or 0xD0 <= marker <= 0xD7:
            # A second SOI, TEM, or a restart outside a scan.
            raise _Unreadable("jpeg-misplaced-marker")
        payload, pos = _payload(data, pos)
        out = body if seen_scan else header
        if marker == _SOS:
            if not seen_frame:
                raise _Unreadable("jpeg-sos-before-frame")
            seen_scan = True
            scan_start = pos
            pos = _scan_end(data, pos)
            body.append(_segment(marker, payload) + data[scan_start:pos])
        elif marker in _STRUCTURE:
            if marker in _FRAME_HEADERS:
                seen_frame = True
            out.append(_segment(marker, payload))
        elif marker == _APP0:
            if not seen_scan and payload.startswith(_JFIF):
                jfif_first = jfif_first or not header
                header.append(_segment(marker, _jfif(payload)))
        elif marker == _APP1:
            if orientation is None and not seen_scan and payload.startswith(_EXIF):
                orientation = _orientation_from_tiff(payload[len(_EXIF) :])
        elif _APP0 <= marker <= 0xEF:
            if not seen_scan and _keep_app(marker, payload):
                header.append(_segment(marker, payload))
        elif marker == _COM:
            pass
        else:
            raise _Unreadable("jpeg-unknown-marker")
    if orientation is not None and orientation != 1:
        exif = _segment(_APP1, _EXIF + _orientation_tiff(orientation))
        header.insert(1 if jfif_first else 0, exif)
    return b"\xff\xd8" + b"".join(header) + b"".join(body)


# --------------------------------------------------------------------------
# PNG
# --------------------------------------------------------------------------

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

#: The chunks a stored PNG may carry: the image, and how to show it.
PNG_KEPT_CHUNKS = frozenset(
    {
        b"IHDR",
        b"PLTE",
        b"IDAT",
        b"IEND",
        b"tRNS",
        b"gAMA",
        b"cHRM",
        b"sRGB",
        b"iCCP",
        b"sBIT",
        b"bKGD",
        b"pHYs",
        b"cICP",
        b"mDCv",
        b"cLLi",
        b"acTL",
        b"fcTL",
        b"fdAT",
    }
)
#: The PNG specification's ceiling on a chunk's length.
_PNG_MAX_CHUNK = 2**31 - 1


def _chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def _strip_png(data: bytes) -> bytes:
    if not data.startswith(PNG_SIGNATURE):
        raise _Unreadable("png-bad-signature")
    kept: List[bytes] = []
    orientation: Optional[int] = None
    pos = len(PNG_SIGNATURE)
    end = len(data)
    while True:
        if pos + 12 > end:
            raise _Unreadable("png-no-iend")
        (length,) = struct.unpack_from(">I", data, pos)
        kind = data[pos + 4 : pos + 8]
        if length > _PNG_MAX_CHUNK:
            raise _Unreadable("png-bad-length")
        if not all(65 <= c <= 90 or 97 <= c <= 122 for c in kind):
            raise _Unreadable("png-bad-chunk-type")
        payload_end = pos + 8 + length
        if payload_end + 4 > end:
            raise _Unreadable("png-chunk-past-end")
        (crc,) = struct.unpack_from(">I", data, payload_end)
        if zlib.crc32(data[pos + 4 : payload_end]) & 0xFFFFFFFF != crc:
            raise _Unreadable("png-bad-crc")
        if not kept and kind != b"IHDR":
            raise _Unreadable("png-ihdr-not-first")
        if kind in PNG_KEPT_CHUNKS:
            kept.append(data[pos : payload_end + 4])
        elif kind == b"eXIf" and orientation is None:
            orientation = _orientation_from_tiff(data[pos + 8 : payload_end])
        pos = payload_end + 4
        if kind == b"IEND":
            break
    if orientation is not None and orientation != 1:
        # Straight after IHDR: eXIf must come before the image data.
        kept.insert(1, _chunk(b"eXIf", _orientation_tiff(orientation)))
    return PNG_SIGNATURE + b"".join(kept)


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

_STRIPPERS = {"image/jpeg": _strip_jpeg, "image/png": _strip_png}

#: The detected types this module rewrites.
STRIPPABLE_TYPES = frozenset(_STRIPPERS)


def strip_photo_metadata(content: bytes, mime_type: str) -> bytes:
    """*content*, a JPEG or PNG by its detected *mime_type*, without its
    metadata and with its compressed image data unchanged; or a 400 when it
    cannot be walked."""
    strip = _STRIPPERS.get(mime_type)
    if strip is None:
        raise ValueError(f"Not a JPEG or PNG: {mime_type}")
    try:
        return strip(content)
    except _Unreadable as unreadable:
        raise _refusal(unreadable.reason) from None
