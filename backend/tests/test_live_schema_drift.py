"""The live database matches the models where drift has already bitten.

A fresh install is built by ``create_all`` from the models; an upgraded one by
the Alembic chain plus ``repair_schema``. Nothing compared the two, and on
2026-10-20 they differed in ways that mattered: 18 apparatus columns carried a
leftover RESTRICT foreign key beside their SET NULL one (blocking member
deletion), and three indexes existed on one kind of database and not the other.
On 2026-10-22 a third: ``training_waivers.end_date`` was still NOT NULL on
upgraded databases, so a permanent waiver or an open-ended leave failed there.

CI's integration job builds its database the upgraded way (migrations, then
``scripts/repair_schema.py``), so these checks run against that shape there.
The local suite's own ``intranet_test`` database is built by ``create_all`` and
passes trivially; point ``DB_NAME`` at a migrated database to check one by hand.

Only drift in a direction that has a fix is asserted. Nullability is now one
of them: 6dce1364ff7e made 99 model columns NOT NULL to match the chain, so the
two shapes must agree on every column. The differences still recorded in
``docs/KNOWN_LIMITATIONS.md`` (leftover tables, server defaults on columns that
are NOT NULL on both, the unused ``shift_equipment_checks.apparatus_id`` index)
are deliberately not checked here.
"""

import uuid
from collections import defaultdict
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import Column, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import Base
from app.models.apparatus import (
    Apparatus,
    ApparatusFuelLog,
    ApparatusStatus,
    ApparatusType,
    FuelType,
)
from app.models.training import TrainingWaiver
from app.models.user import Organization, User
from app.services.member_leave_service import MemberLeaveService
from app.services.user_deletion_service import release_user_references

pytestmark = pytest.mark.integration


async def test_no_column_has_two_foreign_keys_to_one_target(db_session: AsyncSession):
    rows = await db_session.execute(
        text(
            "SELECT table_name, column_name, referenced_table_name, "
            "       referenced_column_name, constraint_name "
            "FROM information_schema.key_column_usage "
            "WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL"
        )
    )
    keys = defaultdict(list)
    for table, column, ref_table, ref_column, name in rows:
        keys[(table, column, ref_table, ref_column)].append(name)
    duplicated = sorted(
        f"{t}.{c} -> {rt}.{rc}: {sorted(names)}"
        for (t, c, rt, rc), names in keys.items()
        if len(names) > 1
    )
    assert not duplicated, (
        "Columns with more than one foreign key to the same target (the "
        "stricter delete rule wins):\n" + "\n".join(duplicated)
    )


async def test_every_model_index_exists_in_the_database(db_session: AsyncSession):
    rows = await db_session.execute(
        text(
            "SELECT table_name, index_name, column_name "
            "FROM information_schema.statistics "
            "WHERE table_schema = DATABASE() "
            "ORDER BY table_name, index_name, seq_in_index"
        )
    )
    columns_by_index = defaultdict(list)
    for table, index, column in rows:
        columns_by_index[(table, index)].append(column)
    live = {(table, tuple(cols)) for (table, _), cols in columns_by_index.items()}
    live_tables = {table for table, _ in live}

    missing = []
    for table in Base.metadata.tables.values():
        if table.name not in live_tables:
            continue
        for index in table.indexes:
            if not all(isinstance(expr, Column) for expr in index.expressions):
                continue
            key = (table.name, tuple(col.name for col in index.columns))
            if key not in live:
                missing.append(f"{table.name}: {index.name} {key[1]}")
    assert not missing, "Model indexes absent from the database:\n" + "\n".join(
        sorted(missing)
    )


