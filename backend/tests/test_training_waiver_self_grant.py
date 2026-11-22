"""Nobody grants or extends their own training waiver.

Owner decision 2026-11-22, closing what ADV2-9 left open. ADV2-9 stopped an
officer giving themselves a leave of absence, whose training waiver excused
their own requirements. ``POST /training/waivers`` reached the same outcome
directly: a ``training.manage`` holder could choose **Applies To: Training
only** for themselves, or extend or re-enable a waiver they already held.
Another training officer records it now, or the member submits a leave
request. Deactivating one's own waiver is still allowed: it excuses nothing.
"""

import uuid
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.training_waivers import (
    TrainingWaiverCreate,
    TrainingWaiverUpdate,
    create_training_waiver,
    delete_training_waiver,
    update_training_waiver,
)
from app.models.training import TrainingWaiver
from app.models.user import User

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def officers(db_session: AsyncSession):
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Self Waiver Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"selfwaiver-{org_id[:8]}"},
    )
    ids = {}
    for role in ("officer", "colleague"):
        uid = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, :fn, 'User', :em, 'hashed', 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": f"{role}-{uid[:8]}",
                "fn": role.capitalize(),
                "em": f"{role}-{uid[:8]}@test.com",
            },
        )
        ids[role] = uid
    await db_session.flush()
    return {
        role: (
            await db_session.execute(select(User).where(User.id == uid))
        ).scalar_one()
        for role, uid in ids.items()
    }


def _body(user_id: str) -> TrainingWaiverCreate:
    return TrainingWaiverCreate(
        user_id=user_id,
        waiver_type="other",
        reason="Training only",
        start_date=date(2026, 12, 1),
        end_date=date(2026, 12, 31),
    )


async def _waivers(db: AsyncSession, user_id: str) -> int:
    return int(
        await db.scalar(
            select(func.count(TrainingWaiver.id)).where(
                TrainingWaiver.user_id == user_id
            )
        )
        or 0
    )


async def _granted_to(db: AsyncSession, member: User, by: User) -> str:
    response = await create_training_waiver(
        _body(str(member.id)), db=db, current_user=by
    )
    return response.id


class TestCreate:
    async def test_an_officer_cannot_grant_themselves_a_waiver(
        self, db_session, officers
    ):
        officer = officers["officer"]

        with pytest.raises(HTTPException) as caught:
            await create_training_waiver(
                _body(str(officer.id)), db=db_session, current_user=officer
            )

        assert caught.value.status_code == 400
        assert "own" in caught.value.detail
        assert await _waivers(db_session, str(officer.id)) == 0

    async def test_an_officer_still_grants_a_colleague_a_waiver(
        self, db_session, officers
    ):
        officer, colleague = officers["officer"], officers["colleague"]

        await _granted_to(db_session, colleague, officer)

        assert await _waivers(db_session, str(colleague.id)) == 1


class TestUpdate:
    async def test_an_officer_cannot_extend_their_own_waiver(
        self, db_session, officers
    ):
        officer, colleague = officers["officer"], officers["colleague"]
        waiver_id = await _granted_to(db_session, officer, colleague)

        with pytest.raises(HTTPException) as caught:
            await update_training_waiver(
                waiver_id,
                TrainingWaiverUpdate(end_date=date(2027, 6, 30)),
                db=db_session,
                current_user=officer,
            )

        assert caught.value.status_code == 403
        waiver = await db_session.get(TrainingWaiver, waiver_id)
        await db_session.refresh(waiver)
        assert waiver.end_date == date(2026, 12, 31)

    async def test_an_officer_cannot_reenable_their_own_waiver(
        self, db_session, officers
    ):
        officer, colleague = officers["officer"], officers["colleague"]
        waiver_id = await _granted_to(db_session, officer, colleague)
        await delete_training_waiver(waiver_id, db=db_session, current_user=colleague)

        with pytest.raises(HTTPException) as caught:
            await update_training_waiver(
                waiver_id,
                TrainingWaiverUpdate(active=True),
                db=db_session,
                current_user=officer,
            )

        assert caught.value.status_code == 403
        waiver = await db_session.get(TrainingWaiver, waiver_id)
        await db_session.refresh(waiver)
        assert waiver.active is False

    async def test_a_colleague_can_still_change_it(self, db_session, officers):
        officer, colleague = officers["officer"], officers["colleague"]
        waiver_id = await _granted_to(db_session, officer, colleague)

        response = await update_training_waiver(
            waiver_id,
            TrainingWaiverUpdate(end_date=date(2027, 1, 31)),
            db=db_session,
            current_user=colleague,
        )

        assert response.end_date == date(2027, 1, 31)


class TestDeactivate:
    async def test_an_officer_may_end_their_own_waiver_early(
        self, db_session, officers
    ):
        officer, colleague = officers["officer"], officers["colleague"]
        waiver_id = await _granted_to(db_session, officer, colleague)

        await delete_training_waiver(waiver_id, db=db_session, current_user=officer)

        waiver = await db_session.get(TrainingWaiver, waiver_id)
        await db_session.refresh(waiver)
        assert waiver.active is False
