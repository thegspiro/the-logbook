"""
Member badge codes: issuing, reissuing, and resolving a scan.

Every scanner that identifies a member from a badge resolves through
:meth:`MemberBadgeService.resolve`, on the server, rather than matching the
scanned text against a roster in the browser. That is what lets a badge carry
a code nobody can see in the directory, and it closes the gap where a scanner
trusted the member id inside a QR code without checking it.

Old badges — the membership number, the short id, and the digital card's QR
JSON — are accepted while ``organization.settings["member_badges"]
["accept_legacy"]`` allows. Absent means accepted, so upgrading changes nothing
a department relies on until an officer decides every member holds a new
badge and switches the old ones off.
"""

import copy
from typing import Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization, User
from app.utils.member_badge import (
    LEGACY_SHORT_ID_LENGTH,
    MAX_SCANNED_LENGTH,
    generate_badge_code,
    is_badge_code,
    legacy_qr_member_id,
    normalize_scanned_code,
)

SETTINGS_KEY = "member_badges"
ACCEPT_LEGACY_KEY = "accept_legacy"

MATCHED_BADGE_CODE = "badge_code"
MATCHED_LEGACY = "legacy"


def accepts_legacy_badges(settings) -> bool:
    """Whether old-style badges still scan. Anything but an explicit False
    keeps the behaviour every installation had before badge codes."""
    section = settings.get(SETTINGS_KEY) if isinstance(settings, dict) else None
    if not isinstance(section, dict):
        return True
    return section.get(ACCEPT_LEGACY_KEY) is not False


class MemberBadgeService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _organization(self, organization_id, for_update: bool = False):
        query = select(Organization).where(Organization.id == str(organization_id))
        if for_update:
            query = query.with_for_update()
        org = await self.db.scalar(query)
        if org is None:
            raise ValueError("Organization not found")
        return org

    async def get_member(self, organization_id, user_id) -> Optional[User]:
        return await self.db.scalar(
            select(User).where(
                User.id == str(user_id),
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
            )
        )

    async def ensure_codes(self, users: Iterable[User]) -> None:
        """Give any member without a code one.

        The migration and the model default cover every row the ORM writes,
        so this is for a row inserted some other way; it keeps a print from
        ever falling back to a code the directory exposes.
        """
        issued = False
        for user in users:
            if not user.badge_code:
                user.badge_code = generate_badge_code()
                issued = True
        if issued:
            await self.db.flush()

    async def reissue(self, organization_id, user_id) -> Optional[User]:
        """Replace a member's code, so the badge they lost stops scanning."""
        user = await self.db.scalar(
            select(User)
            .where(
                User.id == str(user_id),
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if user is None:
            return None
        previous = user.badge_code
        code = generate_badge_code()
        while code == previous:
            code = generate_badge_code()
        user.badge_code = code
        await self.db.flush()
        return user

    async def get_accept_legacy(self, organization_id) -> bool:
        org = await self._organization(organization_id)
        return accepts_legacy_badges(org.settings)

    async def set_accept_legacy(self, organization_id, accept: bool) -> bool:
        # Locked read-modify-write: settings holds every module's
        # configuration, and two officers saving at once must not drop each
        # other's change.
        org = await self._organization(organization_id, for_update=True)
        settings = copy.deepcopy(org.settings or {})
        section = settings.get(SETTINGS_KEY)
        section = dict(section) if isinstance(section, dict) else {}
        section[ACCEPT_LEGACY_KEY] = bool(accept)
        settings[SETTINGS_KEY] = section
        org.settings = settings
        await self.db.flush()
        return bool(accept)

    async def resolve(self, organization_id, scanned: str):
        """The member a scanned value names in this organization.

        Returns ``(user, matched)`` where *matched* says which kind of code
        identified them, or ``(None, None)``. Deleted members never resolve.
        """
        if not scanned or len(scanned) > MAX_SCANNED_LENGTH:
            return None, None
        org_id = str(organization_id)
        code = normalize_scanned_code(scanned)
        live = (User.organization_id == org_id, User.deleted_at.is_(None))

        if is_badge_code(code):
            user = await self.db.scalar(
                select(User).where(*live, User.badge_code == code)
            )
            if user is not None:
                return user, MATCHED_BADGE_CODE

        if not await self.get_accept_legacy(org_id):
            return None, None

        member_id = legacy_qr_member_id(scanned.strip())
        if member_id:
            # The id in an old QR was written by the browser, so it is a
            # claim: it names a member only inside the caller's organization.
            user = await self.db.scalar(
                select(User).where(
                    User.id == member_id,
                    User.organization_id == org_id,
                    User.deleted_at.is_(None),
                )
            )
            return (user, MATCHED_LEGACY) if user is not None else (None, None)

        user = await self.db.scalar(
            select(User).where(*live, func.upper(User.membership_number) == code)
        )
        if user is not None:
            return user, MATCHED_LEGACY

        if len(code) == LEGACY_SHORT_ID_LENGTH and code.isalnum():
            short_id = func.upper(
                func.left(func.replace(User.id, "-", ""), LEGACY_SHORT_ID_LENGTH)
            )
            users = (
                await self.db.scalars(
                    select(User).where(*live, short_id == code).limit(2)
                )
            ).all()
            # Twelve hex characters of a UUID are unique in practice; if two
            # members ever share them, naming either would be a guess.
            if len(users) == 1:
                return users[0], MATCHED_LEGACY
        return None, None
