"""The storage guarantees behind member performance evaluations.

Each test exercises a constraint in the database itself, not in a service,
because these are the guarantees that must hold whatever code writes the
rows: one evaluation per member per period, a member's evaluation history
blocking their hard delete, a published template version that cannot be
removed from under the evaluations started on it, and a deletion record that
outlives the evaluation it describes.
"""

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models.evaluation import (
    Evaluation,
    EvaluationAmendment,
    EvaluationDeletionRecord,
    EvaluationPart,
    EvaluationPeriod,
    EvaluationSignature,
    EvaluationStep,
    EvaluationTemplate,
    EvaluationTemplateVersion,
)
from app.services.user_deletion_service import find_hard_delete_blockers

pytestmark = pytest.mark.integration


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"s-{org_id[:8]}"},
    )
    return org_id


async def _user(db, org_id: str, first: str) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Member', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@example.test",
        },
    )
    return user_id


async def _flush_in_savepoint(db, *rows) -> None:
    """Add and flush inside a savepoint, so a constraint violation rolls back
    only these rows and the test's own transaction stays usable."""
    async with db.begin_nested():
        db.add_all(rows)
        await db.flush()


async def _execute_in_savepoint(db, statement: str, params: dict) -> None:
    async with db.begin_nested():
        await db.execute(text(statement), params)


async def _template_version(db, org_id: str) -> EvaluationTemplateVersion:
    template = EvaluationTemplate(
        organization_id=org_id,
        name=f"Operational {_uid()[:8]}",
        member_class="operational",
    )
    db.add(template)
    await db.flush()
    version = EvaluationTemplateVersion(
        organization_id=org_id,
        template_id=template.id,
        version_number=1,
        definition={"sections": []},
        workflow={"steps": []},
        published_at=datetime.now(timezone.utc),
    )
    db.add(version)
    await db.flush()
    return version


async def _period(db, org_id: str) -> EvaluationPeriod:
    period = EvaluationPeriod(
        organization_id=org_id,
        name=f"2026 Annual {_uid()[:8]}",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
    )
    db.add(period)
    await db.flush()
    return period


def _evaluation(org_id, member_id, version, period=None, evaluator_id=None):
    return Evaluation(
        organization_id=org_id,
        member_id=member_id,
        evaluator_id=evaluator_id,
        period_id=period.id if period else None,
        template_version_id=version.id,
        period_start=period.start_date if period else date(2026, 3, 1),
        period_end=period.end_date if period else date(2026, 3, 31),
    )


async def test_a_member_has_one_evaluation_per_period(db_session):
    org_id = await _org(db_session)
    member_id = await _user(db_session, org_id, "Avery")
    version = await _template_version(db_session, org_id)
    period = await _period(db_session, org_id)
    db_session.add(_evaluation(org_id, member_id, version, period))
    await db_session.flush()

    with pytest.raises(IntegrityError):
        await _flush_in_savepoint(
            db_session, _evaluation(org_id, member_id, version, period)
        )


async def test_one_off_evaluations_without_a_period_are_not_limited(db_session):
    org_id = await _org(db_session)
    member_id = await _user(db_session, org_id, "Blake")
    version = await _template_version(db_session, org_id)
    db_session.add(_evaluation(org_id, member_id, version))
    db_session.add(_evaluation(org_id, member_id, version))
    await db_session.flush()

    count = await db_session.scalar(
        select(func.count())
        .select_from(Evaluation)
        .where(Evaluation.member_id == member_id)
    )
    assert count == 2


# A CHECK violation is an IntegrityError on MySQL 8 (errno 3819) and an
# OperationalError on MariaDB (errno 4025); CI runs both, so the CHECK tests
# catch their common base and assert the constraint by name instead.


async def test_a_period_cannot_end_before_it_starts(db_session):
    org_id = await _org(db_session)
    with pytest.raises(DBAPIError, match="ck_evaluation_periods_date_order"):
        await _flush_in_savepoint(
            db_session,
            EvaluationPeriod(
                organization_id=org_id,
                name="Backwards",
                start_date=date(2026, 12, 31),
                end_date=date(2026, 1, 1),
            ),
        )


async def test_an_evaluation_cannot_end_before_it_starts(db_session):
    org_id = await _org(db_session)
    member_id = await _user(db_session, org_id, "Casey")
    version = await _template_version(db_session, org_id)
    evaluation = _evaluation(org_id, member_id, version)
    evaluation.period_start = date(2026, 6, 1)
    evaluation.period_end = date(2026, 5, 1)
    with pytest.raises(DBAPIError, match="ck_evaluations_period_order"):
        await _flush_in_savepoint(db_session, evaluation)


