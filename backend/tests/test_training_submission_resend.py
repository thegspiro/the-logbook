"""A training submission sent twice must be stored, and credited, once.

A submission queued offline is resent whenever the answer to an earlier attempt
never arrived — including when the server had stored it. Under auto-approval
that second copy became a second training record and the member's hours
counted twice. The device repeats one ``client_request_id`` on every attempt,
and the server answers a repeat with the submission it already has.

Real committed rows and independent sessions, because the race between two
resends is settled by the database's unique index, which a mock cannot show.
"""

import asyncio
import uuid
from datetime import date

import pytest
from sqlalchemy import text

from app.core.database import database_manager
from app.models.training import SubmissionStatus, TrainingType
from app.services.training_submission_service import TrainingSubmissionService

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("_initialize_database")]


async def _department(auto_approve: bool) -> tuple[str, str, str]:
    org_id, member, colleague = (str(uuid.uuid4()) for _ in range(3))
    async with database_manager.session_factory() as session:
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
                " VALUES (:id, 'Resend Test Dept', 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "slug": f"resend-{org_id[:8]}"},
        )
        for user_id in (member, colleague):
            await session.execute(
                text(
                    "INSERT INTO users (id, organization_id, username, first_name,"
                    " last_name, email, password_hash, status)"
                    " VALUES (:id, :org, :un, 'Test', 'Member', :em, 'hashed', 'active')"
                ),
                {
                    "id": user_id,
                    "org": org_id,
                    "un": f"member-{user_id[:8]}",
                    "em": f"member-{user_id[:8]}@test.com",
                },
            )
        await session.commit()
        config = await TrainingSubmissionService(session).get_config(org_id)
        config.require_approval = not auto_approve
        await session.commit()
    return org_id, member, colleague


async def _cleanup(org_id: str) -> None:
    async with database_manager.session_factory() as session:
        for table in (
            "training_records",
            "training_submissions",
            "self_report_configs",
        ):
            await session.execute(
                text(f"DELETE FROM {table} WHERE organization_id = :o"), {"o": org_id}
            )
        await session.execute(
            text("DELETE FROM users WHERE organization_id = :o"), {"o": org_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :o"), {"o": org_id}
        )
        await session.commit()


async def _submit(org_id: str, member: str, client_request_id=None):
    async with database_manager.session_factory() as session:
        return await TrainingSubmissionService(session).create_submission(
            organization_id=org_id,
            submitted_by=member,
            course_name="Ladder drill",
            training_type=TrainingType.SKILLS_PRACTICE.value,
            completion_date=date(2026, 10, 30),
            hours_completed=2.0,
            client_request_id=client_request_id,
        )


async def _count(org_id: str, table: str, member: str) -> int:
    column = "submitted_by" if table == "training_submissions" else "user_id"
    async with database_manager.session_factory() as session:
        return (
            await session.execute(
                text(
                    f"SELECT COUNT(*) FROM {table} WHERE organization_id = :o AND {column} = :m"
                ),
                {"o": org_id, "m": member},
            )
        ).scalar_one()


class TestTrainingSubmissionResend:
    async def test_a_resent_submission_returns_the_first_and_credits_it_once(self):
        org_id, member, _ = await _department(auto_approve=True)
        try:
            first = await _submit(org_id, member, "req-0001")
            again = await _submit(org_id, member, "req-0001")

            assert first.status == SubmissionStatus.APPROVED
            assert again.id == first.id
            assert await _count(org_id, "training_submissions", member) == 1
            assert await _count(org_id, "training_records", member) == 1
        finally:
            await _cleanup(org_id)

    async def test_two_resends_racing_store_one_submission(self):
        org_id, member, _ = await _department(auto_approve=True)
        try:
            results = await asyncio.gather(
                _submit(org_id, member, "req-race"),
                _submit(org_id, member, "req-race"),
            )

            assert results[0].id == results[1].id
            assert await _count(org_id, "training_submissions", member) == 1
            assert await _count(org_id, "training_records", member) == 1
        finally:
            await _cleanup(org_id)

    async def test_submissions_without_a_request_id_are_each_their_own(self):
        # Callers that send none — the online form, older clients — keep the
        # behaviour they had.
        org_id, member, _ = await _department(auto_approve=False)
        try:
            await _submit(org_id, member)
            await _submit(org_id, member)

            assert await _count(org_id, "training_submissions", member) == 2
        finally:
            await _cleanup(org_id)

    async def test_the_same_request_id_from_another_member_is_a_new_submission(self):
        org_id, member, colleague = await _department(auto_approve=False)
        try:
            mine = await _submit(org_id, member, "req-shared")
            theirs = await _submit(org_id, colleague, "req-shared")

            assert theirs.id != mine.id
            assert str(theirs.submitted_by) == colleague
        finally:
            await _cleanup(org_id)
