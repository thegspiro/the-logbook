"""
The course name a member sees for one of their training records.

A record stores the name it arrived with: an imported CSV row keeps the CSV's
spelling and a provider sync keeps the provider's title, even after an officer
maps it to a library course. Members are shown the library course's name
instead whenever the record is linked to one, so their history reads the same
as the department's catalog and follows a later rename.

This is read-side only and deliberately not applied to the officer-facing
record endpoints: the record edit form sends ``course_name`` back on save, so
showing it the library name would quietly overwrite the stored one.
"""

from collections.abc import Iterable
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import TrainingCourse


async def library_course_names(
    db: AsyncSession, organization_id: str, course_ids: Iterable[Optional[str]]
) -> dict[str, str]:
    """Map each linked course id to its library name, within the organization.

    Scoped to the organization so a record pointing at another department's
    course id (which should not exist, but the column carries no such
    constraint) falls back to its stored name rather than leaking a name.
    """
    ids = {str(cid) for cid in course_ids if cid}
    if not ids:
        return {}
    result = await db.execute(
        select(TrainingCourse.id, TrainingCourse.name).where(
            TrainingCourse.id.in_(ids),
            TrainingCourse.organization_id == str(organization_id),
        )
    )
    return {str(cid): name for cid, name in result.all() if name}


def member_course_name(
    course_id: Optional[str], stored_name: str, names: dict[str, str]
) -> str:
    """The library name when the record is linked to a known course, else its own."""
    if course_id:
        return names.get(str(course_id), stored_name)
    return stored_name
