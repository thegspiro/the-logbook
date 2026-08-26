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

from sqlalchemy import and_, or_, select
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
        #
        # ``paramedic`` is listed explicitly because the medic seat is a real
        # seat now, not a synonym for ``ems``. Without it the seat would exist
        # and nothing would clear anybody for it -- the unfillable-seat failure
        # of #1833, which this module's own test guards in the forward
        # direction only (every granted seat is nameable, but not every seat is
        # grantable).
        "positions": ["ems", "paramedic"],
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
        """Filter for rows in force on ``as_of`` — both ends of the window.

        A NULL ``expires_on`` never lapses and a NULL ``granted_on`` has always
        been in force, so both nulls mean "no bound at that end" rather than
        "unknown".

        ``granted_on`` matters as much as the expiry and is easier to forget.
        A department recording a member's upcoming Paramedic certification with
        a future start date would otherwise have that member clear the medic
        seat *today*, before they are certified — and a shift in the past would
        show them as qualified for a night they had not yet earned. Asked as of
        the day the member would work, not as of today, which is the rule EVOC
        certifications already follow for drivers.
        """
        return and_(
            or_(
                MemberQualification.granted_on.is_(None),
                MemberQualification.granted_on <= as_of,
            ),
            or_(
                MemberQualification.expires_on.is_(None),
                MemberQualification.expires_on >= as_of,
            ),
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

    async def get_current_by_member(
        self,
        organization_id: str,
        as_of: Optional[date] = None,
    ) -> Dict[str, List[Dict[str, Any]]]:
        """user_id -> current qualifications, for the whole organization.

        The bulk form, so a roster screen or a day panel resolves every member
        in one statement rather than one per member.

        Carries ``expires_on`` as well as the code, because a qualification is
        the one eligibility source that lapses on its own. Rank, held positions
        and completed programs all persist until somebody edits a record; a
        card stops counting on a date nobody has to act on. A roster that
        reports only *that* a member is cleared hides the medic whose card runs
        out in three weeks until the day the roster silently shortens.
        """
        result = await self.db.execute(
            select(
                MemberQualification.user_id,
                MemberQualification.qualification_code,
                MemberQualification.expires_on,
            ).where(
                MemberQualification.organization_id == organization_id,
                self._current_on(as_of or date.today()),
            )
        )
        # No per-code deduplication: ``uq_member_qualification`` allows one row
        # per member per qualification, and ``grant`` renews by updating that
        # row rather than adding a second, so there is nothing to collapse.
        by_user: Dict[str, List[Dict[str, Any]]] = {}
        for user_id, code, expires_on in result.all():
            by_user.setdefault(str(user_id), []).append(
                {"code": code, "expires_on": expires_on}
            )
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

    async def sync_from_training_record(
        self,
        record: Any,
    ) -> Optional[MemberQualification]:
        """Grant the qualification a completed course confers, if it confers one.

        The writer half of this table. A training officer records the class
        that actually happened; the course already knows what it certifies and
        the record already knows when it was completed and when it expires. So
        the qualification follows from the record rather than being entered a
        second time, which is the entry that gets forgotten and leaves a member
        certified on paper and unqualified in the scheduler.

        Does nothing unless the record is COMPLETED and its course names a
        qualification. A record that is scheduled, cancelled or failed has
        certified nobody, and re-recording an older completion must not pull a
        current card's expiry backwards -- ``grant`` renews in place, so this
        keeps whichever expiry is further out.
        """
        from app.models.training import TrainingCourse, TrainingStatus

        if getattr(record, "status", None) != TrainingStatus.COMPLETED:
            return None
        course_id = getattr(record, "course_id", None)
        if not course_id:
            return None

        result = await self.db.execute(
            select(TrainingCourse.grants_qualification).where(
                TrainingCourse.id == str(course_id),
                TrainingCourse.organization_id == str(record.organization_id),
            )
        )
        code = result.scalar_one_or_none()
        if not code or code not in QUALIFICATIONS:
            return None

        existing = await self.db.execute(
            select(MemberQualification).where(
                MemberQualification.user_id == str(record.user_id),
                MemberQualification.organization_id == str(record.organization_id),
                MemberQualification.qualification_code == code,
            )
        )
        held = existing.scalar_one_or_none()
        expires_on = getattr(record, "expiration_date", None)
        if held is not None:
            # Never move a live card's expiry earlier. Backfilling an old class
            # is routine, and it must not lapse the certification the member is
            # actually working under.
            if held.expires_on is None:
                expires_on = None
            elif expires_on is not None and expires_on < held.expires_on:
                expires_on = held.expires_on

        return await self.grant(
            user_id=str(record.user_id),
            organization_id=str(record.organization_id),
            qualification_code=code,
            granted_on=getattr(record, "completion_date", None),
            expires_on=expires_on,
        )

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
