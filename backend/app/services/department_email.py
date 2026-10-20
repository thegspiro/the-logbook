"""Department email addresses: first.last@domain, per Organization Settings.

One rule for every path that gives a member a department address -- converting
an applicant, and adding a member who is getting a directory account -- so the
two cannot produce different addresses for the same name.
"""

import re
import unicodedata
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


def sanitize_name_for_identifier(name: str) -> str:
    """Normalize a name for use in usernames and email local parts.

    Strips accents (François → francois), removes apostrophes and
    non-alphanumeric characters, and lowercases the result.
    """
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_only = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", ascii_only.lower())


async def generate_department_email(
    db: AsyncSession, organization_id: str, first_name: str, last_name: str
) -> Optional[str]:
    """A department address no member of the organization uses yet.

    Returns None when department addresses are turned off, no domain is set,
    or a name sanitizes to nothing.
    """
    from loguru import logger

    from app.schemas.organization import DepartmentEmailFormat
    from app.services.organization_service import OrganizationService

    org_settings = await OrganizationService(db).get_organization_settings(
        organization_id
    )
    dept = org_settings.department_email
    if not dept.enabled or not dept.domain:
        return None

    first = sanitize_name_for_identifier(first_name)
    last = sanitize_name_for_identifier(last_name)
    if not first or not last:
        logger.warning(
            "Skipping department email generation: sanitized name is empty "
            f"(first={first_name!r}, last={last_name!r})"
        )
        return None

    if dept.format == DepartmentEmailFormat.FIRST_INITIAL_LAST:
        local = f"{first[0]}{last}"
    elif dept.format == DepartmentEmailFormat.FIRST_LAST:
        local = f"{first}{last}"
    elif dept.format == DepartmentEmailFormat.LAST_DOT_FIRST:
        local = f"{last}.{first}"
    else:
        local = f"{first}.{last}"

    candidate = f"{local}@{dept.domain}"
    suffix = 0
    while True:
        taken = await db.execute(
            select(func.count())
            .select_from(User)
            .where(
                User.organization_id == str(organization_id),
                User.email == candidate,
            )
        )
        if (taken.scalar() or 0) == 0:
            return candidate
        suffix += 1
        candidate = f"{local}{suffix}@{dept.domain}"
