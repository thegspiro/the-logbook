"""Who the election report reaches.

The report carries the results and the list of who did and did not get a
ballot. It went to the election's creator alone, looked up without checking
the account was still current: leadership never received it, a creator who had
left the department still did, and an officer pressing "Send report" got a
confirmation naming somebody else's inbox. With no creator at all it went to
nobody and the close said nothing.
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.services.election_service import ElectionService

pytestmark = pytest.mark.integration

SEND_REPORT = "app.services.email_service.EmailService.send_election_report"


def _uid() -> str:
    return str(uuid.uuid4())


class _Department:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.org_id = _uid()
        self._positions: dict = {}

    async def create(self) -> "_Department":
        await self.db.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, 'Report FD', 'fire_department', :slug, "
                "'UTC')"
            ),
            {"id": self.org_id, "slug": f"report-{self.org_id[:8]}"},
        )
        return self

    async def _position(self, slug: str) -> str:
        if slug not in self._positions:
            position_id = _uid()
            await self.db.execute(
                text(
                    "INSERT INTO positions (id, organization_id, name, slug, "
                    "permissions, is_system) "
                    "VALUES (:id, :org, :name, :slug, :perms, 0)"
                ),
                {
                    "id": position_id,
                    "org": self.org_id,
                    "name": slug.title(),
                    "slug": slug,
                    "perms": json.dumps([]),
                },
            )
            self._positions[slug] = position_id
        return self._positions[slug]

    async def member(
        self,
        name: str,
        *,
        position: str = "member",
        status: str = "active",
        email: bool = True,
        preferences: dict | None = None,
    ) -> str:
        user_id = _uid()
        await self.db.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status, "
                "notification_preferences) "
                "VALUES (:id, :org, :un, :un, 'Member', :em, 'x', :status, :prefs)"
            ),
            {
                "id": user_id,
                "org": self.org_id,
                "un": name,
                "em": f"{name}@test.com" if email else "",
                "status": status,
                "prefs": json.dumps(preferences) if preferences else None,
            },
        )
        await self.db.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": user_id, "p": await self._position(position)},
        )
        return user_id

    async def closed_election(self, creator_id: str | None) -> str:
        election_id = _uid()
        now = datetime.now(timezone.utc)
        await self.db.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, start_date, "
                "end_date, status, anonymous_voting, allow_write_ins, "
                "max_votes_per_position, voting_method, victory_condition, "
                "voter_anonymity_salt, quorum_type, created_by, email_sent, "
                "results_visible_immediately, enable_runoffs, runoff_type, "
                "max_runoff_rounds, is_runoff, runoff_round, created_at, updated_at) "
                "VALUES (:id, :org, 'Bylaw Vote', 'ballot', '[]', "
                ":start, :end, 'closed', 1, 0, 1, 'simple_majority', 'most_votes', "
                ":salt, 'none', :creator, 1, 1, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": self.org_id,
                "start": now - timedelta(days=2),
                "end": now - timedelta(hours=1),
                "salt": secrets.token_hex(32),
                "creator": creator_id,
            },
        )
        await self.db.flush()
        return election_id


async def _send(db, dept, election_id, requested_by=None, sent=(1, 0)):
    with patch(SEND_REPORT, new=AsyncMock(return_value=sent)) as send_report:
        ok, message = await ElectionService(db).generate_and_send_election_report(
            uuid.UUID(election_id),
            uuid.UUID(dept.org_id),
            requested_by=requested_by,
        )
    mailed = [call.kwargs["to_emails"] for call in send_report.call_args_list]
    return ok, message, mailed


class TestAutomaticReport:
    async def test_goes_to_the_creator_then_current_leadership(
        self, db_session: AsyncSession
    ):
        dept = await _Department(db_session).create()
        creator = await dept.member("sec", position="secretary")
        await dept.member("chief", position="chief")
        await dept.member("ff", position="member")
        await dept.member("oldpres", position="president", status="inactive")
        election_id = await dept.closed_election(creator)

        ok, message, mailed = await _send(db_session, dept, election_id)

        assert ok, message
        # One message each, the creator first; the ordinary member and the
        # departed president get nothing.
        assert mailed == [["sec@test.com"], ["chief@test.com"]]

    async def test_a_creator_who_has_left_does_not_receive_it(
        self, db_session: AsyncSession
    ):
        dept = await _Department(db_session).create()
        creator = await dept.member("gone", position="member", status="inactive")
        await dept.member("chief", position="chief")
        election_id = await dept.closed_election(creator)

        ok, _message, mailed = await _send(db_session, dept, election_id)

        assert ok
        assert mailed == [["chief@test.com"]]

    async def test_probationary_leadership_is_current(self, db_session: AsyncSession):
        dept = await _Department(db_session).create()
        await dept.member("vp", position="vice_president", status="probationary")
        election_id = await dept.closed_election(None)

        ok, _message, mailed = await _send(db_session, dept, election_id)

        assert ok
        assert mailed == [["vp@test.com"]]

    async def test_leadership_who_turned_admin_mail_off_is_skipped(
        self, db_session: AsyncSession
    ):
        dept = await _Department(db_session).create()
        creator = await dept.member("sec", position="secretary")
        await dept.member(
            "chief",
            position="chief",
            preferences={"email_kinds": {"election_admin": False}},
        )
        election_id = await dept.closed_election(creator)

        _ok, _message, mailed = await _send(db_session, dept, election_id)

        assert mailed == [["sec@test.com"]]

    async def test_nobody_to_send_to_is_logged_and_audited(
        self, db_session: AsyncSession
    ):
        dept = await _Department(db_session).create()
        creator = await dept.member("gone", status="inactive")
        election_id = await dept.closed_election(creator)

        ok, message, mailed = await _send(db_session, dept, election_id)

        assert not ok
        assert mailed == []
        assert message == "No current member can receive the election report"
        audit = (
            await db_session.execute(
                select(AuditLog)
                .where(AuditLog.event_type == "election_report_not_sent")
                .where(AuditLog.organization_id == dept.org_id)
            )
        ).scalar_one()
        assert audit.event_data["election_id"] == election_id

    async def test_partial_delivery_is_reported(self, db_session: AsyncSession):
        dept = await _Department(db_session).create()
        creator = await dept.member("sec", position="secretary")
        await dept.member("chief", position="chief")
        election_id = await dept.closed_election(creator)

        with patch(
            SEND_REPORT, new=AsyncMock(side_effect=[(1, 0), (0, 1)])
        ) as send_report:
            ok, message = await ElectionService(
                db_session
            ).generate_and_send_election_report(
                uuid.UUID(election_id), uuid.UUID(dept.org_id)
            )

        assert send_report.await_count == 2
        assert ok
        assert message == (
            "Election report sent to sec@test.com; 1 recipient(s) could not be "
            "reached"
        )


class TestRequestedReport:
    async def test_goes_to_the_officer_who_asked_only(self, db_session: AsyncSession):
        dept = await _Department(db_session).create()
        creator = await dept.member("sec", position="secretary")
        await dept.member("chief", position="chief")
        officer = await dept.member(
            "clerk",
            position="member",
            preferences={"email_kinds": {"election_admin": False}},
        )
        election_id = await dept.closed_election(creator)

        ok, message, mailed = await _send(
            db_session, dept, election_id, requested_by=officer
        )

        assert ok, message
        # Asked for it, so it arrives even with election-admin mail turned off.
        assert mailed == [["clerk@test.com"]]
        assert message == "Election report sent to clerk@test.com"

    async def test_an_officer_with_no_email_is_told_why(self, db_session: AsyncSession):
        dept = await _Department(db_session).create()
        creator = await dept.member("sec", position="secretary")
        officer = await dept.member("noemail", email=False)
        election_id = await dept.closed_election(creator)

        ok, message, mailed = await _send(
            db_session, dept, election_id, requested_by=officer
        )

        assert not ok
        assert mailed == []
        assert message == "You have no email address on your profile"

    async def test_an_officer_of_another_department_gets_nothing(
        self, db_session: AsyncSession
    ):
        dept = await _Department(db_session).create()
        other = await _Department(db_session).create()
        creator = await dept.member("sec", position="secretary")
        outsider = await other.member("spy")
        election_id = await dept.closed_election(creator)

        ok, _message, mailed = await _send(
            db_session, dept, election_id, requested_by=outsider
        )

        assert not ok
        assert mailed == []
