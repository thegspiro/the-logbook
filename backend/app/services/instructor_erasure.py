"""An erased member's name where it is stored as an instructor.

Owner decision 2026-11-23: on anonymisation and on permanent delete the
member's name is replaced with :data:`FORMER_MEMBER` in the three places that
store it as an instructor:

* ``event_templates.training_details`` — the lead instructor's name, and its
  ``instructor_id`` is cleared, so applying the template no longer names a
  member at all;
* ``training_sessions.instructor`` — the free-text name beside an
  ``instructor_id`` that is the member;
* attendees' ``training_records.instructor`` — the copy of that session's
  name finalizing wrote onto each attendee's record (matched by the session's
  event and the name as the session held it).

"Former member" rather than a blank, so the records stay off the NFPA
completeness report's missing-instructor list. ``training_sessions``
keeps ``instructor_id``: on an anonymisation it points at the anonymised
shell, and a permanent delete sets it NULL through its foreign key.

Migration ``9c41e7b2d5a3`` applies the same rule to members anonymised before
it; its copy of the template rule is frozen there.
"""

import copy
from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import EventTemplate
from app.models.training import TrainingRecord, TrainingSession
from app.utils.sql_results import rows_affected

FORMER_MEMBER = "Former member"


@dataclass
class InstructorErasure:
    templates: int = 0
    sessions: int = 0
    records: int = 0


async def replace_instructor_name(
    db: AsyncSession, user_id: str, organization_id: str
) -> InstructorErasure:
    """Write :data:`FORMER_MEMBER` over *user_id*'s name as an instructor.

    Flushes nothing itself and never commits. Call it before a permanent
    delete removes the users row: the sessions are found by their
    ``instructor_id``, which the delete sets NULL.
    """
    member = str(user_id)
    org_id = str(organization_id)
    erasure = InstructorErasure()

    # Templates are few per department, and the id sits inside JSON, so the
    # match is made here rather than with a dialect-specific JSON path.
    templates = (
        (
            await db.execute(
                select(EventTemplate)
                .where(
                    EventTemplate.organization_id == org_id,
                    EventTemplate.training_details.is_not(None),
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    for template in templates:
        details = template.training_details
        if not isinstance(details, dict) or str(details.get("instructor_id")) != member:
            continue
        # A new dict, not an in-place edit: a plain JSON column does not see a
        # nested change (pitfall #12).
        rewritten = copy.deepcopy(details)
        rewritten["instructor_id"] = None
        rewritten["instructor"] = FORMER_MEMBER
        template.training_details = rewritten
        erasure.templates += 1

    sessions = (
        await db.execute(
            select(
                TrainingSession.id, TrainingSession.event_id, TrainingSession.instructor
            )
            .where(
                TrainingSession.organization_id == org_id,
                TrainingSession.instructor_id == member,
            )
            .with_for_update()
        )
    ).all()
    for session_id, event_id, name in sessions:
        # The records first, matched by the name the session still holds.
        if name and name != FORMER_MEMBER and event_id:
            result = await db.execute(
                update(TrainingRecord)
                .where(
                    TrainingRecord.organization_id == org_id,
                    TrainingRecord.source_event_id == str(event_id),
                    TrainingRecord.instructor == name,
                )
                .values(instructor=FORMER_MEMBER)
                .execution_options(synchronize_session=False)
            )
            erasure.records += rows_affected(result) or 0
        if name != FORMER_MEMBER:
            await db.execute(
                update(TrainingSession)
                .where(TrainingSession.id == session_id)
                .values(instructor=FORMER_MEMBER)
                .execution_options(synchronize_session=False)
            )
            erasure.sessions += 1
    return erasure
