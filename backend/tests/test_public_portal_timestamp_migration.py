"""Regression tests for public-portal timestamp conversion."""

import importlib.util
from pathlib import Path
from unittest.mock import Mock

import sqlalchemy as sa

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic/versions/20260805_0004_public_portal_timestamps_to_datetime.py"
)


def test_api_key_expiration_offsets_are_converted_and_fail_closed(monkeypatch):
    spec = importlib.util.spec_from_file_location("public_portal_timestamps", MIGRATION)
    migration = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(migration)

    inspector = Mock()
    inspector.has_table.return_value = True
    inspector.get_columns.return_value = [
        {"name": column, "type": sa.String(26)} for _, column, _ in migration._COLUMNS
    ]
    monkeypatch.setattr(migration.sa, "inspect", lambda bind: inspector)
    monkeypatch.setattr(migration.op, "get_bind", Mock())
    execute = Mock()
    monkeypatch.setattr(migration.op, "execute", execute)
    monkeypatch.setattr(migration.op, "alter_column", Mock())

    migration.upgrade()

    statements = [str(call.args[0]) for call in execute.call_args_list]
    expiry_statements = [
        statement
        for statement in statements
        if "`public_portal_api_keys`" in statement and "`expires_at`" in statement
    ]

    assert "CONVERT_TZ" in expiry_statements[0]
    assert "RIGHT(`expires_at`, 6)" in expiry_statements[0]
    assert any(
        "SET `expires_at` = UTC_TIMESTAMP(6)" in sql for sql in expiry_statements
    )
    assert not any("SET `expires_at` = NULL" in sql for sql in expiry_statements)
