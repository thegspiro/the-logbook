"""
The History timeline and "Today in history".

The department timeline shows events plus milestones computed from records
that already exist (owner decision 8): an apparatus entering and leaving
service, a line-of-duty death from the Honor Roll, and the start of a title
the Historian has chosen to show (decision 9, opt-in per title so the
timeline is not cluttered). A milestone is never stored; it is read from its
record each time, so correcting the record corrects the timeline.

What a member sees is decided here, not by the screen (CLAUDE.md pitfall
#29): an entry appears only when its record is published to members, and a
line-of-duty death only when the death date's own visibility allows members
to see it. A title's start is placed only by the date the Historian entered
for that title, never by guessing from the service period around it.

"Today in history" lists day-precise entries whose day and month are today's
on the department's calendar, in earlier years. A 29 February entry shows on
28 February in a year that has no 29th.
"""

import calendar
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Iterable, Optional

from sqlalchemy import and_, extract, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.history import (
    ApparatusDisposition,
    DatePrecision,
    FieldVisibility,
    HistoricalMember,
    HistoricalMemberPeriodTitle,
    HistoricalMemberServicePeriod,
    HistoryApparatus,
    HistoryApparatusDesignation,
    HistoryEvent,
    HistoryEventApparatus,
    HistoryEventMember,
    HistoryTitle,
    PublicationLevel,
)
from app.services.history_records import READABLE_BY_MEMBERS
from app.services.history_service import Viewer, display_name

KIND_EVENT = "event"
KIND_APPARATUS_IN = "apparatus_in"
KIND_APPARATUS_OUT = "apparatus_out"
KIND_LINE_OF_DUTY = "line_of_duty"
KIND_TITLE = "title"
#: A change of unit number. Shown on an apparatus's own timeline only.
KIND_DESIGNATION = "designation"

#: The kinds the department timeline and "Today in history" draw from.
DEPARTMENT_KINDS = frozenset(
    {
        KIND_EVENT,
        KIND_APPARATUS_IN,
        KIND_APPARATUS_OUT,
        KIND_LINE_OF_DUTY,
        KIND_TITLE,
    }
)

_DISPOSITION_TEXT = {
    ApparatusDisposition.SOLD: "sold",
    ApparatusDisposition.TRADED: "traded",
    ApparatusDisposition.SCRAPPED: "scrapped",
    ApparatusDisposition.PRESERVED: "preserved",
    ApparatusDisposition.MUSEUM: "went to a museum",
}

_VISIBLE_TO_MEMBERS = (FieldVisibility.MEMBERS, FieldVisibility.PUBLIC)


@dataclass
class _Window:
    """Which dates to read: a range, a set of calendar days, or both."""

    start: Optional[date] = None
    end: Optional[date] = None
    #: (month, day) pairs; only day-precise dates can match one.
    days: list[tuple[int, int]] = field(default_factory=list)

    def conditions(self, column: Any, precision: Any) -> list[Any]:
        out = [column.is_not(None)]
        if self.start is not None:
            out.append(column >= self.start)
        if self.end is not None:
            out.append(column <= self.end)
        if self.days:
            out.append(precision == DatePrecision.DAY)
            out.append(
                or_(
                    *(
                        and_(
                            extract("month", column) == month,
                            extract("day", column) == day,
                        )
                        for month, day in self.days
                    )
                )
            )
        return out


def _entry(
    *,
    kind: str,
    when: date,
    precision: DatePrecision,
    circa: bool,
    label: str,
    record_type: str,
    record_id: str,
    publication_level: PublicationLevel,
    key_suffix: str = "",
    end_date: Optional[date] = None,
    end_precision: Optional[DatePrecision] = None,
    end_circa: bool = False,
    detail: Optional[str] = None,
    event_type_id: Optional[str] = None,
    event_type_name: Optional[str] = None,
) -> dict[str, Any]:
    return {
        "key": f"{kind}:{record_id}{key_suffix}",
        "kind": kind,
        "date": when,
        "precision": precision,
        "circa": circa,
        "end_date": end_date,
        "end_precision": end_precision,
        "end_circa": end_circa,
        "label": label,
        "detail": detail,
        "record_type": record_type,
        "record_id": record_id,
        "event_type_id": event_type_id,
        "event_type_name": event_type_name,
        "publication_level": publication_level,
    }


