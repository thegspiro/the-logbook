"""XC-1 for the governance and communications modules, against a real database.

Three create/update paths stored a client-supplied reference without checking
it belonged to the caller's organization:

- elections: ``eligible_voters`` (a JSON list of member ids) on create and on
  PATCH;
- minutes: ``attendees[].user_id`` on create and on update;
- forms: ``condition_field_id`` on a field created inline with its form — the
  add/update field paths already confined it to the same form.

Each refusal is paired with an in-org case on the same field, so a guard that
rejected everything would not pass.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.endpoints.elections import create_election, update_election
from app.models.election import Election
from app.models.forms import Form, FormField
from app.models.minute import MeetingMinutes
from app.models.user import Organization, User
from app.schemas.election import ElectionCreate, ElectionUpdate
from app.schemas.minute import AttendeeEntry, MinutesCreate, MinutesUpdate
from app.services.forms_service import FormsService
from app.services.minute_service import MinuteService

pytestmark = [pytest.mark.integration]


async def _org(db_session, name: str) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"{name.lower()}-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _user(db_session, org: Organization) -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{suffix}",
        email=f"member-{suffix}@example.org",
        first_name="Pat",
        last_name=f"Member{suffix}",
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
async def two_orgs(db_session):
    home = await _org(db_session, "Home")
    other = await _org(db_session, "Other")
    actor = await _user(db_session, home)
    home_member = await _user(db_session, home)
    foreign_member = await _user(db_session, other)
    return {
        "home": home,
        "other": other,
        "actor": actor,
        "home_member": home_member,
        "foreign_member": foreign_member,
    }


# ---------------------------------------------------------------------------
# Elections — eligible_voters
# ---------------------------------------------------------------------------


def _election_payload(title: str, voters) -> ElectionCreate:
    start = datetime.now(timezone.utc) + timedelta(days=1)
    return ElectionCreate(
        title=title,
        start_date=start,
        end_date=start + timedelta(days=1),
        eligible_voters=voters,
    )


async def _election_count(db_session, org_id: str, title: str) -> int:
    result = await db_session.execute(
        select(func.count(Election.id)).where(
            Election.organization_id == org_id, Election.title == title
        )
    )
    return result.scalar() or 0


class TestElectionEligibleVoters:
    async def test_create_refuses_a_foreign_voter(self, db_session, two_orgs):
        title = f"Foreign voter {uuid.uuid4().hex[:6]}"
        payload = _election_payload(
            title,
            [two_orgs["home_member"].id, two_orgs["foreign_member"].id],
        )

        with pytest.raises(HTTPException) as exc:
            await create_election(
                election=payload, db=db_session, current_user=two_orgs["actor"]
            )

        assert exc.value.status_code == 400
        assert await _election_count(db_session, two_orgs["home"].id, title) == 0

    async def test_create_accepts_in_org_voters(self, db_session, two_orgs):
        title = f"Home voters {uuid.uuid4().hex[:6]}"
        payload = _election_payload(title, [two_orgs["home_member"].id])

        response = await create_election(
            election=payload, db=db_session, current_user=two_orgs["actor"]
        )

        assert [str(v) for v in response.eligible_voters or []] == [
            two_orgs["home_member"].id
        ]

    async def test_create_accepts_no_list(self, db_session, two_orgs):
        title = f"Open roster {uuid.uuid4().hex[:6]}"
        await create_election(
            election=_election_payload(title, None),
            db=db_session,
            current_user=two_orgs["actor"],
        )
        assert await _election_count(db_session, two_orgs["home"].id, title) == 1

    async def test_update_refuses_a_foreign_voter(self, db_session, two_orgs):
        title = f"Patch voters {uuid.uuid4().hex[:6]}"
        created = await create_election(
            election=_election_payload(title, [two_orgs["home_member"].id]),
            db=db_session,
            current_user=two_orgs["actor"],
        )

        with pytest.raises(HTTPException) as exc:
            await update_election(
                election_id=created.id,
                election_update=ElectionUpdate(
                    eligible_voters=[two_orgs["foreign_member"].id]
                ),
                db=db_session,
                current_user=two_orgs["actor"],
            )

        assert exc.value.status_code == 400
        stored = await db_session.get(Election, str(created.id))
        await db_session.refresh(stored)
        assert stored.eligible_voters == [two_orgs["home_member"].id]

    async def test_update_accepts_in_org_voters(self, db_session, two_orgs):
        title = f"Patch home {uuid.uuid4().hex[:6]}"
        created = await create_election(
            election=_election_payload(title, None),
            db=db_session,
            current_user=two_orgs["actor"],
        )
        extra = await _user(db_session, two_orgs["home"])

        response = await update_election(
            election_id=created.id,
            election_update=ElectionUpdate(
                eligible_voters=[two_orgs["home_member"].id, extra.id]
            ),
            db=db_session,
            current_user=two_orgs["actor"],
        )

        assert sorted(str(v) for v in response.eligible_voters or []) == sorted(
            [two_orgs["home_member"].id, extra.id]
        )


# ---------------------------------------------------------------------------
# Minutes — attendees[].user_id
# ---------------------------------------------------------------------------


def _minutes_payload(title: str, attendees) -> MinutesCreate:
    return MinutesCreate(
        title=title,
        meeting_date=datetime.now(timezone.utc),
        attendees=attendees,
    )


async def _minutes_count(db_session, org_id: str, title: str) -> int:
    result = await db_session.execute(
        select(func.count(MeetingMinutes.id)).where(
            MeetingMinutes.organization_id == org_id,
            MeetingMinutes.title == title,
        )
    )
    return result.scalar() or 0


class TestMinutesAttendees:
    async def test_create_refuses_a_foreign_attendee(self, db_session, two_orgs):
        title = f"Foreign attendee {uuid.uuid4().hex[:6]}"
        service = MinuteService(db_session)

        with pytest.raises(ValueError, match="Invalid attendee"):
            await service.create_minutes(
                _minutes_payload(
                    title,
                    [
                        AttendeeEntry(user_id=two_orgs["home_member"].id, name="Home"),
                        AttendeeEntry(
                            user_id=two_orgs["foreign_member"].id, name="Other"
                        ),
                    ],
                ),
                two_orgs["home"].id,
                two_orgs["actor"].id,
            )

        assert await _minutes_count(db_session, two_orgs["home"].id, title) == 0

    async def test_create_accepts_members_and_guests(self, db_session, two_orgs):
        """A guest has no user_id and must still be accepted."""
        title = f"Home attendees {uuid.uuid4().hex[:6]}"
        minutes = await MinuteService(db_session).create_minutes(
            _minutes_payload(
                title,
                [
                    AttendeeEntry(user_id=two_orgs["home_member"].id, name="Home"),
                    AttendeeEntry(name="Visiting guest"),
                ],
            ),
            two_orgs["home"].id,
            two_orgs["actor"].id,
        )

        assert [a.get("user_id") for a in minutes.attendees] == [
            two_orgs["home_member"].id,
            None,
        ]

    async def test_update_refuses_a_foreign_attendee(self, db_session, two_orgs):
        service = MinuteService(db_session)
        minutes = await service.create_minutes(
            _minutes_payload(
                f"Update {uuid.uuid4().hex[:6]}",
                [AttendeeEntry(user_id=two_orgs["home_member"].id, name="Home")],
            ),
            two_orgs["home"].id,
            two_orgs["actor"].id,
        )

        with pytest.raises(ValueError, match="Invalid attendee"):
            await service.update_minutes(
                minutes.id,
                two_orgs["home"].id,
                MinutesUpdate(
                    attendees=[
                        AttendeeEntry(
                            user_id=two_orgs["foreign_member"].id, name="Other"
                        )
                    ]
                ),
            )

        await db_session.refresh(minutes)
        assert [a.get("user_id") for a in minutes.attendees] == [
            two_orgs["home_member"].id
        ]

    async def test_update_accepts_in_org_attendee(self, db_session, two_orgs):
        service = MinuteService(db_session)
        minutes = await service.create_minutes(
            _minutes_payload(f"Update ok {uuid.uuid4().hex[:6]}", None),
            two_orgs["home"].id,
            two_orgs["actor"].id,
        )

        updated = await service.update_minutes(
            minutes.id,
            two_orgs["home"].id,
            MinutesUpdate(
                attendees=[
                    AttendeeEntry(user_id=two_orgs["home_member"].id, name="Home")
                ]
            ),
        )

        assert [a.get("user_id") for a in updated.attendees] == [
            two_orgs["home_member"].id
        ]


# ---------------------------------------------------------------------------
# Forms — condition_field_id on a field created with its form
# ---------------------------------------------------------------------------


def _field(label: str, **extra) -> dict:
    return {"label": label, "field_type": "text", **extra}


async def _form_count(db_session, org_id: str, name: str) -> int:
    result = await db_session.execute(
        select(func.count(Form.id)).where(
            Form.organization_id == org_id, Form.name == name
        )
    )
    return result.scalar() or 0


class TestFormInlineFieldCondition:
    async def test_refuses_a_condition_on_another_orgs_field(
        self, db_session, two_orgs
    ):
        service = FormsService(db_session)
        foreign_form, error = await service.create_form(
            two_orgs["other"].id,
            {"name": "Other form", "fields": [_field("Controlling question")]},
            two_orgs["foreign_member"].id,
        )
        assert error is None
        foreign_field_id = foreign_form.fields[0].id

        name = f"Branching {uuid.uuid4().hex[:6]}"
        form, error = await service.create_form(
            two_orgs["home"].id,
            {
                "name": name,
                "fields": [
                    _field(
                        "Follow-up",
                        condition_field_id=foreign_field_id,
                        condition_operator="not_empty",
                    )
                ],
            },
            two_orgs["actor"].id,
        )

        assert form is None
        assert error == "The question this field depends on is not on this form"
        assert await _form_count(db_session, two_orgs["home"].id, name) == 0
        stray = await db_session.execute(
            select(func.count(FormField.id)).where(
                FormField.condition_field_id == foreign_field_id
            )
        )
        assert (stray.scalar() or 0) == 0

    async def test_accepts_fields_without_a_condition(self, db_session, two_orgs):
        name = f"Plain {uuid.uuid4().hex[:6]}"
        form, error = await FormsService(db_session).create_form(
            two_orgs["home"].id,
            {"name": name, "fields": [_field("Name"), _field("Phone")]},
            two_orgs["actor"].id,
        )

        assert error is None
        assert len(form.fields) == 2
        assert await _form_count(db_session, two_orgs["home"].id, name) == 1
