"""Possible double credit between an event's finalize and a member's own record.

Owner decision 2026-11-23 ("Double credit: flag, never merge"). Finalizing a
Training event writes each attendee a record keyed by ``source_event_id``. A
member may already hold a record of the same class from another route: an
approved self-report (``TrainingSubmission``) or a record an officer typed in.
Those are never merged into the event's record and never adopted by it; the
pair is flagged for an officer, who keeps both or voids one.

**The match rule, stated conservatively.** A record the member already had is
flagged against the event's record when all of these hold:

* the same member, and the record is not the event's own (no
  ``source_event_id``), is COMPLETED, and did not come from a provider import;
* its completion date is the event's day, on the department's calendar or in
  UTC (the two dates every event-credit lookup accepts);
* it names the same library course as the event's record, **or** its name has
  the same match key as the event's course name or the event's title.

A match key (``app/utils/training_match_key.py``) ignores case, spacing and
punctuation and nothing else: "CPR", "c.p.r." and "C-P-R" match; "CPR
Refresher" and "CPR" do not, nor do two classes that merely share a word. This
is the "close name". Anything looser risks pairing two genuinely different
classes taken the same day, which the owner ruled out.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Iterable, List, Optional, Sequence, Set

from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.training import (
    TrainingCreditDuplicateFlag,
    TrainingRecord,
    TrainingStatus,
    TrainingSubmission,
)
from app.models.user import User
from app.utils.training_match_key import training_match_key

SAME_COURSE = "same_course"
SAME_NAME = "same_name"
KEPT_BOTH = "kept_both"


async def submission_record_ids(
    db: AsyncSession, record_ids: Iterable[str]
) -> Set[str]:
    """The ids among ``record_ids`` that an approved self-report created.

    Such a record is the member's own claim, never the event's: finalize must
    not adopt it, and taking credit back from an event must not void it.
    """
    ids = sorted({str(i) for i in record_ids if i})
    if not ids:
        return set()
    rows = await db.execute(
        select(TrainingSubmission.training_record_id).where(
            TrainingSubmission.training_record_id.in_(ids)
        )
    )
    return {str(row[0]) for row in rows.all() if row[0]}


async def flag_duplicate_credit(
    db: AsyncSession,
    event_records: Sequence[TrainingRecord],
    *,
    event_title: Optional[str],
    dates: Sequence[date],
    organization_id: str,
) -> int:
    """Flag each event record against the member's matching records.

    ``event_records`` must be flushed (they need their ids). A pair already
    flagged, open or resolved, is left as it is, so a re-finalize records
    nothing new; the unique pair constraint backs that against a race. Flushes;
    never commits. Returns how many pairs it flagged.
    """
    day_dates = list(dict.fromkeys(dates))
    if not day_dates:
        return 0
    title_key = training_match_key(event_title)
    flagged = 0
    for record in event_records:
        status = getattr(record.status, "value", record.status)
        if status != TrainingStatus.COMPLETED.value or not record.id:
            continue
        keys = {k for k in (training_match_key(record.course_name), title_key) if k}
        matches: List[ColumnElement[bool]] = []
        if keys:
            matches.append(TrainingRecord.match_key.in_(sorted(keys)))
        if record.course_id:
            matches.append(TrainingRecord.course_id == str(record.course_id))
        if not matches:
            continue
        candidates = (
            (
                await db.execute(
                    select(TrainingRecord).where(
                        TrainingRecord.organization_id == organization_id,
                        TrainingRecord.user_id == str(record.user_id),
                        TrainingRecord.id != str(record.id),
                        TrainingRecord.source_event_id.is_(None),
                        TrainingRecord.status == TrainingStatus.COMPLETED,
                        TrainingRecord.external_provider_id.is_(None),
                        TrainingRecord.completion_date.in_(day_dates),
                        or_(*matches),
                    )
                )
            )
            .scalars()
            .all()
        )
        if not candidates:
            continue
        already = {
            str(row[0])
            for row in (
                await db.execute(
                    select(TrainingCreditDuplicateFlag.other_record_id).where(
                        TrainingCreditDuplicateFlag.event_record_id == str(record.id),
                        TrainingCreditDuplicateFlag.other_record_id.in_(
                            [str(c.id) for c in candidates]
                        ),
                    )
                )
            ).all()
        }
        for other in candidates:
            if str(other.id) in already:
                continue
            same_course = bool(
                record.course_id
                and other.course_id
                and str(record.course_id) == str(other.course_id)
            )
            db.add(
                TrainingCreditDuplicateFlag(
                    organization_id=organization_id,
                    user_id=str(record.user_id),
                    event_record_id=str(record.id),
                    other_record_id=str(other.id),
                    match_reason=SAME_COURSE if same_course else SAME_NAME,
                )
            )
            flagged += 1
    if flagged:
        await db.flush()
    return flagged


def _open_criteria(organization_id: str, event_record, other_record):
    return and_(
        TrainingCreditDuplicateFlag.organization_id == organization_id,
        TrainingCreditDuplicateFlag.resolution.is_(None),
        event_record.status != TrainingStatus.CANCELLED,
        other_record.status != TrainingStatus.CANCELLED,
    )


@dataclass
class DuplicateCreditPair:
    flag: TrainingCreditDuplicateFlag
    member_name: str
    event_record: TrainingRecord
    other_record: TrainingRecord
    other_from_self_report: bool


async def count_open_flags(
    db: AsyncSession, organization_id: str
) -> tuple[int, Optional[datetime]]:
    """Open pairs and the oldest one's detection time."""
    event_record = aliased(TrainingRecord)
    other_record = aliased(TrainingRecord)
    row = (
        await db.execute(
            select(
                func.count(TrainingCreditDuplicateFlag.id),
                func.min(TrainingCreditDuplicateFlag.created_at),
            )
            .join(
                event_record,
                event_record.id == TrainingCreditDuplicateFlag.event_record_id,
            )
            .join(
                other_record,
                other_record.id == TrainingCreditDuplicateFlag.other_record_id,
            )
            .where(_open_criteria(organization_id, event_record, other_record))
        )
    ).one()
    return int(row[0] or 0), row[1]


