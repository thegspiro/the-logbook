"""The courses a COURSES training requirement is made of, as a member stands.

A COURSES requirement is graded as "required courses completed / courses
required", and that count alone does not say which courses are meant. These
helpers name them: the course catalog for every required id, loaded once per
member, and the per-requirement checklist the requirement card lists.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from datetime import date
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import RequirementType, TrainingCourse

CourseCatalog = Mapping[str, tuple[str, Optional[str]]]


def _requirement_type(req: Any) -> str:
    value: Any = getattr(req, "requirement_type", None)
    return str(getattr(value, "value", value))


async def load_required_course_catalog(
    db: AsyncSession, organization_id: str, requirements: Iterable[Any]
) -> dict[str, tuple[str, Optional[str]]]:
    """``{course_id: (name, code)}`` for every course a COURSES requirement names.

    Scoped to the organization: ``required_courses`` is a JSON list of ids
    with no foreign key behind it, so an id belonging to another
    organization, or to a course since deleted, is simply absent here and
    the checklist reports it without a name rather than leaking one.
    """
    course_ids = {
        str(cid)
        for req in requirements
        if _requirement_type(req) == RequirementType.COURSES.value
        for cid in (getattr(req, "required_courses", None) or [])
        if cid
    }
    if not course_ids:
        return {}
    result = await db.execute(
        select(TrainingCourse.id, TrainingCourse.name, TrainingCourse.code).where(
            TrainingCourse.organization_id == str(organization_id),
            TrainingCourse.id.in_(course_ids),
        )
    )
    return {str(row.id): (row.name, row.code) for row in result.all()}


def course_checklist_entries(
    course_ids: Sequence[Any],
    windowed_records: Iterable[Any],
    catalog: CourseCatalog,
) -> list[dict[str, Any]]:
    """One entry per required course, in the requirement's own order.

    ``completed`` uses exactly the test the count does — a record for the
    course among *windowed_records*, the completed in-window records — so the
    ticked entries always add up to the figure shown. ``completed_on`` is the
    latest completion date among them, null for a record that carries none
    (possible when the requirement has no window). ``name`` is null for an
    id the catalog does not hold.
    """
    done: set[str] = set()
    latest: dict[str, date] = {}
    for record in windowed_records:
        course_id = getattr(record, "course_id", None)
        if not course_id:
            continue
        key = str(course_id)
        done.add(key)
        completed = getattr(record, "completion_date", None)
        if completed is not None and (key not in latest or completed > latest[key]):
            latest[key] = completed

    entries: list[dict[str, Any]] = []
    for raw_id in course_ids:
        course_id = str(raw_id)
        name, code = catalog.get(course_id, (None, None))
        completed_on = latest.get(course_id)
        entries.append(
            {
                "course_id": course_id,
                "name": name,
                "code": code,
                "completed": course_id in done,
                "completed_on": completed_on.isoformat() if completed_on else None,
            }
        )
    return entries
