"""An applicant's own edits stop the self-access guard trusting them (ADV2-10).

The guard hides from a member the application that describes them, matched by
the transfer back-link, an email the member owns, or name and birth date. The
email and the name and birth date are the applicant's to change through a
follow-up form, so an applicant could type a coordinator's details and hide
their own file from that coordinator. Owner decision 2026-11-21: once the
applicant has changed one of them, only ``transferred_user_id`` counts for that
record; a coordinator's correction restores the rest.
"""

import uuid
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.prospect_privacy import load_self_prospect_ids, normalize_prospect_id
from app.models.user import User
from app.services.email_service import EmailService
from app.services.follow_up_form_service import FollowUpFormService
from app.services.membership_pipeline_service import MembershipPipelineService
from tests.test_follow_up_forms import _answers, _arrive, _prospect, _seed, _token_from

pytestmark = [pytest.mark.integration]

BORN = date(1985, 6, 2)


@pytest.fixture
def mail():
    """The follow-up link and contact-change senders, recorded."""
    link = AsyncMock(return_value=True)
    notice = AsyncMock(return_value=True)
    with patch.object(EmailService, "send_follow_up_form_email", link), patch.object(
        EmailService, "send_contact_changed_email", notice
    ):
        yield link, notice


async def _coordinator(db: AsyncSession, org_id: str, email: str) -> str:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, date_of_birth, password_hash, status) VALUES "
            "(:id, :org, :un, 'Casey', 'Coordinator', :em, :dob, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"casey-{user_id[:8]}",
            "em": email,
            "dob": BORN,
        },
    )
    await db.flush()
    return user_id


async def _hidden_from(db: AsyncSession, user_id: str, prospect_id: str) -> bool:
    # Loaded afresh: the services commit, which expires what the test held.
    db.expire_all()
    user = await db.get(User, user_id)
    assert user is not None
    return normalize_prospect_id(prospect_id) in await load_self_prospect_ids(db, user)


class TestAFollowUpEdit:
    async def test_typing_a_coordinators_email_no_longer_hides_the_file(
        self, db_session, mail
    ):
        link, _ = mail
        seed = await _seed(db_session)
        coordinator = await _coordinator(db_session, seed.org_id, "casey@dept.example")
        await _arrive(db_session, seed)

        await FollowUpFormService(db_session).submit(
            _token_from(link), _answers(seed, Email="casey@dept.example")
        )

        prospect = await _prospect(db_session, seed)
        assert prospect.email == "casey@dept.example"
        assert prospect.identity_edited_by_applicant_at is not None
        assert not await _hidden_from(db_session, coordinator, seed.prospect_id)

    async def test_an_edit_to_other_fields_leaves_the_guard_as_it_was(
        self, db_session, mail
    ):
        link, _ = mail
        seed = await _seed(db_session)
        # The member's own application, before transfer: matched by email.
        member = await _coordinator(db_session, seed.org_id, seed.old_email)
        await _arrive(db_session, seed)

        await FollowUpFormService(db_session).submit(
            _token_from(link), _answers(seed, Phone="555-0199")
        )

        prospect = await _prospect(db_session, seed)
        assert prospect.identity_edited_by_applicant_at is None
        assert await _hidden_from(db_session, member, seed.prospect_id)


class TestTheGuardOnAnEditedRecord:
    async def _edited(self, db, seed, **fields):
        prospect = await _prospect(db, seed)
        for key, value in fields.items():
            setattr(prospect, key, value)
        prospect.identity_edited_by_applicant_at = datetime.now(timezone.utc)
        await db.flush()
        return prospect

    async def test_a_matching_name_and_birth_date_is_not_trusted(self, db_session):
        seed = await _seed(db_session)
        coordinator = await _coordinator(db_session, seed.org_id, "c@dept.example")
        await self._edited(
            db_session,
            seed,
            first_name="Casey",
            last_name="Coordinator",
            date_of_birth=BORN,
        )

        assert not await _hidden_from(db_session, coordinator, seed.prospect_id)

    async def test_the_transfer_back_link_still_hides_it(self, db_session):
        seed = await _seed(db_session)
        member = await _coordinator(db_session, seed.org_id, "m@dept.example")
        await self._edited(db_session, seed, transferred_user_id=member)

        assert await _hidden_from(db_session, member, seed.prospect_id)


class TestACoordinatorsCorrection:
    async def test_correcting_the_email_restores_the_match(self, db_session):
        seed = await _seed(db_session)
        member = await _coordinator(db_session, seed.org_id, "m@dept.example")
        prospect = await _prospect(db_session, seed)
        prospect.identity_edited_by_applicant_at = datetime.now(timezone.utc)
        await db_session.commit()

        await MembershipPipelineService(db_session).update_prospect(
            seed.prospect_id, seed.org_id, {"email": "m@dept.example"}
        )

        prospect = await _prospect(db_session, seed)
        assert prospect.identity_edited_by_applicant_at is None
        assert await _hidden_from(db_session, member, seed.prospect_id)

    async def test_an_edit_to_other_fields_keeps_the_stamp(self, db_session):
        seed = await _seed(db_session)
        prospect = await _prospect(db_session, seed)
        prospect.identity_edited_by_applicant_at = datetime.now(timezone.utc)
        await db_session.commit()

        await MembershipPipelineService(db_session).update_prospect(
            seed.prospect_id,
            seed.org_id,
            # The drawer re-sends unchanged fields with every save.
            {"phone": "555-0177", "email": seed.old_email},
        )

        prospect = await _prospect(db_session, seed)
        assert prospect.identity_edited_by_applicant_at is not None

    async def test_the_stamp_cannot_be_written_through_an_update(self, db_session):
        seed = await _seed(db_session)
        prospect = await _prospect(db_session, seed)
        prospect.identity_edited_by_applicant_at = datetime.now(timezone.utc)
        await db_session.commit()

        await MembershipPipelineService(db_session).update_prospect(
            seed.prospect_id,
            seed.org_id,
            {"identity_edited_by_applicant_at": None},
        )

        prospect = await _prospect(db_session, seed)
        assert prospect.identity_edited_by_applicant_at is not None
