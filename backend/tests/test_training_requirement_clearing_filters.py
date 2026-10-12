"""
Clearing a training requirement's filters and dates must persist.

RequirementModal.tsx used to omit ``training_type`` when the officer chose
"Any Type", omit ``category_ids`` / ``required_membership_types`` when
the last one was deselected, and omit ``year``, ``period_end_month`` /
``period_end_day``, ``due_date`` and ``start_date`` when emptied. An update omits a key to mean "leave it
alone", so each clear kept the old value behind a success toast. The form
now sends ``null`` / ``[]``; these tests pin the backend half of that
contract on both the "everyone" and the "new members only" save paths.
"""

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.training import update_requirement
from app.models.training import TrainingRequirement
from app.schemas.training import TrainingRequirementUpdate
from app.services.training_compliance import get_requirement_date_window

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def current_user(db_session: AsyncSession):
    org_id = _uid()
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"test-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'John', 'Smith', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"jsmith-{user_id[:8]}",
            "em": f"jsmith-{user_id[:8]}@test.com",
        },
    )
    await db_session.flush()
    return SimpleNamespace(
        id=user_id, organization_id=org_id, username=f"jsmith-{user_id[:8]}"
    )


async def _insert_ce_rolling_requirement(
    db_session: AsyncSession,
    org_id: str,
    *,
    category_ids: str | None = None,
    membership_types: str | None = None,
) -> str:
    """72 hours over a rolling 12 months, continuing education only.

    ``category_ids`` / ``membership_types`` are JSON text; giving
    ``membership_types`` also scopes the requirement to them.
    """
    req_id = _uid()
    now = datetime.now(timezone.utc)
    await db_session.execute(
        text(
            "INSERT INTO training_requirements "
            "(id, organization_id, name, requirement_type, source, training_type, "
            "required_hours, frequency, due_date_type, rolling_period_months, "
            "category_ids, required_membership_types, required_roles, "
            "applies_to_all, active, created_at, updated_at) "
            "VALUES (:id, :org, 'Annual Hours', 'hours', 'department', "
            "'continuing_education', 72, 'annual', 'rolling', 12, "
            ":cats, :mtypes, :roles, :all, 1, :now, :now)"
        ),
        {
            "id": req_id,
            "org": org_id,
            "cats": category_ids,
            "mtypes": membership_types,
            "roles": '["captain"]' if membership_types else None,
            "all": membership_types is None,
            "now": now,
        },
    )
    await db_session.flush()
    return req_id


async def _load(db_session: AsyncSession, req_id: str) -> TrainingRequirement:
    result = await db_session.execute(
        select(TrainingRequirement).where(TrainingRequirement.id == req_id)
    )
    return result.scalar_one()


class TestWideningTrainingType:
    async def test_saving_for_everyone_clears_the_training_type(
        self, db_session: AsyncSession, current_user
    ):
        req_id = await _insert_ce_rolling_requirement(
            db_session, current_user.organization_id
        )

        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(
                apply_to="everyone", training_type=None
            ),
            db=db_session,
            current_user=current_user,
        )

        db_session.expire_all()
        assert (await _load(db_session, req_id)).training_type is None

    async def test_omitting_the_training_type_leaves_it_alone(
        self, db_session: AsyncSession, current_user
    ):
        req_id = await _insert_ce_rolling_requirement(
            db_session, current_user.organization_id
        )

        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(required_hours=80),
            db=db_session,
            current_user=current_user,
        )

        db_session.expire_all()
        updated = await _load(db_session, req_id)
        assert updated.required_hours == 80
        assert updated.training_type == "continuing_education"

    async def test_saving_for_new_members_clears_it_on_the_new_copy_only(
        self, db_session: AsyncSession, current_user
    ):
        req_id = await _insert_ce_rolling_requirement(
            db_session, current_user.organization_id
        )

        response = await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(
                apply_to="new_members_only",
                effective_date=date(2026, 11, 1),
                training_type=None,
            ),
            db=db_session,
            current_user=current_user,
        )

        new_id = str(response.id)
        db_session.expire_all()
        assert (await _load(db_session, new_id)).training_type is None
        assert (await _load(db_session, req_id)).training_type == (
            "continuing_education"
        )


class TestClearingListFilters:
    async def test_an_empty_category_list_clears_the_categories(
        self, db_session: AsyncSession, current_user
    ):
        req_id = await _insert_ce_rolling_requirement(
            db_session, current_user.organization_id, category_ids='["cat-1"]'
        )

        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(category_ids=[]),
            db=db_session,
            current_user=current_user,
        )

        db_session.expire_all()
        assert not (await _load(db_session, req_id)).category_ids

    async def test_an_empty_member_category_list_clears_the_member_categories(
        self, db_session: AsyncSession, current_user
    ):
        req_id = await _insert_ce_rolling_requirement(
            db_session,
            current_user.organization_id,
            membership_types='["probationary"]',
        )

        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(required_membership_types=[]),
            db=db_session,
            current_user=current_user,
        )

        db_session.expire_all()
        updated = await _load(db_session, req_id)
        assert not updated.required_membership_types
        assert updated.required_roles == ["captain"]


