"""
Signed links to the files a department's website may show from its History
archive: a photo's display copy or thumbnail, a document's thumbnail or
cleaned file, an article's public PDF.

A browser drawing ``<img src=...>`` cannot carry the portal's API key, and a
key in a page's source is a key anyone can copy. So each file the public API
names is given a link that proves itself: an HMAC-SHA256, under a key derived
from ``SECRET_KEY`` for this purpose alone, over the department, the kind of
record, its id, which copy, an optional context (the article a photo appears
in) and an expiry.

A valid signature only says the link was issued. Whoever serves it must still
check that the record is public, its kind is switched on and the portal is on,
every time, so a withdrawn photo's link stops working at once rather than when
it expires (owner-approved spec, 2026-11-24).

Expiries are rounded up to the next hour before the 24 hours are added, so a
link handed out twice within an hour is the same link and a browser's cache
can recognize it.
"""

import base64
import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.config import settings

LINK_LIFETIME = timedelta(hours=24)
#: Longer than any token :func:`sign` makes; anything past it is refused
#: before it is decoded.
MAX_TOKEN_LENGTH = 512
FILES_PATH = "/api/public/v1/history/files/"

KIND_PHOTO = "photo"
KIND_DOCUMENT = "document"
KIND_ARTICLE = "article"

VARIANT_THUMBNAIL = "thumbnail"
VARIANT_DISPLAY = "display"
VARIANT_FILE = "file"
VARIANT_PDF = "pdf"

#: The copies each kind may name. An original is never among them.
VARIANTS = {
    KIND_PHOTO: (VARIANT_THUMBNAIL, VARIANT_DISPLAY),
    KIND_DOCUMENT: (VARIANT_THUMBNAIL, VARIANT_FILE),
    KIND_ARTICLE: (VARIANT_PDF,),
}

_PURPOSE = b"history-public-files/v1"


@dataclass(frozen=True)
class FileClaim:
    organization_id: str
    kind: str
    record_id: str
    variant: str
    #: The article a photo is shown in, when the photo is reached through it.
    context: Optional[str]
    expires: int


def _key() -> bytes:
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"), _PURPOSE, hashlib.sha256
    ).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _expiry(now: datetime) -> int:
    hour = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return int((hour + LINK_LIFETIME).timestamp())


def sign(
    organization_id: str,
    kind: str,
    record_id: str,
    variant: str,
    *,
    context: Optional[str] = None,
    now: Optional[datetime] = None,
) -> str:
    """A token for one copy of one record. Raises ValueError for a copy the
    kind may not name."""
    if variant not in VARIANTS.get(kind, ()):
        raise ValueError("That copy cannot be linked publicly")
    expires = _expiry(now or datetime.now(timezone.utc))
    payload = _b64(
        json.dumps(
            [str(organization_id), kind, str(record_id), variant, context, expires],
            separators=(",", ":"),
        ).encode("utf-8")
    )
    signature = _b64(hmac.new(_key(), payload.encode("ascii"), hashlib.sha256).digest())
    return f"{payload}.{signature}"


def link(
    organization_id: str,
    kind: str,
    record_id: str,
    variant: str,
    *,
    context: Optional[str] = None,
) -> str:
    """The path a website requests, relative to the portal's own host."""
    return FILES_PATH + sign(organization_id, kind, record_id, variant, context=context)


def verify(token: str, *, now: Optional[datetime] = None) -> Optional[FileClaim]:
    """The claim a token makes, or None when it is malformed, forged, for a
    copy its kind may not name, or expired."""
    if not token or len(token) > MAX_TOKEN_LENGTH or token.count(".") != 1:
        return None
    payload, signature = token.split(".")
    expected = _b64(hmac.new(_key(), payload.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(expected, signature):
        return None
    try:
        values = json.loads(_unb64(payload))
        organization_id, kind, record_id, variant, context, expires = values
    except (ValueError, TypeError):
        return None
    if (
        not isinstance(organization_id, str)
        or not isinstance(record_id, str)
        or not isinstance(expires, int)
        or (context is not None and not isinstance(context, str))
        or variant not in VARIANTS.get(kind, ())
    ):
        return None
    moment = int((now or datetime.now(timezone.utc)).timestamp())
    if expires <= moment:
        return None
    return FileClaim(organization_id, kind, record_id, variant, context, expires)
