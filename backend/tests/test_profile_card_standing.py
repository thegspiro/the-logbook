"""
The member profile compliance card shows the compliance matrix's standing.

``GET /training/compliance-summary/{user_id}`` (the profile card, My Crew and
the member training print page) coloured a member by its own rule: red for any
expired certificate or under half the requirements met, yellow for any
certificate expiring within 90 days or anything unmet, green otherwise. The
compliance matrix classifies the same member through
``ComplianceGrading.classify``: the department's thresholds and
``threshold_type``, and the matching profile's overrides. The two screens read
differently for the same member (owner decision 2026-11-20, "card uses profile
limits"; CLAUDE.md pitfall 29).

Every test here asserts the card against the matrix row for the same member,
with the expected colour written out rather than imported, so a wrong map in
the endpoint fails. The tests whose old answer differs say so; the guards at
the end pass before and after.

Records are tied to requirements by ``training_type``: each hours requirement
takes its own type, so one record credits exactly one requirement, and
certificate records carry no hours, so they credit no hours requirement.
"""

import uuid
from datetime import date, timedelta
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.training import (
    get_compliance_matrix,
    get_compliance_summary,
)
from app.models.compliance_config import ComplianceConfig, ComplianceProfile
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.utils.org_timezone import resolve_org_today

pytestmark = [pytest.mark.integration]

# Written out, not imported from the endpoint: the test states the mapping the
# owner approved, so a wrong map in the code under test fails here.
COLOUR = {
    "compliant": "green",
    "at_risk": "yellow",
    "non_compliant": "red",
    "not_applicable": "not_applicable",
}
LABEL = {
    "compliant": "Compliant",
    "at_risk": "At Risk",
    "non_compliant": "Non-Compliant",
    "not_applicable": "Not Applicable",
}

