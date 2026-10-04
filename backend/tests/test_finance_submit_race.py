"""
Two concurrent submits of one draft purchase request: one wins, one is refused.

``submit_purchase_request`` reads the request, checks it is still a draft, and
then builds its approval records. Off a plain SELECT both racers see DRAFT —
the second one's snapshot predates the first one's commit — so both pass the
check and a request can end up with two parallel approval chains. The submit
paths (and the other non-ledger transitions beside them) now read the row with
a lock, which both serializes them and makes the second read current
(CLAUDE.md Pitfall #27; FIN-31's follow-up).

Real connections, not ``db_session``: the race needs two transactions.
"""

import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.services.finance_service import FinanceService

pytestmark = [pytest.mark.integration]

# How long the first submit holds its lock after flushing, so the second is
# certain to arrive while it is held.
_HOLD_SECONDS = 0.3


async def _seed() -> tuple[str, str, str]:
    org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(
                    "INSERT INTO organizations "
                    "(id, name, organization_type, slug, timezone, active) "
                    "VALUES (:id, 'Submit Race Dept', 'fire_department', :slug, "
                    "'UTC', 1)"
                ),
                {"id": org_id, "slug": f"submit-race-{org_id[:8]}"},
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, organization_id, username, first_name, "
                    "last_name, email, password_hash, status) VALUES (:id, :org, "
                    ":un, 'Submit', 'Racer', :em, 'hashed', 'active')"
                ),
                {
                    "id": user_id,
                    "org": org_id,
                    "un": f"submit-race-{user_id[:8]}",
                    "em": f"submit-race-{user_id[:8]}@test.com",
                },
            )
        session = AsyncSession(bind=conn, expire_on_commit=False)
        service = FinanceService(session)
        fiscal_year = await service.create_fiscal_year(
            org_id=org_id,
            created_by=user_id,
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )
        request = await service.create_purchase_request(
            org_id=org_id,
            requested_by=user_id,
            fiscal_year_id=fiscal_year.id,
            title="Hose",
            estimated_amount=100,
        )
        await session.commit()
        await session.close()
    return org_id, user_id, request.id


async def _cleanup(org_id: str) -> None:
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            for statement in (
                "DELETE FROM purchase_requests WHERE organization_id = :o",
                "DELETE FROM fiscal_years WHERE organization_id = :o",
                "DELETE FROM users WHERE organization_id = :o",
                "DELETE FROM organizations WHERE id = :o",
            ):
                await conn.execute(text(statement), {"o": org_id})


@pytest.mark.usefixtures("_initialize_database")
async def test_concurrent_submits_of_one_draft_admit_exactly_one():
    org_id, _, request_id = await _seed()
    first_flushed = asyncio.Event()

    async def first():
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            try:
                await FinanceService(session).submit_purchase_request(
                    request_id, org_id
                )
                first_flushed.set()
                await asyncio.sleep(_HOLD_SECONDS)
                await session.commit()
                return "submitted"
            finally:
                first_flushed.set()
                await session.close()

    async def second():
        await first_flushed.wait()
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            try:
                await FinanceService(session).submit_purchase_request(
                    request_id, org_id
                )
                await session.commit()
                return "submitted"
            except ValueError as exc:
                await session.rollback()
                return str(exc)
            finally:
                await session.close()

    try:
        results = await asyncio.gather(first(), second())
    finally:
        await _cleanup(org_id)

    assert results == ["submitted", "Only draft requests can be submitted"], (
        f"two concurrent submits returned {results}. A second success means "
        "both read DRAFT off a stale snapshot and both built an approval chain."
    )
