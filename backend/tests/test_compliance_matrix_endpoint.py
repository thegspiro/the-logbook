"""
Integration tests for GET /training/compliance-matrix.

Covers the fields the triage view added on top of the original payload and,
separately, the denominator: a requirement restricted to another membership
type is not something the member can fail, so it must not sit in their
percentage.
"""

import json
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.training import get_compliance_matrix

pytestmark = [pytest.mark.integration]

_NOW = datetime.now(timezone.utc)


def _uid() -> str:
    return str(uuid.uuid4())


async def _insert_org(db_session: AsyncSession) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Matrix Dept", "slug": f"matrix-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


async def _insert_member(
    db_session: AsyncSession,
    org_id: str,
    *,
    last_name: str,
    membership_type: str = "active",
) -> str:
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, email, "
            "password_hash, status, membership_type, compliance_exempt) "
            "VALUES (:id, :org, :un, 'Test', :ln, :em, 'hashed', 'active', "
            ":mt, 0)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u-{user_id[:8]}",
            "ln": last_name,
            "em": f"u-{user_id[:8]}@test.com",
            "mt": membership_type,
        },
    )
    await db_session.flush()
    return user_id


async def _insert_hours_req(
    db_session: AsyncSession,
    org_id: str,
    *,
    name: str,
    required_hours: float = 24.0,
    membership_types: list[str] | None = None,
) -> str:
    req_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO training_requirements "
            "(id, organization_id, name, requirement_type, source, "
            "required_hours, frequency, due_date_type, period_start_month, "
            "period_start_day, required_membership_types, applies_to_all, "
            "active, created_at, updated_at) "
            "VALUES (:id, :org, :name, 'hours', 'department', :hours, "
            "'annual', 'calendar_period', 1, 1, :mt, 1, 1, :now, :now)"
        ),
        {
            "id": req_id,
            "org": org_id,
            "name": name,
            "hours": required_hours,
            "mt": json.dumps(membership_types) if membership_types else None,
            "now": _NOW,
        },
    )
    await db_session.flush()
    return req_id


async def _insert_record(
    db_session: AsyncSession,
    org_id: str,
    user_id: str,
    *,
    hours: float,
    completion_date: date,
) -> None:
    await db_session.execute(
        text(
            "INSERT INTO training_records "
            "(id, organization_id, user_id, course_name, training_type, "
            "status, completion_date, hours_completed, created_at, updated_at) "
            "VALUES (:id, :org, :uid, 'Drill', 'continuing_education', "
            "'completed', :cd, :hrs, :now, :now)"
        ),
        {
            "id": _uid(),
            "org": org_id,
            "uid": user_id,
            "cd": completion_date,
            "hrs": hours,
            "now": _NOW,
        },
    )
    await db_session.flush()


async def _call(db_session: AsyncSession, org_id: str) -> dict:
    """Invoke the endpoint with a caller already resolved to this org."""
    from app.models.user import User

    caller = User(id=_uid(), organization_id=org_id)
    return await get_compliance_matrix(db=db_session, current_user=caller)


