"""Shared set-up for the attendance waiver request tests.

A department, its members and positions, attendance requirements and training
sessions linked to them, and the session waiver policy. Plain helpers over a
session, so the rolled-back ``db_session`` tests and the race tests (which
commit on their own connections) build the same department.
"""

import copy
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.event import Event, EventType
from app.models.training import (
    RequirementFrequency,
    RequirementSource,
    RequirementType,
    TrainingRequirement,
    TrainingSession,
    TrainingSessionRequirement,
    TrainingType,
)
from app.models.user import Organization, User


def uid() -> str:
    return str(uuid.uuid4())


def utc(y: int, m: int, d: int, h: int = 0, minute: int = 0) -> datetime:
    return datetime(y, m, d, h, minute, tzinfo=timezone.utc)


async def make_org(db, tz: str = "America/New_York", **policy) -> str:
    """A department; with ``policy`` fields, its session waiver policy saved."""
    org = Organization(
        id=uid(),
        name="Waiver Test Department",
        slug=f"waiver-{uuid.uuid4().hex[:8]}",
        timezone=tz,
        settings=(
            {"training": {"session_waiver_policy": {"enabled": True, **policy}}}
            if policy
            else {}
        ),
    )
    db.add(org)
    await db.flush()
    return str(org.id)


async def set_policy(db, org_id: str, **fields) -> None:
    """Store the department's policy as a training officer's save would."""
    org = (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one()
    settings = copy.deepcopy(org.settings or {})
    settings.setdefault("training", {})["session_waiver_policy"] = {
        "enabled": True,
        **fields,
    }
    org.settings = settings
    await db.flush()


async def make_member(
    db, org_id: str, first: str, *, status: str = "active", exempt: bool = False
) -> str:
    user_id = uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status, membership_type, compliance_exempt) "
            "VALUES (:id, :org, :un, :fn, 'Member', :em, 'hashed', :st, 'active', "
            ":ex)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@waiver.test",
            "st": status,
            "ex": exempt,
        },
    )
    return user_id


async def make_position(
    db, org_id: str, name: str, *, slug: Optional[str] = None, permissions=()
) -> str:
    position_id = uid()
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions, "
            "is_system) VALUES (:id, :org, :name, :slug, :perms, 0)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": name,
            "slug": slug or f"p-{position_id[:8]}",
            "perms": json.dumps(list(permissions)),
        },
    )
    return position_id


async def assign(db, user_id: str, position_id: str) -> None:
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )


async def load(db: AsyncSession, user_id: str) -> User:
    """The member as the endpoints see them: positions loaded."""
    user: User = (
        await db.execute(
            select(User)
            .options(selectinload(User.positions))
            .where(User.id == user_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return user


async def make_requirement(db, org_id: str, **fields) -> TrainingRequirement:
    values = dict(
        id=uid(),
        organization_id=org_id,
        name=f"Drills {uuid.uuid4().hex[:6]}",
        requirement_type=RequirementType.SESSION_ATTENDANCE,
        source=RequirementSource.DEPARTMENT,
        frequency=RequirementFrequency.ANNUAL,
        required_attendance_pct=50,
        required_hours=10,
        applies_to_all=True,
    )
    values.update(fields)
    requirement = TrainingRequirement(**values)
    db.add(requirement)
    await db.flush()
    return requirement


async def make_session(
    db,
    org_id: str,
    start: datetime,
    *,
    link: Iterable[TrainingRequirement] = (),
    hours: int = 2,
    finalized: bool = False,
    cancelled: bool = False,
    event_type: EventType = EventType.TRAINING,
    title: str = "Company Drill",
) -> str:
    """A training event with its session, linked to ``link``; the event id."""
    event = Event(
        id=uid(),
        organization_id=org_id,
        title=title,
        event_type=event_type,
        start_datetime=start,
        end_datetime=start + timedelta(hours=hours),
        is_cancelled=cancelled,
    )
    db.add(event)
    await db.flush()
    session = TrainingSession(
        id=uid(),
        organization_id=org_id,
        event_id=event.id,
        course_name=title,
        training_type=TrainingType.CONTINUING_EDUCATION,
        credit_hours=hours,
        is_finalized=finalized,
    )
    db.add(session)
    await db.flush()
    for requirement in link:
        db.add(
            TrainingSessionRequirement(
                organization_id=org_id,
                session_id=session.id,
                requirement_id=requirement.id,
            )
        )
    await db.flush()
    return str(event.id)


async def set_meeting_policy(db, org_id: str, **fields) -> None:
    """Store the business-meeting policy as the Secretary's save would."""
    org = (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one()
    settings = copy.deepcopy(org.settings or {})
    settings.setdefault("meetings", {})["waiver_policy"] = {"enabled": True, **fields}
    org.settings = settings
    await db.flush()


async def make_meeting_event(
    db,
    org_id: str,
    start: datetime,
    *,
    hours: int = 2,
    cancelled: bool = False,
    title: str = "Monthly Business Meeting",
) -> str:
    """A business_meeting event, with no minutes record; the event id."""
    event = Event(
        id=uid(),
        organization_id=org_id,
        title=title,
        event_type=EventType.BUSINESS_MEETING,
        start_datetime=start,
        end_datetime=start + timedelta(hours=hours),
        is_cancelled=cancelled,
    )
    db.add(event)
    await db.flush()
    return str(event.id)


async def make_minutes_record(
    db, org_id: str, created_by: str, *, event_id: Optional[str] = None, day=None
) -> str:
    """A minutes record (``Meeting``), linked to ``event_id`` when given."""
    from datetime import date

    from app.models.meeting import Meeting, MeetingStatus, MeetingType

    meeting = Meeting(
        id=uid(),
        organization_id=org_id,
        title="Business Meeting",
        meeting_type=MeetingType.BUSINESS,
        meeting_date=day or date(2026, 11, 20),
        event_id=event_id,
        status=MeetingStatus.DRAFT,
        created_by=created_by,
    )
    db.add(meeting)
    await db.flush()
    return str(meeting.id)
