"""
Tests for the hard-delete reference handling (app/services/user_deletion_service.py).

The classification tests run against the real ``Base.metadata``, so they also
act as a guard on the schema: a new table that references ``users.id`` with a
NOT NULL attribution column will show up as a blocker rather than as a 500 at
delete time. The query helpers are exercised with a mocked session, so the
suite needs no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.database import Base
from app.services import user_deletion_service as svc


@pytest.fixture
def references():
    return svc._classify_references()


class TestClassifyReferences:
    def test_returns_existing_tables_and_columns(self, references):
        clearable, blocking = references
        for table_name, column_name in clearable + blocking:
            table = Base.metadata.tables[table_name]
            assert column_name in table.c

    def test_a_column_is_never_both_clearable_and_blocking(self, references):
        clearable, blocking = references
        assert not set(clearable) & set(blocking)

    def test_clearable_columns_are_nullable(self, references):
        clearable, _ = references
        for table_name, column_name in clearable:
            assert Base.metadata.tables[table_name].c[column_name].nullable

    def test_blocking_columns_are_not_nullable(self, references):
        _, blocking = references
        for table_name, column_name in blocking:
            assert not Base.metadata.tables[table_name].c[column_name].nullable

    def test_skips_references_mysql_resolves_itself(self, references):
        """CASCADE / SET NULL columns need no help and must not be touched."""
        every_reference = set(references[0]) | set(references[1])
        for table in Base.metadata.sorted_tables:
            for column in table.columns:
                for foreign_key in column.foreign_keys:
                    if not svc._targets_user_id(foreign_key):
                        continue
                    action = (foreign_key.ondelete or "").strip().upper()
                    if action in svc._DB_HANDLED_ACTIONS:
                        assert (table.name, column.name) not in every_reference

    def test_covers_the_association_table_assigner(self, references):
        """
        user_positions.assigned_by has no ondelete, so an admin who assigned a
        position to somebody else would otherwise be undeletable.
        """
        clearable, _ = references
        assert ("user_positions", "assigned_by") in clearable

    def test_reports_ownerless_financial_records_as_blocking(self, references):
        """
        These carry NOT NULL attribution on purpose — the record must keep the
        member who requested it — so they can only ever be blockers.
        """
        _, blocking = references
        assert ("purchase_requests", "requested_by") in blocking
        assert ("budgets", "created_by") in blocking


class TestFindHardDeleteBlockers:
    async def test_reports_only_tables_with_matching_rows(self, monkeypatch):
        monkeypatch.setattr(
            svc,
            "_classify_references",
            lambda: ((), (("budgets", "created_by"), ("fiscal_years", "created_by"))),
        )
        db = MagicMock()
        db.scalar = AsyncMock(side_effect=[3, 0])

        assert await svc.find_hard_delete_blockers(db, "u1") == [("budgets", 3)]

    async def test_orders_by_row_count_descending(self, monkeypatch):
        monkeypatch.setattr(
            svc,
            "_classify_references",
            lambda: ((), (("budgets", "created_by"), ("fiscal_years", "created_by"))),
        )
        db = MagicMock()
        db.scalar = AsyncMock(side_effect=[1, 9])

        assert await svc.find_hard_delete_blockers(db, "u1") == [
            ("fiscal_years", 9),
            ("budgets", 1),
        ]

    async def test_queries_each_table_once_for_all_its_columns(self, monkeypatch):
        monkeypatch.setattr(
            svc,
            "_classify_references",
            lambda: (
                (),
                (("ip_exceptions", "requested_by"), ("ip_exceptions", "approved_by")),
            ),
        )
        db = MagicMock()
        db.scalar = AsyncMock(return_value=2)

        assert await svc.find_hard_delete_blockers(db, "u1") == [("ip_exceptions", 2)]
        assert db.scalar.await_count == 1

    async def test_empty_when_nothing_references_the_member(self, monkeypatch):
        monkeypatch.setattr(
            svc, "_classify_references", lambda: ((), (("budgets", "created_by"),))
        )
        db = MagicMock()
        db.scalar = AsyncMock(return_value=0)

        assert await svc.find_hard_delete_blockers(db, "u1") == []


class TestReleaseUserReferences:
    async def test_updates_every_clearable_column(self, monkeypatch):
        monkeypatch.setattr(
            svc,
            "_classify_references",
            lambda: (
                (("events", "created_by"), ("events", "updated_by")),
                (),
            ),
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[MagicMock(rowcount=2), MagicMock(rowcount=1)]
        )

        assert await svc.release_user_references(db, "u1") == 3
        assert db.execute.await_count == 2

    async def test_tolerates_drivers_reporting_no_rowcount(self, monkeypatch):
        monkeypatch.setattr(
            svc, "_classify_references", lambda: ((("events", "created_by"),), ())
        )
        db = MagicMock()
        db.execute = AsyncMock(return_value=MagicMock(rowcount=None))

        assert await svc.release_user_references(db, "u1") == 0

    async def test_sets_the_column_to_null_for_that_user_only(self, monkeypatch):
        monkeypatch.setattr(
            svc, "_classify_references", lambda: ((("events", "created_by"),), ())
        )
        db = MagicMock()
        db.execute = AsyncMock(return_value=MagicMock(rowcount=1))

        await svc.release_user_references(db, "u1")

        statement = str(db.execute.await_args.args[0])
        assert "UPDATE events" in statement
        assert "SET created_by=" in statement
        assert "WHERE events.created_by =" in statement


class TestDescribeBlockers:
    def test_renders_counts_with_readable_table_names(self):
        assert (
            svc.describe_blockers([("purchase_requests", 2), ("budgets", 1)])
            == "2 purchase requests, 1 budget"
        )

    def test_leaves_names_that_are_not_plural_alone(self):
        assert svc.describe_blockers([("ip_exception_audit_log", 1)]) == (
            "1 ip exception audit log"
        )

    def test_empty_for_no_blockers(self):
        assert svc.describe_blockers([]) == ""
