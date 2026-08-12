"""Validation helpers for URLs that will be presented as browser links."""

from typing import Any
from urllib.parse import urlsplit


def validate_external_http_url(value: Any) -> Any:
    """Accept blank values or absolute HTTP(S) URLs with a hostname.

    This validator is for navigational links, not server-side fetch targets. It
    prevents stored executable schemes from reaching an anchor while leaving
    SSRF protections to the code that performs outbound requests.
    """
    if value is None or not isinstance(value, str):
        return value

    cleaned = value.strip()
    if not cleaned:
        return None

    parsed = urlsplit(cleaned)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise ValueError("URL must be an absolute HTTP or HTTPS URL")
    return cleaned
