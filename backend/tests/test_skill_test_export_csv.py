"""The CSV export's timing-verified column, on both detail levels.

A resumed test's clock carried on from the last save rather than running
continuously, so its recorded seconds are not a stopwatch reading. The summary
export said so; the per-step (``detail=criteria``) file — the one the records
page actually links, and the one a state or ISO reviewer is handed — did not,
so a ``time_limit`` step's seconds read as verified evidence there.

These tests drive the endpoint itself rather than the row helper, because the
column lives in the endpoint's writer loops and only an end-to-end read of the
produced file proves both branches carry it.
"""

import csv
import io
import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.skills_testing import export_tests_csv
from app.models.skills_testing import SkillTemplate, SkillTest
from app.models.user import User

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


SECTIONS = [
    {
        "name": "Hose advance",
        "criteria": [
            {
                "label": "Advance to the door",
                "type": "time_limit",
                "required": True,
                "time_limit_seconds": 60,
            }
        ],
    }
]


@pytest.fixture
async def org_and_officer(db_session: AsyncSession):
    org_id = _uid()
    officer_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Officer', 'User', :em, 'hashed', 'active')"
        ),
        {
            "id": officer_id,
            "org": org_id,
            "un": f"officer-{org_id[:8]}",
            "em": f"officer-{org_id[:8]}@test.example",
        },
    )
    await db_session.flush()
    officer = (
        await db_session.execute(select(User).where(User.id == officer_id))
    ).scalar_one()
    return org_id, officer


async def _seed_tests(db_session: AsyncSession, org_id: str, officer: User):
    template = SkillTemplate(
        organization_id=org_id,
        name="SCBA Evaluation",
        sections=SECTIONS,
        status="published",
    )
    db_session.add(template)
    await db_session.flush()

    def _test(resume_count: int) -> SkillTest:
        return SkillTest(
            organization_id=org_id,
            template_id=template.id,
            candidate_id=officer.id,
            examiner_id=officer.id,
            status="completed",
            result="pass",
            resume_count=resume_count,
            elapsed_seconds=55,
            section_results=[
                {
                    "section_id": "section-0",
                    "criteria_results": [
                        {
                            "criterion_id": "criterion-0-0",
                            "passed": True,
                            "time_seconds": 55,
                        }
                    ],
                }
            ],
        )

    straight_through = _test(resume_count=0)
    resumed = _test(resume_count=2)
    db_session.add_all([straight_through, resumed])
    await db_session.flush()
    return straight_through, resumed


async def _export_rows(db_session: AsyncSession, officer: User, detail: str):
    response = await export_tests_csv(
        detail=detail,
        status_filter=None,
        pending_validation=False,
        candidate_id=None,
        template_id=None,
        include_practice=False,
        date_from=None,
        date_to=None,
        db=db_session,
        current_user=officer,
    )
    body = "".join([chunk async for chunk in response.body_iterator])
    return list(csv.reader(io.StringIO(body)))


class TestCriteriaExportTimingColumn:
    async def test_criteria_rows_carry_the_timing_verified_column(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        straight_through, resumed = await _seed_tests(db_session, org_id, officer)

        rows = await _export_rows(db_session, officer, "criteria")
        header, data = rows[0], rows[1:]

        assert "Timing Verified" in header
        # Grouped with the per-test columns, before the per-step ones — the
        # reader meets what the whole test's clock can support before the
        # step-level seconds it qualifies.
        assert header.index("Timing Verified") == header.index("Test Result") + 1

        column = header.index("Timing Verified")
        by_test = {row[header.index("Test ID")]: row[column] for row in data}
        assert by_test[straight_through.id] == "Yes"
        assert by_test[resumed.id] == "No"

    async def test_summary_and_criteria_exports_agree_per_test(
        self, db_session, org_and_officer
    ):
        """The same test must not be verified in one file and not the other."""
        org_id, officer = org_and_officer
        await _seed_tests(db_session, org_id, officer)

        def verdicts(rows):
            header, data = rows[0], rows[1:]
            id_col = header.index("Test ID")
            tv_col = header.index("Timing Verified")
            return {row[id_col]: row[tv_col] for row in data}

        summary = verdicts(await _export_rows(db_session, officer, "summary"))
        criteria = verdicts(await _export_rows(db_session, officer, "criteria"))
        assert summary == criteria
