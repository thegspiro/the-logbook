"""Which minutes attachments the minutes PDF carries, and in what form.

Owner decision 2026-11-01: the minutes PDF embeds the files filed with the
minutes. What the installed libraries can do decides the form:

* **Images** (JPEG, PNG, GIF, WebP) are drawn into the PDF after the minutes,
  scaled down first, with ReportLab's ``Image`` flowable.
* **PDFs** are appended after the minutes, page for page, with pypdf's
  ``PdfWriter.append`` (each gets a bookmark).
* **Anything else** (Word, Excel, text) is listed by name only: nothing here
  renders it, and a reader opens it from the minutes.

**Budgets.** A PDF build runs in the request, so it must not read or draw
without bound. Files are read in the order they were filed until
``MAX_INCLUDED_BYTES`` of them have been taken (by the size recorded at upload,
before reading any), appended pages stop at ``MAX_APPENDED_PAGES``, and an
image larger than ``MAX_IMAGE_PIXELS`` is not decoded at all — Pillow's own
decompression-bomb limit is far higher than anything a minutes page needs.
A file left out for any of these reasons is still listed, with the reason.

**A bad file never spoils the export.** A file that cannot be read, a PDF that
does not parse or is password-protected, and an image that does not decode are
listed with a note and skipped; the minutes still print.

Who may receive the result is the PDF endpoint's business: these are the files
of minutes the caller is already allowed to read.
"""

import warnings
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Dict, List, Mapping, Optional, Sequence

from loguru import logger
from PIL import Image, ImageOps
from pypdf import PasswordType, PdfReader, PdfWriter

# Total bytes of attachment files one PDF build reads. The upload limit is
# 25 MB a file (ATTACHMENT_FILE_RULES), so this takes at least one of any size.
MAX_INCLUDED_BYTES = 40 * 1024 * 1024
# Pages appended from PDF attachments, all files together.
MAX_APPENDED_PAGES = 300
# An image with more pixels than this is not decoded (40 MP is a large camera).
MAX_IMAGE_PIXELS = 40_000_000
# Longest edge an image is scaled down to before it is drawn: enough for a
# full page at print resolution, and it keeps the PDF small.
IMAGE_MAX_EDGE = 1800

IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})
PDF_TYPE = "application/pdf"

IMAGE = "image"
PDF = "pdf"
LISTED = "listed"
OMITTED = "omitted"

_TYPE_LABELS = {
    "application/msword": "Word document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (
        "Word document"
    ),
    "application/vnd.ms-excel": "Excel workbook",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (
        "Excel workbook"
    ),
    "text/plain": "text file",
}

OVER_SIZE = (
    "Not included: the PDF's attachment size limit was reached. "
    "Open it from the minutes."
)
OVER_PAGES = "Not included: the PDF's page limit was reached. Open it from the minutes."
UNREADABLE = "Not included: the file could not be read. Open it from the minutes."
LOCKED = "Not included: the PDF is password-protected. Open it from the minutes."
IMAGE_TOO_LARGE = (
    "Not included: the image is too large to draw. Open it from the minutes."
)


@dataclass
class PreparedAttachment:
    kind: str
    note: str
    # IMAGE: the scaled image, re-encoded, and its size in pixels.
    image: Optional[bytes] = None
    width: int = 0
    height: int = 0
    # PDF: the attachment as pypdf wrote it back out, known to append cleanly.
    pdf: Optional[bytes] = None
    pages: int = 0


def renderable(mime_type: Any) -> bool:
    return mime_type in IMAGE_TYPES or mime_type == PDF_TYPE


def select_for_pdf(attachments: Sequence[Mapping[str, Any]]) -> List[str]:
    """The ids of the attachments to read, in filing order, within the budget.

    Decided from the size recorded at upload, so nothing past the budget is
    ever read. A type that is only listed is never read either.
    """
    chosen: List[str] = []
    total = 0
    for attachment in attachments:
        if not renderable(attachment.get("mime_type")):
            continue
        size = int(attachment.get("file_size") or 0)
        if total + size > MAX_INCLUDED_BYTES:
            continue
        total += size
        chosen.append(str(attachment.get("id")))
    return chosen


