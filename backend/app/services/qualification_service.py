"""The qualification vocabulary, and which shift seats each one unlocks.

Ranks answer "where does this member sit in the chain of command". These
answer "what is this member trained to do". Keeping them apart is what lets a
Captain also be a Paramedic, and lets an EMS-only agency staff its medic unit
from members who will never be firefighters.

Each qualification names the shift positions it clears a member for, in the
same vocabulary ``operational_ranks.eligible_positions`` uses and
``ShiftPosition`` speaks — because a seat a qualification unlocks has to be a
seat the signup API can name. ``tests/test_qualification_service.py`` asserts
that, so this list cannot drift out of the seat vocabulary the way the
apparatus editor's did (#1833).
"""

from datetime import date
from typing import Any, Dict, List, Optional, Sequence, Set

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.qualification import MemberQualification

# code -> (label, shift positions it clears the holder for)
#
# Firefighter II clears the same seat as Firefighter I: it is a deeper
# certification, not a different job, and no seat in the scheduling vocabulary
# distinguishes them. It is listed separately because departments track and
# require it separately, and because a member may hold I without II.
QUALIFICATIONS: Dict[str, Dict[str, Any]] = {
    "firefighter_i": {
        "label": "Firefighter I",
        "positions": ["firefighter"],
    },
    "firefighter_ii": {
        "label": "Firefighter II",
        "positions": ["firefighter"],
    },
    "driver_operator": {
        "label": "Driver / Operator",
        "positions": ["driver"],
    },
    "emt": {
        "label": "EMT",
        "positions": ["ems"],
    },
    "aemt": {
        "label": "Advanced EMT",
        "positions": ["ems"],
    },
    "paramedic": {
        "label": "Paramedic",
        # A paramedic can staff the medic unit and, holding the higher
        # credential, anything an EMT can.
        "positions": ["ems"],
    },
}


def qualification_label(code: str) -> str:
    """Human-readable name for a code, or the code itself if unknown."""
    entry = QUALIFICATIONS.get(code)
    return entry["label"] if entry else code


def positions_for_qualifications(codes: Sequence[str]) -> Set[str]:
    """Union of the shift seats these qualifications clear a member for.

    An unrecognised code clears nothing rather than raising: the column is a
    string so a department's own future qualification can live there, and one
    the seat map has no entry for simply grants no seats.
    """
    granted: Set[str] = set()
    for code in codes:
        entry = QUALIFICATIONS.get(code)
        if entry:
            granted.update(entry["positions"])
    return granted


class QualificationService:
    """Reads and writes the qualifications a member holds."""

    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _current_on(as_of: date):
        """Filter for rows still current on ``as_of``.

        A NULL ``expires_on`` never lapses. Note this is asked *as of the day
        the member would work*, not as of today — a card that is valid now and
        expires before the shift qualifies nobody to work it, which is the rule
        EVOC certifications already follow for drivers.
        """
        return or_(
            MemberQualification.expires_on.is_(None),
            MemberQualification.expires_on >= as_of,
        )

    async def get_member_codes(
        self,
        user_id: str,
        organization_id: str,
        as_of: Optional[date] = None,
    ) -> List[str]:
        """Qualification codes this member holds and has not let lapse."""
        result = await self.db.execute(
            select(MemberQualification.qualification_code).where(
                MemberQualification.user_id == user_id,
                MemberQualification.organization_id == organization_id,
                self._current_on(as_of or date.today()),
            )
        )
        return [code for (code,) in result.all()]

    async def get_codes_by_member(
        self,
        organization_id: str,
        as_of: Optional[date] = None,
    ) -> Dict[str, List[str]]:
        """user_id -> current qualification codes, for the whole organization.

        The bulk form, so a roster screen or a day panel resolves every member
        in one statement rather than one per member.
        """
        result = await self.db.execute(
            select(
                MemberQualification.user_id,
                MemberQualification.qualification_code,
            ).where(
                MemberQualification.organization_id == organization_id,
                self._current_on(as_of or date.today()),
            )
        )
        by_user: Dict[str, List[str]] = {}
        for user_id, code in result.all():
            by_user.setdefault(str(user_id), []).append(code)
        return by_user

    async def list_for_member(
        self,
        user_id: str,
        organization_id: str,
    ) -> List[MemberQualification]:
        """Every qualification on record, lapsed ones included.

        The expiry filter belongs on eligibility questions, not on this one: an
        officer looking at a member's record needs to see the EMT card that
        expired last month, which is exactly the thing to act on.
        """
        result = await self.db.execute(
            select(MemberQualification)
            .where(
                MemberQualification.user_id == user_id,
                MemberQualification.organization_id == organization_id,
            )
            .order_by(MemberQualification.qualification_code)
        )
        return list(result.scalars().all())

    async def grant(
        self,
        user_id: str,
        organization_id: str,
        qualification_code: str,
        granted_on: Optional[date] = None,
        expires_on: Optional[date] = None,
        notes: Optional[str] = None,
    ) -> MemberQualification:
        """Record or renew a qualification.

        Renewal updates the row that is there rather than adding a second, so
        "does this member hold X" never has to choose between rows. The unique
        constraint enforces it at the database too.
        """
        if qualification_code not in QUALIFICATIONS:
            raise ValueError(
                f"Unknown qualification '{qualification_code}'. "
                f"Known: {', '.join(sorted(QUALIFICATIONS))}."
            )

        result = await self.db.execute(
            select(MemberQualification).where(
                MemberQualification.user_id == user_id,
                MemberQualification.organization_id == organization_id,
                MemberQualification.qualification_code == qualification_code,
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.granted_on = granted_on
            existing.expires_on = expires_on
            existing.notes = notes
            await self.db.flush()
            return existing

        record = MemberQualification(
            organization_id=organization_id,
            user_id=user_id,
            qualification_code=qualification_code,
            granted_on=granted_on,
            expires_on=expires_on,
            notes=notes,
        )
        self.db.add(record)
        await self.db.flush()
        return record

    async def revoke(
        self,
        user_id: str,
        organization_id: str,
        qualification_code: str,
    ) -> bool:
        """Remove a qualification. Returns whether there was one to remove."""
        result = await self.db.execute(
            select(MemberQualification).where(
                MemberQualification.user_id == user_id,
                MemberQualification.organization_id == organization_id,
                MemberQualification.qualification_code == qualification_code,
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            return False
        await self.db.delete(record)
        await self.db.flush()
        return True
