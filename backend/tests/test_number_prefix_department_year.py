"""
Order and request numbers carry the department's year, not the server's.

A container's clock is UTC, which is already next year on a US department's
New Year's Eve. ``ORD-YYYY-`` and the fiscal-year-less ``PR-YYYY-`` fallback
took their year from that clock, so an order placed at 7:30pm on December 31
in New York was numbered for the following year.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import finance_service, storefront_service
from app.services.finance_service import FinanceService
from app.services.storefront_service import StorefrontService
from app.utils import org_timezone

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("_new_years_eve")]

# 2027-01-01 00:30 UTC is 2026-12-31 19:30 in New York.
_NEW_YEARS_EVE_IN_NEW_YORK = datetime(2027, 1, 1, 0, 30, tzinfo=timezone.utc)


class _FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return _NEW_YEARS_EVE_IN_NEW_YORK.astimezone(tz or timezone.utc)


@pytest.fixture
def _new_years_eve(monkeypatch):
    # Freeze the server's clock as well as the department's, so a number
    # built from the server's UTC year would read 2027 and fail.
    monkeypatch.setattr(org_timezone, "datetime", _FrozenDatetime)
    monkeypatch.setattr(finance_service, "datetime", _FrozenDatetime)
    monkeypatch.setattr(
        storefront_service, "_utcnow", lambda: _NEW_YEARS_EVE_IN_NEW_YORK
    )


async def _org(db_session: AsyncSession, tz: str) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, :tz)"
        ),
        {"id": org_id, "name": "Year Test Dept", "slug": f"yr-{org_id[:8]}", "tz": tz},
    )
    await db_session.flush()
    return org_id


async def test_order_number_uses_the_departments_year(
    db_session: AsyncSession,
):
    org_id = await _org(db_session, "America/New_York")

    number = await StorefrontService(db_session)._generate_order_number(org_id)

    assert number == "ORD-2026-0001"


async def test_order_number_follows_the_department_across_midnight(
    db_session: AsyncSession,
):
    # Same instant, but a department whose calendar has already turned over.
    org_id = await _org(db_session, "UTC")

    number = await StorefrontService(db_session)._generate_order_number(org_id)

    assert number == "ORD-2027-0001"


async def test_request_number_without_a_fiscal_year_uses_the_departments_year(
    db_session: AsyncSession,
):
    org_id = await _org(db_session, "America/New_York")

    number = await FinanceService(db_session)._generate_request_number(
        org_id, "PR", str(uuid.uuid4())
    )

    assert number == "PR-2026-0001"
