"""MS-6: the screening requirement and record lists page in SQL.

Both list endpoints used to load every matching row and slice the result in
Python, so an organization with years of screening history paid for the whole
table on every page load. The slice now happens as ``LIMIT``/``OFFSET`` on the
query itself, and the response shape — a bare list — is unchanged.

These run against the real database: the property under test is what reaches
MySQL, which a mocked session cannot show.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams
from app.api.v1.endpoints import medical_screening as ep
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.services.medical_screening_service import MedicalScreeningService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


class _StatementLog:
    """Collects the SQL text the connection sends while it is attached."""

    def __init__(self, session: AsyncSession):
        self._engine = session.bind.sync_engine
        self.statements: list[str] = []

    def _on_execute(self, conn, cursor, statement, parameters, context, many):
        self.statements.append(statement)

    def __enter__(self):
        event.listen(self._engine, "before_cursor_execute", self._on_execute)
        return self

    def __exit__(self, *exc):
        event.remove(self._engine, "before_cursor_execute", self._on_execute)

    def touching(self, table: str) -> list[str]:
        return [s for s in self.statements if f"FROM {table}" in s]


@pytest.fixture
async def org_with_records(db_session: AsyncSession, setup_org_and_admin):
    org_id, admin_id = setup_org_and_admin
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    record_ids = []
    # Distinct created_at values so the expected newest-first order is known.
    for i in range(5):
        rec = ScreeningRecord(
            id=_uid(),
            organization_id=org_id,
            user_id=admin_id,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            status=ScreeningStatus.SCHEDULED,
            created_at=base + timedelta(days=i),
        )
        db_session.add(rec)
        record_ids.append(rec.id)
    for name in ("Alpha", "Bravo", "Charlie", "Delta"):
        db_session.add(
            ScreeningRequirement(
                id=_uid(),
                organization_id=org_id,
                name=name,
                screening_type=ScreeningType.PHYSICAL_EXAM,
            )
        )
    await db_session.flush()
    # Newest first, matching the endpoint's order.
    return org_id, admin_id, list(reversed(record_ids))


def _caller(org_id: str, user_id: str) -> SimpleNamespace:
    return SimpleNamespace(id=user_id, organization_id=org_id, username="officer")


class TestRecordListPagesInSql:
    async def test_endpoint_returns_the_requested_page(
        self, db_session, org_with_records
    ):
        org_id, admin_id, newest_first = org_with_records
        page = await ep.list_records(
            user_id=None,
            prospect_id=None,
            screening_type=None,
            record_status=None,
            pagination=PaginationParams(skip=1, limit=2),
            db=db_session,
            current_user=_caller(org_id, admin_id),
        )
        assert [r.id for r in page] == newest_first[1:3]
        # The page is still enriched with names, as before the change.
        assert all(r.user_name for r in page)

    async def test_query_carries_limit_and_offset(self, db_session, org_with_records):
        org_id, _, _ = org_with_records
        service = MedicalScreeningService(db_session)
        with _StatementLog(db_session) as log:
            rows = await service.list_records(org_id, skip=2, limit=2)
        assert len(rows) == 2
        statements = log.touching("screening_records")
        assert statements, "list_records issued no query"
        # MySQL renders an offset as `LIMIT offset, count`.
        assert all("LIMIT %s, %s" in s for s in statements)

    async def test_internal_callers_still_get_every_row(
        self, db_session, org_with_records
    ):
        """``limit=None`` is how compliance grading reads a full history."""
        org_id, admin_id, newest_first = org_with_records
        service = MedicalScreeningService(db_session)
        with _StatementLog(db_session) as log:
            rows = await service.list_records(org_id, user_id=admin_id)
        assert [r.id for r in rows] == newest_first
        assert all("LIMIT" not in s for s in log.touching("screening_records"))


class TestRequirementListPagesInSql:
    async def test_endpoint_returns_the_requested_page(
        self, db_session, org_with_records
    ):
        org_id, admin_id, _ = org_with_records
        page = await ep.list_requirements(
            is_active=None,
            screening_type=None,
            pagination=PaginationParams(skip=1, limit=2),
            db=db_session,
            current_user=_caller(org_id, admin_id),
        )
        assert [r.name for r in page] == ["Bravo", "Charlie"]

    async def test_query_carries_limit_and_offset(self, db_session, org_with_records):
        org_id, _, _ = org_with_records
        service = MedicalScreeningService(db_session)
        with _StatementLog(db_session) as log:
            rows = await service.list_requirements(org_id, skip=3, limit=10)
        assert [r.name for r in rows] == ["Delta"]
        statements = log.touching("screening_requirements")
        assert statements
        # MySQL renders an offset as `LIMIT offset, count`.
        assert all("LIMIT %s, %s" in s for s in statements)
