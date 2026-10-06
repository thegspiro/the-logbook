"""TR2-2: GET /training/records serves pages, not the whole history.

An officer listing the organization read every training record it had in
one response. The list is now paged with skip/limit, capped at
MAX_TRAINING_RECORDS_PAGE, and reports the matching total in X-Total-Count
so a client can page to the end without guessing.
"""

import uuid
from datetime import date, timedelta

import pytest
from fastapi import Response
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.training import MAX_TRAINING_RECORDS_PAGE, list_records
from app.models.training import TrainingRecord, TrainingStatus, TrainingType
from app.models.user import User

pytestmark = pytest.mark.integration


async def _seed(db, org_id, user_id, count, start=date(2024, 1, 1)):
    for i in range(count):
        db.add(
            TrainingRecord(
                id=str(uuid.uuid4()),
                organization_id=org_id,
                user_id=user_id,
                course_name=f"Drill {i}",
                training_type=TrainingType.CONTINUING_EDUCATION,
                # Pairs share a date, so the id tiebreak is what keeps pages
                # disjoint.
                completion_date=start + timedelta(days=i // 2),
                hours_completed=1,
                status=TrainingStatus.COMPLETED,
            )
        )
    await db.flush()


async def _caller(db, user_id) -> User:
    """The caller as the auth dependency hands it over: positions loaded."""
    result = await db.execute(
        select(User).options(selectinload(User.positions)).where(User.id == user_id)
    )
    return result.scalar_one()


async def _page(db, user, **params):
    response = Response()
    defaults = {
        "user_id": None,
        "status": None,
        "start_date": None,
        "end_date": None,
        "skip": 0,
        "limit": MAX_TRAINING_RECORDS_PAGE,
    }
    rows = await list_records(
        response=response, db=db, current_user=user, **{**defaults, **params}
    )
    return rows, int(response.headers["X-Total-Count"])


async def test_pages_are_disjoint_and_cover_every_record(
    db_session, setup_org_and_admin
):
    org_id, user_id = setup_org_and_admin
    user = await _caller(db_session, user_id)
    await _seed(db_session, org_id, user_id, 7)

    seen = []
    skip = 0
    while True:
        rows, total = await _page(db_session, user, skip=skip, limit=3)
        assert total == 7
        seen.extend(r.id for r in rows)
        if len(rows) < 3:
            break
        skip += 3

    assert len(seen) == 7
    assert len(set(seen)) == 7


async def test_the_total_counts_the_filter_not_the_page(
    db_session, setup_org_and_admin
):
    org_id, user_id = setup_org_and_admin
    user = await _caller(db_session, user_id)
    await _seed(db_session, org_id, user_id, 6)

    rows, total = await _page(db_session, user, start_date=date(2024, 1, 2), limit=1)

    assert len(rows) == 1
    # Days 2 and 3 hold records 2-5.
    assert total == 4


async def test_a_member_still_sees_only_their_own_records(
    db_session, setup_org_and_admin
):
    org_id, user_id = setup_org_and_admin
    user = await _caller(db_session, user_id)
    other_id = str(uuid.uuid4())
    db_session.add(
        User(
            id=other_id,
            organization_id=org_id,
            username=f"other-{other_id[:8]}",
            email=f"other-{other_id[:8]}@example.com",
        )
    )
    await db_session.flush()
    await _seed(db_session, org_id, user_id, 2)
    await _seed(db_session, org_id, other_id, 3)

    rows, total = await _page(db_session, user, user_id=uuid.UUID(other_id))

    assert total == 2
    assert {str(r.user_id) for r in rows} == {user_id}
