"""
Grant applications list: grouped status filters (GF-27a) and real paging
(GF-33).

GF-27a: the dashboard's "Active Grants" and "Pending Applications" cards count
several statuses but linked to a single one, so the list a card opened showed
fewer applications than the card's own number. ``status_group`` filters by the
same named set the card counts -- one definition, ``APPLICATION_STATUS_GROUPS``.

GF-33: the applications page fetched up to 1,000 rows once and silently
dropped the rest. It now pages, so the list endpoint filters, searches and
sorts in SQL and reports the matching total in ``X-Total-Count``.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException, Response
from sqlalchemy.dialects import mysql

from app.models.grant import APPLICATION_STATUS_GROUPS, ApplicationStatus
from app.services.grant_service import GrantService


def _sql(stmt) -> str:
    return str(
        stmt.compile(dialect=mysql.dialect(), compile_kwargs={"literal_binds": True})
    ).lower()


def _capturing_db(captured: list, scalar=0):
    async def execute(stmt, *_a, **_kw):
        captured.append(stmt)
        result = MagicMock()
        result.scalars.return_value.unique.return_value.all.return_value = []
        result.scalar.return_value = scalar
        return result

    db = MagicMock()
    db.execute = execute
    return db


@pytest.mark.unit
class TestStatusGroups:
    def test_groups_are_the_dashboards_sets(self):
        assert set(APPLICATION_STATUS_GROUPS["active"]) == {
            ApplicationStatus.ACTIVE,
            ApplicationStatus.REPORTING,
        }
        assert set(APPLICATION_STATUS_GROUPS["pending"]) == {
            ApplicationStatus.RESEARCHING,
            ApplicationStatus.PREPARING,
            ApplicationStatus.INTERNAL_REVIEW,
            ApplicationStatus.SUBMITTED,
            ApplicationStatus.UNDER_REVIEW,
        }

    async def test_list_filters_by_every_status_in_the_group(self):
        captured: list = []
        await GrantService(_capturing_db(captured)).list_applications(
            "org-1", status_group="active"
        )
        sql = _sql(captured[-1])
        assert "application_status in ('active', 'reporting')" in sql

    async def test_count_uses_the_same_filter(self):
        captured: list = []
        total = await GrantService(_capturing_db(captured, 7)).count_applications(
            "org-1", status_group="pending"
        )
        assert total == 7
        sql = _sql(captured[-1])
        assert "count(grant_applications.id)" in sql
        assert "'under_review'" in sql
        assert "'active'" not in sql

    async def test_an_unknown_group_is_refused(self):
        with pytest.raises(ValueError, match="Unknown status group"):
            await GrantService(_capturing_db([])).list_applications(
                "org-1", status_group="everything"
            )

    async def test_the_dashboard_counts_the_same_groups(self):
        captured: list = []
        db = _capturing_db(captured)
        result = MagicMock()
        result.scalar.return_value = 0
        result.scalars.return_value.all.return_value = []
        result.all.return_value = []
        org = MagicMock()
        org.scalar_one_or_none.return_value = SimpleNamespace(timezone="UTC")

        calls = []

        async def execute(stmt, *_a, **_kw):
            calls.append(stmt)
            return org if len(calls) == 1 else result

        db.execute = execute
        await GrantService(db).get_dashboard_data("org-1")
        active_sql, pending_sql = _sql(calls[1]), _sql(calls[2])
        assert "in ('active', 'reporting')" in active_sql
        assert (
            "in ('researching', 'preparing', 'internal_review', 'submitted', "
            "'under_review')" in pending_sql
        )


@pytest.mark.unit
class TestSearchAndSort:
    async def test_search_matches_program_or_agency_with_escaping(self):
        captured: list = []
        await GrantService(_capturing_db(captured)).list_applications(
            "org-1", search="50%_off"
        )
        sql = _sql(captured[-1])
        # The typed % and _ are escaped, so they match themselves.
        escaped = "like lower('%%50\\\\%%\\\\_off%%') escape"
        assert f"lower(grant_applications.grant_program_name) {escaped}" in sql
        assert f"lower(grant_applications.grant_agency) {escaped}" in sql

    async def test_default_order_is_newest_first(self):
        captured: list = []
        await GrantService(_capturing_db(captured)).list_applications("org-1")
        order = _sql(captured[-1]).split("order by", 1)[1]
        assert order.strip().startswith("grant_applications.created_at desc")

    async def test_deadline_sort_puts_missing_dates_last_both_ways(self):
        for direction in ("asc", "desc"):
            captured: list = []
            await GrantService(_capturing_db(captured)).list_applications(
                "org-1", sort="applicationDeadline", order=direction
            )
            order = _sql(captured[-1]).split("order by", 1)[1]
            assert order.strip().startswith(
                "grant_applications.application_deadline is null asc"
            )
            assert f"grant_applications.application_deadline {direction}" in order
            assert order.split("limit")[0].strip().endswith("grant_applications.id asc")

    async def test_priority_sorts_by_urgency(self):
        captured: list = []
        await GrantService(_capturing_db(captured)).list_applications(
            "org-1", sort="priority"
        )
        order = _sql(captured[-1]).split("order by", 1)[1]
        assert order.strip().startswith("case when")
        assert "= 'critical') then 0" in order

    async def test_an_unknown_sort_is_refused(self):
        with pytest.raises(ValueError, match="Unknown sort"):
            await GrantService(_capturing_db([])).list_applications(
                "org-1", sort="password_hash"
            )


@pytest.mark.unit
class TestEndpoint:
    async def test_total_is_reported_in_a_header(self, monkeypatch):
        from app.api.v1.endpoints import grants as endpoint

        service = MagicMock()
        service.count_applications = AsyncMock(return_value=1234)
        service.list_applications = AsyncMock(return_value=[])
        monkeypatch.setattr(endpoint, "GrantService", lambda _db: service)
        response = Response()

        await endpoint.list_applications(
            response=response,
            status_filter=None,
            priority=None,
            assigned_to=None,
            status_group="active",
            search="fema",
            sort="amountRequested",
            order="desc",
            pagination=SimpleNamespace(skip=50, limit=25),
            db=MagicMock(),
            current_user=SimpleNamespace(organization_id=uuid.uuid4()),
        )

        assert response.headers["X-Total-Count"] == "1234"
        kwargs = service.list_applications.await_args.kwargs
        assert kwargs["status_group"] == "active"
        assert kwargs["search"] == "fema"
        assert (kwargs["sort"], kwargs["order"]) == ("amountRequested", "desc")
        assert (kwargs["skip"], kwargs["limit"]) == (50, 25)
        assert service.count_applications.await_args.kwargs["status_group"] == "active"

    async def test_an_unknown_group_is_a_400(self, monkeypatch):
        from app.api.v1.endpoints import grants as endpoint

        service = MagicMock()
        service.count_applications = AsyncMock(side_effect=ValueError("Unknown group"))
        monkeypatch.setattr(endpoint, "GrantService", lambda _db: service)

        with pytest.raises(HTTPException) as exc:
            await endpoint.list_applications(
                response=Response(),
                status_filter=None,
                priority=None,
                assigned_to=None,
                status_group="nope",
                search=None,
                sort=None,
                order="asc",
                pagination=SimpleNamespace(skip=0, limit=25),
                db=MagicMock(),
                current_user=SimpleNamespace(organization_id=uuid.uuid4()),
            )
        assert exc.value.status_code == 400


@pytest.mark.integration
class TestAgainstTheDatabase:
    async def test_group_count_sort_and_pages_agree(self, db_session):
        from app.models.grant import GrantApplication, GrantPriority
        from app.models.user import Organization

        org = Organization(
            id=str(uuid.uuid4()),
            name="Paging Department",
            slug=f"paging-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
        )
        db_session.add(org)
        await db_session.flush()
        rows = [
            ("A", ApplicationStatus.ACTIVE, GrantPriority.LOW),
            ("B", ApplicationStatus.REPORTING, GrantPriority.CRITICAL),
            ("C", ApplicationStatus.ACTIVE, GrantPriority.HIGH),
            ("D", ApplicationStatus.SUBMITTED, GrantPriority.CRITICAL),
        ]
        for name, app_status, priority in rows:
            db_session.add(
                GrantApplication(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    grant_program_name=f"Program {name}",
                    application_status=app_status,
                    priority=priority,
                )
            )
        await db_session.flush()
        service = GrantService(db_session)

        assert await service.count_applications(org.id, status_group="active") == 3
        first = await service.list_applications(
            org.id, status_group="active", sort="priority", skip=0, limit=2
        )
        second = await service.list_applications(
            org.id, status_group="active", sort="priority", skip=2, limit=2
        )
        assert [a.grant_program_name for a in first + second] == [
            "Program B",
            "Program C",
            "Program A",
        ]
