"""Key rotation must recompute email fingerprints, not only re-encrypt values.

A fingerprint is a keyed HMAC, so after ENCRYPTION_KEY changes a row is found
by email only while the old key stays in ENCRYPTION_KEYS_LEGACY. The rotation
script is what lets that key be removed without breaking sign-in by email.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select, text

from app.core import security
from app.core.config import settings
from app.models.user import User

pytestmark = pytest.mark.integration

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "rotate_encryption_key.py"
_KEY_A = "a" * 64
_KEY_B = "b" * 64
ADDRESS = "Chief.Rotation@example.org"


def _script():
    spec = importlib.util.spec_from_file_location("rotate_encryption_key", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def keyring(monkeypatch):
    def set_keys(current: str, legacy: str = ""):
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", current)
        monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", legacy)
        security.reset_encryption_ciphers()

    yield set_keys
    security.reset_encryption_ciphers()


async def _member_under_key_a(db, keyring) -> str:
    keyring(_KEY_A)
    org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": f"Rotate {org_id[:8]}", "slug": f"rot-{org_id[:8]}"},
    )
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, email_hash, password_hash, status) VALUES "
            "(:id, :org, :un, 'Test', 'Member', :em, :fp, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"rot-{user_id[:8]}",
            "em": security.encrypt_data(ADDRESS),
            "fp": security.email_fingerprint(ADDRESS),
        },
    )
    await db.flush()
    return user_id


async def _found_by_email(db) -> list[str]:
    result = await db.execute(
        select(User.id).where(
            User.email_hash.in_(security.email_fingerprints(ADDRESS.lower()))
        )
    )
    return list(result.scalars().all())


async def test_without_the_rotation_dropping_the_old_key_loses_the_row(
    db_session, keyring
):
    user_id = await _member_under_key_a(db_session, keyring)

    keyring(_KEY_B, legacy=_KEY_A)
    assert user_id in await _found_by_email(db_session)
    keyring(_KEY_B)

    assert user_id not in await _found_by_email(db_session)


async def test_after_the_rotation_the_old_key_can_go(db_session, keyring):
    user_id = await _member_under_key_a(db_session, keyring)
    keyring(_KEY_B, legacy=_KEY_A)
    stats = {"current": 0, "rotated": 0, "unreadable": 0}

    await _script()._rotate_fingerprints(db_session, stats, commit=True)

    assert stats["rotated"] >= 1
    keyring(_KEY_B)
    assert user_id in await _found_by_email(db_session)


async def test_a_dry_run_writes_nothing(db_session, keyring):
    user_id = await _member_under_key_a(db_session, keyring)
    keyring(_KEY_B, legacy=_KEY_A)
    stats = {"current": 0, "rotated": 0, "unreadable": 0}

    await _script()._rotate_fingerprints(db_session, stats, commit=False)

    keyring(_KEY_B)
    assert user_id not in await _found_by_email(db_session)