class TestNewMembersSplitTreatsEmptyListsAsUnset:
    async def test_empty_lists_against_null_columns_change_nothing(
        self, db_session: AsyncSession, current_user
    ):
        """The form sends [] for an empty selection; a row holding NULL for the
        same state must not make a no-op save look like a change."""
        req_id = await _insert_ce_rolling_requirement(
            db_session, current_user.organization_id
        )

        with pytest.raises(HTTPException) as exc:
            await update_requirement(
                requirement_id=UUID(req_id),
                requirement_update=TrainingRequirementUpdate(
                    apply_to="new_members_only",
                    effective_date=date(2026, 11, 1),
                    category_ids=[],
                    required_membership_types=[],
                ),
                db=db_session,
                current_user=current_user,
            )

        assert exc.value.status_code == 400
        assert "Nothing would change" in exc.value.detail

    async def test_clearing_categories_for_new_members_reaches_the_copy_only(
        self, db_session: AsyncSession, current_user
    ):
        req_id = await _insert_ce_rolling_requirement(
            db_session, current_user.organization_id, category_ids='["cat-1"]'
        )

        response = await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(
                apply_to="new_members_only",
                effective_date=date(2026, 11, 1),
                category_ids=[],
            ),
            db=db_session,
            current_user=current_user,
        )

        new_id = str(response.id)
        db_session.expire_all()
        assert not (await _load(db_session, new_id)).category_ids
        assert (await _load(db_session, req_id)).category_ids == ["cat-1"]


class TestClearingCalendarFields:
    async def _insert_pinned_annual_requirement(
        self, db_session: AsyncSession, org_id: str
    ) -> str:
        """Annual, pinned to 2025 with a March-June window and both dates set."""
        req_id = _uid()
        now = datetime.now(timezone.utc)
        await db_session.execute(
            text(
                "INSERT INTO training_requirements "
                "(id, organization_id, name, requirement_type, source, "
                "required_hours, frequency, year, due_date_type, "
                "period_start_month, period_start_day, period_end_month, "
                "period_end_day, start_date, due_date, applies_to_all, active, "
                "created_at, updated_at) "
                "VALUES (:id, :org, 'Annual Hours', 'hours', 'department', 72, "
                "'annual', 2025, 'calendar_period', 3, 1, 6, 30, "
                "'2025-01-01', '2025-12-31', 1, 1, :now, :now)"
            ),
            {"id": req_id, "org": org_id, "now": now},
        )
        await db_session.flush()
        return req_id

    async def test_nulls_clear_year_period_end_and_dates(
        self, db_session: AsyncSession, current_user
    ):
        req_id = await self._insert_pinned_annual_requirement(
            db_session, current_user.organization_id
        )

        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(
                apply_to="everyone",
                year=None,
                period_end_month=None,
                period_end_day=None,
                start_date=None,
                due_date=None,
            ),
            db=db_session,
            current_user=current_user,
        )

        db_session.expire_all()
        updated = await _load(db_session, req_id)
        assert updated.year is None
        assert updated.period_end_month is None
        assert updated.period_end_day is None
        assert updated.start_date is None
        assert updated.due_date is None
        # The point of the clear: grading falls back to the current calendar
        # year instead of the old pinned March-June 2025 window.
        assert get_requirement_date_window(updated, date(2026, 10, 12)) == (
            date(2026, 1, 1),
            date(2026, 12, 31),
        )

    async def test_omitting_them_leaves_them_alone(
        self, db_session: AsyncSession, current_user
    ):
        req_id = await self._insert_pinned_annual_requirement(
            db_session, current_user.organization_id
        )

        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(required_hours=80),
            db=db_session,
            current_user=current_user,
        )

        db_session.expire_all()
        updated = await _load(db_session, req_id)
        assert updated.year == 2025
        assert (updated.period_end_month, updated.period_end_day) == (6, 30)
        assert updated.start_date == date(2025, 1, 1)

    async def test_a_null_due_date_clears_a_fixed_date_requirement(
        self, db_session: AsyncSession, current_user
    ):
        """Only a fixed-date requirement keeps its due date on save, so this is
        the case where the explicit null is what does the clearing."""
        req_id = _uid()
        now = datetime.now(timezone.utc)
        await db_session.execute(
            text(
                "INSERT INTO training_requirements "
                "(id, organization_id, name, requirement_type, source, "
                "required_hours, frequency, due_date_type, due_date, "
                "applies_to_all, active, created_at, updated_at) "
                "VALUES (:id, :org, 'Hazmat Refresher', 'hours', 'department', "
                "8, 'annual', 'fixed_date', '2026-12-31', 1, 1, :now, :now)"
            ),
            {"id": req_id, "org": current_user.organization_id, "now": now},
        )
        await db_session.flush()

        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(due_date=None),
            db=db_session,
            current_user=current_user,
        )

        db_session.expire_all()
        updated = await _load(db_session, req_id)
        assert updated.due_date_type == "fixed_date"
        assert updated.due_date is None
