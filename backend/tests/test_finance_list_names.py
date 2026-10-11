"""
Names on the dues list.

The list is read by a Treasurer, who holds ``finance.manage`` but not
necessarily ``users.view`` and so cannot look a member up by id. Each row
therefore carries the member's display name, joined in the same query.

Unit tests: the database is mocked, so these stay in CI's no-database job.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.dependencies import PaginationParams
from app.models.finance import DuesStatus, MemberDues
from app.schemas.finance import MemberDuesResponse
from app.services.finance_service import FinanceService

pytestmark = [pytest.mark.unit]

ORG_ID = str(uuid.uuid4())
NOW = datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc)


def _service_returning(rows: list[tuple]) -> FinanceService:
    db = MagicMock()
    result = MagicMock()
    result.all = MagicMock(return_value=rows)
    db.execute = AsyncMock(return_value=result)
    return FinanceService(db)


def _dues(**overrides) -> MemberDues:
    values = {
        "id": str(uuid.uuid4()),
        "organization_id": ORG_ID,
        "dues_schedule_id": str(uuid.uuid4()),
        "user_id": str(uuid.uuid4()),
        "amount_due": Decimal("100.00"),
        "amount_paid": Decimal("0.00"),
        "status": DuesStatus.PENDING,
        "due_date": NOW,
        "created_at": NOW,
        "updated_at": NOW,
    }
    values.update(overrides)
    return MemberDues(**values)


class TestMemberDuesNames:
    async def test_rows_carry_the_preferred_display_name(self):
        dues = _dues()
        service = _service_returning([(dues, "John", "Heather", "Terry", "jheather")])

        rows = await service.list_member_dues(
            ORG_ID, PaginationParams(skip=0, limit=100)
        )

        assert rows[0]["member_name"] == "Terry Heather"
        assert rows[0]["id"] == dues.id
        response = MemberDuesResponse.model_validate(rows[0])
        assert response.model_dump(by_alias=True)["memberName"] == "Terry Heather"

    async def test_a_member_with_no_name_falls_back_to_username(self):
        service = _service_returning([(_dues(), None, None, None, "jheather")])

        rows = await service.list_member_dues(
            ORG_ID, PaginationParams(skip=0, limit=100)
        )

        assert rows[0]["member_name"] == "jheather"

    async def test_a_missing_member_reads_as_no_name(self):
        service = _service_returning([(_dues(), None, None, None, None)])

        rows = await service.list_member_dues(
            ORG_ID, PaginationParams(skip=0, limit=100)
        )

        assert rows[0]["member_name"] is None

    async def test_query_stays_org_scoped_and_filtered(self):
        service = _service_returning([])

        await service.list_member_dues(
            ORG_ID,
            PaginationParams(skip=0, limit=100),
            schedule_id="s-1",
            status="pending",
        )

        query = str(service.db.execute.await_args.args[0])
        assert "member_dues.organization_id =" in query
        assert "member_dues.dues_schedule_id =" in query
        assert "LEFT OUTER JOIN users" in query
