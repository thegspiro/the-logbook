"""A passing official skills test that lapses, for the My Training upcoming list.

``skill_templates.valid_for_months`` says how long a pass stays valid;
``member_skill_expirations`` turns a member's newest qualifying pass per skill
into an expiry date. The date arithmetic is pure and tested directly; which
tests qualify is the database's answer, so those cases read real rows.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.skills_testing import SkillTemplate, SkillTest
from app.schemas.skills_testing import (
    MAX_VALID_FOR_MONTHS,
    SkillTemplateCreate,
    SkillTemplateUpdate,
)
from app.services.skills_testing_service import (
    member_skill_expirations,
    skill_test_expiration,
)

SECTIONS = [{"name": "Donning", "criteria": [{"label": "Mask seal"}]}]
TODAY = date(2026, 10, 14)


@pytest.mark.unit
class TestExpirationDate:
    def test_adds_whole_months(self):
        assert skill_test_expiration(date(2026, 3, 15), 24) == date(2028, 3, 15)

    def test_clamps_to_the_end_of_a_shorter_month(self):
        assert skill_test_expiration(date(2026, 1, 31), 1) == date(2026, 2, 28)

    def test_leap_day_lands_on_the_last_day_of_february(self):
        assert skill_test_expiration(date(2028, 2, 29), 12) == date(2029, 2, 28)


@pytest.mark.unit
class TestSchemaBounds:
    def _create(self, **extra):
        return SkillTemplateCreate(name="SCBA", sections=SECTIONS, **extra)

    def test_blank_is_allowed(self):
        assert self._create().valid_for_months is None

    @pytest.mark.parametrize("value", [0, -1, MAX_VALID_FOR_MONTHS + 1])
    def test_out_of_range_is_rejected(self, value):
        with pytest.raises(ValidationError):
            self._create(valid_for_months=value)

    def test_bounds_are_accepted(self):
        assert self._create(valid_for_months=1).valid_for_months == 1
        assert (
            self._create(valid_for_months=MAX_VALID_FOR_MONTHS).valid_for_months
            == MAX_VALID_FOR_MONTHS
        )

    def test_explicit_null_on_update_is_kept_as_a_clear(self):
        payload = SkillTemplateUpdate(valid_for_months=None)
        assert payload.model_dump(exclude_unset=True) == {"valid_for_months": None}

    def test_omitted_on_update_is_left_alone(self):
        assert SkillTemplateUpdate().model_dump(exclude_unset=True) == {}


def _uid() -> str:
    return str(uuid.uuid4())


async def _make_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    return org_id


async def _make_user(db: AsyncSession, org_id: str) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Pat', 'Member', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u-{user_id[:8]}",
            "em": f"u-{user_id[:8]}@test.example",
        },
    )
    await db.flush()
    return user_id


async def _template(
    db: AsyncSession, org_id: str, name: str, months: int | None, **extra
) -> SkillTemplate:
    template = SkillTemplate(
        organization_id=org_id,
        name=name,
        sections=SECTIONS,
        status="published",
        valid_for_months=months,
        **extra,
    )
    db.add(template)
    await db.flush()
    return template


def _test(org_id, template, candidate, examiner, when: datetime, **overrides):
    fields = {
        "organization_id": org_id,
        "template_id": template.id,
        "candidate_id": candidate,
        "examiner_id": examiner,
        "status": "completed",
        "result": "pass",
        "started_at": when,
        "completed_at": when,
        "created_at": when,
        "validated_at": when,
    }
    fields.update(overrides)
    return SkillTest(**fields)


NOW = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)


@pytest.mark.integration
class TestMemberSkillExpirations:
    async def _world(self, db: AsyncSession):
        org_id = await _make_org(db)
        member = await _make_user(db, org_id)
        examiner = await _make_user(db, org_id)
        return org_id, member, examiner

    async def _expirations(self, db, org_id, member, *, is_officer=False):
        return await member_skill_expirations(
            db, org_id, member, is_officer=is_officer, today=TODAY
        )

    async def test_a_qualifying_pass_expires_after_the_period(
        self, db_session: AsyncSession
    ):
        org_id, member, examiner = await self._world(db_session)
        scba = await _template(db_session, org_id, "SCBA Donning", 12)
        db_session.add(_test(org_id, scba, member, examiner, NOW))
        await db_session.flush()

        result = await self._expirations(db_session, org_id, member)

        assert len(result) == 1
        assert result[0]["template_name"] == "SCBA Donning"
        assert result[0]["passed_on"] == "2026-04-01"
        assert result[0]["expiration_date"] == "2027-04-01"
        assert result[0]["days_until_expiry"] == (date(2027, 4, 1) - TODAY).days

    async def test_an_expired_pass_has_negative_days(self, db_session: AsyncSession):
        org_id, member, examiner = await self._world(db_session)
        scba = await _template(db_session, org_id, "SCBA Donning", 3)
        db_session.add(_test(org_id, scba, member, examiner, NOW))
        await db_session.flush()

        result = await self._expirations(db_session, org_id, member)

        assert result[0]["expiration_date"] == "2026-07-01"
        assert result[0]["days_until_expiry"] < 0

    async def test_a_skill_without_a_period_never_lapses(
        self, db_session: AsyncSession
    ):
        org_id, member, examiner = await self._world(db_session)
        scba = await _template(db_session, org_id, "SCBA Donning", None)
        db_session.add(_test(org_id, scba, member, examiner, NOW))
        await db_session.flush()

        assert await self._expirations(db_session, org_id, member) == []

    @pytest.mark.parametrize(
        "overrides",
        [
            {"is_practice": True},
            {"result": "fail"},
            {"result": "incomplete"},
            {"status": "in_progress"},
            {"status": "voided"},
            {"voided_at": NOW},
            {"validated_at": None},
        ],
        ids=[
            "practice",
            "failed",
            "incomplete",
            "in_progress",
            "voided_status",
            "voided_at",
            "unvalidated",
        ],
    )
    async def test_only_an_official_validated_pass_starts_a_clock(
        self, db_session: AsyncSession, overrides
    ):
        org_id, member, examiner = await self._world(db_session)
        scba = await _template(db_session, org_id, "SCBA Donning", 12)
        db_session.add(_test(org_id, scba, member, examiner, NOW, **overrides))
        await db_session.flush()

        assert await self._expirations(db_session, org_id, member) == []

    async def test_the_newest_pass_per_skill_is_the_one_read(
        self, db_session: AsyncSession
    ):
        org_id, member, examiner = await self._world(db_session)
        scba = await _template(db_session, org_id, "SCBA Donning", 12)
        older = NOW - timedelta(days=300)
        db_session.add_all(
            [
                _test(org_id, scba, member, examiner, older),
                _test(org_id, scba, member, examiner, NOW),
            ]
        )
        await db_session.flush()

        result = await self._expirations(db_session, org_id, member)

        assert [e["expiration_date"] for e in result] == ["2027-04-01"]

    async def test_a_later_failure_does_not_hide_the_standing_pass(
        self, db_session: AsyncSession
    ):
        org_id, member, examiner = await self._world(db_session)
        scba = await _template(db_session, org_id, "SCBA Donning", 12)
        db_session.add_all(
            [
                _test(org_id, scba, member, examiner, NOW),
                _test(
                    org_id,
                    scba,
                    member,
                    examiner,
                    NOW + timedelta(days=30),
                    result="fail",
                ),
            ]
        )
        await db_session.flush()

        result = await self._expirations(db_session, org_id, member)

        assert [e["passed_on"] for e in result] == ["2026-04-01"]

    async def test_entries_are_sorted_soonest_first(self, db_session: AsyncSession):
        org_id, member, examiner = await self._world(db_session)
        slow = await _template(db_session, org_id, "Ladder Raise", 36)
        fast = await _template(db_session, org_id, "SCBA Donning", 6)
        db_session.add_all(
            [
                _test(org_id, slow, member, examiner, NOW),
                _test(org_id, fast, member, examiner, NOW),
            ]
        )
        await db_session.flush()

        result = await self._expirations(db_session, org_id, member)

        assert [e["template_name"] for e in result] == ["SCBA Donning", "Ladder Raise"]

    async def test_another_members_pass_is_not_listed(self, db_session: AsyncSession):
        org_id, member, examiner = await self._world(db_session)
        scba = await _template(db_session, org_id, "SCBA Donning", 12)
        db_session.add(_test(org_id, scba, examiner, examiner, NOW))
        await db_session.flush()

        assert await self._expirations(db_session, org_id, member) == []

    async def test_another_organizations_rows_are_not_listed(
        self, db_session: AsyncSession
    ):
        org_id, member, examiner = await self._world(db_session)
        other_org = await _make_org(db_session)
        foreign = await _template(db_session, other_org, "SCBA Donning", 12)
        db_session.add(_test(other_org, foreign, member, examiner, NOW))
        await db_session.flush()

        assert await self._expirations(db_session, org_id, member) == []

    async def test_a_withheld_result_is_not_announced_by_its_expiry(
        self, db_session: AsyncSession
    ):
        org_id, member, examiner = await self._world(db_session)
        promo = await _template(
            db_session, org_id, "Promotional Evaluation", 12, result_disclosure="none"
        )
        db_session.add(_test(org_id, promo, member, examiner, NOW))
        await db_session.flush()

        assert await self._expirations(db_session, org_id, member) == []

    async def test_a_result_awaiting_release_is_not_listed(
        self, db_session: AsyncSession
    ):
        org_id, member, examiner = await self._world(db_session)
        promo = await _template(
            db_session,
            org_id,
            "Promotional Evaluation",
            12,
            result_release="on_release",
        )
        db_session.add(_test(org_id, promo, member, examiner, NOW))
        await db_session.flush()

        assert await self._expirations(db_session, org_id, member) == []

    async def test_the_pass_date_is_the_organizations_local_day(
        self, db_session: AsyncSession
    ):
        org_id, member, examiner = await self._world(db_session)
        await db_session.execute(
            text(
                "UPDATE organizations SET timezone = 'America/New_York' WHERE id = :i"
            ),
            {"i": org_id},
        )
        scba = await _template(db_session, org_id, "SCBA Donning", 12)
        late = datetime(2026, 4, 2, 2, 30, tzinfo=timezone.utc)
        db_session.add(_test(org_id, scba, member, examiner, late))
        await db_session.flush()

        result = await self._expirations(db_session, org_id, member)

        assert result[0]["passed_on"] == "2026-04-01"
        assert result[0]["expiration_date"] == "2027-04-01"
