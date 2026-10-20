"""An organization cannot hold two active admin-hours categories of one name.

Workflow review W70: the seeded "Station Maintenance" already existed, and
"Add Category" created a second one, then a third as "station maintenance".
A member then chooses between identical names at clock-in, and the summary
splits their hours across rows nobody can tell apart.
"""

import uuid
from unittest.mock import patch

import pytest
from sqlalchemy.dialects import mysql
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization, User
from app.services.admin_hours_service import AdminHoursService

pytestmark = pytest.mark.integration


@pytest.fixture
async def setup(db_session: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Hours VFD",
        slug=f"hours-{uuid.uuid4().hex[:8]}",
        timezone="America/Chicago",
    )
    db_session.add(org)
    await db_session.flush()
    name = f"admin-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org.id,
        username=name,
        first_name="Riley",
        last_name="Owner",
        email=f"{name}@example.com",
    )
    db_session.add(user)
    await db_session.flush()
    service = AdminHoursService(db_session)
    existing = await service.create_category(
        organization_id=org.id, created_by=user.id, name="Station Maintenance"
    )
    return {
        "service": service,
        "org_id": org.id,
        "user_id": user.id,
        "existing": existing,
    }


class TestCategoryNames:
    @pytest.mark.parametrize(
        "name", ["Station Maintenance", "station maintenance", "  Station Maintenance "]
    )
    async def test_a_second_active_category_of_the_same_name_is_refused(
        self, setup, name
    ):
        with pytest.raises(ValueError, match="already an active category"):
            await setup["service"].create_category(
                organization_id=setup["org_id"], created_by=setup["user_id"], name=name
            )

    async def test_another_organization_may_use_the_name(self, setup, db_session):
        other = Organization(
            id=str(uuid.uuid4()),
            name="Other VFD",
            slug=f"other-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
        )
        db_session.add(other)
        await db_session.flush()
        created = await setup["service"].create_category(
            organization_id=other.id,
            created_by=setup["user_id"],
            name="Station Maintenance",
        )
        assert created.name == "Station Maintenance"

    async def test_a_retired_name_can_be_reused(self, setup):
        await setup["service"].delete_category(setup["existing"].id, setup["org_id"])
        created = await setup["service"].create_category(
            organization_id=setup["org_id"],
            created_by=setup["user_id"],
            name="Station Maintenance",
        )
        assert created.is_active is True

    async def test_renaming_onto_a_taken_name_is_refused(self, setup):
        other = await setup["service"].create_category(
            organization_id=setup["org_id"],
            created_by=setup["user_id"],
            name="Grounds",
        )
        with pytest.raises(ValueError, match="already an active category"):
            await setup["service"].update_category(
                other.id, setup["org_id"], setup["user_id"], name="station maintenance"
            )

    async def test_saving_a_category_under_its_own_name_is_allowed(self, setup):
        updated = await setup["service"].update_category(
            setup["existing"].id,
            setup["org_id"],
            setup["user_id"],
            name="Station Maintenance",
            description="Bays and grounds",
        )
        assert updated.description == "Bays and grounds"

    async def test_reactivating_onto_a_taken_name_is_refused(self, setup):
        await setup["service"].delete_category(setup["existing"].id, setup["org_id"])
        await setup["service"].create_category(
            organization_id=setup["org_id"],
            created_by=setup["user_id"],
            name="Station Maintenance",
        )
        with pytest.raises(ValueError, match="already an active category"):
            await setup["service"].update_category(
                setup["existing"].id, setup["org_id"], setup["user_id"], is_active=True
            )


async def _statements_run_by(db_session: AsyncSession, action) -> list[str]:
    """The SQL *action* emits, compiled for MySQL and whitespace-normalised."""
    seen: list[str] = []
    real_execute = db_session.execute

    async def spy(statement, *args, **kwargs):
        seen.append(" ".join(str(statement.compile(dialect=mysql.dialect())).split()))
        return await real_execute(statement, *args, **kwargs)

    with patch.object(db_session, "execute", spy):
        await action()
    return seen


class TestTheNameCheckSerializesConcurrentWrites:
    """Two officers adding one name at once must not both succeed (AH-18).

    The check is a read followed by the caller's write, so it needs the two
    halves of CLAUDE.md pitfall #27: a lock on the contended parent row to
    serialize the decision, and a locking read for the check itself, because
    under REPEATABLE READ a plain SELECT answers from the transaction's first
    snapshot, which predates the lock. Two sessions cannot be raced inside the
    rolled-back test transaction, so this asserts the SQL the service emits.
    """

    @staticmethod
    def _lock_and_check(statements: list[str]) -> tuple[int, int]:
        locks = [
            i
            for i, sql in enumerate(statements)
            if "FROM organizations" in sql and sql.endswith("FOR UPDATE")
        ]
        checks = [
            i
            for i, sql in enumerate(statements)
            if "FROM admin_hours_categories" in sql and "lower(trim(" in sql
        ]
        assert len(locks) == 1, statements
        assert len(checks) == 1, statements
        return locks[0], checks[0]

    async def test_create_locks_the_organization_before_a_locking_check(
        self, setup, db_session
    ):
        statements = await _statements_run_by(
            db_session,
            lambda: setup["service"].create_category(
                organization_id=setup["org_id"],
                created_by=setup["user_id"],
                name="Grounds",
            ),
        )

        lock, check = self._lock_and_check(statements)
        assert lock < check
        assert statements[check].endswith("FOR UPDATE")

    async def test_rename_locks_the_organization_before_a_locking_check(
        self, setup, db_session
    ):
        statements = await _statements_run_by(
            db_session,
            lambda: setup["service"].update_category(
                setup["existing"].id,
                setup["org_id"],
                setup["user_id"],
                name="Station Upkeep",
            ),
        )

        lock, check = self._lock_and_check(statements)
        assert lock < check
        assert statements[check].endswith("FOR UPDATE")

    async def test_deactivating_a_category_takes_no_lock(self, setup, db_session):
        statements = await _statements_run_by(
            db_session,
            lambda: setup["service"].update_category(
                setup["existing"].id,
                setup["org_id"],
                setup["user_id"],
                is_active=False,
            ),
        )

        assert not any(sql.endswith("FOR UPDATE") for sql in statements), statements
