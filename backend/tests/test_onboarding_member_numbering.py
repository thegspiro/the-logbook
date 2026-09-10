"""Member numbers are settled in step 1, and start with the accounts setup makes.

``organization.settings["membership_id"]`` holds a counter that only advances
for members created after it is switched on. The wizard creates the System Owner
in step 9 and the IT team in step 10, so a department that answered this
question on a members screen afterwards ended up with its first two or three
accounts holding no number at all and the roster import starting at the number
they should have had -- an off-by-a-few that surfaces when a badge is printed,
long after anyone would connect it to setup.

Asking in step 1 is what makes the sequence whole. These assert the two halves
of that: the answer reaches organization settings, and the accounts setup itself
creates are numbered from it.
"""

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.onboarding import _membership_id_settings
from app.models.user import User
from app.schemas.organization import OrganizationSetupCreate
from app.services.onboarding import OnboardingService

pytestmark = [pytest.mark.integration, pytest.mark.onboarding]


async def _org(db_session: AsyncSession, membership_id: dict | None = None):
    service = OnboardingService(db_session)
    unique = str(uuid.uuid4())[:8]
    org = await service.create_organization(
        name=f"Numbering Test VFD {unique}",
        slug=f"numbering-test-{unique}",
        organization_type="fire_department",
        timezone="America/New_York",
        settings_dict={"membership_id": membership_id} if membership_id else None,
    )
    await db_session.flush()
    return service, org


async def _owner(service: OnboardingService, org_id: str, **kwargs) -> User:
    unique = str(uuid.uuid4())[:8]
    return await service.create_system_owner(
        organization_id=org_id,
        username=f"owner{unique}",
        email=f"owner-{unique}@example.com",
        password="Str0ng!Passw0rd#2026",
        first_name="Alex",
        last_name="Reyes",
        **kwargs,
    )


def _contact() -> dict:
    unique = str(uuid.uuid4())[:8]
    return {
        "name": "Dana Reyes",
        "email": f"dana-{unique}@example.com",
        "phone": "555-0101",
        "role": "IT Support",
    }


def _setup_payload(**over) -> OrganizationSetupCreate:
    payload = {
        "name": "Numbering Test VFD",
        "organization_type": "fire_department",
        "mailing_address": {
            "line1": "1 Main St",
            "city": "Falls Church",
            "state": "VA",
            "zip_code": "22046",
        },
    }
    payload.update(over)
    return OrganizationSetupCreate.model_validate(payload)


class TestTheAnswerReachesSettings:
    def test_step_one_carries_the_numbering_the_department_chose(self):
        data = _setup_payload(
            membership_id={
                "enabled": True,
                "auto_generate": True,
                "prefix": "FD-",
                "next_number": 7,
            }
        )

        assert _membership_id_settings(data) == {
            "membership_id": {
                "enabled": True,
                "auto_generate": True,
                "prefix": "FD-",
                "next_number": 7,
            }
        }

    def test_skipping_the_question_writes_nothing(self):
        # Absent, not an explicit "off": a department that never saw the
        # question and one that answered "no" must stay distinguishable, so a
        # later default change reaches the first and not the second.
        assert _membership_id_settings(_setup_payload()) == {}

    async def test_the_stored_organization_carries_it(self, db_session: AsyncSession):
        data = _setup_payload(
            membership_id={
                "enabled": True,
                "auto_generate": True,
                "prefix": "FD-",
                "next_number": 7,
            }
        )

        _, org = await _org(db_session, _membership_id_settings(data)["membership_id"])

        assert org.settings["membership_id"]["prefix"] == "FD-"
        assert org.settings["membership_id"]["next_number"] == 7


