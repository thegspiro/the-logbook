"""
A walk-in staff sign in by hand at a pipeline-linked event gets an application.

At an event that adds its guests to the prospective members pipeline, the
kiosk signs in only applicants it already knows and sends everyone else to
staff. Staff checking such a walk-in in (``PATCH .../external-attendees/{id}/
check-in``) is therefore where the visitor's application is opened. These
drive the real endpoint function against the real schema, because what gets
matched (an existing applicant, a member account) is a query property.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.events import check_in_external_attendee
from app.core.security import email_fingerprint
from app.models.event import (
    CheckInWindowType,
    Event,
    EventExternalAttendee,
    EventType,
)
from app.models.membership_pipeline import (
    ProspectEventLink,
    ProspectiveMember,
    ProspectStatus,
)
from app.services.guest_check_in_service import GuestCheckInService
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def org(db_session: AsyncSession) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Walk-in Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"walkin-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


def _email() -> str:
    return f"walkin-{uuid.uuid4().hex[:10]}@test.example"


async def _event(db_session, org_id, *, pipeline=True) -> Event:
    now = datetime.now(timezone.utc)
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        title="Recruitment Night",
        event_type=EventType.PUBLIC_EDUCATION,
        start_datetime=now - timedelta(minutes=10),
        end_datetime=now + timedelta(hours=2),
        check_in_window_type=CheckInWindowType.FLEXIBLE,
        allow_guest_check_in=True,
        guest_check_in_creates_prospect=pipeline,
    )
    db_session.add(event)
    await db_session.flush()
    return event


async def _attendee(db_session, org_id, event, *, name, email, phone=None):
    attendee = EventExternalAttendee(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        event_id=event.id,
        name=name,
        email=email,
        phone=phone,
    )
    db_session.add(attendee)
    await db_session.commit()
    return attendee


async def _check_in(db_session, org_id, event, attendee):
    return await check_in_external_attendee(
        event_id=uuid.UUID(str(event.id)),
        attendee_id=uuid.UUID(str(attendee.id)),
        db=db_session,
        current_user=SimpleNamespace(organization_id=org_id),
    )


async def _applicants(db_session, email) -> list[ProspectiveMember]:
    result = await db_session.execute(
        select(ProspectiveMember).where(
            ProspectiveMember.email_hash == email_fingerprint(email)
        )
    )
    return list(result.scalars().all())


class TestWalkInApplication:
    async def test_walk_in_at_a_pipeline_event_gets_an_application(
        self, db_session: AsyncSession, org
    ):
        event = await _event(db_session, org)
        email = _email()
        attendee = await _attendee(
            db_session,
            org,
            event,
            name="Mary Anne Walker",
            email=email.upper(),
            phone="(703) 555-0100",
        )

        response = await _check_in(db_session, org, event, attendee)

        [prospect] = await _applicants(db_session, email)
        assert response.status == "checked_in"
        assert response.prospect_id == prospect.id
        assert prospect.first_name == "Mary Anne"
        assert prospect.last_name == "Walker"
        assert prospect.email == email
        assert prospect.phone == "(703) 555-0100"
        assert prospect.status == ProspectStatus.ACTIVE
        assert prospect.metadata_["source"] == GuestCheckInService.SOURCE_STAFF_ENTRY

        await db_session.refresh(attendee)
        assert attendee.checked_in is True
        assert attendee.prospect_id == prospect.id

        link = (
            await db_session.execute(
                select(ProspectEventLink).where(
                    ProspectEventLink.prospect_id == prospect.id,
                    ProspectEventLink.event_id == event.id,
                )
            )
        ).scalar_one()
        assert "by staff" in (link.notes or "")

    async def test_checking_in_twice_opens_one_application(
        self, db_session: AsyncSession, org
    ):
        event = await _event(db_session, org)
        email = _email()
        attendee = await _attendee(
            db_session, org, event, name="Sam Twice", email=email
        )

        first = await _check_in(db_session, org, event, attendee)
        second = await _check_in(db_session, org, event, attendee)

        applicants = await _applicants(db_session, email)
        assert len(applicants) == 1
        assert first.prospect_id == second.prospect_id == applicants[0].id
        links = await db_session.scalar(
            select(func.count())
            .select_from(ProspectEventLink)
            .where(ProspectEventLink.prospect_id == applicants[0].id)
        )
        assert links == 1

    async def test_existing_applicant_is_linked_not_duplicated(
        self, db_session: AsyncSession, org
    ):
        event = await _event(db_session, org)
        email = _email()
        existing = ProspectiveMember(
            id=str(uuid.uuid4()),
            organization_id=org,
            first_name="Already",
            last_name="Applied",
            email=email,
            status=ProspectStatus.ACTIVE,
        )
        db_session.add(existing)
        attendee = await _attendee(
            db_session, org, event, name="Already Applied", email=email
        )

        response = await _check_in(db_session, org, event, attendee)

        assert response.prospect_id == existing.id
        assert len(await _applicants(db_session, email)) == 1

    async def test_long_phone_is_left_off_the_application(
        self, db_session: AsyncSession, org
    ):
        event = await _event(db_session, org)
        email = _email()
        attendee = await _attendee(
            db_session,
            org,
            event,
            name="Long Number",
            email=email,
            phone="+1 (703) 555-0100 ext. 4421",
        )

        await _check_in(db_session, org, event, attendee)

        [prospect] = await _applicants(db_session, email)
        assert prospect.phone is None


class TestNoApplication:
    async def test_event_without_the_pipeline_switch(
        self, db_session: AsyncSession, org
    ):
        event = await _event(db_session, org, pipeline=False)
        email = _email()
        attendee = await _attendee(
            db_session, org, event, name="Plain Guest", email=email
        )

        response = await _check_in(db_session, org, event, attendee)

        assert response.prospect_id is None
        assert await _applicants(db_session, email) == []

    async def test_guest_without_an_email(self, db_session: AsyncSession, org):
        event = await _event(db_session, org)
        attendee = await _attendee(db_session, org, event, name="No Email", email=None)

        response = await _check_in(db_session, org, event, attendee)

        assert response.prospect_id is None
        await db_session.refresh(attendee)
        assert attendee.checked_in is True

    async def test_guest_with_a_single_name(self, db_session: AsyncSession, org):
        event = await _event(db_session, org)
        email = _email()
        attendee = await _attendee(db_session, org, event, name="Cher", email=email)

        response = await _check_in(db_session, org, event, attendee)

        assert response.prospect_id is None
        assert await _applicants(db_session, email) == []

    async def test_member_account_is_not_made_an_applicant(
        self, db_session: AsyncSession, org
    ):
        event = await _event(db_session, org)
        email = _email()
        user_id = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, email_hash, password_hash, status) "
                "VALUES (:id, :org, :un, 'Mo', 'Member', :em, :fp, 'hashed', "
                "'active')"
            ),
            {
                "id": user_id,
                "org": org,
                "un": f"m-{user_id[:8]}",
                "em": email,
                "fp": email_fingerprint(email),
            },
        )
        attendee = await _attendee(
            db_session, org, event, name="Mo Member", email=email
        )

        response = await _check_in(db_session, org, event, attendee)

        assert response.prospect_id is None
        assert await _applicants(db_session, email) == []

    async def test_pipeline_failure_still_checks_the_guest_in(
        self, db_session: AsyncSession, org, monkeypatch
    ):
        event = await _event(db_session, org)
        email = _email()
        attendee = await _attendee(
            db_session, org, event, name="Unlucky Walker", email=email
        )
        # The endpoint rolls back after the pipeline fails, which expires
        # every instance in the session.
        attendee_id = attendee.id

        async def _boom(self, *args, **kwargs):
            raise RuntimeError("pipeline down")

        monkeypatch.setattr(MembershipPipelineService, "create_prospect", _boom)

        response = await _check_in(db_session, org, event, attendee)

        assert response.status == "checked_in"
        assert response.prospect_id is None
        checked_in = await db_session.scalar(
            select(EventExternalAttendee.checked_in).where(
                EventExternalAttendee.id == attendee_id
            )
        )
        assert checked_in is True