def _image(data: bytes) -> PreparedAttachment:
    try:
        with warnings.catch_warnings():
            # Pillow warns, rather than raises, between its own limit and twice
            # it; treat the warning as the refusal it is.
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as opened:
                width, height = opened.size
                if width * height > MAX_IMAGE_PIXELS:
                    return PreparedAttachment(OMITTED, IMAGE_TOO_LARGE)
                opened.seek(0)
                picture = ImageOps.exif_transpose(opened)
                picture.thumbnail((IMAGE_MAX_EDGE, IMAGE_MAX_EDGE))
                if picture.mode in ("RGBA", "LA", "P"):
                    rgba = picture.convert("RGBA")
                    flat = Image.new("RGB", rgba.size, (255, 255, 255))
                    flat.paste(rgba, mask=rgba.getchannel("A"))
                    picture = flat
                elif picture.mode != "RGB":
                    picture = picture.convert("RGB")
                out = BytesIO()
                picture.save(out, "JPEG", quality=85)
                return PreparedAttachment(
                    IMAGE,
                    "Shown after the minutes.",
                    image=out.getvalue(),
                    width=picture.width,
                    height=picture.height,
                )
    except Image.DecompressionBombError:
        return PreparedAttachment(OMITTED, IMAGE_TOO_LARGE)
    except (Image.DecompressionBombWarning, OSError, ValueError, SyntaxError) as exc:
        logger.info("Minutes PDF: an image attachment did not decode: {}", exc)
        return PreparedAttachment(OMITTED, UNREADABLE)


def _pdf(data: bytes, pages_left: int) -> PreparedAttachment:
    try:
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted and reader.decrypt("") == PasswordType.NOT_DECRYPTED:
            return PreparedAttachment(OMITTED, LOCKED)
        pages = len(reader.pages)
        if pages > pages_left:
            return PreparedAttachment(OMITTED, OVER_PAGES)
        # Written out once here so a file that parses but cannot be copied is
        # caught now, while it can still be listed, rather than half-appended.
        writer = PdfWriter()
        writer.append(reader, import_outline=False)
        out = BytesIO()
        writer.write(out)
    except Exception as exc:
        # pypdf raises a wide range of errors on a malformed file (its own,
        # KeyError, ValueError, ...); any of them means "list it, do not
        # append it", never a failed export.
        logger.info("Minutes PDF: a PDF attachment could not be read: {}", exc)
        return PreparedAttachment(OMITTED, UNREADABLE)
    noun = "page" if pages == 1 else "pages"
    return PreparedAttachment(
        PDF,
        f"Appended after the minutes ({pages} {noun}).",
        pdf=out.getvalue(),
        pages=pages,
    )


def prepare(
    attachments: Sequence[Mapping[str, Any]], contents: Mapping[str, bytes]
) -> Dict[str, PreparedAttachment]:
    """How each attachment appears in the PDF, keyed by attachment id.

    *contents* holds the bytes read for the ids :func:`select_for_pdf` chose;
    a chosen id missing from it is a file that could not be read.
    """
    chosen = set(select_for_pdf(attachments))
    pages_left = MAX_APPENDED_PAGES
    prepared: Dict[str, PreparedAttachment] = {}
    for attachment in attachments:
        att_id = str(attachment.get("id"))
        mime = attachment.get("mime_type")
        if not renderable(mime):
            label = _TYPE_LABELS.get(str(mime), "file")
            prepared[att_id] = PreparedAttachment(
                LISTED, f"Listed only ({label}). Open it from the minutes."
            )
            continue
        if att_id not in chosen:
            prepared[att_id] = PreparedAttachment(OMITTED, OVER_SIZE)
            continue
        data = contents.get(att_id)
        if data is None:
            prepared[att_id] = PreparedAttachment(OMITTED, UNREADABLE)
            continue
        if mime == PDF_TYPE:
            entry = _pdf(data, pages_left)
            pages_left -= entry.pages
        else:
            entry = _image(data)
        prepared[att_id] = entry
    return prepared


def append_pdfs(
    minutes_pdf: bytes,
    attachments: Sequence[Mapping[str, Any]],
    prepared: Mapping[str, PreparedAttachment],
) -> bytes:
    """The minutes followed by every PDF attachment, each bookmarked by title."""
    appended = [
        (attachment, prepared[str(attachment.get("id"))])
        for attachment in attachments
        if str(attachment.get("id")) in prepared
        and prepared[str(attachment.get("id"))].kind == PDF
    ]
    if not appended:
        return minutes_pdf
    writer = PdfWriter()
    writer.append(PdfReader(BytesIO(minutes_pdf)))
    for attachment, entry in appended:
        writer.append(
            PdfReader(BytesIO(entry.pdf or b"")),
            outline_item=f"Attachment: {attachment.get('title') or 'Untitled'}",
            import_outline=False,
        )
    out = BytesIO()
    writer.write(out)
    return out.getvalue()
