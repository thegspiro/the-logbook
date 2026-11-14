"""A screening record satisfies only the requirement it is linked to.

Owner decision 2026-11-01, "Match by linked requirement". Records used to be
matched to requirements by screening *type*, so a department with an annual
physical and a separate two-yearly fitness-for-duty physical had both
satisfied by one exam, and a record linked to neither counted for both.

Now ``requirement_id`` decides: in the grade (summary, roster, dashboard), in
which newer record supersedes an older one, and in the expiring list. A record
linked to nothing counts toward nothing; an officer can link an existing record
from its Edit dialog, which is how a record the upgrade could not link
unambiguously (migration d6906e3dd76c) is filed.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.api.v1.endpoints import medical_screening as ep
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.schemas.medical_screening import ScreeningRecordUpdate
from app.services.medical_screening_service import MedicalScreeningService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def scene(db_session, setup_org_and_admin):
    """A member and two physical requirements of the same type."""
    org_id, officer_id = setup_org_and_admin
    member_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Pat', 'Member', :em, 'x', 'active')"
        ),
        {
            "id": member_id,
            "org": org_id,
            "un": f"m-{member_id[:8]}",
            "em": f"m-{member_id[:8]}@test.com",
        },
    )
    annual, fit_for_duty = (
        ScreeningRequirement(
            id=_uid(),
            organization_id=org_id,
            name=name,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            grace_period_days=0,
        )
        for name in ("Annual physical", "Fitness-for-duty physical")
    )
    db_session.add_all([annual, fit_for_duty])
    await db_session.flush()
    officer = SimpleNamespace(
        id=officer_id,
        organization_id=org_id,
        username="o",
        positions=[SimpleNamespace(permissions=["medical_screening.manage"])],
        rank=None,
    )
    return SimpleNamespace(
        org_id=org_id,
        member_id=member_id,
        annual=annual,
        fit_for_duty=fit_for_duty,
        officer=officer,
    )


async def _add(db_session, scene, requirement_id, **fields):
    record = ScreeningRecord(
        id=_uid(),
        organization_id=scene.org_id,
        user_id=scene.member_id,
        requirement_id=requirement_id,
        screening_type=ScreeningType.PHYSICAL_EXAM,
        status=fields.pop("status", ScreeningStatus.PASSED),
        completed_date=fields.pop("completed_date", date.today() - timedelta(days=5)),
        **fields,
    )
    db_session.add(record)
    await db_session.flush()
    return record


async def _met(db_session, scene) -> dict:
    summary = await MedicalScreeningService(db_session).get_compliance_status(
        scene.org_id, user_id=scene.member_id
    )
    return {item.requirement_name: item.is_compliant for item in summary.items}


async def test_a_record_satisfies_only_its_own_requirement(db_session, scene):
    await _add(db_session, scene, scene.annual.id)

    assert await _met(db_session, scene) == {
        "Annual physical": True,
        "Fitness-for-duty physical": False,
    }


async def test_an_unlinked_record_satisfies_nothing(db_session, scene):
    await _add(db_session, scene, None)

    assert await _met(db_session, scene) == {
        "Annual physical": False,
        "Fitness-for-duty physical": False,
    }


async def test_a_failure_under_one_requirement_does_not_revoke_the_other(
    db_session, scene
):
    await _add(db_session, scene, scene.annual.id)
    await _add(
        db_session,
        scene,
        scene.fit_for_duty.id,
        status=ScreeningStatus.FAILED,
        completed_date=date.today() - timedelta(days=1),
    )

    assert await _met(db_session, scene) == {
        "Annual physical": True,
        "Fitness-for-duty physical": False,
    }


class TestExpiringList:
    async def test_a_newer_record_for_another_requirement_does_not_supersede(
        self, db_session, scene
    ):
        lapsing = await _add(
            db_session,
            scene,
            scene.annual.id,
            completed_date=date.today() - timedelta(days=355),
            expiration_date=date.today() + timedelta(days=10),
        )
        await _add(
            db_session,
            scene,
            scene.fit_for_duty.id,
            completed_date=date.today() - timedelta(days=2),
            expiration_date=date.today() + timedelta(days=700),
        )
        service = MedicalScreeningService(db_session)

        listed = await service.get_expiring_soon(scene.org_id, days=30)
        summary = await service.get_compliance_status(
            scene.org_id, user_id=scene.member_id
        )

        assert [row.record_id for row in listed] == [lapsing.id]
        assert listed[0].requirement_id == scene.annual.id
        assert listed[0].requirement_name == "Annual physical"
        assert summary.expiring_soon_count == 1

    async def test_an_unlinked_record_is_not_listed(self, db_session, scene):
        await _add(
            db_session,
            scene,
            None,
            expiration_date=date.today() + timedelta(days=10),
        )

        listed = await MedicalScreeningService(db_session).get_expiring_soon(
            scene.org_id, days=30
        )

        assert listed == []


class TestLinkingAnExistingRecord:
    async def test_an_officer_links_an_unlinked_record(self, db_session, scene):
        record = await _add(db_session, scene, None)

        updated = await ep.update_record(
            record_id=record.id,
            data=ScreeningRecordUpdate(requirement_id=scene.fit_for_duty.id),
            db=db_session,
            current_user=scene.officer,
        )

        assert updated.requirement_id == scene.fit_for_duty.id
        assert updated.requirement_name == "Fitness-for-duty physical"
        assert await _met(db_session, scene) == {
            "Annual physical": False,
            "Fitness-for-duty physical": True,
        }

    async def test_another_departments_requirement_is_refused(self, db_session, scene):
        other_org = _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, 'Elsewhere', 'fire_department', :slug, "
                "'America/New_York')"
            ),
            {"id": other_org, "slug": f"else-{other_org[:8]}"},
        )
        foreign = ScreeningRequirement(
            id=_uid(),
            organization_id=other_org,
            name="Theirs",
            screening_type=ScreeningType.PHYSICAL_EXAM,
        )
        db_session.add(foreign)
        await db_session.flush()
        record = await _add(db_session, scene, None)

        with pytest.raises(HTTPException) as exc:
            await ep.update_record(
                record_id=record.id,
                data=ScreeningRecordUpdate(requirement_id=foreign.id),
                db=db_session,
                current_user=scene.officer,
            )

        assert exc.value.status_code == 400
        await db_session.refresh(record)
        assert record.requirement_id is None
