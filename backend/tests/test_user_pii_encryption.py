"""Date of birth and emergency contacts are ciphertext in the database and
ordinary values everywhere else."""

import uuid
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

pytestmark = pytest.mark.integration

CONTACTS = [
    {
        "name": "José Ñandú",
        "relationship": "spouse",
        "phone": "555-0100",
        "email": "jose@example.com",
        "is_primary": True,
    }
]


async def _org(db: AsyncSession) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'PII Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"pii-{org_id[:8]}"},
    )
    return org_id


def _user(org_id: str, **extra) -> User:
    uid = str(uuid.uuid4())
    return User(
        id=uid,
        organization_id=org_id,
        username=f"u-{uid[:8]}",
        email=f"{uid[:8]}@dept.example",
        first_name="Dana",
        last_name="Reyes",
        password_hash="hashed",
        **extra,
    )


async def _raw(db: AsyncSession, user_id: str, column: str):
    return (
        await db.execute(
            text(f"SELECT {column} FROM users WHERE id = :id"), {"id": user_id}
        )
    ).scalar_one()


class TestStoredAsCiphertext:
    async def test_date_of_birth_is_not_readable_in_the_table(
        self, db_session: AsyncSession
    ):
        user = _user(await _org(db_session), date_of_birth=date(1988, 4, 11))
        db_session.add(user)
        await db_session.flush()

        raw = await _raw(db_session, user.id, "date_of_birth")

        assert raw.startswith("$gcm2$")
        assert "1988" not in raw

    async def test_emergency_contacts_are_not_readable_in_the_table(
        self, db_session: AsyncSession
    ):
        user = _user(await _org(db_session), emergency_contacts=CONTACTS)
        db_session.add(user)
        await db_session.flush()

        raw = await _raw(db_session, user.id, "emergency_contacts")

        assert raw.startswith("$gcm2$")
        assert "Ñandú" not in raw
        assert "555-0100" not in raw

    async def test_the_application_still_sees_a_date_and_a_list(
        self, db_session: AsyncSession
    ):
        user = _user(
            await _org(db_session),
            date_of_birth=date(1988, 4, 11),
            emergency_contacts=CONTACTS,
        )
        db_session.add(user)
        await db_session.flush()
        user_id = user.id
        db_session.expire(user)

        loaded = await db_session.get(User, user_id)

        assert loaded.date_of_birth == date(1988, 4, 11)
        assert loaded.emergency_contacts == CONTACTS


class TestClearingAndUpdating:
    async def test_clearing_both_stores_null_not_an_encrypted_empty_value(
        self, db_session: AsyncSession
    ):
        user = _user(
            await _org(db_session),
            date_of_birth=date(1988, 4, 11),
            emergency_contacts=CONTACTS,
        )
        db_session.add(user)
        await db_session.flush()

        user.date_of_birth = None
        user.emergency_contacts = None
        await db_session.flush()

        assert await _raw(db_session, user.id, "date_of_birth") is None
        assert await _raw(db_session, user.id, "emergency_contacts") is None

    async def test_replacing_the_list_persists_the_new_contacts(
        self, db_session: AsyncSession
    ):
        user = _user(await _org(db_session), emergency_contacts=CONTACTS)
        db_session.add(user)
        await db_session.flush()

        user.emergency_contacts = [{"name": "Pat", "phone": "555-0199"}]
        await db_session.flush()
        user_id = user.id
        db_session.expire(user)

        loaded = await db_session.get(User, user_id)
        assert loaded.emergency_contacts == [{"name": "Pat", "phone": "555-0199"}]

    async def test_a_new_member_defaults_to_an_empty_list(
        self, db_session: AsyncSession
    ):
        user = _user(await _org(db_session))
        db_session.add(user)
        await db_session.flush()
        user_id = user.id
        db_session.expire(user)

        loaded = await db_session.get(User, user_id)

        assert loaded.emergency_contacts == []