class TestMatrixProgressFields:
    async def test_cell_carries_the_numbers_behind_its_status(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session)
        user_id = await _insert_member(db_session, org_id, last_name="Boyle")
        await _insert_hours_req(db_session, org_id, name="Company Hours")
        await _insert_record(
            db_session, org_id, user_id, hours=18.0, completion_date=date.today()
        )

        payload = await _call(db_session, org_id)

        cell = payload["members"][0]["requirements"][0]
        assert cell["status"] == "in_progress"
        assert cell["progress_current"] == 18.0
        assert cell["progress_required"] == 24.0
        assert cell["progress_unit"] == "hours"
        assert cell["waived_months"] == 0
        assert cell["window_start"] is not None
        assert cell["window_end"] is not None

    async def test_requirement_meta_describes_the_target(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session)
        await _insert_member(db_session, org_id, last_name="Boyle")
        await _insert_hours_req(
            db_session, org_id, name="Company Hours", required_hours=24.0
        )

        payload = await _call(db_session, org_id)

        req = payload["requirements"][0]
        assert req["requirement_type"] == "hours"
        assert req["frequency"] == "annual"
        assert req["target"] == 24.0
        assert req["target_unit"] == "hours"

    async def test_response_reports_the_evaluation_cutoff(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session)
        await _insert_member(db_session, org_id, last_name="Boyle")
        await _insert_hours_req(db_session, org_id, name="Company Hours")

        payload = await _call(db_session, org_id)

        assert payload["as_of"] == date.today().isoformat()
        assert payload["threshold_type"] == "percentage"

    async def test_original_fields_are_unchanged(self, db_session: AsyncSession):
        """The added keys are additive — the four a pre-existing consumer
        reads must still be there and still mean the same thing."""
        org_id = await _insert_org(db_session)
        await _insert_member(db_session, org_id, last_name="Boyle")
        await _insert_hours_req(db_session, org_id, name="Company Hours")

        payload = await _call(db_session, org_id)

        assert set(payload) >= {"members", "requirements", "generated_at"}
        member = payload["members"][0]
        assert set(member) >= {
            "user_id",
            "member_name",
            "requirements",
            "completion_pct",
        }
        assert member["member_name"] == "Boyle, Test"
        assert set(payload["requirements"][0]) >= {"id", "name"}
        assert set(payload["members"][0]["requirements"][0]) >= {
            "requirement_id",
            "requirement_name",
            "status",
            "completion_date",
            "expiry_date",
        }


class TestApplicableRequirementDenominator:
    async def test_inapplicable_requirement_is_out_of_the_percentage(
        self, db_session: AsyncSession
    ):
        """An active member cannot satisfy a probationary-only requirement and
        must not be scored against it. Dividing by every active requirement
        capped them below 100% no matter what they did."""
        org_id = await _insert_org(db_session)
        user_id = await _insert_member(
            db_session, org_id, last_name="Boyle", membership_type="active"
        )
        await _insert_hours_req(db_session, org_id, name="Company Hours")
        await _insert_hours_req(
            db_session,
            org_id,
            name="Probationary Intake",
            membership_types=["probationary"],
        )
        await _insert_record(
            db_session, org_id, user_id, hours=30.0, completion_date=date.today()
        )

        payload = await _call(db_session, org_id)

        member = payload["members"][0]
        assert len(member["requirements"]) == 1
        assert member["requirements_total"] == 1
        assert member["requirements_met"] == 1
        assert member["completion_pct"] == 100.0
        assert member["standing"] == "compliant"

    async def test_standing_reflects_the_shortfall(self, db_session: AsyncSession):
        org_id = await _insert_org(db_session)
        user_id = await _insert_member(db_session, org_id, last_name="Doherty")
        await _insert_hours_req(db_session, org_id, name="Company Hours")
        await _insert_hours_req(db_session, org_id, name="Officer Hours")
        await _insert_record(
            db_session, org_id, user_id, hours=30.0, completion_date=date.today()
        )

        payload = await _call(db_session, org_id)

        member = payload["members"][0]
        assert member["requirements_total"] == 2
        assert member["completion_pct"] == 100.0
        assert member["membership_type"] == "active"

    async def test_member_with_nothing_recorded_is_non_compliant(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session)
        await _insert_member(db_session, org_id, last_name="Halloran")
        await _insert_hours_req(db_session, org_id, name="Company Hours")

        payload = await _call(db_session, org_id)

        member = payload["members"][0]
        assert member["standing"] == "non_compliant"
        assert member["completion_pct"] == 0.0
        assert member["requirements_met"] == 0


async def _insert_compliance_config(
    db_session: AsyncSession,
    org_id: str,
    *,
    compliant_threshold: float = 100.0,
    at_risk_threshold: float = 75.0,
    threshold_type: str = "percentage",
) -> str:
    config_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO compliance_configs "
            "(id, organization_id, compliant_threshold, at_risk_threshold, "
            "threshold_type, include_current_month, created_at, updated_at) "
            "VALUES (:id, :org, :ct, :art, :tt, 1, :now, :now)"
        ),
        {
            "id": config_id,
            "org": org_id,
            "ct": compliant_threshold,
            "art": at_risk_threshold,
            "tt": threshold_type,
            "now": _NOW,
        },
    )
    await db_session.flush()
    return config_id


