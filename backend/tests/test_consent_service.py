"""Tests for member consent tracking (ISO/IEC 27701)."""

import uuid

import pytest

from app.models.consent import ConsentType
from app.models.user import Organization, User
from app.services.consent_service import ConsentService

pytestmark = pytest.mark.integration


async def _make_member(db):
    org = Organization(name="Consent FD", slug=f"consent-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{suffix}",
        email=f"member-{suffix}@example.org",
    )
    db.add(user)
    await db.flush()
    return user


class TestConsentService:
    async def test_unasked_consents_are_null_not_granted(self, db_session):
        user = await _make_member(db_session)
        service = ConsentService(db_session)

        items = await service.list_for_user(user)

        assert {i["consent_type"] for i in items} == {t.value for t in ConsentType}
        assert all(i["granted"] is None for i in items)
        # Fail closed: never-asked is not consent.
        assert (
            await service.has_consent(user.id, ConsentType.SMS_NOTIFICATIONS)
        ) is False

    async def test_grant_and_revoke_upserts_single_row(self, db_session):
        user = await _make_member(db_session)
        service = ConsentService(db_session)

        await service.set_consent(user, ConsentType.PHOTO_USE, True)
        assert (await service.has_consent(user.id, ConsentType.PHOTO_USE)) is True

        await service.set_consent(user, ConsentType.PHOTO_USE, False)
        assert (await service.has_consent(user.id, ConsentType.PHOTO_USE)) is False

        items = await service.list_for_user(user)
        photo = next(i for i in items if i["consent_type"] == "photo_use")
        assert photo["granted"] is False
        assert photo["updated_at"] is not None
        # Explicit refusal is distinguishable from never-asked.
        roster = next(i for i in items if i["consent_type"] == "public_roster_listing")
        assert roster["granted"] is None

    async def test_consents_are_per_member(self, db_session):
        user_a = await _make_member(db_session)
        user_b = await _make_member(db_session)
        service = ConsentService(db_session)

        await service.set_consent(user_a, ConsentType.SMS_NOTIFICATIONS, True)

        assert (
            await service.has_consent(user_a.id, ConsentType.SMS_NOTIFICATIONS)
        ) is True
        assert (
            await service.has_consent(user_b.id, ConsentType.SMS_NOTIFICATIONS)
        ) is False
