"""Names for files people download, built from the record they belong to.

A stored file's name on disk is a UUID; the uploader's own filename is often
``scan0003.pdf`` or ``IMG_2291.jpg``. Neither tells someone who saved the file
a month ago what it is. A download is named from the record instead —
``2026-10-08_Smith-John_EMT-Recertification.pdf`` — so the file is findable in
a Downloads folder and sorts by date.

Member names are written last name first. The owner accepted that a
downloaded file names the member it belongs to (decision recorded in
docs/FILE_STORAGE_HARDENING.md).
"""

import os
import re
import unicodedata
from datetime import date, datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.utils.org_timezone import local_date
from app.utils.upload_paths import safe_download_filename

# Each part is capped so one long title cannot crowd out the rest; the whole
# name is capped again by safe_download_filename.
_MAX_PART_LENGTH = 60
_SEPARATOR_RUN = re.compile(r"-{2,}")


def _slug(text: str) -> str:
    """Letters and digits kept (accented ones included), everything else a
    single hyphen: ``"Pump Ops / Drill #2"`` -> ``"Pump-Ops-Drill-2"``."""
    normalized = unicodedata.normalize("NFC", text)
    chars = [ch if ch.isalnum() else "-" for ch in normalized]
    slug = _SEPARATOR_RUN.sub("-", "".join(chars)).strip("-")
    return slug[:_MAX_PART_LENGTH].rstrip("-")


def _part(value: object) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = _slug(str(value))
    return text or None


def member_name_part(first_name: Optional[str], last_name: Optional[str]) -> str:
    """``Smith-John`` — last name first, so a folder of files sorts by member."""
    return "-".join(
        part for part in (_slug(last_name or ""), _slug(first_name or "")) if part
    )


def descriptive_filename(
    *parts: object, extension: str, fallback: str = "download"
) -> str:
    """Join the present *parts* with underscores and add *extension*.

    Dates and datetimes become ``YYYY-MM-DD`` — pass a datetime already
    converted to the department's timezone. ``None`` and empty parts are
    skipped. *extension* comes from the stored file (``".pdf"``), never from
    a name the uploader chose, so it matches the bytes being sent.
    """
    words = [p for p in (_part(value) for value in parts) if p]
    stem = "_".join(words) or _slug(fallback) or "download"
    ext = extension.lower() if extension else ""
    if ext and not ext.startswith("."):
        ext = f".{ext}"
    if not re.fullmatch(r"\.[a-z0-9]{1,10}", ext):
        ext = ""
    return safe_download_filename(f"{stem}{ext}", f"download{ext}")


def stored_extension(path: str) -> str:
    """Extension of a stored file's path — set from its detected content."""
    return os.path.splitext(path)[1].lower()


def original_stem(name: Optional[str]) -> Optional[str]:
    """The uploader's filename without its extension, for use as one part."""
    if not name:
        return None
    return os.path.splitext(os.path.basename(name))[0] or None


def without_extension(text: Optional[str], extension: str) -> Optional[str]:
    """*text* minus a trailing *extension*, so a document named ``scan.pdf``
    does not download as ``scan-pdf.pdf``."""
    if not text:
        return text
    if extension and text.lower().endswith(extension.lower()):
        return text[: -len(extension)] or None
    return text


def local_day(value: Optional[datetime], tz: ZoneInfo) -> Optional[date]:
    """The department's calendar date of a stored UTC timestamp."""
    return local_date(value, tz) if value is not None else None


async def member_name_for(
    db: AsyncSession, user_id: Any, organization_id: Any
) -> Optional[str]:
    """``Smith-John`` for a member of *organization_id*, or None."""
    if not user_id:
        return None
    row = (
        await db.execute(
            select(User.first_name, User.last_name).where(
                User.id == str(user_id),
                User.organization_id == str(organization_id),
            )
        )
    ).first()
    if row is None:
        return None
    return member_name_part(row.first_name, row.last_name) or None