async def test_evaluation_history_blocks_a_members_hard_delete(db_session):
    """Personnel history is kept indefinitely, so removing the account must
    not take it along: the delete endpoint reports these rows as blockers and
    the member is archived instead."""
    org_id = await _org(db_session)
    member_id = await _user(db_session, org_id, "Drew")
    other_id = await _user(db_session, org_id, "Emery")
    version = await _template_version(db_session, org_id)
    db_session.add(_evaluation(org_id, member_id, version))
    db_session.add(
        EvaluationDeletionRecord(
            organization_id=org_id,
            member_id=other_id,
            evaluation_id=_uid(),
            period_start=date(2025, 1, 1),
            period_end=date(2025, 12, 31),
            template_name="Operational",
            was_finalized=True,
            reason="Contained an inadmissible statement",
            deleted_by_name="Chief Example",
        )
    )
    await db_session.flush()

    assert ("evaluations", 1) in await find_hard_delete_blockers(db_session, member_id)
    assert ("evaluation_deletion_records", 1) in await find_hard_delete_blockers(
        db_session, other_id
    )


async def test_the_evaluator_leaving_does_not_block_their_removal(db_session):
    org_id = await _org(db_session)
    member_id = await _user(db_session, org_id, "Finley")
    evaluator_id = await _user(db_session, org_id, "Gray")
    version = await _template_version(db_session, org_id)
    evaluation = _evaluation(org_id, member_id, version, evaluator_id=evaluator_id)
    db_session.add(evaluation)
    await db_session.flush()

    blockers = dict(await find_hard_delete_blockers(db_session, evaluator_id))
    assert "evaluations" not in blockers

    await db_session.execute(
        text("DELETE FROM users WHERE id = :id"), {"id": evaluator_id}
    )
    await db_session.refresh(evaluation)
    assert evaluation.evaluator_id is None


async def test_a_template_version_in_use_cannot_be_deleted(db_session):
    org_id = await _org(db_session)
    member_id = await _user(db_session, org_id, "Harper")
    version = await _template_version(db_session, org_id)
    db_session.add(_evaluation(org_id, member_id, version))
    await db_session.flush()

    with pytest.raises(IntegrityError):
        await _execute_in_savepoint(
            db_session,
            "DELETE FROM evaluation_template_versions WHERE id = :id",
            {"id": version.id},
        )


async def test_deleting_an_evaluation_keeps_only_its_deletion_record(db_session):
    """The content goes — that is what deletion is for — and the record of
    the deletion stays on the member's history."""
    org_id = await _org(db_session)
    member_id = await _user(db_session, org_id, "Indy")
    version = await _template_version(db_session, org_id)
    evaluation = _evaluation(org_id, member_id, version)
    db_session.add(evaluation)
    await db_session.flush()
    evaluation_id = evaluation.id
    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            EvaluationStep(
                organization_id=org_id,
                evaluation_id=evaluation_id,
                revision=1,
                step_key="evaluator",
                step_order=1,
                step_type="evaluator",
            ),
            EvaluationPart(
                organization_id=org_id,
                evaluation_id=evaluation_id,
                revision=1,
                kind="evaluator",
                content={"items": {}},
            ),
            EvaluationSignature(
                organization_id=org_id,
                evaluation_id=evaluation_id,
                revision=1,
                step_key="evaluator",
                signed_name="Pat Evaluator",
                disposition="signed",
                intent_confirmed=True,
                content_hash="0" * 64,
                signed_at=now,
            ),
            EvaluationAmendment(
                organization_id=org_id,
                evaluation_id=evaluation_id,
                from_revision=1,
                to_revision=2,
                reason="Corrected a date",
            ),
            EvaluationDeletionRecord(
                organization_id=org_id,
                member_id=member_id,
                evaluation_id=evaluation_id,
                period_start=evaluation.period_start,
                period_end=evaluation.period_end,
                template_name="Operational",
                was_finalized=True,
                reason="Contained an inadmissible statement",
                deleted_by_name="Chief Example",
            ),
        ]
    )
    await db_session.flush()

    await db_session.execute(
        text("DELETE FROM evaluations WHERE id = :id"), {"id": evaluation_id}
    )

    for table in (
        "evaluation_steps",
        "evaluation_parts",
        "evaluation_signatures",
        "evaluation_amendments",
    ):
        remaining = await db_session.scalar(
            text(f"SELECT COUNT(*) FROM {table} WHERE evaluation_id = :id"),
            {"id": evaluation_id},
        )
        assert remaining == 0, table
    record = await db_session.scalar(
        select(EvaluationDeletionRecord).where(
            EvaluationDeletionRecord.evaluation_id == evaluation_id
        )
    )
    assert record is not None
    assert record.reason == "Contained an inadmissible statement"


async def test_a_step_is_recorded_once_per_revision(db_session):
    """An amendment starts a new revision with its own steps; within one
    revision a step key is unique, so a retried write cannot duplicate it."""
    org_id = await _org(db_session)
    member_id = await _user(db_session, org_id, "Jordan")
    version = await _template_version(db_session, org_id)
    evaluation = _evaluation(org_id, member_id, version)
    db_session.add(evaluation)
    await db_session.flush()

    def step(revision: int) -> EvaluationStep:
        return EvaluationStep(
            organization_id=org_id,
            evaluation_id=evaluation.id,
            revision=revision,
            step_key="member_acknowledgement",
            step_order=3,
            step_type="member_acknowledgement",
        )

    db_session.add_all([step(1), step(2)])
    await db_session.flush()

    with pytest.raises(IntegrityError):
        await _flush_in_savepoint(db_session, step(1))
