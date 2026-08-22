"""Regression tests for the skipped Web Push table reconciliation."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION = next(VERSIONS.glob("*_reconcile_push_subscriptions.py"))


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "reconcile_push_subscriptions", MIGRATION
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_upgrade(engine):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            _load_migration().upgrade()


def test_upgrade_creates_skipped_push_subscription_schema():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "organizations", metadata, sa.Column("id", sa.String(36), primary_key=True)
    )
    sa.Table("users", metadata, sa.Column("id", sa.String(36), primary_key=True))
    metadata.create_all(engine)

    _run_upgrade(engine)

    inspector = sa.inspect(engine)
    assert inspector.has_table("push_subscriptions")
    assert {
        column["name"] for column in inspector.get_columns("push_subscriptions")
    } == {
        "id",
        "organization_id",
        "user_id",
        "endpoint",
        "endpoint_hash",
        "p256dh",
        "auth",
        "user_agent",
        "created_at",
        "last_used_at",
    }
    assert {index["name"] for index in inspector.get_indexes("push_subscriptions")} == {
        "idx_push_sub_org_user",
        "ix_push_subscriptions_organization_id",
        "ix_push_subscriptions_user_id",
    }
    assert any(
        constraint["name"] == "uq_push_sub_endpoint"
        for constraint in inspector.get_unique_constraints("push_subscriptions")
    )


def test_upgrade_is_idempotent_and_downgrade_preserves_table():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("push_subscriptions", metadata, sa.Column("sentinel", sa.Integer()))
    metadata.create_all(engine)

    _run_upgrade(engine)
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            _load_migration().downgrade()

    inspector = sa.inspect(engine)
    assert inspector.has_table("push_subscriptions")
    assert [
        column["name"] for column in inspector.get_columns("push_subscriptions")
    ] == ["sentinel"]
