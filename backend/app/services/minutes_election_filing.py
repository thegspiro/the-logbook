"""Filing a closed election's result with the minutes of its meeting.

A manager can always import a closed election into a set of minutes by hand
(``MinutesRecordService.capture_election_result``). This module does the same
thing without being asked, at the two moments it becomes possible:

* an election closes, and minutes for the meeting it was held at already exist;
* minutes for that meeting are created after an election has closed.

"The meeting it was held at" is the election's event or its meeting record,
the same link the manual picker uses to list an election first. Filing goes
through ``capture_election_result``, so an automatic filing is the manual one:
a draft takes it as content, circulated or adopted minutes take it as a
permanent addendum, and the unique pair (minutes, election) means a result is
never filed twice.

Nothing here may fail the caller. The election has already closed (or the
minutes already exist) and been committed; a problem filing its result is
logged and left for a manager to import by hand, never raised into the close or
the creation that triggered it. A department can switch the behaviour off
(``auto_file_election_results``).
"""

from typing import Optional

from loguru import logger
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election, ElectionStatus
from app.models.minute import MeetingMinutes
from app.utils.minutes_settings import load_auto_file_election_results


async def _file(
    db: AsyncSession,
    minutes_id: str,
    election_id: str,
    organization_id: str,
    captured_by: Optional[str],
) -> bool:
    """Try to file one result; False when it was already there or not fileable."""
    # Imported here: the record service imports MinuteService, which imports
    # this module, so a top-level import would be circular.
    from app.services.minutes_record_service import MinutesRecordService

    try:
        row = await MinutesRecordService(db).capture_election_result(
            minutes_id, organization_id, election_id, captured_by
        )
    except ValueError as exc:
        # Already filed with these minutes, or not closed: nothing to do.
        logger.info(
            f"Election result not auto-filed | election={election_id} "
            f"minutes={minutes_id} reason={exc}"
        )
        await db.rollback()
        return False
    except Exception:
        logger.exception(
            f"Election result auto-filing failed | election={election_id} "
            f"minutes={minutes_id}"
        )
        await db.rollback()
        return False
    if row is not None:
        logger.info(
            f"Election result auto-filed | election={election_id} "
            f"minutes={minutes_id} addendum={row.is_addendum}"
        )
    return row is not None


async def file_closed_election(
    db: AsyncSession, election: Election, closed_by: Optional[str]
) -> None:
    """File a just-closed election with its meeting's minutes, if they exist.

    When a meeting has more than one set of minutes the newest one takes it.
    """
    # Plain values, read before anything can roll the session back and expire
    # the election row.
    election_id = str(election.id)
    organization_id = str(election.organization_id)
    event_id = election.event_id
    meeting_id = election.meeting_id
    try:
        if election.status != ElectionStatus.CLOSED:
            return
        if not await load_auto_file_election_results(db, organization_id):
            return
        links = []
        if event_id:
            links.append(MeetingMinutes.event_id == event_id)
        if meeting_id:
            links.append(MeetingMinutes.meeting_id == meeting_id)
        if not links:
            return
        minutes_id = (
            await db.execute(
                select(MeetingMinutes.id)
                .where(
                    MeetingMinutes.organization_id == organization_id,
                    or_(*links),
                )
                .order_by(MeetingMinutes.created_at.desc(), MeetingMinutes.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if minutes_id is None:
            return
        await _file(db, minutes_id, election_id, organization_id, closed_by)
    except Exception:
        logger.exception(f"Election result auto-filing failed | election={election_id}")
        await db.rollback()


async def file_waiting_elections(
    db: AsyncSession, minutes: MeetingMinutes, created_by: Optional[str]
) -> None:
    """File the closed elections already held at this meeting into new minutes."""
    minutes_id = str(minutes.id)
    organization_id = str(minutes.organization_id)
    event_id = minutes.event_id
    meeting_id = minutes.meeting_id
    try:
        links = []
        if event_id:
            links.append(Election.event_id == event_id)
        if meeting_id:
            links.append(Election.meeting_id == meeting_id)
        if not links:
            return
        if not await load_auto_file_election_results(db, organization_id):
            return
        elections = (
            (
                await db.execute(
                    select(Election)
                    .where(
                        Election.organization_id == organization_id,
                        Election.status == ElectionStatus.CLOSED.value,
                        or_(*links),
                    )
                    .order_by(Election.closed_at, Election.id)
                )
            )
            .scalars()
            .all()
        )
        # Ids first: a failed filing rolls the session back, which expires every
        # row still held.
        for election_id in [str(e.id) for e in elections]:
            await _file(db, minutes_id, election_id, organization_id, created_by)
    except Exception:
        logger.exception(
            f"Waiting election results could not be filed | minutes={minutes_id}"
        )
        await db.rollback()
