"""W50-48: an election with no quorum rule must not be certified as "Quorum Met".

``ElectionResults.quorum_met`` defaulted to True and the results builder
only ever lowered it under a percentage or count rule, so a ``quorum_type``
of ``none`` — the default, and the shape of every business-meeting ballot —
serialised ``quorum_met: true`` to the results tab, printed "Quorum: Quorum
Met" in the close report and "Met" in the certified PDF, on elections where
nobody had voted at all. Now the field is None when there is no rule, and the
report and PDF say "No quorum requirement".
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from pypdf import PdfReader
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.election import ElectionResults
from app.services.election_service import ElectionService
from app.utils.certified_results_pdf import render_certified_results_pdf


def _results(**overrides) -> ElectionResults:
    fields = dict(
        election_id=uuid4(),
        election_title="Bylaw Vote",
        status="closed",
        total_votes=0,
        total_eligible_voters=21,
        voter_turnout_percentage=0.0,
        results_by_position=[],
        overall_results=[],
    )
    fields.update(overrides)
    return ElectionResults(**fields)


def _pdf_text(results: ElectionResults) -> str:
    buf = render_certified_results_pdf(
        {
            "election": {
                "title": "Bylaw Vote",
                "closed_display": "",
                "closed_by_display": "automatic close",
                "voting_method": "simple_majority",
                "victory_condition": "most_votes",
                "tie_policy": "co_winners",
                "anonymous_voting": True,
            },
            "results": results.model_dump(),
            "stats": {},
            "batches": [],
            "integrity": {},
        },
        {"org_name": "W50-48 FD", "generated_at": ""},
    )
    return " ".join(page.extract_text() for page in PdfReader(buf).pages)


@pytest.mark.unit
class TestNoQuorumRule:
    def test_schema_default_does_not_assert_a_met_quorum(self):
        assert _results().quorum_met is None

    def test_report_line(self):
        svc = ElectionService(MagicMock())
        assert svc._quorum_status_text(_results()) == "No quorum requirement"
        assert svc._quorum_status_text(_results(quorum_met=True)) == "Quorum Met"
        assert svc._quorum_status_text(_results(quorum_met=False)) == "Quorum NOT Met"

    def test_certified_pdf_line(self):
        # The row label and its value extract on adjacent lines.
        assert "Quorum\nNo quorum requirement" in _pdf_text(_results())
        assert "Quorum\nMet" in _pdf_text(_results(quorum_met=True))
        assert "Quorum\nNOT MET" in _pdf_text(_results(quorum_met=False))

    def test_certified_pdf_prefers_the_rule_detail(self):
        detail = "Quorum requires 5 voters. Actual: 3. Quorum NOT met."
        assert detail in _pdf_text(_results(quorum_met=False, quorum_detail=detail))


@pytest.mark.integration
class TestNoQuorumRuleEndToEnd:
    """The B8 shape: 21 eligible members, no votes, no quorum rule."""

    async def _closed_election(
        self, db_session: AsyncSession, quorum_type: str, quorum_value
    ):
        org_id, election_id, creator_id = _uid(), _uid(), _uid()
        now = datetime.now(timezone.utc)
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, 'W50-48 FD', 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "slug": f"w5048-{org_id[:8]}"},
        )
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Sec', 'Retary', :em, 'x', 'active')"
            ),
            {
                "id": creator_id,
                "org": org_id,
                "un": f"sec-{creator_id[:8]}",
                "em": f"sec-{creator_id[:8]}@test.com",
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, start_date, "
                "end_date, status, anonymous_voting, allow_write_ins, "
                "max_votes_per_position, voting_method, victory_condition, "
                "voter_anonymity_salt, quorum_type, quorum_value, created_by, "
                "email_sent, results_visible_immediately, enable_runoffs, "
                "runoff_type, max_runoff_rounds, is_runoff, runoff_round, "
                "created_at, updated_at) "
                "VALUES (:id, :org, 'Bylaw Vote', 'ballot', '[]', "
                ":start, :end, 'closed', 1, 0, 1, 'simple_majority', 'most_votes', "
                ":salt, :qtype, :qvalue, :creator, 1, 1, 0, 'top_two', 3, 0, 0, "
                "NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "start": now - timedelta(days=2),
                "end": now - timedelta(hours=1),
                "salt": secrets.token_hex(32),
                "qtype": quorum_type,
                "qvalue": quorum_value,
                "creator": creator_id,
            },
        )
        await db_session.flush()
        return org_id, election_id

    async def test_results_leave_quorum_unset_without_a_rule(self, db_session):
        org_id, election_id = await self._closed_election(db_session, "none", None)
        results = await ElectionService(db_session).get_election_results(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert results is not None
        assert results.quorum_met is None
        assert results.quorum_detail is None

    async def test_results_still_grade_a_count_rule(self, db_session):
        org_id, election_id = await self._closed_election(db_session, "count", 1)
        results = await ElectionService(db_session).get_election_results(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert results is not None
        assert results.quorum_met is False
        assert "Quorum NOT met" in (results.quorum_detail or "")

    async def test_close_report_says_no_quorum_requirement(self, db_session):
        org_id, election_id = await self._closed_election(db_session, "none", None)
        with patch(
            "app.services.email_service.EmailService.send_election_report",
            new=AsyncMock(return_value=(1, 0)),
        ) as send_report:
            ok, msg = await ElectionService(
                db_session
            ).generate_and_send_election_report(
                uuid.UUID(election_id), uuid.UUID(org_id), requested=True
            )
            assert ok, msg
        kwargs = send_report.call_args.kwargs
        assert kwargs["quorum_status"] == "No quorum requirement"
        assert kwargs["quorum_detail"] == ""


def _uid() -> str:
    return str(uuid.uuid4())
