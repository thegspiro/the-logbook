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
  carry; DQT, every SOFn of the DCT and lossless processes, DHT, DAC, DRI,
  DNL, DHP, EXP; APP2 ``ICC_PROFILE`` chunks (the colours); and APP14
  ``Adobe`` (a CMYK or YCCK file's colours depend on its transform flag).
* Dropped: APP1 (Exif, XMP, extended XMP), any other APP2 (MPF, FlashPix),
  APP3 to APP13 (APP13 is Photoshop and IPTC), any other APP14, APP15, COM,
  and an APP0 that is not JFIF (a JFXX thumbnail).
* Refused: any other marker, JPEG-LS's SOF55 and LSE included. None
  appears in a photo a phone or a scanner writes, an unknown segment can
  carry anything, and JPEG-LS stuffs bits rather than bytes, so its scan
  cannot be told apart from a marker the way a JPEG's can.

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

**A crafted file costs little more than a photo.** A 10 MB upload can be
built from millions of tiny segments or chunks, or from bytes that make a
byte-by-byte scan slow, and an independent review measured seconds of CPU
and hundreds of MB for such files on the first version of this walk. So:

* the entropy-coded data and runs of fill bytes are crossed by compiled
  regular expressions, in C, never byte by byte in Python;
* a JPEG may hold ``MAX_JPEG_SEGMENTS`` markers and a PNG
  ``MAX_PNG_CHUNKS`` chunks, far above what any camera, phone or editor
  writes; more is refused with the same 400;
* the output is joined once from views of the input, so the walk holds the
  input and one output, never a copy per segment;
* the caller runs it on a worker thread, off the event loop.
"""

import re
import struct
import zlib
from typing import List, Optional, Union

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

_FRAME_HEADERS = frozenset(
    [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]
)
#: Segments that describe the image itself, kept wherever they appear:
#: SOF0-3, 5-7, 9-11, 13-15; DHT; DAC; DQT; DNL; DRI; DHP; EXP.
_STRUCTURE = _FRAME_HEADERS | {0xC4, 0xCC, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF}

#: The most markers a JPEG may hold. A camera's photo has a few dozen; the
#: most a 10 MB file needs is about 255 ICC chunks, some 160 extended-XMP
#: segments and a progressive file's scans and tables, all far below this.
MAX_JPEG_SEGMENTS = 4096
#: The most chunks a PNG may hold. libpng writes its image data in 8 KB
#: IDAT chunks, about 1,300 for 10 MB; this leaves room for an encoder
#: writing chunks a sixteenth that size, or an APNG of many frames.
MAX_PNG_CHUNKS = 16384

#: A run of fill bytes, crossed in one step.
_FILL = re.compile(rb"\xff+")
#: The end of a scan: an 0xFF followed by a marker code, that is, by
#: anything but a stuffed zero (FF00), a restart marker (FFD0-FFD7) or
#: another 0xFF (a fill byte, which the match moves past). A single literal
#: byte leading the pattern lets the engine search for it in C, so the
#: search is linear whatever the scan holds.
_SCAN_END = re.compile(rb"\xff[^\x00\xd0-\xd7\xff]")

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


def _jfif(data: bytes, start: int, end: int) -> bytes:
    """The APP0 JFIF segment whose payload is ``data[start:end]``, without
    a thumbnail."""
    if end - start < _JFIF_LENGTH:
        raise _Unreadable("jpeg-short-jfif")
    return _segment(_APP0, data[start : start + _JFIF_LENGTH - 2] + b"\x00\x00")


def _keep_app(marker: int, data: bytes, start: int) -> bool:
    if marker == _APP2:
        return data.startswith(_ICC, start)
    if marker == _APP14:
        return data.startswith(_ADOBE, start)
    return False


def _marker_at(data: bytes, pos: int) -> tuple[int, int, int]:
    """The marker at *pos*, after any fill bytes: ``(marker, where its 0xFF
    is, where its length starts)``."""
    fill = _FILL.match(data, pos)
    if fill is None:
        raise _Unreadable("jpeg-expected-marker")
    at = fill.end()
    if at >= len(data):
        raise _Unreadable("jpeg-truncated")
    marker = data[at]
    if marker == 0x00:
        raise _Unreadable("jpeg-expected-marker")
    return marker, at - 1, at + 1


def _segment_end(data: bytes, pos: int) -> int:
    """Where the segment whose two-byte length starts at *pos* ends."""
    if pos + 2 > len(data):
        raise _Unreadable("jpeg-truncated")
    length = int.from_bytes(data[pos : pos + 2], "big")
    if length < 2:
        raise _Unreadable("jpeg-bad-length")
    end = pos + length
    if end > len(data):
        raise _Unreadable("jpeg-segment-past-end")
    return end


def _scan_end(data: bytes, pos: int) -> int:
    """Where the entropy-coded data starting at *pos* ends: the 0xFF of the
    marker that follows it. Fill bytes before that marker stay with the
    scan, which a decoder skips; FF00 and FFD0-FFD7 belong to it."""
    found = _SCAN_END.search(data, pos)
    if found is None:
        raise _Unreadable("jpeg-no-eoi")
    return found.start()


def _strip_jpeg(data: bytes) -> bytes:
    if len(data) < 4 or data[0] != 0xFF or data[1] != _SOI:
        raise _Unreadable("jpeg-no-soi")
    view = memoryview(data)
    # Views of the input, and the few short segments rewritten here; joined
    # once at the end.
    header: List[Union[bytes, memoryview]] = []
    body: List[Union[bytes, memoryview]] = []
    orientation: Optional[int] = None
    jfif_first = False
    seen_frame = False
    seen_scan = False
    segments = 0
    pos = 2
    while True:
        marker, at, pos = _marker_at(data, pos)
        segments += 1
        if segments > MAX_JPEG_SEGMENTS:
            raise _Unreadable("jpeg-too-many-segments")
        if marker == _EOI:
            if not seen_scan:
                raise _Unreadable("jpeg-no-sos")
            body.append(b"\xff\xd9")
            break
        if marker == _SOI or marker == 0x01 or 0xD0 <= marker <= 0xD7:
            # A second SOI, TEM, or a restart outside a scan.
            raise _Unreadable("jpeg-misplaced-marker")
        end = _segment_end(data, pos)
        payload = pos + 2
        out = body if seen_scan else header
        if marker == _SOS:
            if not seen_frame:
                raise _Unreadable("jpeg-sos-before-frame")
            seen_scan = True
            pos = _scan_end(data, end)
            body.append(view[at:pos])
        elif marker in _STRUCTURE:
            if marker in _FRAME_HEADERS:
                seen_frame = True
            out.append(view[at:end])
            pos = end
        elif marker == _APP0:
            if not seen_scan and data.startswith(_JFIF, payload):
                jfif_first = jfif_first or not header
                header.append(_jfif(data, payload, end))
            pos = end
        elif marker == _APP1:
            if (
                orientation is None
                and not seen_scan
                and data.startswith(_EXIF, payload)
            ):
                orientation = _orientation_from_tiff(
                    bytes(view[payload + len(_EXIF) : end])
                )
            pos = end
        elif _APP0 <= marker <= 0xEF:
            if not seen_scan and _keep_app(marker, data, payload):
                header.append(view[at:end])
            pos = end
        elif marker == _COM:
            pos = end
        else:
            raise _Unreadable("jpeg-unknown-marker")
    if orientation is not None and orientation != 1:
        exif = _segment(_APP1, _EXIF + _orientation_tiff(orientation))
        header.insert(1 if jfif_first else 0, exif)
    return b"".join([b"\xff\xd8", *header, *body])


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
    view = memoryview(data)
    kept: List[Union[bytes, memoryview]] = []
    orientation: Optional[int] = None
    pos = len(PNG_SIGNATURE)
    end = len(data)
    chunks = 0
    while True:
        chunks += 1
        if chunks > MAX_PNG_CHUNKS:
            raise _Unreadable("png-too-many-chunks")
        if pos + 12 > end:
            raise _Unreadable("png-no-iend")
        (length,) = struct.unpack_from(">I", data, pos)
        kind = data[pos + 4 : pos + 8]
        if length > _PNG_MAX_CHUNK:
            raise _Unreadable("png-bad-length")
        # ASCII letters only; bytes.isalpha() checks exactly that, in C.
        if not kind.isalpha():
            raise _Unreadable("png-bad-chunk-type")
        payload_end = pos + 8 + length
        if payload_end + 4 > end:
            raise _Unreadable("png-chunk-past-end")
        (crc,) = struct.unpack_from(">I", data, payload_end)
        if zlib.crc32(view[pos + 4 : payload_end]) & 0xFFFFFFFF != crc:
            raise _Unreadable("png-bad-crc")
        if not kept and kind != b"IHDR":
            raise _Unreadable("png-ihdr-not-first")
        if kind in PNG_KEPT_CHUNKS:
            kept.append(view[pos : payload_end + 4])
        elif kind == b"eXIf" and orientation is None:
            orientation = _orientation_from_tiff(bytes(view[pos + 8 : payload_end]))
        pos = payload_end + 4
        if kind == b"IEND":
            break
    if orientation is not None and orientation != 1:
        # Straight after IHDR: eXIf must come before the image data.
        kept.insert(1, _chunk(b"eXIf", _orientation_tiff(orientation)))
    return b"".join([PNG_SIGNATURE, *kept])


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
