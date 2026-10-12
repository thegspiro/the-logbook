"""Fail-closed MIME detection for uploads with broad format allowlists."""


def detect_mime_type(content: bytes) -> str:
    """Return the libmagic MIME type or raise when validation is unavailable."""
    try:
        import magic
    except ImportError as exc:
        raise RuntimeError("File content validation is unavailable") from exc
    return str(magic.from_buffer(content[:2048], mime=True))


_OLE_EXTENSIONS = frozenset({".doc", ".xls", ".ppt"})
_OOXML_EXTENSIONS = frozenset({".docx", ".xlsx", ".pptx"})
_TEXT_EXTENSIONS = frozenset({".txt", ".csv", ".ics"})

# Which filename extensions are consistent with a detected MIME type. Grouped
# by container family rather than one-to-one, because libmagic cannot always
# tell the members of a family apart: the legacy Office formats share one OLE
# compound-file container, CSV and iCalendar routinely detect as text/plain,
# and older libmagic builds report an Office Open XML file as a plain zip. A
# one-to-one table would reject genuine files; a family table still refuses
# the disguise that matters — a PDF named ``.png``, an image named ``.docx``.
_EXTENSIONS_FOR_MIME: dict[str, frozenset[str]] = {
    "application/pdf": frozenset({".pdf"}),
    "application/msword": _OLE_EXTENSIONS,
    "application/vnd.ms-excel": _OLE_EXTENSIONS,
    "application/vnd.ms-powerpoint": _OLE_EXTENSIONS,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (
        _OOXML_EXTENSIONS
    ),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (
        _OOXML_EXTENSIONS
    ),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": (
        _OOXML_EXTENSIONS
    ),
    "application/zip": _OOXML_EXTENSIONS | {".zip"},
    "application/x-zip-compressed": _OOXML_EXTENSIONS | {".zip"},
    "text/plain": _TEXT_EXTENSIONS,
    "text/csv": _TEXT_EXTENSIONS,
    "text/calendar": _TEXT_EXTENSIONS,
    "image/jpeg": frozenset({".jpg", ".jpeg"}),
    "image/png": frozenset({".png"}),
    "image/gif": frozenset({".gif"}),
    "image/bmp": frozenset({".bmp"}),
    "image/webp": frozenset({".webp"}),
    "image/svg+xml": frozenset({".svg"}),
}


def extension_matches_mime(ext: str, mime: str) -> bool:
    """True when filename extension *ext* is consistent with detected *mime*.

    Fails closed: a MIME type with no entry matches no extension, so a new
    entry in a caller's allowlist has to be added here deliberately.
    """
    return ext.lower() in _EXTENSIONS_FOR_MIME.get(mime, frozenset())
