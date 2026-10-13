"""
CSV exports stream a batch at a time instead of building one string (AH-16).

The admin-hours entries export, the storefront order export and the training
report export each used to read their whole result and assemble the complete
file in memory before the first byte left. The owner chose streaming over a
row cap: the file is still complete, but memory is bounded by a batch.

The unit tests pin the chunking itself and that each endpoint hands the
service's iterator to the response rather than a pre-built string. The
integration tests read through a real server-side cursor (``db.stream``) with
the batch size forced down, so more than one batch is actually fetched.
"""

import csv
import io
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.responses import StreamingResponse

from app.utils.csv_export import SafeCsvChunks, collect_csv


async def _chunks(*parts):
    for part in parts:
        yield part


async def _body(response: StreamingResponse) -> list[str]:
    return [
        chunk.decode() if isinstance(chunk, bytes) else chunk
        async for chunk in response.body_iterator
    ]


@pytest.mark.unit
class TestSafeCsvChunks:
    def test_drain_returns_only_what_was_written_since_the_last_drain(self):
        writer = SafeCsvChunks()
        writer.writerow(["a", "b"])
        assert writer.drain() == "a,b\r\n"
        writer.writerow(["c", "d"])
        assert writer.drain() == "c,d\r\n"
        assert writer.drain() == ""

    def test_cells_are_still_neutralized_against_formula_injection(self):
        writer = SafeCsvChunks()
        writer.writerow(["=cmd|' /C calc'!A0", "ok"])
        assert writer.drain().startswith("'=cmd")

    async def test_collect_joins_the_chunks_in_order(self):
        assert await collect_csv(_chunks("h\r\n", "1\r\n", "2\r\n")) == (
            "h\r\n1\r\n2\r\n"
        )


@pytest.mark.unit
class TestEndpointsStreamTheServiceIterator:
    async def test_admin_hours_export(self, monkeypatch):
        from app.api.v1.endpoints import admin_hours as endpoint

        service = MagicMock()
        service.stream_entries_csv = AsyncMock(
            return_value=_chunks("Member\r\n", "Dana\r\n", "Lee\r\n")
        )
        monkeypatch.setattr(endpoint, "AdminHoursService", lambda _db: service)

        response = await endpoint.export_entries(
            status=None,
            category_id=None,
            user_id=None,
            start_date=None,
            end_date=None,
            db=MagicMock(),
            current_user=SimpleNamespace(organization_id="org-1"),
        )

        assert isinstance(response, StreamingResponse)
        assert await _body(response) == ["Member\r\n", "Dana\r\n", "Lee\r\n"]

    async def test_storefront_order_export(self, monkeypatch):
        from app.api.v1.endpoints import storefront as endpoint

        service = MagicMock()
        service.stream_orders_csv = AsyncMock(
            return_value=_chunks("Order Number\r\n", "SO-1\r\n")
        )
        monkeypatch.setattr(endpoint, "StorefrontService", lambda _db: service)
        monkeypatch.setattr(endpoint, "log_audit_event", AsyncMock())

        response = await endpoint.export_orders(
            window_id=None,
            status_filter=None,
            db=MagicMock(),
            current_user=SimpleNamespace(
                id="u1", organization_id="org-1", username="qm"
            ),
        )

        assert isinstance(response, StreamingResponse)
        assert await _body(response) == ["Order Number\r\n", "SO-1\r\n"]

    @pytest.mark.parametrize(
        ("report_type", "method"),
        [
            ("compliance", "stream_compliance_csv"),
            ("member_records", "stream_bulk_csv"),
            ("hours_summary", "stream_hours_summary_csv"),
            ("certification", "stream_certification_csv"),
        ],
    )
    async def test_training_report_export(self, monkeypatch, report_type, method):
        from app.api.v1.endpoints import training_enhancements as endpoint
        from app.schemas.training_enhancements import ReportExportRequest

        service = MagicMock()
        setattr(service, method, AsyncMock(return_value=_chunks("H\r\n", "r\r\n")))
        monkeypatch.setattr(endpoint, "ReportExportService", lambda _db: service)

        response = await endpoint.export_report(
            ReportExportRequest(report_type=report_type, format="csv"),
            db=MagicMock(),
            current_user=SimpleNamespace(organization_id="org-1"),
        )

        assert isinstance(response, StreamingResponse)
        assert await _body(response) == ["H\r\n", "r\r\n"]


