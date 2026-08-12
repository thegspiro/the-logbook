"""Fail-closed MIME detection for uploads with broad format allowlists."""


def detect_mime_type(content: bytes) -> str:
    """Return the libmagic MIME type or raise when validation is unavailable."""
    try:
        import magic
    except ImportError as exc:
        raise RuntimeError("File content validation is unavailable") from exc
    return str(magic.from_buffer(content[:2048], mime=True))