def _ordered(entries: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(entries, key=lambda e: (e["date"], e["kind"], e["label"], e["key"]))


def today_days(today: date) -> list[tuple[int, int]]:
    """The calendar days "Today in history" matches: today's, plus 29
    February on 28 February in a year with no 29th."""
    days = [(today.month, today.day)]
    if (today.month, today.day) == (2, 28) and not calendar.isleap(today.year):
        days.append((2, 29))
    return days


class HistoryTimelineService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Readers, one per kind
    # ------------------------------------------------------------------

    @staticmethod
    def _published(viewer: Viewer, column: Any) -> list[Any]:
        return [] if viewer.can_view_archive else [column.in_(READABLE_BY_MEMBERS)]

    async def _events(
        self,
        viewer: Viewer,
        window: _Window,
        *,
        event_type_id: Optional[str] = None,
        member_id: Optional[str] = None,
        apparatus_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        conditions = [
            HistoryEvent.organization_id == viewer.organization_id,
            *self._published(viewer, HistoryEvent.publication_level),
            *window.conditions(HistoryEvent.start_date, HistoryEvent.start_precision),
        ]
        if event_type_id:
            conditions.append(HistoryEvent.event_type_id == str(event_type_id))
        if member_id:
            conditions.append(
                HistoryEvent.id.in_(
                    select(HistoryEventMember.event_id).where(
                        HistoryEventMember.member_id == str(member_id)
                    )
                )
            )
        if apparatus_id:
            conditions.append(
                HistoryEvent.id.in_(
                    select(HistoryEventApparatus.event_id).where(
                        HistoryEventApparatus.apparatus_id == str(apparatus_id)
                    )
                )
            )
        result = await self.db.execute(
            select(HistoryEvent)
            .options(selectinload(HistoryEvent.event_type))
            .where(*conditions)
        )
        return [
            _entry(
                kind=KIND_EVENT,
                when=item.start_date,
                precision=item.start_precision,
                circa=item.start_circa,
                end_date=item.end_date,
                end_precision=item.end_precision if item.end_date else None,
                end_circa=item.end_circa,
                label=item.title,
                detail=item.place,
                record_type="event",
                record_id=item.id,
                event_type_id=item.event_type_id,
                event_type_name=item.event_type.name if item.event_type else None,
                publication_level=item.publication_level,
            )
            for item in result.scalars().all()
        ]

    async def _apparatus(
        self,
        viewer: Viewer,
        window: _Window,
        kinds: frozenset[str],
        *,
        apparatus_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        base = [
            HistoryApparatus.organization_id == viewer.organization_id,
            *self._published(viewer, HistoryApparatus.publication_level),
        ]
        if apparatus_id:
            base.append(HistoryApparatus.id == str(apparatus_id))
        if KIND_APPARATUS_IN in kinds:
            result = await self.db.execute(
                select(HistoryApparatus).where(
                    *base,
                    *window.conditions(
                        HistoryApparatus.in_service_date,
                        HistoryApparatus.in_service_precision,
                    ),
                )
            )
            for item in result.scalars().all():
                # The window already excludes undated rows; the check keeps
                # the type honest.
                if item.in_service_date is None:
                    continue
                entries.append(
                    _entry(
                        kind=KIND_APPARATUS_IN,
                        when=item.in_service_date,
                        precision=item.in_service_precision,
                        circa=item.in_service_circa,
                        label=f"{item.name} entered service",
                        record_type="apparatus",
                        record_id=item.id,
                        publication_level=item.publication_level,
                    )
                )
        if KIND_APPARATUS_OUT in kinds:
            result = await self.db.execute(
                select(HistoryApparatus).where(
                    *base,
                    *window.conditions(
                        HistoryApparatus.out_of_service_date,
                        HistoryApparatus.out_of_service_precision,
                    ),
                )
            )
            for item in result.scalars().all():
                if item.out_of_service_date is None:
                    continue
                entries.append(
                    _entry(
                        kind=KIND_APPARATUS_OUT,
                        when=item.out_of_service_date,
                        precision=item.out_of_service_precision,
                        circa=item.out_of_service_circa,
                        label=f"{item.name} left service",
                        detail=_DISPOSITION_TEXT.get(item.disposition),
                        record_type="apparatus",
                        record_id=item.id,
                        publication_level=item.publication_level,
                    )
                )
        if KIND_DESIGNATION in kinds:
            designation = HistoryApparatusDesignation
            pairs = await self.db.execute(
                select(designation, HistoryApparatus)
                .join(HistoryApparatus, HistoryApparatus.id == designation.apparatus_id)
                .options(selectinload(designation.station))
                .where(
                    *base,
                    *window.conditions(
                        designation.start_date, designation.start_precision
                    ),
                )
            )
            for row, item in pairs.all():
                if row.start_date is None:
                    continue
                entries.append(
                    _entry(
                        kind=KIND_DESIGNATION,
                        when=row.start_date,
                        precision=row.start_precision,
                        circa=row.start_circa,
                        label=f"Became {row.designation}",
                        detail=row.station.name if row.station else None,
                        record_type="apparatus",
                        record_id=item.id,
                        key_suffix=f":{row.id}",
                        publication_level=item.publication_level,
                    )
                )
        return entries

    async def _line_of_duty(
        self, viewer: Viewer, window: _Window, *, member_id: Optional[str] = None
    ) -> list[dict[str, Any]]:
        conditions = [
            HistoricalMember.organization_id == viewer.organization_id,
            HistoricalMember.is_line_of_duty_death.is_(True),
            *self._published(viewer, HistoricalMember.publication_level),
            *window.conditions(
                HistoricalMember.death_date, HistoricalMember.death_date_precision
            ),
        ]
        if not viewer.can_view_archive:
            # The death date has a visibility of its own; a member never
            # learns it through the timeline when the record hides it.
            conditions.append(
                HistoricalMember.death_date_visibility.in_(_VISIBLE_TO_MEMBERS)
            )
        if member_id:
            conditions.append(HistoricalMember.id == str(member_id))
        result = await self.db.execute(select(HistoricalMember).where(*conditions))
        return [
            _entry(
                kind=KIND_LINE_OF_DUTY,
                when=person.death_date,
                precision=person.death_date_precision,
                circa=person.death_date_circa,
                label=f"{display_name(person)} died in the line of duty",
                record_type="member",
                record_id=person.id,
                publication_level=person.publication_level,
            )
            for person in result.scalars().all()
            if person.death_date is not None
        ]

    async def _titles(
        self,
        viewer: Viewer,
        window: _Window,
        *,
        member_id: Optional[str] = None,
        flagged_only: bool = True,
    ) -> list[dict[str, Any]]:
        held = HistoricalMemberPeriodTitle
        period = HistoricalMemberServicePeriod
        conditions = [
            HistoricalMember.organization_id == viewer.organization_id,
            HistoryTitle.organization_id == viewer.organization_id,
            *self._published(viewer, HistoricalMember.publication_level),
            *window.conditions(held.held_from_date, held.held_from_precision),
        ]
        if flagged_only:
            conditions.append(HistoryTitle.show_on_timeline.is_(True))
        if member_id:
            conditions.append(HistoricalMember.id == str(member_id))
        result = await self.db.execute(
            select(held, HistoryTitle, HistoricalMember)
            .join(period, period.id == held.period_id)
            .join(HistoricalMember, HistoricalMember.id == period.member_id)
            .join(HistoryTitle, HistoryTitle.id == held.title_id)
            .where(*conditions)
        )
        return [
            _entry(
                kind=KIND_TITLE,
                when=row.held_from_date,
                precision=row.held_from_precision,
                circa=row.held_from_circa,
                end_date=row.held_to_date,
                end_precision=row.held_to_precision if row.held_to_date else None,
                end_circa=row.held_to_circa,
                label=f"{display_name(person)} became {title.name}",
                record_type="member",
                record_id=person.id,
                key_suffix=f":{row.period_id}:{title.id}",
                publication_level=person.publication_level,
            )
            for row, title, person in result.all()
            if row.held_from_date is not None
        ]

    # ------------------------------------------------------------------
    # The department timeline
    # ------------------------------------------------------------------

    async def _department(
        self,
        viewer: Viewer,
        window: _Window,
        kinds: frozenset[str],
        event_type_id: Optional[str],
    ) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        if KIND_EVENT in kinds:
            entries += await self._events(viewer, window, event_type_id=event_type_id)
        if kinds & {KIND_APPARATUS_IN, KIND_APPARATUS_OUT}:
            entries += await self._apparatus(viewer, window, kinds)
        if KIND_LINE_OF_DUTY in kinds:
            entries += await self._line_of_duty(viewer, window)
        if KIND_TITLE in kinds:
            entries += await self._titles(viewer, window)
        return entries

    @staticmethod
    def _kinds(kinds: Optional[Iterable[str]]) -> frozenset[str]:
        if kinds is None:
            return DEPARTMENT_KINDS
        return frozenset(kinds) & DEPARTMENT_KINDS

    async def decades(
        self,
        viewer: Viewer,
        *,
        kinds: Optional[Iterable[str]] = None,
        event_type_id: Optional[str] = None,
    ) -> list[dict[str, int]]:
        """How many entries each decade holds, oldest first, so the page can
        load one decade at a time."""
        entries = await self._department(
            viewer, _Window(), self._kinds(kinds), event_type_id
        )
        counts: dict[int, int] = {}
        for entry in entries:
            decade = entry["date"].year // 10 * 10
            counts[decade] = counts.get(decade, 0) + 1
        return [{"decade": d, "count": counts[d]} for d in sorted(counts)]

    async def decade(
        self,
        viewer: Viewer,
        decade: int,
        *,
        kinds: Optional[Iterable[str]] = None,
        event_type_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        window = _Window(start=date(decade, 1, 1), end=date(decade + 9, 12, 31))
        return _ordered(
            await self._department(viewer, window, self._kinds(kinds), event_type_id)
        )

    async def today_in_history(
        self, viewer: Viewer, today: date
    ) -> list[dict[str, Any]]:
        """Day-precise entries on today's day and month, in earlier years,
        oldest first. *today* is the department's date, chosen by the
        caller."""
        window = _Window(end=date(today.year - 1, 12, 31), days=today_days(today))
        return _ordered(await self._department(viewer, window, DEPARTMENT_KINDS, None))

    # ------------------------------------------------------------------
    # A person's and an apparatus's own timelines
    # ------------------------------------------------------------------

    async def for_person(
        self, viewer: Viewer, person: HistoricalMember
    ) -> list[dict[str, Any]]:
        """The events a person took part in, their line-of-duty death, and
        every title they held with a date entered. On their own page every
        dated title belongs, not only those shown on the department
        timeline."""
        window = _Window()
        entries = await self._events(viewer, window, member_id=person.id)
        entries += await self._line_of_duty(viewer, window, member_id=person.id)
        entries += await self._titles(
            viewer, window, member_id=person.id, flagged_only=False
        )
        return _ordered(entries)

    async def for_apparatus(
        self, viewer: Viewer, apparatus: HistoryApparatus
    ) -> list[dict[str, Any]]:
        """An apparatus's service, its changes of unit number and the events
        it took part in."""
        window = _Window()
        entries = await self._events(viewer, window, apparatus_id=apparatus.id)
        entries += await self._apparatus(
            viewer,
            window,
            frozenset({KIND_APPARATUS_IN, KIND_APPARATUS_OUT, KIND_DESIGNATION}),
            apparatus_id=apparatus.id,
        )
        return _ordered(entries)
