"""
History documents: what is accepted, and the copies everyone but the
archive's keepers sees.

Owner decisions (2026-11-14, phase 4):

* PDFs and image scans (JPEG, PNG, WebP), up to 50 MB. Word and other office
  files are converted to PDF before upload.
* The original is stored exactly as received and only ``history.manage``
  downloads it.
* Everyone else reads a copy with the hidden metadata removed. For a scan
  that is the photo pipeline (WebP, upright, no EXIF or GPS), with a higher
  pixel cap: a page scanned at 600 dpi is about 35 megapixels.
* A PDF's copy is rebuilt from its pages alone, so nothing from the
  document catalogue comes across: no document information, XMP, open
  action, document JavaScript, embedded files, outline or form scripts. Each
  page then loses its own actions, metadata and the annotation types that
  carry files or play media, and every embedded JPEG loses its EXIF, XMP,
  IPTC and comment segments without being re-encoded. A PDF opens in the
  browser's viewer in its own tab, so this rebuilt copy is what keeps a
  script inside the file from running there: the app's frame and sandbox
  headers cannot apply to a PDF a browser displays.
* The first page is drawn by PDFium for the preview; the text a PDF carries
  is read for search. A password-protected PDF is refused: it can be neither
  stripped, read nor drawn.
"""

import io
import threading
from dataclasses import dataclass
from typing import Any, Optional

from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError
from pypdf.generic import ArrayObject, DictionaryObject, NameObject

from app.services.file_storage_service import FileRules
from app.services.history_media_files import (
    MB,
    THUMBNAIL_MAX,
    PhotoCopies,
    UnreadableMedia,
    _webp,
    extension_of,
    make_photo_copies,
)

DOCUMENT_MAX_BYTES = 50 * MB
#: A letter scanned at 600 dpi is about 35 megapixels; photos stay at 25.
SCAN_MAX_PIXELS = 60_000_000

#: Search reads at most this much of a PDF. Past it the item page says the
#: search covers only what was read.
MAX_TEXT_PAGES = 2_000
MAX_TEXT_CHARS = 2_000_000

#: The longest side, in pixels, the first page is drawn at before it is cut
#: down to the 400 px preview: enough detail for a sharp thumbnail without
#: drawing a poster-sized page.
RENDER_LONG_SIDE = 1_600

_PDF = "application/pdf"
_SCAN_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
_EXTENSIONS = frozenset({".pdf", ".jpg", ".jpeg", ".png", ".webp"})

DOCUMENT_RULES = FileRules(
    allowed_types={_PDF: ".pdf", **_SCAN_TYPES},
    max_bytes=DOCUMENT_MAX_BYTES,
    description="PDF, JPEG, PNG or WebP",
    keep_consistent_extension=True,
    allowed_extensions=_EXTENSIONS,
)

#: Annotation types that carry a file or play media; none belongs in a copy a
#: member opens.
_DROPPED_ANNOTATIONS = frozenset(
    {"/FileAttachment", "/Sound", "/Movie", "/Screen", "/RichMedia", "/3D"}
)
#: Actions a kept annotation may still perform: following a link, or going to
#: a page in the same file. Everything else (JavaScript, launching a program,
#: submitting or importing form data, opening another file) is removed.
_KEPT_ACTIONS = frozenset({"/URI", "/GoTo"})
#: Page keys that hold actions or metadata rather than what is drawn.
_DROPPED_PAGE_KEYS = ("/AA", "/Metadata", "/PieceInfo")

#: JPEG markers kept when an embedded image is cleaned: APP0 (JFIF), APP2
#: (ICC colour profile) and APP14 (Adobe colour transform) change how the
#: picture is drawn; every other APPn and COM segment is metadata.
_KEPT_JPEG_APPS = frozenset({0xE0, 0xE2, 0xEE})

#: PDFium is not thread-safe, and uploads are processed in worker threads, so
#: every use of it goes through this lock.
_PDFIUM_LOCK = threading.Lock()


class UnreadableDocument(UnreadableMedia):
    pass


def is_pdf(mime_type: str) -> bool:
    return mime_type == _PDF


def accepts(filename: Optional[str]) -> bool:
    return extension_of(filename) in _EXTENSIONS


@dataclass(frozen=True)
class PdfCopies:
    cleaned: bytes
    preview: Optional[bytes]
    text: str
    text_truncated: bool
    page_count: int


def make_scan_copies(content: bytes) -> PhotoCopies:
    """The viewing copy and preview of an image scan."""
    return make_photo_copies(content, max_pixels=SCAN_MAX_PIXELS)


def strip_jpeg(data: bytes) -> bytes:
    """A JPEG with its metadata segments removed, the image data untouched.

    Anything that does not parse as a JPEG header is returned unchanged:
    the caller is cleaning an image inside a PDF, and a stream it cannot
    read is one PDFium draws as it is either way.
    """
    if len(data) < 4 or data[0:2] != b"\xff\xd8":
        return data
    out = bytearray(b"\xff\xd8")
    i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            return data
        marker = data[i + 1]
        if marker == 0xFF:
            i += 1
            continue
        if marker == 0xDA:  # start of scan: the rest is image data
            out += data[i:]
            return bytes(out)
        length = int.from_bytes(data[i + 2 : i + 4], "big")
        if length < 2 or i + 2 + length > len(data):
            return data
        segment = data[i : i + 2 + length]
        is_app = 0xE0 <= marker <= 0xEF
        if (is_app and marker in _KEPT_JPEG_APPS) or (not is_app and marker != 0xFE):
            out += segment
        i += 2 + length
    return data