async def test_every_model_column_has_the_databases_nullability(
    db_session: AsyncSession,
):
    """A column the models call nullable must be nullable in the database too.

    When they disagreed, ``apply_updates`` (which reads nullability from the
    models) passed an explicit null that an upgraded database then refused at
    flush with MySQL 1048.
    """
    rows = await db_session.execute(
        text(
            "SELECT table_name, column_name, is_nullable "
            "FROM information_schema.columns WHERE table_schema = DATABASE()"
        )
    )
    live = {(t, c): nullable == "YES" for t, c, nullable in rows}

    disagree = sorted(
        f"{table.name}.{column.name}: model "
        f"{'NULL' if column.nullable else 'NOT NULL'}, database "
        f"{'NULL' if live[(table.name, column.name)] else 'NOT NULL'}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if (table.name, column.name) in live
        and bool(column.nullable) != live[(table.name, column.name)]
    )
    assert not disagree, "Nullability differs from the models:\n" + "\n".join(disagree)


async def test_member_who_logged_fuel_can_be_hard_deleted(db_session: AsyncSession):
    """The delete rule the models declare is the one the database enforces.

    Before 7c8e6565e05e an upgraded database refused this DELETE with errno
    1451, because the leftover RESTRICT key on ``recorded_by`` outranked the
    SET NULL one that ``release_user_references`` relies on.
    """
    suffix = uuid.uuid4().hex[:8]
    org = Organization(id=str(uuid.uuid4()), name="Drift", slug=f"drift-{suffix}")
    db_session.add(org)
    await db_session.flush()
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"fueler-{suffix}",
        email=f"fueler-{suffix}@example.org",
    )
    apparatus_type = ApparatusType(
        id=str(uuid.uuid4()), organization_id=org.id, name="Engine", code=f"E{suffix}"
    )
    status = ApparatusStatus(
        id=str(uuid.uuid4()), organization_id=org.id, name="In", code=f"I{suffix}"
    )
    db_session.add_all([member, apparatus_type, status])
    await db_session.flush()
    apparatus = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number=f"E-{suffix}",
        apparatus_type_id=apparatus_type.id,
        status_id=status.id,
    )
    db_session.add(apparatus)
    await db_session.flush()
    log = ApparatusFuelLog(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        apparatus_id=apparatus.id,
        fuel_date=datetime(2026, 10, 1, tzinfo=timezone.utc),
        fuel_type=FuelType.DIESEL,
        gallons=40,
        recorded_by=member.id,
    )
    db_session.add(log)
    await db_session.flush()

    await release_user_references(db_session, member.id)
    await db_session.execute(
        text("DELETE FROM users WHERE id = :id"), {"id": member.id}
    )

    recorded_by = await db_session.scalar(
        select(ApparatusFuelLog.recorded_by)
        .where(ApparatusFuelLog.id == log.id)
        .execution_options(populate_existing=True)
    )
    assert recorded_by is None


async def test_open_ended_leave_stores_a_permanent_waiver(db_session: AsyncSession):
    """A NULL end date means a permanent waiver, and the database must allow it.

    Before f938324f8081 an upgraded database refused this with MySQL 1048,
    because ``training_waivers.end_date`` was created NOT NULL and never relaxed
    when the model was. An open-ended leave creates exactly this waiver.
    """
    suffix = uuid.uuid4().hex[:8]
    org = Organization(id=str(uuid.uuid4()), name="Waiver", slug=f"waiver-{suffix}")
    db_session.add(org)
    await db_session.flush()
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"leave-{suffix}",
        email=f"leave-{suffix}@example.org",
    )
    db_session.add(member)
    await db_session.flush()

    waiver_id = await MemberLeaveService(db_session)._create_linked_waiver(
        organization_id=org.id,
        user_id=member.id,
        leave_type="leave_of_absence",
        start_date=date(2026, 10, 1),
        end_date=None,
        reason="Open-ended leave",
        granted_by=member.id,
    )
    await db_session.flush()

    end_date = await db_session.scalar(
        select(TrainingWaiver.end_date)
        .where(TrainingWaiver.id == waiver_id)
        .execution_options(populate_existing=True)
    )
    assert end_date is None
