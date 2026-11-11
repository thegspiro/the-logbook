"""Member offboarding paths that a second actor or a second click could corrupt.

Application review A6, pass 6:

- LIFE-8: resolving a departure-clearance line as returned unassigned the item
  from whoever held it *now*. A clearance line records only the item id, so a
  helmet taken back through the inventory screens and issued to another member
  was silently unassigned from that member when the departed member's old
  clearance line was later marked returned.
- LIFE-9: opening a clearance checked for an open one and then inserted, with
  no lock, so two requests arriving together opened two clearances for one
  member.
- LIFE-10: reactivating an archived member checked the status and then opened
  a new service stint, with no lock, so a double-click recorded two open
  stints and the member's length of service counted twice.

The two races cannot be produced on one connection, so their tests assert the
mechanism instead: the member row is read ``FOR UPDATE`` before the decision,
and the existence check is itself a locking read (CLAUDE.md pitfall #27).
"""

import uuid
from contextlib import contextmanager

import pytest
from sqlalchemy import event, select, text

from app.models.inventory import InventoryItem
from app.services.departure_clearance_service import DepartureClearanceService
from app.services.inventory_service import InventoryService
from app.services.member_archive_service import reactivate_member

pytestmark = pytest.mark.integration


async def _org(db):
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Lifecycle FD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"life-{org_id[:8]}"},
    )
    return org_id


async def _member(db, org_id, status="active"):
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) VALUES (:id, :org, :un, 'Pat', 'Lee', "
            ":em, 'hashed', :status)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"m{user_id[:8]}",
            "em": f"m{user_id[:8]}@test.example",
            "status": status,
        },
    )
    await db.flush()
    return user_id


@contextmanager
def _captured_sql(db):
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(" ".join(statement.split()))

    engine = db.bind.sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


class TestAClearanceLineOnlyReturnsWhatTheMemberHolds:
    async def test_marking_returned_leaves_the_items_new_holder_alone(self, db_session):
        org_id = await _org(db_session)
        departing = await _member(db_session, org_id, status="dropped_voluntary")
        new_holder = await _member(db_session, org_id)
        inventory = InventoryService(db_session)
        item, _ = await inventory.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Helmet", "condition": "good", "status": "available"},
            created_by=uuid.UUID(departing),
        )
        await inventory.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(departing),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(departing),
        )
        clearances = DepartureClearanceService(db_session)
        clearance, err = await clearances.initiate_clearance(
            user_id=departing,
            organization_id=org_id,
            initiated_by=new_holder,
        )
        assert err is None
        line_id = clearance.line_items[0].id

        # The quartermaster takes the helmet back through the inventory
        # screens and issues it to someone else, outside the clearance.
        ok, err = await inventory.unassign_item(
            item_id=uuid.UUID(item.id),
            organization_id=uuid.UUID(org_id),
            returned_by=uuid.UUID(new_holder),
        )
        assert ok, err
        await inventory.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(new_holder),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(new_holder),
        )

        line, err = await clearances.resolve_line_item(
            clearance_item_id=str(line_id),
            clearance_id=str(clearance.id),
            organization_id=org_id,
            resolved_by=new_holder,
            disposition="returned",
        )

        assert line is None
        assert err is not None
        holder = (
            await db_session.execute(
                select(InventoryItem.assigned_to_user_id)
                .where(InventoryItem.id == item.id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert str(holder) == new_holder


class TestOpeningAClearanceIsSerializedPerMember:
    async def test_the_member_is_locked_and_the_open_check_is_a_locking_read(
        self, db_session
    ):
        org_id = await _org(db_session)
        departing = await _member(db_session, org_id, status="dropped_voluntary")
        officer = await _member(db_session, org_id)

        with _captured_sql(db_session) as statements:
            clearance, err = await DepartureClearanceService(
                db_session
            ).initiate_clearance(
                user_id=departing,
                organization_id=org_id,
                initiated_by=officer,
            )
        assert err is None
        assert clearance is not None

        locked_member = [
            s
            for s in statements
            if s.startswith("SELECT") and "FROM users" in s and s.endswith("FOR UPDATE")
        ]
        open_check = [
            s
            for s in statements
            if s.startswith("SELECT")
            and "FROM departure_clearances" in s
            and "WHERE" in s
            and "status IN" in s
        ]
        assert locked_member, "the departing member's row is not locked"
        assert open_check, "no open-clearance check was issued"
        assert all(s.endswith("FOR UPDATE") for s in open_check)


class TestReactivationIsSerializedPerMember:
    async def test_the_member_is_read_for_update_before_the_status_check(
        self, db_session
    ):
        org_id = await _org(db_session)
        member = await _member(db_session, org_id, status="archived")
        officer = await _member(db_session, org_id)

        with _captured_sql(db_session) as statements:
            await reactivate_member(
                db_session,
                user_id=member,
                organization_id=org_id,
                reactivated_by=officer,
            )

        member_reads = [
            s for s in statements if s.startswith("SELECT") and "FROM users" in s
        ]
        assert member_reads, "reactivation read no member row"
        assert member_reads[0].endswith("FOR UPDATE")