def _filters(stream: Any) -> list[str]:
    raw = stream.get("/Filter")
    if raw is None:
        return []
    if isinstance(raw, ArrayObject):
        return [str(f) for f in raw]
    return [str(raw)]


def _clean_xobjects(resources: Any, seen: set[int]) -> None:
    """Strip metadata from every image a page draws, through nested forms."""
    if not isinstance(resources, DictionaryObject):
        return
    xobjects = resources.get("/XObject")
    if xobjects is None:
        return
    xobjects = xobjects.get_object()
    for ref in list(xobjects.values()):
        obj = ref.get_object()
        if id(obj) in seen:
            continue
        seen.add(id(obj))
        if NameObject("/Metadata") in obj:
            del obj[NameObject("/Metadata")]
        subtype = obj.get("/Subtype")
        if subtype == "/Image" and _filters(obj) == ["/DCTDecode"]:
            # The raw stream of a DCT-only image is the JPEG file itself;
            # rewriting it keeps every byte of picture data.
            obj._data = strip_jpeg(obj._data)
        elif subtype == "/Form":
            _clean_xobjects(obj.get("/Resources"), seen)


def _clean_annotations(page: Any) -> None:
    annots = page.get("/Annots")
    if annots is None:
        return
    kept = ArrayObject()
    for ref in annots.get_object():
        annot = ref.get_object()
        if annot.get("/Subtype") in _DROPPED_ANNOTATIONS:
            continue
        for key in ("/AA", "/Metadata"):
            if NameObject(key) in annot:
                del annot[NameObject(key)]
        # A form widget's field (and the fields above it) can carry its own
        # calculate, format and keystroke scripts.
        parent = annot.get("/Parent")
        hops = 0
        while parent is not None and hops < 32:
            field = parent.get_object()
            if NameObject("/AA") in field:
                del field[NameObject("/AA")]
            parent = field.get("/Parent")
            hops += 1
        action = annot.get("/A")
        if action is not None and action.get_object().get("/S") not in _KEPT_ACTIONS:
            del annot[NameObject("/A")]
        kept.append(ref)
    page[NameObject("/Annots")] = kept


def _rebuild(reader: PdfReader) -> bytes:
    writer = PdfWriter()
    seen: set[int] = set()
    for page in reader.pages:
        # Cleaned before it is copied, not after: add_page copies everything
        # the page references, and deleting a reference afterwards would
        # leave the script or attachment it pointed to in the file, orphaned
        # but still readable by anyone who opens the bytes.
        for key in _DROPPED_PAGE_KEYS:
            if NameObject(key) in page:
                del page[NameObject(key)]
        _clean_annotations(page)
        _clean_xobjects(page.get("/Resources"), seen)
        writer.add_page(page)
    # pypdf writes its own name as the producer unless told not to.
    writer.metadata = None
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _read_text(cleaned: bytes) -> tuple[str, bool]:
    reader = PdfReader(io.BytesIO(cleaned))
    parts: list[str] = []
    total = 0
    truncated = len(reader.pages) > MAX_TEXT_PAGES
    for page in reader.pages[:MAX_TEXT_PAGES]:
        try:
            text = page.extract_text() or ""
        except Exception:  # one unreadable page must not lose the rest
            continue
        if total + len(text) > MAX_TEXT_CHARS:
            parts.append(text[: MAX_TEXT_CHARS - total])
            truncated = True
            break
        parts.append(text)
        total += len(text)
    return "\n".join(p.strip() for p in parts if p.strip()), truncated


def _preview(cleaned: bytes) -> Optional[bytes]:
    """The first page drawn as a 400 px WebP, or None when PDFium cannot draw
    it: the document then shows an icon rather than failing the upload."""
    import pypdfium2 as pdfium

    with _PDFIUM_LOCK:
        try:
            document = pdfium.PdfDocument(cleaned)
        except pdfium.PdfiumError:
            return None
        try:
            if len(document) == 0:
                return None
            page = document[0]
            try:
                width, height = page.get_size()
                longest = max(width, height)
                if longest <= 0:
                    return None
                # Points are 1/72 in; at scale 1 one point is one pixel.
                scale = min(RENDER_LONG_SIDE / longest, 4.0)
                image = page.render(scale=scale, may_draw_forms=True).to_pil()
            finally:
                page.close()
        except pdfium.PdfiumError:
            return None
        finally:
            document.close()
    still = image.convert("RGB")
    still.info = {}
    return _webp(still, THUMBNAIL_MAX)


def make_pdf_copies(content: bytes) -> PdfCopies:
    """The members' copy of an accepted PDF, its preview and its text.

    Blocking (pypdf, PDFium): call through ``asyncio.to_thread``. Runs only on
    bytes that already passed the type check and the malware scan.
    """
    try:
        reader = PdfReader(io.BytesIO(content))
        if reader.is_encrypted:
            # An owner-restricted PDF opens with an empty password and is
            # not password-protected; one that needs a password to open is.
            if not reader.decrypt(""):
                raise UnreadableDocument(
                    "This PDF is password-protected. Remove the password and "
                    "upload it again"
                )
        page_count = len(reader.pages)
        if page_count == 0:
            raise UnreadableDocument("This PDF has no pages")
        cleaned = _rebuild(reader)
    except UnreadableDocument:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise UnreadableDocument("This PDF could not be read") from exc
    text, truncated = _read_text(cleaned)
    return PdfCopies(
        cleaned=cleaned,
        preview=_preview(cleaned),
        text=text,
        text_truncated=truncated,
        page_count=page_count,
    )