async def list_open_flags(
    db: AsyncSession, organization_id: str
) -> List[DuplicateCreditPair]:
    """Every open pair, oldest first, with both records and the member."""
    event_record = aliased(TrainingRecord)
    other_record = aliased(TrainingRecord)
    rows = (
        await db.execute(
            select(TrainingCreditDuplicateFlag, event_record, other_record, User)
            .join(
                event_record,
                event_record.id == TrainingCreditDuplicateFlag.event_record_id,
            )
            .join(
                other_record,
                other_record.id == TrainingCreditDuplicateFlag.other_record_id,
            )
            .join(User, User.id == TrainingCreditDuplicateFlag.user_id)
            .where(_open_criteria(organization_id, event_record, other_record))
            .where(User.organization_id == organization_id)
            .order_by(
                TrainingCreditDuplicateFlag.created_at,
                TrainingCreditDuplicateFlag.id,
            )
        )
    ).all()
    from_self_report = await submission_record_ids(db, [str(row[2].id) for row in rows])
    pairs: List[DuplicateCreditPair] = []
    for flag, event_rec, other_rec, user in rows:
        name = user.display_name or (user.username or "Member")
        pairs.append(
            DuplicateCreditPair(
                flag=flag,
                member_name=name,
                event_record=event_rec,
                other_record=other_rec,
                other_from_self_report=str(other_rec.id) in from_self_report,
            )
        )
    return pairs


async def keep_both(
    db: AsyncSession, organization_id: str, flag_id: str, resolved_by: str
) -> Optional[TrainingCreditDuplicateFlag]:
    """Record an officer's decision that both records stand.

    Idempotent: a pair already kept is returned unchanged. ``None`` when the
    flag is not this organization's. Flushes; never commits.
    """
    flag = (
        await db.execute(
            select(TrainingCreditDuplicateFlag)
            .where(TrainingCreditDuplicateFlag.id == str(flag_id))
            .where(TrainingCreditDuplicateFlag.organization_id == organization_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if flag is None:
        return None
    if flag.resolution is None:
        flag.resolution = KEPT_BOTH
        flag.resolved_by = str(resolved_by)
        flag.resolved_at = datetime.now(timezone.utc)
        await db.flush()
    return flag
