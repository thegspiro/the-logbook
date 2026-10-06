"""Server-issued member badge codes.

A badge used to carry the membership number or a short form of the member's
id, both visible in the directory, so any member could print a working copy of
a colleague's badge. These tests pin the replacement: the code is random and
org-unique, scanners resolve it on the server and only within the caller's
organization, a reissue cancels the old badge, and old badges keep scanning
until the department switches them off.
"""

import json
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import PermissionChecker
from app.api.v1.endpoints import member_badges as endpoints
from app.models.user import Organization, Role, User, UserStatus
from app.services.member_badge_service import (
    MATCHED_BADGE_CODE,
    MATCHED_LEGACY,
    MemberBadgeService,
    accepts_legacy_badges,
)
from app.utils.member_badge import (
    BADGE_CODE_ALPHABET,
    BADGE_CODE_PREFIX,
    generate_badge_code,
    is_badge_code,
    legacy_qr_member_id,
    legacy_short_id,
    normalize_scanned_code,
)


@pytest.mark.unit
class TestBadgeCodeShape:
    def test_generated_codes_have_the_badge_shape(self):
        for _ in range(200):
            code = generate_badge_code()
            assert is_badge_code(code)
            assert code.startswith(BADGE_CODE_PREFIX)

    def test_codes_avoid_characters_people_misread(self):
        for ch in "01ILOUV":
            assert ch not in BADGE_CODE_ALPHABET

    def test_codes_do_not_repeat(self):
        codes = {generate_badge_code() for _ in range(5000)}
        assert len(codes) == 5000

    @pytest.mark.parametrize(
        "value",
        [
            "M-042",
            "MB-1234567890",
            "MB-23456789A",
            "XX-23456789AB",
            "",
            "mb-23456789ab",
        ],
    )
    def test_other_values_are_not_badge_codes(self, value):
        assert not is_badge_code(value)

    def test_scanned_values_are_trimmed_and_upper_cased(self):
        assert normalize_scanned_code("  mb-23456789ab\r\n") == "MB-23456789AB"

    def test_legacy_short_id(self):
        assert legacy_short_id("abcdef12-3456-7890-abcd-ef1234567890") == "ABCDEF123456"


@pytest.mark.unit
class TestLegacyQr:
    def test_reads_the_member_id(self):
        raw = json.dumps({"type": "member_id", "id": "u-1", "org": "o"})
        assert legacy_qr_member_id(raw) == "u-1"

    @pytest.mark.parametrize(
        "raw",
        [
            "M-042",
            json.dumps({"type": "asset", "id": "u-1"}),
            json.dumps({"type": "member_id", "id": 7}),
            json.dumps(["member_id"]),
        ],
    )
    def test_anything_else_is_not_a_legacy_qr(self, raw):
        assert legacy_qr_member_id(raw) is None


@pytest.mark.unit
class TestLegacySwitch:
    def test_absent_means_old_badges_still_scan(self):
        """Upgrading must not stop a single printed badge working."""
        assert accepts_legacy_badges({}) is True
        assert accepts_legacy_badges(None) is True
        assert accepts_legacy_badges({"member_badges": "junk"}) is True

    def test_only_an_explicit_false_switches_them_off(self):
        assert (
            accepts_legacy_badges({"member_badges": {"accept_legacy": False}}) is False
        )
        assert accepts_legacy_badges({"member_badges": {"accept_legacy": 0}}) is True


@pytest.mark.unit
class TestEndpointGates:
    @staticmethod
    def _gate(path: str, method: str):
        for route in endpoints.router.routes:
            if route.path == path and method in route.methods:
                checkers = [
                    d.call
                    for d in route.dependant.dependencies
                    if isinstance(d.call, PermissionChecker)
                ]
                return set(checkers[0].required_permissions) if checkers else None
        raise AssertionError(f"no route {method} {path}")

    def test_settings_and_reissue_are_for_badge_officers(self):
        officers = {"members.manage", "members.manage_id_cards"}
        assert self._gate("/settings", "GET") == officers
        assert self._gate("/settings", "PUT") == officers
        assert self._gate("/{user_id}/reissue", "POST") == officers

    def test_resolve_is_for_the_scanners_never_the_directory(self):
        gate = self._gate("/resolve", "POST")
        assert gate == {
            "users.view",
            "members.manage",
            "members.manage_id_cards",
            "inventory.manage",
        }
        assert "members.view" not in gate

    def test_reading_a_code_checks_the_caller_in_the_handler(self):
        """Self or a badge officer — decided in the handler, so no route-level
        permission dependency is expected here."""
        assert self._gate("/{user_id}", "GET") is None


def _hex() -> str:
    return uuid.uuid4().hex[:8]


async def _org(db: AsyncSession, **fields) -> Organization:
    org = Organization(name="Badge VFD", slug=f"badge-{_hex()}", **fields)
    db.add(org)
    await db.flush()
    return org


