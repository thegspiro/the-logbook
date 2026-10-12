"""W50-14: an election records when it actually closed, and who closed it.

``end_date`` is the *scheduled* end and an early manual close left it
untouched, so the certified PDF, the report and every card dated the close
to a moment that never happened, and the ``election_closed`` audit row
carried no actor. ``close_election`` now stamps ``closed_at`` / ``closed_by``
(NULL officer for a lifecycle close), the audit row names the officer, and
the PDF and report print the actual instant.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest
from pypdf import PdfReader
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.election import ElectionResponse
from app.services.election_service import ElectionService
from tests.test_election_lifecycle import TestLifecycleSetup

pytestmark = [pytest.mark.integration]


async def _closed_audit_row(db_session: AsyncSession, election_id: str):
    result = await db_session.execute(
        text(
            "SELECT user_id, event_data FROM audit_logs "
            "WHERE event_type = 'election_closed' "
            "AND JSON_UNQUOTE(JSON_EXTRACT(event_data, '$.election_id')) = :eid "
            "ORDER BY id DESC LIMIT 1"
        ),
        {"eid": election_id},
    )
    user_id, event_data = result.one()
    if isinstance(event_data, str):
        event_data = json.loads(event_data)
    return user_id, event_data


def _within_a_minute(dt: datetime, of: datetime) -> bool:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return abs((dt - of).total_seconds()) < 60


class TestClosedAtStamp(TestLifecycleSetup):
    async def test_manual_close_stamps_actual_instant_and_officer(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        now = datetime.now(timezone.utc)
        scheduled_end = now + timedelta(days=2)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=now - timedelta(days=1),
            end=scheduled_end,
        )
        svc = ElectionService(db_session)

        closed, err = await svc.close_election(
            uuid.UUID(election_id), uuid.UUID(org_id), closed_by=uuid.UUID(user1_id)
        )
        assert err is None, err

        assert closed.closed_at is not None
        assert _within_a_minute(closed.closed_at, now), closed.closed_at
        assert not _within_a_minute(closed.closed_at, scheduled_end)
        assert closed.closed_by == user1_id

        actor, event_data = await _closed_audit_row(db_session, election_id)
        assert actor == user1_id
        assert event_data["automatic"] is False

        response = ElectionResponse.model_validate(closed)
        assert response.closed_by == uuid.UUID(user1_id)
        assert _within_a_minute(response.closed_at, now)
        assert await svc.closed_by_name(closed) == "Alice Anderson"

    async def test_lifecycle_close_stamps_instant_without_officer(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        now = datetime.now(timezone.utc)
        scheduled_end = now - timedelta(hours=3)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=now - timedelta(days=2),
            end=scheduled_end,
        )
        svc = ElectionService(db_session)

        actions = await svc.process_election_lifecycle(uuid.UUID(org_id))
        assert actions >= 1

        election = await self._get_election(db_session, election_id)
        assert election.closed_at is not None
        # The task ran now, hours after the scheduled end; that is the record.
        assert _within_a_minute(election.closed_at, now)
        assert election.closed_by is None
        assert await svc.closed_by_name(election) is None

        actor, event_data = await _closed_audit_row(db_session, election_id)
        assert actor is None
        assert event_data["automatic"] is True

    async def test_rollback_to_open_clears_the_stamp(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=now - timedelta(days=1),
            end=now + timedelta(days=1),
        )
        svc = ElectionService(db_session)
        _closed, err = await svc.close_election(
            uuid.UUID(election_id), uuid.UUID(org_id), closed_by=uuid.UUID(user1_id)
        )
        assert err is None, err

        reopened, _n, err = await svc.rollback_election(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            uuid.UUID(user1_id),
            "closed early",
        )
        assert err is None, err
        assert reopened.closed_at is None
        assert reopened.closed_by is None

    async def test_certified_pdf_and_report_date_the_actual_close(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        now = datetime.now(timezone.utc)
        # Scheduled to end well over a day out, so the wrong date differs
        # from the right one on the calendar, not just the clock.
        scheduled_end = now + timedelta(days=40)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=now - timedelta(days=1),
            end=scheduled_end,
        )
        svc = ElectionService(db_session)
        # The automatic report at close is not the one under test; the
        # explicit send below is, with the same mock so nothing leaves.
        with patch(
            "app.services.email_service.EmailService.send_election_report",
            new=AsyncMock(return_value=(1, 0)),
        ) as send_report:
            _closed, err = await svc.close_election(
                uuid.UUID(election_id),
                uuid.UUID(org_id),
                closed_by=uuid.UUID(user1_id),
            )
            assert err is None, err
            send_report.reset_mock()
            ok, msg = await svc.generate_and_send_election_report(
                uuid.UUID(election_id), uuid.UUID(org_id), requested=True
            )
            assert ok, msg
            kwargs = send_report.call_args.kwargs

        # The fixture org is on UTC, so the report's date is today's, not
        # the scheduled end's.
        assert kwargs["closed_at"].startswith(now.strftime("%B %d, %Y"))
        assert kwargs["closed_by"] == "Alice Anderson"
        assert not kwargs["closed_at"].startswith(scheduled_end.strftime("%B %d, %Y"))

        buf, err, _filename = await svc.build_certified_results_pdf(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        pdf_text = " ".join(
            page.extract_text() for page in PdfReader(BytesIO(buf.getvalue())).pages
        )
        assert f"Election closed {now:%Y-%m-%d}" in pdf_text, pdf_text[:400]
        assert f"Election closed {scheduled_end:%Y-%m-%d}" not in pdf_text
        assert "by Alice Anderson" in pdf_text


class TestListCarriesClosedAt(TestLifecycleSetup):
    """The list endpoint built its response field by field and left
    ``closed_at`` out, so the election card dated an early close to the
    scheduled end — three days in the future on the re-drive (REDRIVE-A-1)."""

    async def test_list_response_carries_the_actual_close(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        from types import SimpleNamespace

        from app.api.v1.endpoints.elections import list_elections

        org_id, user1_id, _ = setup_org_and_users
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=now - timedelta(days=1),
            end=now + timedelta(days=3),
        )
        svc = ElectionService(db_session)
        closed, err = await svc.close_election(
            uuid.UUID(election_id), uuid.UUID(org_id), closed_by=uuid.UUID(user1_id)
        )
        assert err is None, err

        listed = await list_elections(
            db=db_session,
            current_user=SimpleNamespace(organization_id=org_id, id=user1_id),
        )
        row = next(e for e in listed if str(e.id) == election_id)
        assert row.closed_at is not None
        assert _within_a_minute(row.closed_at, now)
        assert not _within_a_minute(row.closed_at, row.end_date)
