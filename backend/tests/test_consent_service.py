"""Tests for member consent tracking (ISO/IEC 27701)."""

import uuid

import pytest

from app.models.consent import ConsentType
from app.models.user import Organization, User, UserStatus
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


async def _make_org(db, label="Roster FD"):
    org = Organization(name=label, slug=f"roster-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _add_member(db, org, last_name, status=UserStatus.ACTIVE):
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{suffix}",
        email=f"member-{suffix}@example.org",
        first_name="Pat",
        last_name=last_name,
        status=status,
    )
    db.add(user)
    await db.flush()
    return user


class TestConsentRoster:
    async def test_roster_separates_declined_from_never_asked(self, db_session):
        org = await _make_org(db_session)
        agreed = await _add_member(db_session, org, "Agreed")
        refused = await _add_member(db_session, org, "Refused")
        await _add_member(db_session, org, "Unasked")
        service = ConsentService(db_session)
        await service.set_consent(agreed, ConsentType.PHOTO_USE, True)
        await service.set_consent(refused, ConsentType.PHOTO_USE, False)

        roster = await service.roster(org.id, ConsentType.PHOTO_USE)

        assert roster["consent_type"] == "photo_use"
        assert roster["summary"] == {
            "granted": 1,
            "declined": 1,
            "not_answered": 1,
            "total": 3,
        }
        by_name = {m["last_name"]: m for m in roster["members"]}
        assert by_name["Agreed"]["status"] == "granted"
        assert by_name["Refused"]["status"] == "declined"
        assert by_name["Unasked"]["status"] == "not_answered"
        assert by_name["Unasked"]["granted"] is None
        assert by_name["Unasked"]["decided_at"] is None
        assert by_name["Agreed"]["decided_at"] is not None
        # Sorted by surname so the page does not need to re-sort.
        assert [m["last_name"] for m in roster["members"]] == [
            "Agreed",
            "Refused",
            "Unasked",
        ]

    async def test_roster_carries_no_contact_fields(self, db_session):
        org = await _make_org(db_session)
        await _add_member(db_session, org, "Private")

        roster = await ConsentService(db_session).roster(org.id, ConsentType.PHOTO_USE)

        # The member directory gates email on the org's contact-visibility
        # setting. This list must not become a way around it.
        assert "email" not in roster["members"][0]
        assert "phone" not in roster["members"][0]
        assert "mobile" not in roster["members"][0]

    async def test_roster_never_crosses_organizations(self, db_session):
        org_a = await _make_org(db_session, "A FD")
        org_b = await _make_org(db_session, "B FD")
        theirs = await _add_member(db_session, org_b, "Elsewhere")
        service = ConsentService(db_session)
        await service.set_consent(theirs, ConsentType.PHOTO_USE, True)
        await _add_member(db_session, org_a, "Ours")

        roster = await service.roster(org_a.id, ConsentType.PHOTO_USE)

        assert [m["last_name"] for m in roster["members"]] == ["Ours"]
        assert roster["summary"]["total"] == 1

    async def test_roster_reports_only_the_requested_consent(self, db_session):
        org = await _make_org(db_session)
        member = await _add_member(db_session, org, "Texter")
        service = ConsentService(db_session)
        # Agreeing to texts is not agreeing to be photographed.
        await service.set_consent(member, ConsentType.SMS_NOTIFICATIONS, True)

        roster = await service.roster(org.id, ConsentType.PHOTO_USE)

        assert roster["members"][0]["status"] == "not_answered"
        assert roster["summary"]["granted"] == 0

    async def test_inactive_members_are_excluded_unless_asked_for(self, db_session):
        org = await _make_org(db_session)
        await _add_member(db_session, org, "Current")
        await _add_member(db_session, org, "Retired", status=UserStatus.RETIRED)
        service = ConsentService(db_session)

        active_only = await service.roster(org.id, ConsentType.PHOTO_USE)
        assert [m["last_name"] for m in active_only["members"]] == ["Current"]

        with_inactive = await service.roster(
            org.id, ConsentType.PHOTO_USE, include_inactive=True
        )
        assert [m["last_name"] for m in with_inactive["members"]] == [
            "Current",
            "Retired",
        ]
        assert with_inactive["members"][1]["member_status"] == "retired"