class TestSetupsOwnAccountsAreNumbered:
    async def test_the_system_owner_gets_the_first_number(
        self, db_session: AsyncSession
    ):
        service, org = await _org(
            db_session,
            {
                "enabled": True,
                "auto_generate": True,
                "prefix": "FD-",
                "next_number": 1,
            },
        )

        owner = await _owner(service, str(org.id))

        assert owner.membership_number == "FD-0001"

    async def test_a_typed_number_wins_over_the_sequence(
        self, db_session: AsyncSession
    ):
        # An officer transcribing an existing badge is not asking for the next
        # number in the sequence.
        service, org = await _org(
            db_session,
            {
                "enabled": True,
                "auto_generate": True,
                "prefix": "FD-",
                "next_number": 1,
            },
        )

        owner = await _owner(service, str(org.id), membership_number="CHIEF-1")

        assert owner.membership_number == "CHIEF-1"

    async def test_the_it_team_continues_the_sequence(self, db_session: AsyncSession):
        service, org = await _org(
            db_session,
            {
                "enabled": True,
                "auto_generate": True,
                "prefix": "FD-",
                "next_number": 1,
            },
        )
        await _owner(service, str(org.id))

        created = await service.create_it_team_users(
            str(org.id), [_contact(), _contact()]
        )

        assert [u.membership_number for u in created] == ["FD-0002", "FD-0003"]

    async def test_nobody_is_numbered_when_the_department_said_no(
        self, db_session: AsyncSession
    ):
        service, org = await _org(db_session)

        owner = await _owner(service, str(org.id))
        created = await service.create_it_team_users(str(org.id), [_contact()])

        assert owner.membership_number is None
        assert [u.membership_number for u in created] == [None]

    async def test_numbering_that_is_on_but_not_automatic_assigns_nothing(
        self, db_session: AsyncSession
    ):
        # A department that shows member numbers but types them in by hand.
        # Minting one here would put a number on a badge nobody issued.
        service, org = await _org(
            db_session,
            {
                "enabled": True,
                "auto_generate": False,
                "prefix": "FD-",
                "next_number": 1,
            },
        )

        owner = await _owner(service, str(org.id))

        assert owner.membership_number is None

    async def test_the_counter_advances_past_the_accounts_setup_created(
        self, db_session: AsyncSession
    ):
        # The roster import that follows setup must not re-issue FD-0001.
        service, org = await _org(
            db_session,
            {
                "enabled": True,
                "auto_generate": True,
                "prefix": "FD-",
                "next_number": 1,
            },
        )
        await _owner(service, str(org.id))
        await service.create_it_team_users(str(org.id), [_contact()])

        refreshed = (
            await db_session.execute(
                select(User).where(User.organization_id == str(org.id))
            )
        ).scalars()
        issued = {u.membership_number for u in refreshed}
        assert issued == {"FD-0001", "FD-0002"}

        from app.services.organization_service import OrganizationService

        assert (
            await OrganizationService(db_session).generate_next_membership_id(org.id)
            == "FD-0003"
        )


class TestCompletionKeepsTheCounter:
    """Completion must not roll the counter back over its own IT contacts.

    ``_persist_session_data_to_org`` deep-copies ``organization.settings``,
    edits the copy, and assigns it back at the end. ``create_it_team_users``
    runs in between and advances ``membership_id.next_number`` on the live row,
    so the final assignment reinstated the value from before those contacts
    were numbered: the Membership ID screen reported a number already on a
    badge, and the next generator call had to rediscover the occupied ones.
    """

    async def test_the_counter_survives_completion(self, db_session: AsyncSession):
        from app.api.v1 import onboarding as onboarding_api

        service, org = await _org(
            db_session,
            {
                "enabled": True,
                "auto_generate": True,
                "prefix": "FD-",
                "next_number": 1,
            },
        )
        await _owner(service, str(org.id))

        session = SimpleNamespace(
            data={"it_team": {"members": [_contact(), _contact()], "backup_access": {}}}
        )
        await onboarding_api._persist_session_data_to_org(session, db_session)

        await db_session.refresh(org)
        assert org.settings["membership_id"]["next_number"] == 4
        assert org.settings["it_team"]["members"]

    async def test_completion_leaves_an_unnumbered_department_alone(
        self, db_session: AsyncSession
    ):
        # No membership_id block at all: reading one back must not invent one.
        from app.api.v1 import onboarding as onboarding_api

        service, org = await _org(db_session)
        await _owner(service, str(org.id))

        session = SimpleNamespace(
            data={"it_team": {"members": [_contact()], "backup_access": {}}}
        )
        await onboarding_api._persist_session_data_to_org(session, db_session)

        await db_session.refresh(org)
        assert "membership_id" not in org.settings
