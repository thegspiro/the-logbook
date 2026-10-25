"""Websites a department lets frame its embeddable forms.

Each entry becomes part of a ``Content-Security-Policy: frame-ancestors``
header that nginx writes for ``/embed/f/<slug>``, so the shape is narrow on
purpose: an exact ``https`` origin — scheme, host and optional port, nothing
else. No path (``frame-ancestors`` ignores it and a reader would assume it
applies), no wildcard (it would let every subdomain, including ones the
department does not control, present its form), and no character that could
end the header value or start another directive.

The same check runs at write time, where a bad entry is refused, and again at
read time, where a stored value that is not one — written through the
free-form settings JSON, say — is dropped rather than sent to the browser.
"""

import re
from typing import Iterable, List

# Lowercase host labels, dots and hyphens, an optional port. Anything else —
# a space, a semicolon, a quote, a path — is not an origin and could change the
# meaning of the header it is written into.
_ORIGIN = re.compile(
    r"^https://(?=.{1,253}(?::|\Z))"
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*"
    r"(?::[0-9]{1,5})?\Z"
)

# Enough for a department's site, a recruiting microsite and a staging copy.
MAX_EMBED_ORIGINS = 10


def normalize_embed_origin(value: object) -> str:
    """Return *value* as an exact https origin, or raise ``ValueError``."""
    if not isinstance(value, str):
        raise ValueError("Each website must be text, such as https://example.org")
    origin = value.strip().lower().rstrip("/")
    if not _ORIGIN.match(origin):
        raise ValueError(
            f"{value.strip()!r} is not a website address of the form "
            "https://example.org (https only, no path or wildcard)"
        )
    port = origin.rpartition(":")[2] if origin.count(":") == 2 else None
    if port is not None and not 0 < int(port) <= 65535:
        raise ValueError(f"{value.strip()!r} has an invalid port")
    return origin


def valid_embed_origins(values: Iterable[object]) -> List[str]:
    """The entries of *values* that are exact https origins, deduplicated.

    For reading stored settings: an invalid entry is skipped, never raised,
    because an exception here would take every embedded form down rather than
    the one entry somebody typed wrong.
    """
    origins: List[str] = []
    for value in values:
        try:
            origin = normalize_embed_origin(value)
        except ValueError:
            continue
        if origin not in origins:
            origins.append(origin)
        if len(origins) == MAX_EMBED_ORIGINS:
            break
    return origins
