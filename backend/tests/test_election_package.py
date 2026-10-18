"""
Pre-Meeting Package — Integration Tests

Covers the secretary's pre-meeting package flow: recipient prefill
(leadership / eligible voters), PDF assembly, and sending to a
secretary-edited email list (EmailService mocked).
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService


async def _deliver_all(**kwargs):
    """A send_email stand-in that accepts every address, one answer each."""
    kwargs["results_out"].extend([True] * len(kwargs["to_emails"]))
    return len(kwargs["to_emails"]), 0


pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


class TestPackageSetup:
    """Org, three users (one secretary with leadership role), draft election."""

    @pytest.fixture
    async def setup_package_election(self, db_session: AsyncSession):
        org_id = _uid()
        secretary_id = _uid()
        voter_id = _uid()
        position_id = _uid()
        election_id = _uid()
        candidate_id = _uid()
        salt = secrets.token_hex(32)

        now = datetime.now(timezone.utc)

        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, :otype, :slug, :tz)"
            ),
            {
                "id": org_id,
                "name": "Package Test FD",
                "otype": "fire_department",
                "slug": f"pkg-{org_id[:8]}",
                "tz": "America/New_York",
            },
        )

        for uid, uname, fn, ln in [
            (secretary_id, "pkgsec", "Sue", "Secretary"),
            (voter_id, "pkgvoter", "Vic", "Voter"),
        ]:
            await db_session.execute(
                text(
                    "INSERT INTO users "
                    "(id, organization_id, username, first_name, last_name, "
                    "email, password_hash, status) "
                    "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
                ),
                {
                    "id": uid,
                    "org": org_id,
                    "un": uname,
                    "fn": fn,
                    "ln": ln,
                    "em": f"{uname}@test.com",
                    "pw": "hashed",
                },
            )

        # Secretary holds a leadership position (slug in LEADERSHIP_ROLE_SLUGS)
        await db_session.execute(
            text(
                "INSERT INTO positions (id, organization_id, name, slug, permissions) "
                "VALUES (:id, :org, 'Secretary', 'secretary', '[]')"
            ),
            {"id": position_id, "org": org_id},
        )
        await db_session.execute(
            text(
                "INSERT INTO user_positions (user_id, position_id) "
                "VALUES (:uid, :pid)"
            ),
            {"uid": secretary_id, "pid": position_id},
        )

        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "start_date, end_date, status, anonymous_voting, "
                "allow_write_ins, max_votes_per_position, voting_method, "
                "victory_condition, voter_anonymity_salt, quorum_type, "
                "created_by, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, "
                "is_runoff, runoff_round, created_at, updated_at) "
                "VALUES (:id, :org, :title, :etype, :positions, "
                ":start, :end, :status, :anon, 0, 1, "
                "'simple_majority', 'majority', :salt, 'none', :creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "title": "Annual Officer Election 2027",
                "etype": "officer",
                "positions": '["Chief"]',
                "start": now + timedelta(days=7),
                "end": now + timedelta(days=8),
                "status": "draft",
                "anon": True,
                "salt": salt,
                "creator": secretary_id,
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Jane Doe', 'Chief', 1, 0, 0, NOW(), NOW(), NOW())"
            ),
            {"id": candidate_id, "eid": election_id},
        )
        await db_session.flush()

        return {
            "org_id": org_id,
            "secretary_id": secretary_id,
            "voter_id": voter_id,
            "election_id": election_id,
        }


class TestPackageRecipients(TestPackageSetup):
    async def test_leadership_prefill(
        self, db_session: AsyncSession, setup_package_election
    ):
        data = setup_package_election
        svc = ElectionService(db_session)

        recipients, err = await svc.get_package_recipients(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"]), "leadership"
        )

        assert err is None
        assert recipients is not None
        emails = [r["email"] for r in recipients]
        assert "pkgsec@test.com" in emails
        assert (
            "pkgvoter@test.com" not in emails
        ), "Non-leadership members must not appear in the leadership prefill"

    async def test_eligible_voters_prefill(
        self, db_session: AsyncSession, setup_package_election
    ):
        data = setup_package_election
        svc = ElectionService(db_session)

        recipients, err = await svc.get_package_recipients(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            "eligible_voters",
        )

        assert err is None
        emails = [r["email"] for r in recipients]
        assert "pkgsec@test.com" in emails
        assert "pkgvoter@test.com" in emails

    async def test_unknown_mode_rejected(
        self, db_session: AsyncSession, setup_package_election
    ):
        data = setup_package_election
        svc = ElectionService(db_session)

        recipients, err = await svc.get_package_recipients(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"]), "everyone"
        )
        assert recipients is None
        assert err is not None


class TestPackagePdfBuild(TestPackageSetup):
    async def test_build_returns_pdf_and_filename(
        self, db_session: AsyncSession, setup_package_election
    ):
        data = setup_package_election
        svc = ElectionService(db_session)

        buf, err, filename = await svc.build_pre_meeting_package_pdf(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )

        assert err is None
        assert buf is not None
        assert buf.getvalue().startswith(b"%PDF")
        assert filename == "pre-meeting-package-annual-officer-election-2027.pdf"

    async def test_closed_election_rejected(
        self, db_session: AsyncSession, setup_package_election
    ):
        data = setup_package_election
        await db_session.execute(
            text("UPDATE elections SET status = 'closed' WHERE id = :id"),
            {"id": data["election_id"]},
        )
        await db_session.flush()
        svc = ElectionService(db_session)

        buf, err, _ = await svc.build_pre_meeting_package_pdf(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert buf is None
        assert err is not None
        assert "draft or open" in err

    async def test_cross_org_rejected(
        self, db_session: AsyncSession, setup_package_election
    ):
        data = setup_package_election
        svc = ElectionService(db_session)

        buf, err, _ = await svc.build_pre_meeting_package_pdf(
            uuid.UUID(data["election_id"]), uuid.uuid4()
        )
        assert buf is None
        assert err == "Election not found"


class TestPackageSend(TestPackageSetup):
    async def test_send_to_edited_list_with_free_form_address(
        self, db_session: AsyncSession, setup_package_election
    ):
        data = setup_package_election
        svc = ElectionService(db_session)

        with patch(
            "app.services.email_service.EmailService.send_email",
            new=AsyncMock(side_effect=_deliver_all),
        ) as mock_send:
            success, message, sent_count, unsent = (
                await svc.generate_and_send_pre_meeting_package(
                    election_id=uuid.UUID(data["election_id"]),
                    organization_id=uuid.UUID(data["org_id"]),
                    sent_by=uuid.UUID(data["secretary_id"]),
                    recipient_emails=[
                        "pkgvoter@test.com",
                        "counsel@lawfirm.example",  # free-form outside address
                        "PKGVOTER@test.com",  # duplicate, different case
                    ],
                    message="See you at the annual meeting.",
                    include_full_roster=True,
                )
            )

        assert success is True, message
        assert sent_count == 2, "Case-insensitive duplicates must collapse"
        assert unsent == []
        kwargs = mock_send.call_args.kwargs
        # One message per address — no BCC — and the secretary gets a copy
        # without being counted in the list they chose.
        assert kwargs["to_emails"] == [
            "pkgvoter@test.com",
            "counsel@lawfirm.example",
            "pkgsec@test.com",
        ]
        assert not kwargs.get("bcc_emails")
        assert kwargs["attachment_paths"], "Package PDF must be attached"
        assert "Annual Officer Election 2027" in kwargs["subject"]

    async def test_empty_recipient_list_rejected(
        self, db_session: AsyncSession, setup_package_election
    ):
        data = setup_package_election
        svc = ElectionService(db_session)

        success, message, sent_count, _unsent = (
            await svc.generate_and_send_pre_meeting_package(
                election_id=uuid.UUID(data["election_id"]),
                organization_id=uuid.UUID(data["org_id"]),
                sent_by=uuid.UUID(data["secretary_id"]),
                recipient_emails=["", "   "],
            )
        )
        assert success is False
        assert sent_count == 0

    async def test_send_failure_reported(
        self, db_session: AsyncSession, setup_package_election
    ):
        data = setup_package_election
        svc = ElectionService(db_session)

        with patch(
            "app.services.email_service.EmailService.send_email",
            new_callable=AsyncMock,
            return_value=(0, 1),
        ):
            success, message, sent_count, unsent = (
                await svc.generate_and_send_pre_meeting_package(
                    election_id=uuid.UUID(data["election_id"]),
                    organization_id=uuid.UUID(data["org_id"]),
                    sent_by=uuid.UUID(data["secretary_id"]),
                    recipient_emails=["pkgvoter@test.com"],
                )
            )
        assert success is False
        assert sent_count == 0
        # The send gave no per-address answers: unanswered counts as unsent.
        assert unsent == ["pkgvoter@test.com"]

    async def test_a_refused_address_is_named_not_counted_as_sent(
        self, db_session: AsyncSession, setup_package_election
    ):
        # A single BCC'd message reported every address as sent when the
        # server accepted some and refused the rest.
        data = setup_package_election
        svc = ElectionService(db_session)

        async def refuse_counsel(**kwargs):
            outcomes = [
                addr != "counsel@lawfirm.example" for addr in kwargs["to_emails"]
            ]
            kwargs["results_out"].extend(outcomes)
            return sum(outcomes), len(outcomes) - sum(outcomes)

        with patch(
            "app.services.email_service.EmailService.send_email",
            new=AsyncMock(side_effect=refuse_counsel),
        ):
            success, message, sent_count, unsent = (
                await svc.generate_and_send_pre_meeting_package(
                    election_id=uuid.UUID(data["election_id"]),
                    organization_id=uuid.UUID(data["org_id"]),
                    sent_by=uuid.UUID(data["secretary_id"]),
                    recipient_emails=["pkgvoter@test.com", "counsel@lawfirm.example"],
                )
            )

        assert success is True
        assert sent_count == 1
        assert unsent == ["counsel@lawfirm.example"]
        assert "Could not be sent to 1: counsel@lawfirm.example" in message