async def _insert_profile(
    db_session: AsyncSession,
    config_id: str,
    *,
    name: str,
    membership_types: list[str] | None = None,
    required_requirement_ids: list[str] | None = None,
    compliant_override: float | None = None,
    at_risk_override: float | None = None,
    priority: int = 10,
) -> str:
    profile_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO compliance_profiles "
            "(id, config_id, name, membership_types, role_ids, "
            "required_requirement_ids, compliant_threshold_override, "
            "at_risk_threshold_override, priority, is_active, "
            "created_at, updated_at) "
            "VALUES (:id, :cfg, :name, :mt, NULL, :rr, :co, :ao, :prio, 1, "
            ":now, :now)"
        ),
        {
            "id": profile_id,
            "cfg": config_id,
            "name": name,
            "mt": json.dumps(membership_types) if membership_types else None,
            "rr": (
                json.dumps(required_requirement_ids)
                if required_requirement_ids is not None
                else None
            ),
            "co": compliant_override,
            "ao": at_risk_override,
            "prio": priority,
            "now": _NOW,
        },
    )
    await db_session.flush()
    return profile_id


class TestComplianceProfiles:
    """The dashboard percentage honours profiles; the matrix links from it and
    has to agree. A member reading "compliant" on one and "non-compliant" on
    the other is a support call."""

    async def test_profile_narrows_which_requirements_grade_a_member(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session)
        user_id = await _insert_member(db_session, org_id, last_name="Reyes")
        graded = await _insert_hours_req(db_session, org_id, name="Company Hours")
        # Deliberately out of reach, so grading against it would drag the
        # member below compliant if the profile were ignored.
        await _insert_hours_req(
            db_session, org_id, name="Officer Hours", required_hours=100.0
        )
        await _insert_record(
            db_session, org_id, user_id, hours=30.0, completion_date=date.today()
        )

        config_id = await _insert_compliance_config(db_session, org_id)
        await _insert_profile(
            db_session,
            config_id,
            name="Active members",
            membership_types=["active"],
            required_requirement_ids=[graded],
        )

        payload = await _call(db_session, org_id)

        member = payload["members"][0]
        # Only the profile's requirement grades them, so 30 hours is full marks
        # rather than half.
        assert member["requirements_total"] == 1
        assert member["requirements_met"] == 1
        assert member["completion_pct"] == 100.0
        assert member["standing"] == "compliant"
        assert [c["requirement_name"] for c in member["requirements"]] == [
            "Company Hours"
        ]

    async def test_profile_threshold_override_changes_the_standing(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session)
        user_id = await _insert_member(db_session, org_id, last_name="Ito")
        await _insert_hours_req(db_session, org_id, name="Company Hours")
        await _insert_hours_req(
            db_session, org_id, name="Officer Hours", required_hours=100.0
        )
        await _insert_record(
            db_session, org_id, user_id, hours=30.0, completion_date=date.today()
        )

        config_id = await _insert_compliance_config(db_session, org_id)
        # One of two met is 50% — non-compliant on the org default, compliant
        # for a group whose profile says half is enough.
        await _insert_profile(
            db_session,
            config_id,
            name="Support",
            membership_types=["active"],
            compliant_override=50.0,
            at_risk_override=25.0,
        )

        payload = await _call(db_session, org_id)

        member = payload["members"][0]
        assert member["completion_pct"] == 50.0
        assert member["standing"] == "compliant"

    async def test_empty_required_list_means_nothing_is_required(
        self, db_session: AsyncSession
    ):
        """An explicitly empty list is "nothing required of this group", not
        "unset" — the distinction CMP2-3 fixed in compute_org_compliance_pct."""
        org_id = await _insert_org(db_session)
        await _insert_member(db_session, org_id, last_name="Grady")
        await _insert_hours_req(db_session, org_id, name="Company Hours")

        config_id = await _insert_compliance_config(db_session, org_id)
        await _insert_profile(
            db_session,
            config_id,
            name="Life members",
            membership_types=["active"],
            required_requirement_ids=[],
        )

        payload = await _call(db_session, org_id)

        member = payload["members"][0]
        assert member["requirements"] == []
        assert member["requirements_total"] == 0
        assert member["standing"] == "compliant"

    async def test_matrix_agrees_with_the_org_percentage(
        self, db_session: AsyncSession
    ):
        """Cross-check against the function that feeds the dashboard."""
        from app.services.training_compliance import compute_org_compliance_pct

        org_id = await _insert_org(db_session)
        user_id = await _insert_member(db_session, org_id, last_name="Novak")
        graded = await _insert_hours_req(db_session, org_id, name="Company Hours")
        await _insert_hours_req(
            db_session, org_id, name="Officer Hours", required_hours=100.0
        )
        await _insert_record(
            db_session, org_id, user_id, hours=30.0, completion_date=date.today()
        )

        config_id = await _insert_compliance_config(db_session, org_id)
        await _insert_profile(
            db_session,
            config_id,
            name="Active members",
            membership_types=["active"],
            required_requirement_ids=[graded],
        )

        payload = await _call(db_session, org_id)
        org_pct = await compute_org_compliance_pct(db_session, org_id)

        compliant = [m for m in payload["members"] if m["standing"] == "compliant"]
        # One member, compliant on both readings.
        assert len(compliant) == 1
        assert org_pct == 100.0


