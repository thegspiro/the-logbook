"""A screening requirement applies only to the members whose positions it names.

``screening_requirements.applies_to_roles`` was stored and read by nothing, so
every requirement graded every member (pitfall #19; MS-16 in
``docs/KNOWN_LIMITATIONS.md``). It now lists *position* names, and a member is
graded on a requirement only if they hold one of them:

* a requirement listing no positions applies to everyone, as it always did;
* names and slugs both match, in any case and with any of space, ``_`` and ``-``
  between words;
* a prospect holds no positions and is graded on every requirement;
* a member left with nothing that applies is ``not_applicable``, never compliant.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.models.user import Position
from app.schemas.medical_screening import ScreeningSubject, ScreeningSubjects
from app.services.medical_screening_service import (
    MedicalScreeningService,
    _applicable_requirements,
    _requirement_roles,
    _role_key,
)

TODAY = date(2026, 10, 19)


@pytest.fixture(autouse=True)
def _department_today(monkeypatch):
    monkeypatch.setattr(
        "app.services.medical_screening_service.resolve_org_today",
        AsyncMock(return_value=TODAY),
    )


def _requirement(roles=None, name="Annual Physical"):
    req = MagicMock(spec=ScreeningRequirement)
    req.id = str(uuid.uuid4())
    req.name = name
    req.screening_type = ScreeningType.PHYSICAL_EXAM
    req.applies_to_roles = roles
    return req


def _passing_record(user_id):
    rec = MagicMock(spec=ScreeningRecord)
    rec.screening_type = ScreeningType.PHYSICAL_EXAM
    rec.status = ScreeningStatus.PASSED.value
    rec.completed_date = TODAY - timedelta(days=30)
    rec.expiration_date = TODAY + timedelta(days=300)
    rec.user_id = user_id
    rec.prospect_id = None
    rec.self_recorded = False
    return rec


@pytest.mark.unit
class TestMatchingRule:
    def test_names_and_slugs_compare_alike(self):
        assert (
            _role_key("Safety Officer")
            == _role_key("safety_officer")
            == _role_key("  SAFETY-OFFICER ")
        )

    @pytest.mark.parametrize(
        "stored",
        [None, [], ["", "  "], "firefighter", {"firefighter": True}, [None, 5]],
    )
    def test_anything_unusable_reads_as_not_scoped(self, stored):
        """Over-grade rather than silently drop a medical screening."""
        assert _requirement_roles(_requirement(stored)) == set()

    def test_a_partly_usable_list_keeps_its_usable_entries(self):
        assert _requirement_roles(
            _requirement(["EMT", None, " ", "Driver Operator"])
        ) == {
            "emt",
            "driver operator",
        }

    def test_an_unscoped_requirement_applies_to_everyone(self):
        reqs = [_requirement(None)]

        assert _applicable_requirements(reqs, set()) == reqs
        assert _applicable_requirements(reqs, {"member"}) == reqs

    def test_a_scoped_requirement_needs_one_of_its_positions(self):
        scoped = _requirement(["Firefighter", "Apparatus Manager"])

        assert _applicable_requirements([scoped], {"member"}) == []
        assert _applicable_requirements([scoped], {"member", "apparatus manager"}) == [
            scoped
        ]

    def test_a_subject_with_no_positions_at_all_is_graded_on_everything(self):
        """A prospect: there is no role to show the requirement does not apply."""
        scoped = _requirement(["Firefighter"])

        assert _applicable_requirements([scoped], None) == [scoped]


@pytest.mark.unit
class TestGraders:
    @pytest.fixture
    def service(self):
        svc = MedicalScreeningService(AsyncMock())
        no_names = {"users": {}, "prospects": {}, "requirements": {}}
        with patch.object(svc, "_resolve_names", return_value=no_names):
            yield svc

    async def test_a_member_without_the_position_is_not_graded_on_it(self, service):
        scoped = _requirement(["Firefighter"])
        with (
            patch.object(service, "list_requirements", return_value=[scoped]),
            patch.object(service, "list_records", return_value=[]),
            patch.object(
                service, "_position_keys", return_value={"u-1": {"member"}}
            ) as keys,
        ):
            summary = await service.get_compliance_status("org-1", user_id="u-1")

        keys.assert_awaited_once_with("org-1", "u-1")
        assert summary.total_requirements == 0
        assert summary.non_compliant_count == 0

    async def test_the_slug_of_a_held_position_is_enough(self, service):
        scoped = _requirement(["Safety Officer"])
        with (
            patch.object(service, "list_requirements", return_value=[scoped]),
            patch.object(service, "list_records", return_value=[]),
            patch.object(
                service, "_position_keys", return_value={"u-1": {"safety officer"}}
            ),
        ):
            summary = await service.get_compliance_status("org-1", user_id="u-1")

        assert summary.total_requirements == 1
        assert summary.non_compliant_count == 1

    async def test_no_position_query_when_nothing_is_scoped(self, service):
        with (
            patch.object(
                service, "list_requirements", return_value=[_requirement(None)]
            ),
            patch.object(service, "list_records", return_value=[]),
            patch.object(service, "_position_keys", return_value={}) as keys,
        ):
            summary = await service.get_compliance_status("org-1", user_id="u-1")

        keys.assert_not_awaited()
        assert summary.total_requirements == 1

    async def test_a_prospect_is_graded_on_a_scoped_requirement(self, service):
        scoped = _requirement(["Firefighter"])
        with (
            patch.object(service, "list_requirements", return_value=[scoped]),
            patch.object(service, "list_records", return_value=[]),
            patch.object(service, "_position_keys", return_value={}) as keys,
        ):
            summary = await service.get_compliance_status("org-1", prospect_id="p-1")

        keys.assert_not_awaited()
        assert summary.total_requirements == 1

    async def test_the_roster_grades_each_row_on_what_applies_to_it(self, service):
        scoped = _requirement(["Firefighter"], name="Respirator Fit")
        everyone = _requirement(None, name="CPR Card")
        subjects = ScreeningSubjects(
            members=[
                ScreeningSubject(id="u-rider", name="Rae Rider"),
                ScreeningSubject(id="u-admin", name="Abe Admin"),
            ],
            prospects=[ScreeningSubject(id="p-1", name="Pat Prospect")],
        )
        with (
            patch.object(service, "list_requirements", return_value=[scoped, everyone]),
            patch.object(service, "list_subjects", return_value=subjects),
            patch.object(service, "list_records", return_value=[]),
            patch.object(
                service,
                "_position_keys",
                return_value={"u-rider": {"firefighter"}, "u-admin": {"member"}},
            ),
        ):
            roster = await service.get_compliance_roster("org-1")

        rows = {row.subject_name: row for row in roster.rows}
        assert rows["Rae Rider"].non_compliant_count == 2
        assert rows["Abe Admin"].non_compliant_count == 1
        assert rows["Pat Prospect"].non_compliant_count == 2
        assert roster.total_requirements == 2

    async def test_a_member_left_with_nothing_is_not_applicable_not_compliant(
        self, service
    ):
        scoped = _requirement(["Firefighter"])
        subjects = ScreeningSubjects(
            members=[ScreeningSubject(id="u-admin", name="Abe Admin")], prospects=[]
        )
        with (
            patch.object(service, "list_requirements", return_value=[scoped]),
            patch.object(service, "list_subjects", return_value=subjects),
            patch.object(
                service, "list_records", return_value=[_passing_record("u-admin")]
            ),
            patch.object(
                service, "_position_keys", return_value={"u-admin": {"member"}}
            ),
        ):
            roster = await service.get_compliance_roster("org-1", standing="compliant")

        assert roster.rows == []
        assert (roster.compliant, roster.not_compliant, roster.expiring_soon) == (
            0,
            0,
            0,
        )
        assert roster.total_subjects == 1


def _uid() -> str:
    return str(uuid.uuid4())


async def _insert_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Positions Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"pos-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _insert_member(db: AsyncSession, org_id: str, last_name: str) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, email, "
            "password_hash, status, membership_type, compliance_exempt) "
            "VALUES (:id, :org, :un, 'Test', :ln, :em, 'hashed', 'active', "
            "'active', 0)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u-{user_id[:8]}",
            "ln": last_name,
            "em": f"u-{user_id[:8]}@test.com",
        },
    )
    await db.flush()
    return user_id


async def _give_position(
    db: AsyncSession, org_id: str, user_id: str, name: str, slug: str
) -> None:
    position = Position(
        id=_uid(),
        organization_id=org_id,
        name=name,
        slug=slug,
        permissions=[],
        created_at=datetime.now(timezone.utc),
    )
    db.add(position)
    await db.flush()
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position.id},
    )
    await db.flush()


async def _add_requirement(
    db: AsyncSession, org_id: str, name: str, roles: list[str] | None
) -> None:
    db.add(
        ScreeningRequirement(
            id=_uid(),
            organization_id=org_id,
            name=name,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            frequency_months=12,
            applies_to_roles=roles,
            is_active=True,
            grace_period_days=30,
        )
    )
    await db.flush()


@pytest.mark.integration
class TestAgainstTheDatabase:
    async def test_position_keys_carry_names_and_slugs_for_this_org_only(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session)
        other_org = await _insert_org(db_session)
        member = await _insert_member(db_session, org_id, "Able")
        stranger = await _insert_member(db_session, other_org, "Baker")
        await _give_position(
            db_session, org_id, member, "Safety Officer", "safety_officer"
        )
        await _give_position(db_session, other_org, stranger, "Chief", "chief")

        service = MedicalScreeningService(db_session)

        assert await service._position_keys(org_id) == {member: {"safety officer"}}
        assert await service._position_keys(org_id, member) == {
            member: {"safety officer"}
        }
        # An id from another organization resolves nothing here.
        assert await service._position_keys(org_id, stranger) == {}

    async def test_status_and_roster_agree_on_who_a_requirement_applies_to(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session)
        rider = await _insert_member(db_session, org_id, "Rider")
        admin = await _insert_member(db_session, org_id, "Admin")
        await _give_position(db_session, org_id, rider, "Firefighter", "firefighter")
        await _give_position(db_session, org_id, admin, "Member", "member")
        await _add_requirement(db_session, org_id, "Respirator Fit", ["firefighter"])
        await _add_requirement(db_session, org_id, "CPR Card", None)
        service = MedicalScreeningService(db_session)

        rider_status = await service.get_compliance_status(org_id, user_id=rider)
        admin_status = await service.get_compliance_status(org_id, user_id=admin)
        roster = await service.get_compliance_roster(org_id)

        assert rider_status.total_requirements == 2
        assert admin_status.total_requirements == 1
        assert [item.requirement_name for item in admin_status.items] == ["CPR Card"]
        by_name = {row.subject_name: row for row in roster.rows}
        assert by_name["Test Rider"].non_compliant_count == 2
        assert by_name["Test Admin"].non_compliant_count == 1

    async def test_a_member_summary_counts_only_what_applies(
        self, db_session: AsyncSession
    ):
        """The dashboard reads this: zero requirements means no screening row."""
        org_id = await _insert_org(db_session)
        admin = await _insert_member(db_session, org_id, "Admin")
        await _give_position(db_session, org_id, admin, "Member", "member")
        await _add_requirement(db_session, org_id, "Respirator Fit", ["Firefighter"])

        summary = await MedicalScreeningService(db_session).get_my_compliance_summary(
            org_id, admin
        )

        assert summary.total_requirements == 0
        assert summary.non_compliant_count == 0
