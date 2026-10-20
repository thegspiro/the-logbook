"""The live database matches the models where drift has already bitten.

A fresh install is built by ``create_all`` from the models; an upgraded one by
the Alembic chain plus ``repair_schema``. Nothing compared the two, and on
2026-10-20 they differed in ways that mattered: 18 apparatus columns carried a
leftover RESTRICT foreign key beside their SET NULL one (blocking member
deletion), and three indexes existed on one kind of database and not the other.

CI's integration job builds its database the upgraded way (migrations, then
``scripts/repair_schema.py``), so these checks run against that shape there.
The local suite's own ``intranet_test`` database is built by ``create_all`` and
passes trivially; point ``DB_NAME`` at a migrated database to check one by hand.

Only drift in a direction that has a fix is asserted. The differences recorded
in ``docs/KNOWN_LIMITATIONS.md`` (leftover tables, stricter nullability and
server defaults, the unused ``shift_equipment_checks.apparatus_id`` index) are
deliberately not checked here.
"""

import uuid
from collections import defaultdict
from datetime import datetime, timezone

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
from app.models.user import Organization, User
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