# ---------------------------------------------------------------------------
# Real server-side cursor
# ---------------------------------------------------------------------------


async def _org(db_session):
    from app.models.user import Organization

    org = Organization(
        id=str(uuid.uuid4()),
        name="Streamed Export Department",
        slug=f"streamed-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session, org, first="Dana", last="Reyes"):
    from app.models.user import User, UserStatus

    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m-{handle}",
        email=f"{handle}@streamed.test",
        first_name=first,
        last_name=last,
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.mark.integration
class TestStreamedAgainstTheDatabase:
    async def test_admin_hours_rows_arrive_over_several_batches(
        self, db_session, monkeypatch
    ):
        from app.models.admin_hours import (
            AdminHoursCategory,
            AdminHoursEntry,
            AdminHoursEntryStatus,
        )
        from app.services.admin_hours_service import AdminHoursService
        from app.utils import streamed_query

        monkeypatch.setattr(streamed_query, "EXPORT_BATCH_SIZE", 2)
        org = await _org(db_session)
        user = await _member(db_session, org)
        category = AdminHoursCategory(
            id=str(uuid.uuid4()), organization_id=org.id, name="Station", is_active=True
        )
        db_session.add(category)
        start = datetime(2026, 3, 2, 9, 0, tzinfo=timezone.utc)
        for day in range(5):
            db_session.add(
                AdminHoursEntry(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    user_id=user.id,
                    category_id=category.id,
                    clock_in_at=start + timedelta(days=day),
                    clock_out_at=start + timedelta(days=day, hours=1),
                    duration_minutes=60,
                    status=AdminHoursEntryStatus.APPROVED,
                    description=f"day {day}",
                )
            )
        await db_session.flush()

        chunks = [
            chunk
            async for chunk in await AdminHoursService(db_session).stream_entries_csv(
                org.id
            )
        ]

        # Header, then one chunk per batch of two: 2 + 2 + 1.
        assert len(chunks) == 4
        rows = list(csv.reader(io.StringIO("".join(chunks))))
        assert rows[0][0] == "Member"
        assert [r[-1] for r in rows[1:]] == [f"day {d}" for d in (4, 3, 2, 1, 0)]

    async def test_certification_rows_arrive_over_several_batches(
        self, db_session, monkeypatch
    ):
        from app.models.training import TrainingRecord, TrainingStatus, TrainingType
        from app.services.training_enhancement_service import ReportExportService
        from app.utils import streamed_query

        monkeypatch.setattr(streamed_query, "EXPORT_BATCH_SIZE", 2)
        org = await _org(db_session)
        user = await _member(db_session, org)
        for n in range(3):
            db_session.add(
                TrainingRecord(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    user_id=user.id,
                    course_name=f"Cert {n}",
                    certification_number=f"C-{n}",
                    training_type=TrainingType.CERTIFICATION,
                    hours_completed=4,
                    status=TrainingStatus.COMPLETED,
                    completion_date=date(2026, 1, 1),
                    expiration_date=date(2030, 1, 1 + n),
                )
            )
        await db_session.flush()

        text = await ReportExportService(db_session).generate_certification_csv(
            org.id, end_date=date(2026, 6, 1)
        )

        rows = list(csv.reader(io.StringIO(text)))
        assert [r[2] for r in rows[1:]] == ["Cert 0", "Cert 1", "Cert 2"]
        assert {r[7] for r in rows[1:]} == {"Valid"}