# One hours requirement per type, so a record credits exactly one of them.
HOURS_TYPES = (
    TrainingType.CONTINUING_EDUCATION,
    TrainingType.SKILLS_PRACTICE,
    TrainingType.ORIENTATION,
    TrainingType.SPECIALTY,
)


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db) -> tuple[Organization, date]:
    org = Organization(
        id=_uid(),
        name="Card Standing Department",
        slug=f"card-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org, await resolve_org_today(db, org.id)


async def _member(db, org: Organization, name: str, **fields) -> User:
    handle = uuid.uuid4().hex[:10]
    fields.setdefault("membership_type", "active")
    user = User(
        id=_uid(),
        organization_id=org.id,
        username=f"{name.lower()}-{handle}",
        email=f"{handle}@card.test",
        first_name=name,
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        # Long-standing, so no requirement is in a catch-up period.
        hire_date=date.today() - timedelta(days=3650),
        **fields,
    )
    db.add(user)
    await db.flush()
    return await _load(db, user.id)


async def _load(db, user_id: str) -> User:
    # Profile matching reads positions, a lazy relationship: load it, as the
    # auth dependency does for a real caller.
    return (
        await db.execute(
            select(User)
            .options(selectinload(User.positions))
            .where(User.id == user_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _hours_reqs(db, org: Organization, count: int) -> list[TrainingRequirement]:
    reqs = []
    for training_type in HOURS_TYPES[:count]:
        req = TrainingRequirement(
            id=_uid(),
            organization_id=org.id,
            name=f"Hours {training_type.value}",
            requirement_type=RequirementType.HOURS,
            training_type=training_type,
            required_hours=4,
            frequency=RequirementFrequency.ANNUAL,
            due_date_type=DueDateType.CALENDAR_PERIOD,
            period_start_month=1,
            period_start_day=1,
            applies_to_all=True,
            active=True,
        )
        db.add(req)
        reqs.append(req)
    await db.flush()
    return reqs


async def _cert_req(db, org: Organization) -> TrainingRequirement:
    req = TrainingRequirement(
        id=_uid(),
        organization_id=org.id,
        name="EMT Certification",
        requirement_type=RequirementType.CERTIFICATION,
        training_type=TrainingType.CERTIFICATION,
        frequency=RequirementFrequency.ONE_TIME,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        applies_to_all=True,
        active=True,
    )
    db.add(req)
    await db.flush()
    return req


async def _meet(db, org: Organization, user: User, count: int, today: date) -> None:
    """Credit the member's first ``count`` hours requirements in full."""
    for training_type in HOURS_TYPES[:count]:
        db.add(
            TrainingRecord(
                id=_uid(),
                organization_id=org.id,
                user_id=user.id,
                course_name="Company Drill",
                training_type=training_type,
                status=TrainingStatus.COMPLETED,
                completion_date=today,
                hours_completed=4.0,
            )
        )
    await db.flush()


async def _cert(
    db, org: Organization, user: User, *, completed: date, expires: date
) -> None:
    db.add(
        TrainingRecord(
            id=_uid(),
            organization_id=org.id,
            user_id=user.id,
            course_name="EMT",
            training_type=TrainingType.CERTIFICATION,
            status=TrainingStatus.COMPLETED,
            completion_date=completed,
            expiration_date=expires,
            certification_number=f"EMT-{uuid.uuid4().hex[:6]}",
            hours_completed=0,
        )
    )
    await db.flush()


async def _config(
    db,
    org: Organization,
    *,
    compliant: float = 100.0,
    at_risk: float = 75.0,
    threshold_type: str = "percentage",
    include_current_month: bool = True,
) -> ComplianceConfig:
    config = ComplianceConfig(
        id=_uid(),
        organization_id=org.id,
        compliant_threshold=compliant,
        at_risk_threshold=at_risk,
        threshold_type=threshold_type,
        include_current_month=include_current_month,
    )
    db.add(config)
    await db.flush()
    return config


async def _profile(
    db,
    config: ComplianceConfig,
    *,
    membership_types: list[str],
    required_requirement_ids: list[str] | None = None,
    compliant_override: float | None = None,
    at_risk_override: float | None = None,
    priority: int = 10,
) -> None:
    db.add(
        ComplianceProfile(
            id=_uid(),
            config_id=config.id,
            name=f"Profile {priority}",
            membership_types=membership_types,
            required_requirement_ids=required_requirement_ids,
            compliant_threshold_override=compliant_override,
            at_risk_threshold_override=at_risk_override,
            priority=priority,
            is_active=True,
        )
    )
    await db.flush()


async def _card(db, user: User):
    # The member viewing their own card: self-access needs no permission.
    return await get_compliance_summary(user_id=UUID(user.id), db=db, current_user=user)


async def _rows(db, org: Organization) -> dict[str, dict]:
    caller = User(id=_uid(), organization_id=org.id)
    payload = await get_compliance_matrix(db=db, current_user=caller)
    return {str(m["user_id"]): m for m in payload["members"]}


async def _assert_card_matches_matrix(db, org, user, standing: str):
    """The matrix gives ``standing``, and the card shows exactly that."""
    row = (await _rows(db, org))[user.id]
    assert row["standing"] == standing
    card = await _card(db, user)
    assert (card.compliance_status, card.compliance_label) == (
        COLOUR[standing],
        LABEL[standing],
    )
    assert card.requirements_met == row["requirements_met"]
    assert card.requirements_total == row["requirements_total"]
    return card


class TestCardFollowsTheThresholds:
    async def test_lowered_compliant_threshold_reads_green(self, db_session):
        # Before: yellow, because one requirement is unmet.
        org, today = await _org(db_session)
        await _hours_reqs(db_session, org, 2)
        config = await _config(db_session, org)
        await _profile(
            db_session,
            config,
            membership_types=["active"],
            compliant_override=50,
            at_risk_override=25,
        )
        member = await _member(db_session, org, "Alpha")
        await _meet(db_session, org, member, 1, today)

        await _assert_card_matches_matrix(db_session, org, member, "compliant")

    async def test_card_green_exactly_when_matrix_compliant(self, db_session):
        org, today = await _org(db_session)
        await _hours_reqs(db_session, org, 2)
        config = await _config(db_session, org)
        await _profile(
            db_session,
            config,
            membership_types=["active"],
            compliant_override=50,
            at_risk_override=25,
        )
        none_met = await _member(db_session, org, "Bravo")
        one_met = await _member(db_session, org, "Charlie")
        await _meet(db_session, org, one_met, 1, today)

        rows = await _rows(db_session, org)
        for member in (none_met, one_met):
            card = await _card(db_session, member)
            assert (card.compliance_status == "green") == (
                rows[member.id]["standing"] == "compliant"
            )
        assert rows[one_met.id]["standing"] == "compliant"
        assert rows[none_met.id]["standing"] == "non_compliant"

    async def test_at_risk_band_follows_profile_override(self, db_session):
        # 1 of 4 is 25%. Before: red, because 1 < 4 * 0.5.
        org, today = await _org(db_session)
        await _hours_reqs(db_session, org, 4)
        config = await _config(db_session, org)
        await _profile(
            db_session, config, membership_types=["active"], at_risk_override=25
        )
        member = await _member(db_session, org, "Delta")
        await _meet(db_session, org, member, 1, today)

        await _assert_card_matches_matrix(db_session, org, member, "at_risk")

    async def test_non_compliant_band_without_compliance_config(self, db_session):
        # No compliance config: the defaults are 100 / 75. Two of four is 50%,
        # under 75: non-compliant. Before: yellow, because 2 >= 4 * 0.5.
        org, today = await _org(db_session)
        await _hours_reqs(db_session, org, 4)
        half = await _member(db_session, org, "Echo")
        three = await _member(db_session, org, "Foxtrot")
        every = await _member(db_session, org, "Golf")
        await _meet(db_session, org, half, 2, today)
        await _meet(db_session, org, three, 3, today)
        await _meet(db_session, org, every, 4, today)

        await _assert_card_matches_matrix(db_session, org, half, "non_compliant")
        # Guards: the same answer before and after.
        await _assert_card_matches_matrix(db_session, org, three, "at_risk")
        await _assert_card_matches_matrix(db_session, org, every, "compliant")

    async def test_org_level_thresholds_without_profiles(self, db_session):
        # A department that lowered its own bar, with no profiles at all.
        # 3 of 4 is 75%. Before: yellow, because one requirement is unmet.
        org, today = await _org(db_session)
        await _hours_reqs(db_session, org, 4)
        await _config(db_session, org, compliant=75, at_risk=50)
        member = await _member(db_session, org, "Hotel")
        await _meet(db_session, org, member, 3, today)

        await _assert_card_matches_matrix(db_session, org, member, "compliant")

    async def test_all_required_threshold_type(self, db_session):
        # "all_required" ignores the compliant percentage (set to 50 here to
        # prove it) and keeps the at-risk band. Before: 1 of 4 read red,
        # because 1 < 4 * 0.5.
        org, today = await _org(db_session)
        await _hours_reqs(db_session, org, 4)
        await _config(
            db_session, org, compliant=50, at_risk=25, threshold_type="all_required"
        )
        one = await _member(db_session, org, "India")
        two = await _member(db_session, org, "Juliet")
        every = await _member(db_session, org, "Kilo")
        await _meet(db_session, org, one, 1, today)
        await _meet(db_session, org, two, 2, today)
        await _meet(db_session, org, every, 4, today)

        await _assert_card_matches_matrix(db_session, org, one, "at_risk")
        # 50% meets the compliant percentage but not "all required".
        await _assert_card_matches_matrix(db_session, org, two, "at_risk")
        await _assert_card_matches_matrix(db_session, org, every, "compliant")


class TestCertificatesColourOnlyThroughTheirRequirement:
    async def test_expiring_certificate_does_not_colour_a_compliant_member(
        self, db_session
    ):
        # Before: yellow, for a certificate no requirement found lapsed.
        org, today = await _org(db_session)
        await _hours_reqs(db_session, org, 2)
        member = await _member(db_session, org, "Lima")
        await _meet(db_session, org, member, 2, today)
        await _cert(
            db_session,
            org,
            member,
            completed=today - timedelta(days=700),
            expires=today + timedelta(days=30),
        )

        card = await _assert_card_matches_matrix(db_session, org, member, "compliant")
        assert card.certs_expiring_soon == 1

    async def test_superseded_expired_certificate_does_not_colour_the_card(
        self, db_session
    ):
        # The old certificate expired and was renewed. Both records match the
        # requirement, and the grader reads the latest. Before: red, because
        # the expired count includes the superseded record.
        org, today = await _org(db_session)
        cert_req = await _cert_req(db_session, org)
        member = await _member(db_session, org, "Mike")
        await _cert(
            db_session,
            org,
            member,
            completed=today - timedelta(days=1100),
            expires=today - timedelta(days=365),
        )
        await _cert(
            db_session,
            org,
            member,
            completed=today - timedelta(days=30),
            expires=today + timedelta(days=700),
        )

        card = await _assert_card_matches_matrix(db_session, org, member, "compliant")
        assert card.certs_expired == 1
        row = (await _rows(db_session, org))[member.id]
        cell = next(
            c for c in row["requirements"] if str(c["requirement_id"]) == cert_req.id
        )
        assert cell["status"] == "completed"

    async def test_expired_certificate_counts_through_its_requirement(self, db_session):
        # Guard: an expired certificate the department grades still lowers
        # the standing. One of two met is 50%, under the default 75%.
        org, today = await _org(db_session)
        cert_req = await _cert_req(db_session, org)
        await _hours_reqs(db_session, org, 1)
        member = await _member(db_session, org, "November")
        await _meet(db_session, org, member, 1, today)
        await _cert(
            db_session,
            org,
            member,
            completed=today - timedelta(days=800),
            expires=today - timedelta(days=10),
        )

        await _assert_card_matches_matrix(db_session, org, member, "non_compliant")
        row = (await _rows(db_session, org))[member.id]
        cell = next(
            c for c in row["requirements"] if str(c["requirement_id"]) == cert_req.id
        )
        assert cell["status"] == "expired"

    async def test_nothing_graded_with_lapsing_certificate_is_not_applicable(
        self, db_session
    ):
        # The member's profile requires nothing. Before: yellow, for the
        # expiring certificate.
        org, today = await _org(db_session)
        await _hours_reqs(db_session, org, 1)
        config = await _config(db_session, org)
        await _profile(
            db_session,
            config,
            membership_types=["administrative"],
            required_requirement_ids=[],
        )
        member = await _member(
            db_session, org, "Oscar", membership_type="administrative"
        )
        await _cert(
            db_session,
            org,
            member,
            completed=today - timedelta(days=700),
            expires=today + timedelta(days=30),
        )

        card = await _assert_card_matches_matrix(
            db_session, org, member, "not_applicable"
        )
        assert card.requirements_total == 0
        assert card.certs_expiring_soon == 1

    async def test_lapsed_this_month_with_include_current_month_off(self, db_session):
        # With the current month left out, the grader judges expiry at the
        # end of last month, so a certificate that lapsed this month is still
        # graded completed until the month ends. The expired count measures
        # against today and reports it. Before: red, from the count.
        org, today = await _org(db_session)
        if today.day == 1:
            pytest.skip("no day of this month lies before today")
        await _cert_req(db_session, org)
        await _config(db_session, org, include_current_month=False)
        member = await _member(db_session, org, "Papa")
        await _cert(
            db_session,
            org,
            member,
            completed=today - timedelta(days=800),
            expires=today.replace(day=1),
        )

        card = await _assert_card_matches_matrix(db_session, org, member, "compliant")
        assert card.certs_expired == 1


class TestCardAgreesWithTheMatrix:
    async def test_card_agrees_with_matrix_for_every_member(self, db_session):
        org, today = await _org(db_session)
        reqs = await _hours_reqs(db_session, org, 4)
        config = await _config(db_session, org)
        await _profile(
            db_session,
            config,
            membership_types=["administrative"],
            required_requirement_ids=[],
            priority=20,
        )
        await _profile(
            db_session,
            config,
            membership_types=["reserve"],
            required_requirement_ids=[r.id for r in reqs],
            compliant_override=50,
            at_risk_override=25,
            priority=10,
        )
        every = await _member(db_session, org, "Quebec")
        three = await _member(db_session, org, "Romeo")
        half = await _member(db_session, org, "Sierra")
        admin = await _member(
            db_session, org, "Tango", membership_type="administrative"
        )
        reserve = await _member(db_session, org, "Uniform", membership_type="reserve")
        expiring = await _member(db_session, org, "Victor")
        await _meet(db_session, org, every, 4, today)
        await _meet(db_session, org, three, 3, today)
        await _meet(db_session, org, half, 2, today)
        await _meet(db_session, org, reserve, 2, today)
        await _meet(db_session, org, expiring, 4, today)
        for holder in (admin, expiring):
            await _cert(
                db_session,
                org,
                holder,
                completed=today - timedelta(days=700),
                expires=today + timedelta(days=30),
            )

        rows = await _rows(db_session, org)

        # The fixture spans every standing, so the comparison below is not
        # vacuous: the not-applicable member has a row of their own.
        assert {row["standing"] for row in rows.values()} == set(COLOUR)
        assert len(rows) == 6
        for user_id, row in rows.items():
            card = await _card(db_session, await _load(db_session, user_id))
            standing = row["standing"]
            assert card.compliance_status == COLOUR[standing], row["member_name"]
            assert card.compliance_label == LABEL[standing], row["member_name"]
            assert card.requirements_met == row["requirements_met"]
            assert card.requirements_total == row["requirements_total"]


class TestGuards:
    async def test_exempt_member_unchanged(self, db_session):
        org, today = await _org(db_session)
        await _hours_reqs(db_session, org, 2)
        member = await _member(db_session, org, "Whiskey", compliance_exempt=True)

        card = await _card(db_session, member)

        assert card.compliance_status == "exempt"
        assert card.compliance_label == "Exempt"
        assert card.is_exempt is True
        assert (card.requirements_met, card.requirements_total) == (0, 0)
        assert member.id not in await _rows(db_session, org)