class TestConfigLoadedOnce:
    async def test_config_is_not_loaded_twice_per_request(
        self, db_session: AsyncSession, monkeypatch
    ):
        """get_org_include_current_month() issues the same query with the same
        selectinload; calling both cost every configured org a duplicate
        config+profile round trip on each visit."""
        from app.api.v1.endpoints import training as training_ep

        org_id = await _insert_org(db_session)
        await _insert_member(db_session, org_id, last_name="Boyle")
        await _insert_hours_req(db_session, org_id, name="Company Hours")
        await _insert_compliance_config(db_session, org_id)

        calls = 0
        original = training_ep._load_compliance_config

        async def counting(*args, **kwargs):
            nonlocal calls
            calls += 1
            return await original(*args, **kwargs)

        monkeypatch.setattr(training_ep, "_load_compliance_config", counting)

        await _call(db_session, org_id)

        assert calls == 1


class TestProfileMemberLoading:
    async def test_org_percentage_survives_a_member_who_is_not_the_caller(
        self, db_session: AsyncSession
    ):
        """Regression: `compute_org_compliance_pct` selected members with no
        eager load, then `_find_matching_profile` read `member.positions` on
        each one. That relationship is lazy, so touching it unloaded on an
        AsyncSession raises MissingGreenlet — and only the *caller* arrives
        with it warmed by the auth dependency. Any org that configured a
        compliance profile therefore raised on the first member who was not
        the caller, which is every real request.

        Deliberately does not warm the relationship first; warming it is what
        hid this.
        """
        from app.services.training_compliance import compute_org_compliance_pct

        org_id = await _insert_org(db_session)
        await _insert_member(db_session, org_id, last_name="Alvarez")
        await _insert_member(db_session, org_id, last_name="Mbeki")
        req_id = await _insert_hours_req(db_session, org_id, name="Company Hours")

        config_id = await _insert_compliance_config(db_session, org_id)
        await _insert_profile(
            db_session,
            config_id,
            name="Active members",
            membership_types=["active"],
            required_requirement_ids=[req_id],
        )

        pct = await compute_org_compliance_pct(db_session, org_id)
        assert pct == 0.0

    async def test_matrix_survives_the_same(self, db_session: AsyncSession):
        org_id = await _insert_org(db_session)
        await _insert_member(db_session, org_id, last_name="Alvarez")
        await _insert_member(db_session, org_id, last_name="Mbeki")
        req_id = await _insert_hours_req(db_session, org_id, name="Company Hours")

        config_id = await _insert_compliance_config(db_session, org_id)
        await _insert_profile(
            db_session,
            config_id,
            name="Active members",
            membership_types=["active"],
            required_requirement_ids=[req_id],
        )

        payload = await _call(db_session, org_id)
        assert len(payload["members"]) == 2
        assert all(m["standing"] == "non_compliant" for m in payload["members"])
