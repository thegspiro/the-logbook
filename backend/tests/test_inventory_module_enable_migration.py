"""Contract tests for the Inventory auto-enable migration.

Equipment checks moved onto ``module_gate("inventory")``. This migration is
what stops a department that had deliberately switched Inventory off from
losing them on upgrade.

The interesting cases are the ones it must *not* touch. In particular the
all-False stored dict with no ``_user_configured`` marker is onboarding's
failed-dual-write signature: ``_trusted_stored_modules`` returns ``None`` for
it, so the org already runs on the declared defaults. Writing ``True`` into it
would promote it to a trusted configuration and every other False in it would
become a real choice — switching off every module the department has.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_enable_inventory_for_equipment_check_orgs.py"))
assert len(MATCHES) == 1, f"expected exactly one enable migration, found {MATCHES}"
MIGRATION = MATCHES[0]


def _migration_module():
    spec = importlib.util.spec_from_file_location("enable_inventory", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            getattr(_migration_module(), direction)()


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "organizations",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("settings", sa.Text),
    )
    sa.Table(
        "equipment_check_templates",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _seed_org(engine, org_id, modules, with_template=False):
    settings = {"modules": modules} if modules is not None else {}
    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO organizations (id, settings) VALUES (:i, :s)"),
            {"i": org_id, "s": json.dumps(settings)},
        )
        if with_template:
            connection.execute(
                sa.text(
                    "INSERT INTO equipment_check_templates (id, organization_id) "
                    "VALUES (:i, :o)"
                ),
                {"i": f"tpl-{org_id}", "o": org_id},
            )


def _modules(engine, org_id):
    with engine.begin() as connection:
        raw = connection.execute(
            sa.text("SELECT settings FROM organizations WHERE id = :i"),
            {"i": org_id},
        ).scalar()
    return json.loads(raw).get("modules")


def test_enables_inventory_when_scheduling_is_on(engine):
    _seed_org(engine, "org1", {"scheduling": True, "inventory": False})
    _run(engine)
    assert _modules(engine, "org1")["inventory"] is True


def test_enables_inventory_when_the_org_has_checklist_templates(engine):
    """Scheduling off but checklists built: the data is theirs, keep it."""
    _seed_org(
        engine,
        "org2",
        {"scheduling": False, "inventory": False, "training": True},
        with_template=True,
    )
    _run(engine)
    assert _modules(engine, "org2")["inventory"] is True


def test_leaves_an_org_that_uses_neither_alone(engine):
    _seed_org(engine, "org3", {"scheduling": False, "inventory": False, "events": True})
    _run(engine)
    assert _modules(engine, "org3")["inventory"] is False


def test_leaves_an_absent_inventory_key_alone(engine):
    """An absent key already resolves to the declared True default.

    Writing the key would be harmless but untrue: it would record a choice the
    department never made.
    """
    _seed_org(engine, "org4", {"scheduling": True})
    assert "inventory" not in (_modules(engine, "org4") or {})
    _run(engine)
    assert "inventory" not in (_modules(engine, "org4") or {})


def test_leaves_an_unconfigured_org_alone(engine):
    _seed_org(engine, "org5", None)
    _run(engine)
    assert _modules(engine, "org5") is None


def test_does_not_promote_the_failed_dual_write_shape(engine):
    """The case that would cost a department every one of its modules.

    An all-False dict with no _user_configured marker is untrusted, so the org
    is already running on the defaults. Writing inventory=True would make
    any(stored.values()) true and turn every other False into a real choice.
    """
    _seed_org(engine, "org6", {"scheduling": False, "inventory": False})
    _run(engine)
    modules = _modules(engine, "org6")
    assert modules["inventory"] is False
    assert not any(bool(v) for v in modules.values())


def test_touches_a_user_configured_all_false_dict(engine):
    """The same shape, but marked as a real choice, is a real configuration.

    Here the department genuinely turned everything off, so scheduling is off
    too and there is nothing to re-enable — but the marker means the dict is
    trusted, which is what separates this from the case above.
    """
    _seed_org(
        engine,
        "org7",
        {"scheduling": False, "inventory": False, "_user_configured": True},
        with_template=True,
    )
    _run(engine)
    assert _modules(engine, "org7")["inventory"] is True


def test_leaves_an_already_enabled_org_alone(engine):
    _seed_org(engine, "org8", {"scheduling": True, "inventory": True})
    _run(engine)
    assert _modules(engine, "org8")["inventory"] is True


def test_downgrade_is_a_no_op(engine):
    _seed_org(engine, "org9", {"scheduling": True, "inventory": False})
    _run(engine)
    _run(engine, "downgrade")
    assert _modules(engine, "org9")["inventory"] is True
