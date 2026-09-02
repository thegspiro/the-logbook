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

from calendar import monthrange
from datetime import date
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

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

    async def get_member_code_windows(
        self,
        user_id: str,
        organization_id: str,
    ) -> List[Tuple[str, Optional[date], Optional[date]]]:
        """Every code the member holds, with the window it is in force for.

        ``get_member_codes`` answers for one date, so a caller asking about a
        range of dates pays one query per date. The bulk shift-eligibility
        pass asks about every distinct shift date on the page — a year of
        generated shifts is ~365 sequential round trips for one list request.
        Returning the bounds instead lets that caller settle each date in
        Python off a single statement; a NULL at either end means unbounded,
        exactly as ``_current_on`` reads it.
        """
        result = await self.db.execute(
            select(
                MemberQualification.qualification_code,
                MemberQualification.granted_on,
                MemberQualification.expires_on,
            ).where(
                MemberQualification.user_id == user_id,
                MemberQualification.organization_id == organization_id,
            )
        )
        return [(code, granted, expires) for code, granted, expires in result.all()]

    @staticmethod
    def codes_in_force(
        windows: List[Tuple[str, Optional[date], Optional[date]]],
        as_of: date,
    ) -> List[str]:
        """The subset of ``get_member_code_windows`` in force on ``as_of``.

        The Python mirror of ``_current_on``. Kept beside it so the two cannot
        drift: a member with a Paramedic card starting next month must not
        clear the medic seat today by either route.
        """
        return [
            code
            for code, granted, expires in windows
            if (granted is None or granted <= as_of)
            and (expires is None or expires >= as_of)
        ]

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

    #: Stamped on a grant this service derived from a training record, so a
    #: later correction can tell those apart from one an officer entered by
    #: hand. Recomputation only ever removes its own.
    RECORD_SOURCED_NOTE = "Granted from a completed training record."

    @staticmethod
    def _course_expiry(completion, months):
        """When a certification completed on ``completion`` lapses.

        Calendar-month arithmetic, clamped to the length of the landing month
        so a 31st completion on a 24-month cycle does not roll into the next
        month.
        """
        if not completion or not months:
            return None
        month = completion.month - 1 + months
        year = completion.year + month // 12
        month = month % 12 + 1
        return date(year, month, min(completion.day, monthrange(year, month)[1]))

    async def sync_from_training_record(
        self,
        record: Any,
    ) -> Optional[MemberQualification]:
        """Recompute the qualification this record's course confers.

        The writer half of this table. A training officer records the class
        that actually happened; the course already knows what it certifies and
        the record already knows when it was completed and when it expires. So
        the qualification follows from the record rather than being entered a
        second time -- the second entry is the one that gets forgotten, leaving
        a member certified on paper and unqualified in the scheduler.

        A **recompute**, not a one-way grant, because records are corrected. An
        officer who marks a completion failed, cancels it or voids it has said
        the member is not certified, and a grant left standing would keep
        clearing them for an EMT, medic, driver or firefighter seat on the
        strength of a record that no longer says so. So the answer is derived
        from every record that still supports the code, and when none does the
        grant is removed.

        Only grants this service made are removed -- they carry
        ``RECORD_SOURCED_NOTE``. A qualification an officer entered by hand
        says something the records do not know about (a card from a previous
        department, a state reciprocity), and a correction to an unrelated
        record must not silently delete it.

        ``passed is False`` disqualifies a record however its status reads. The
        two are independent columns and the historical-import path defaults
        every row to COMPLETED, so a CSV that records a failure would otherwise
        certify the member for a safety-critical seat.
        """
        from app.models.training import TrainingCourse, TrainingRecord, TrainingStatus

        organization_id = str(record.organization_id)
        user_id = str(record.user_id)

        course_id = getattr(record, "course_id", None)
        if not course_id:
            return None

        result = await self.db.execute(
            select(TrainingCourse.grants_qualification).where(
                TrainingCourse.id == str(course_id),
                TrainingCourse.organization_id == organization_id,
            )
        )
        code = result.scalar_one_or_none()
        if not code or code not in QUALIFICATIONS:
            return None

        # Every record still standing behind this code, across every course
        # that certifies it -- a member may hold EMT from either of two
        # courses, and voiding one must not revoke what the other supports.
        supporting = await self.db.execute(
            select(
                TrainingRecord.completion_date,
                TrainingRecord.expiration_date,
                TrainingCourse.expiration_months,
            )
            .join(TrainingCourse, TrainingRecord.course_id == TrainingCourse.id)
            .where(
                TrainingRecord.user_id == user_id,
                TrainingRecord.organization_id == organization_id,
                TrainingCourse.organization_id == organization_id,
                TrainingCourse.grants_qualification == code,
                TrainingRecord.status == TrainingStatus.COMPLETED,
                or_(
                    TrainingRecord.passed.is_(None),
                    TrainingRecord.passed.is_(True),
                ),
            )
        )
        rows = supporting.all()

        existing = await self.db.execute(
            select(MemberQualification).where(
                MemberQualification.user_id == user_id,
                MemberQualification.organization_id == organization_id,
                MemberQualification.qualification_code == code,
            )
        )
        held = existing.scalar_one_or_none()

        if not rows:
            # Nothing supports it any more. Remove only what this service
            # granted; an officer's own entry is theirs to withdraw.
            if held is not None and held.notes == self.RECORD_SOURCED_NOTE:
                await self.db.delete(held)
                await self.db.flush()
            return None

        # The furthest-out expiry wins, and a record with no expiry at all
        # means the credential does not lapse. An expiry the record does not
        # carry is derived from the course's own cycle: only the create paths
        # populate expiration_date, so a record PATCHed to completed would
        # otherwise confer a permanent card.
        best_completion = None
        best_expiry = None
        never_expires = False
        for completion, expiry, months in rows:
            resolved = expiry or self._course_expiry(completion, months)
            if resolved is None:
                never_expires = True
            elif best_expiry is None or resolved > best_expiry:
                best_expiry = resolved
            if completion and (best_completion is None or completion > best_completion):
                best_completion = completion

        # Do not relabel an officer's own grant as record-sourced. ``grant``
        # overwrites notes, so stamping unconditionally would hand this service
        # permission to delete an entry it did not make the next time a record
        # is voided. A row already carrying the marker, or one being created
        # here, is ours; anything else keeps whatever the officer wrote.
        note = (
            self.RECORD_SOURCED_NOTE
            if held is None or held.notes == self.RECORD_SOURCED_NOTE
            else held.notes
        )

        return await self.grant(
            user_id=user_id,
            organization_id=organization_id,
            qualification_code=code,
            granted_on=best_completion,
            expires_on=None if never_expires else best_expiry,
            notes=note,
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