async def _member(db: AsyncSession, org: Organization, perms=(), **fields) -> User:
    user = User(
        organization_id=org.id,
        username=f"member-{_hex()}",
        email=f"member-{_hex()}@example.org",
        first_name=fields.pop("first_name", "Alex"),
        last_name=fields.pop("last_name", "Reyes"),
        status=fields.pop("status", UserStatus.ACTIVE),
        **fields,
    )
    if perms:
        role = Role(
            organization_id=org.id,
            name=f"Position {_hex()}",
            slug=f"position-{_hex()}",
            permissions=list(perms),
        )
        db.add(role)
        await db.flush()
        user.positions = [role]
    db.add(user)
    await db.flush()
    return (
        await db.execute(
            select(User)
            .where(User.id == user.id)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


@pytest.mark.integration
class TestIssuing:
    async def test_every_new_member_gets_a_code(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        assert is_badge_code(member.badge_code)

    async def test_reissue_cancels_the_old_badge(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        old = member.badge_code
        service = MemberBadgeService(db_session)

        reissued = await service.reissue(org.id, member.id)

        assert reissued.badge_code != old
        assert is_badge_code(reissued.badge_code)
        assert (await service.resolve(org.id, old)) == (None, None)
        assert (await service.resolve(org.id, reissued.badge_code))[0].id == member.id

    async def test_reissue_cannot_reach_another_organization(self, db_session):
        mine = await _org(db_session)
        theirs = await _org(db_session)
        outsider = await _member(db_session, theirs)
        code = outsider.badge_code

        assert (
            await MemberBadgeService(db_session).reissue(mine.id, outsider.id) is None
        )
        await db_session.refresh(outsider)
        assert outsider.badge_code == code


@pytest.mark.integration
class TestResolve:
    async def test_resolves_a_badge_code_however_it_was_typed(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        service = MemberBadgeService(db_session)

        user, matched = await service.resolve(
            org.id, f"  {member.badge_code.lower()}\n"
        )

        assert user.id == member.id
        assert matched == MATCHED_BADGE_CODE

    async def test_never_resolves_another_organizations_badge(self, db_session):
        mine = await _org(db_session)
        theirs = await _org(db_session)
        outsider = await _member(db_session, theirs, membership_number="T-1")
        service = MemberBadgeService(db_session)

        assert await service.resolve(mine.id, outsider.badge_code) == (None, None)
        assert await service.resolve(mine.id, "T-1") == (None, None)
        forged = json.dumps({"type": "member_id", "id": outsider.id})
        assert await service.resolve(mine.id, forged) == (None, None)

    async def test_old_badges_scan_while_the_department_allows_them(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org, membership_number="m-042")
        service = MemberBadgeService(db_session)
        qr = json.dumps({"type": "member_id", "id": member.id})

        for scanned in ("M-042", legacy_short_id(member.id), qr):
            user, matched = await service.resolve(org.id, scanned)
            assert user.id == member.id, scanned
            assert matched == MATCHED_LEGACY

    async def test_switching_old_badges_off_leaves_only_badge_codes(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org, membership_number="M-042")
        service = MemberBadgeService(db_session)

        await service.set_accept_legacy(org.id, False)

        assert await service.resolve(org.id, "M-042") == (None, None)
        assert await service.resolve(org.id, legacy_short_id(member.id)) == (None, None)
        assert (await service.resolve(org.id, member.badge_code))[0].id == member.id

    async def test_a_deleted_member_does_not_resolve(self, db_session):
        from datetime import datetime, timezone

        org = await _org(db_session)
        member = await _member(db_session, org, membership_number="D-1")
        member.deleted_at = datetime.now(timezone.utc)
        await db_session.flush()

        service = MemberBadgeService(db_session)
        assert await service.resolve(org.id, member.badge_code) == (None, None)
        assert await service.resolve(org.id, "D-1") == (None, None)

    async def test_saving_the_switch_keeps_other_settings(self, db_session):
        org = await _org(db_session, settings={"id_card_print": {"sides": "both"}})
        await MemberBadgeService(db_session).set_accept_legacy(org.id, False)
        await db_session.refresh(org)
        assert org.settings["id_card_print"] == {"sides": "both"}
        assert org.settings["member_badges"] == {"accept_legacy": False}


@pytest.mark.integration
class TestReadingACode:
    async def test_a_member_reads_their_own_code(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        result = await endpoints.get_member_badge(member.id, db_session, member)
        assert result["badge_code"] == member.badge_code

    async def test_a_colleague_cannot_read_it(self, db_session):
        from fastapi import HTTPException

        org = await _org(db_session)
        member = await _member(db_session, org)
        colleague = await _member(
            db_session, org, perms=["members.view", "users.view", "inventory.manage"]
        )
        with pytest.raises(HTTPException) as exc:
            await endpoints.get_member_badge(member.id, db_session, colleague)
        assert exc.value.status_code == 404

    @pytest.mark.parametrize("grant", ["members.manage", "members.manage_id_cards"])
    async def test_a_badge_officer_reads_it(self, db_session, grant):
        org = await _org(db_session)
        member = await _member(db_session, org)
        officer = await _member(db_session, org, perms=[grant])
        result = await endpoints.get_member_badge(member.id, db_session, officer)
        assert result["badge_code"] == member.badge_code

    async def test_an_officer_cannot_read_another_organizations_code(self, db_session):
        from fastapi import HTTPException

        mine = await _org(db_session)
        theirs = await _org(db_session)
        outsider = await _member(db_session, theirs)
        officer = await _member(db_session, mine, perms=["members.manage"])
        with pytest.raises(HTTPException) as exc:
            await endpoints.get_member_badge(outsider.id, db_session, officer)
        assert exc.value.status_code == 404
