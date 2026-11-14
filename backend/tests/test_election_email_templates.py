"""Election notices are the department's templates (2026-11-14).

Nominations open, a nomination to answer, a nomination accepted on the
member's behalf, a proxy authorized, and the pre-meeting package were built in
code. Each now renders the department's stored template, falls back to the
shipped default, and is not sent when switched off. The pre-meeting package is
a hand send, so switched off it refuses with a reason instead of going quiet,
and the nominations announcement switched off is reported as such rather than
as a failure the managers are alarmed about.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email_template import EmailTemplate, EmailTemplateType
from app.services.ballot_send_jobs import NominationsAnnouncementSend
from app.services.election_service import (
    PRE_MEETING_PACKAGE_SWITCHED_OFF,
    PROXY_ANONYMITY_WARNING,
    ElectionService,
)
from tests.test_election_nominations import TestNominationSetup

pytestmark = pytest.mark.integration

_SEND = "app.services.email_service.EmailService.send_email"


def _accept_all():
    async def send(**kwargs):
        if "results_out" in kwargs:
            kwargs["results_out"].extend([True] * len(kwargs["to_emails"]))
        return len(kwargs["to_emails"]), 0

    return AsyncMock(side_effect=send)


async def _store(
    db: AsyncSession,
    org_id: str,
    template_type: EmailTemplateType,
    *,
    subject: str = "Edited",
    html: str = "<p>Edited body</p>",
    active: bool = True,
) -> None:
    db.add(
        EmailTemplate(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            template_type=template_type,
            name=f"Edited {template_type.value}",
            subject=subject,
            html_body=html,
            text_body="Edited text",
            is_active=active,
        )
    )
    await db.flush()


class _Base(TestNominationSetup):
    async def _open(self, db: AsyncSession, org_id: str, user_id: str):
        election_id = await self._insert_election(db, org_id, user_id)
        svc = ElectionService(db)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))
        return svc, election_id

    @staticmethod
    async def _user(db: AsyncSession, user_id: str):
        row = (
            await db.execute(
                text("SELECT id, first_name, email FROM users WHERE id = :id"),
                {"id": user_id},
            )
        ).one()
        return SimpleNamespace(
            id=row.id,
            first_name=row.first_name,
            preferred_name=None,
            full_name=f"{row.first_name} Member",
            email=row.email,
        )


class TestNominationsOpen(_Base):
    async def test_the_departments_wording_is_sent(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        svc, election_id = await self._open(db_session, org_id, user1_id)
        await _store(
            db_session,
            org_id,
            EmailTemplateType.ELECTION_NOMINATIONS_OPEN,
            subject="Stand for office: {{election_title}}",
            html="<p>Positions open: {{positions}}</p>",
        )

        send = _accept_all()
        with patch(_SEND, new=send):
            await svc.announce_nominations_open(election_id, org_id, user1_id)

        kwargs = send.await_args.kwargs
        assert kwargs["subject"].startswith("Stand for office: Nomination Election")
        assert "Positions open: Chief" in kwargs["html_body"]
        assert kwargs["template_type"] == "election_nominations_open"

    async def test_switched_off_sends_nothing_and_raises_no_alarm(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        svc, election_id = await self._open(db_session, org_id, user1_id)
        await _store(
            db_session,
            org_id,
            EmailTemplateType.ELECTION_NOMINATIONS_OPEN,
            active=False,
        )
        election = await svc.get_election(uuid.UUID(election_id), org_id)

        send = _accept_all()
        with (
            patch(_SEND, new=send),
            patch.object(
                ElectionService, "record_announcement_failure", AsyncMock()
            ) as alarm,
        ):
            response = await NominationsAnnouncementSend(acting_user_id=user1_id)(
                svc, election, org_id
            )

        assert send.await_count == 0
        alarm.assert_not_awaited()
        assert response.success
        assert "switched off" in response.message


class TestNominee(_Base):
    async def test_the_departments_wording_greets_the_nominee(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        svc, election_id = await self._open(db_session, org_id, user1_id)
        election = await svc.get_election(uuid.UUID(election_id), org_id)
        await _store(
            db_session,
            org_id,
            EmailTemplateType.ELECTION_NOMINATED,
            subject="{{recipient_name}}, will you run for {{position}}?",
        )
        candidate = SimpleNamespace(id="c-1", user_id=user2_id, position="Chief")

        send = _accept_all()
        with (
            patch(_SEND, new=send),
            patch.object(ElectionService, "_record_nominee_bell_notice", AsyncMock()),
        ):
            await svc._notify_nominee(election, candidate, org_id)

        nominee = await self._user(db_session, user2_id)
        assert send.await_args.kwargs["to_emails"] == [nominee.email]
        assert send.await_args.kwargs["subject"] == (
            f"{nominee.first_name}, will you run for Chief?"
        )

    async def test_switched_off_sends_nothing(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        svc, election_id = await self._open(db_session, org_id, user1_id)
        election = await svc.get_election(uuid.UUID(election_id), org_id)
        await _store(
            db_session, org_id, EmailTemplateType.ELECTION_NOMINATED, active=False
        )
        candidate = SimpleNamespace(id="c-1", user_id=user2_id, position="Chief")

        send = _accept_all()
        with (
            patch(_SEND, new=send),
            patch.object(ElectionService, "_record_nominee_bell_notice", AsyncMock()),
        ):
            await svc._notify_nominee(election, candidate, org_id)

        assert send.await_count == 0


class TestAcceptedForYou(_Base):
    async def test_how_to_decline_follows_the_phase(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        svc, election_id = await self._open(db_session, org_id, user1_id)
        election = await svc.get_election(uuid.UUID(election_id), org_id)
        candidate = SimpleNamespace(id="c-1", user_id=user2_id, position="Chief")

        send = _accept_all()
        with patch(_SEND, new=send):
            await svc._notify_accepted_on_behalf(election, candidate, user1_id)
        open_body = send.await_args.kwargs["html_body"]
        assert "Nominations tab before nominations close" in open_body

        await svc.close_nominations(uuid.UUID(election_id), uuid.UUID(org_id))
        election = await svc.get_election(uuid.UUID(election_id), org_id)
        with patch(_SEND, new=send):
            await svc._notify_accepted_on_behalf(election, candidate, user1_id)
        assert "contact your secretary" in send.await_args.kwargs["html_body"]
        assert send.await_args.kwargs["template_type"] == (
            "election_nomination_accepted_for_you"
        )


class TestProxy(_Base):
    async def _send(self, db, org_id, user1_id, user2_id, *, anonymous: bool):
        svc, election_id = await self._open(db, org_id, user1_id)
        await db.execute(
            text("UPDATE elections SET anonymous_voting = :a WHERE id = :id"),
            {"a": 1 if anonymous else 0, "id": election_id},
        )
        election = await svc.get_election(uuid.UUID(election_id), org_id)
        send = _accept_all()
        with patch(_SEND, new=send):
            await svc._notify_proxy_delegator(
                election,
                org_id,
                await self._user(db, user1_id),
                await self._user(db, user2_id),
            )
        return send.await_args.kwargs

    async def test_an_anonymous_election_warns_the_member(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        kwargs = await self._send(
            db_session, org_id, user1_id, user2_id, anonymous=True
        )
        assert "a proxy ballot is not anonymous" in kwargs["html_body"]
        assert PROXY_ANONYMITY_WARNING in kwargs["text_body"]

    async def test_an_open_election_carries_no_warning(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        kwargs = await self._send(
            db_session, org_id, user1_id, user2_id, anonymous=False
        )
        assert "not anonymous" not in kwargs["html_body"]
        assert "Didn't ask for this?" in kwargs["html_body"]
        assert kwargs["template_type"] == "election_proxy_authorized"


class TestPreMeetingPackage(_Base):
    async def test_switched_off_refuses_before_building_anything(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        await _store(
            db_session, org_id, EmailTemplateType.PRE_MEETING_PACKAGE, active=False
        )

        send = _accept_all()
        with (
            patch(_SEND, new=send),
            patch.object(
                ElectionService, "build_pre_meeting_package_pdf", AsyncMock()
            ) as build,
        ):
            result = await ElectionService(
                db_session
            ).generate_and_send_pre_meeting_package(
                uuid.UUID(election_id), org_id, user1_id, ["clerk@example.org"]
            )

        assert result == (False, PRE_MEETING_PACKAGE_SWITCHED_OFF, 0, [])
        build.assert_not_awaited()
        assert send.await_count == 0
