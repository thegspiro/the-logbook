"""
Historical staffing: writing the roster.

``historical_staffing_plan`` decides what each event and seat becomes; this
service resolves the members, shows what a commit would write, lets the
reviewer assign members to unfilled seats, and writes:

* a **shift** fills the department's existing shift for that date and unit
  where there is one (the hours import made most of them), or a new one. Each
  seat becomes that member's crew seat on it. A member the hours import
  already put on the shift keeps that assignment, re-seated in the seat the
  roster names. No hours or attendance are written: the roster is who was
  scheduled, and the hours file credited the time.
* an **event** becomes a calendar event. Attendance seats check their members
  in; role seats go on the event's outreach signup sheet in that role. An
  upcoming event is written as scheduled, with nobody checked in.

The roster and the hours file share no id, so each seat is also paired with
the hours entry of the same member whose time it overlaps most
(``historical_hours_match``). A shift seat goes onto that entry's shift, so the
member's history shows the seat beside the hours and the calls. An event seat
writes its title there only when the title is a crew seat (owner decision
2026-11-21). A position the commit changes on an existing seat is recorded in
the import's results, so undoing the step puts it back.

Every record is entered in the ``imported_source_records`` ledger under the
import's source system, so a second commit writes nothing twice (pitfall #36).
"""

import copy
import html
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.event import Event, EventRSVP, EventType, RSVPStatus
from app.models.historical_import import (
    HistoricalImport,
    ImportedRecordKind,
    ImportedSourceRecord,
)
from app.models.training import (
    AssignmentStatus,
    BasicApparatus,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
    ShiftStatus,
)
from app.services import historical_hours_match as hours_match
from app.services import historical_staffing_engine as engine
from app.services import historical_staffing_mapping as mapping_rules
from app.services import historical_staffing_plan as plan_rules
from app.services import shift_history_import_engine as shift_engine
from app.services.historical_import_service import (
    HistoricalImportNotReady,
    HistoricalImportService,
    _member_views,
)
from app.services.historical_staffing_service import HistoricalStaffingService

_LEDGER_CHUNK = 1_000
_FLUSH_EVERY = 200
# An outreach seat's crew position; the role says what the member did.
_OUTREACH_SEAT = "volunteer"
_TITLE_MAX = 200
# How many sign-ups and hours entries that pair with nothing the preview names;
# the counts are always whole.
_MATCH_EXAMPLES = 25
_LOCATION_MAX = 300


class HistoricalStaffingCommitService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.imports = HistoricalImportService(db)
        self.staffing = HistoricalStaffingService(db)

    # ------------------------------------------------------------------
    # Planning
    # ------------------------------------------------------------------

    async def _units(self, organization_id: str) -> List[Tuple[str, str]]:
        rows = (
            await self.db.execute(
                select(
                    BasicApparatus.id, BasicApparatus.unit_number, BasicApparatus.name
                ).where(BasicApparatus.organization_id == str(organization_id))
            )
        ).all()
        units: List[Tuple[str, str]] = []
        for unit_id, number, name in rows:
            units.extend((unit_id, n) for n in (number, name) if n)
        return units

    async def _plan(
        self, record: HistoricalImport
    ) -> Tuple[plan_rules.Plan, mapping_rules.Decisions, date]:
        joined = await self.staffing._joined(record)
        decisions = mapping_rules.Decisions.from_stored(record.staffing_settings)
        today = datetime.now(ZoneInfo(record.timezone)).date()
        units = await self._units(record.organization_id)
        plan = plan_rules.build_plan(
            joined,
            decisions,
            decisions.seat_members,
            [name for _, name in units],
            today,
            include_unstaffed=decisions.include_unstaffed,
        )
        return plan, decisions, today

    async def _resolve_members(
        self, record: HistoricalImport, plan: plan_rules.Plan
    ) -> Dict[str, shift_engine.MemberResolution]:
        """Who each filled seat names, once per distinct member, by the same
        decisions the import's other steps use."""
        directory = await self.imports.shift_imports.member_directory(
            record.organization_id
        )
        saved = await self.imports.shift_imports.saved_member_mappings(
            record.organization_id
        )
        decisions = (
            record.member_mappings if isinstance(record.member_mappings, dict) else {}
        )
        resolutions: Dict[str, shift_engine.MemberResolution] = {}
        for planned in plan.events:
            for seat in planned.seats:
                if seat.assigned_user_id:
                    continue
                identity = shift_engine.identity_from_values(seat.seat.member)
                resolution = resolutions.get(identity.key)
                if resolution is None:
                    mapping = decisions.get(identity.key, saved.get(identity.key))
                    resolution = shift_engine.resolve_member(
                        identity, directory, mapping
                    )
                    resolutions[identity.key] = resolution
                resolution.row_ids.append(str(seat.seat.line_number))
        return resolutions

    async def preview(self, organization_id: str, import_id: str) -> Dict[str, Any]:
        """What a commit would write, what it leaves out and why, and the
        members still to decide."""
        record = await self.imports.get(organization_id, import_id)
        plan, decisions, _ = await self._plan(record)
        resolutions = await self._resolve_members(record, plan)
        members = _member_views(resolutions)
        undecided = [r for r in resolutions.values() if r.ref is None]
        counts = plan.counts()
        return {
            "counts": counts,
            "hours_match": await self._hours_match_view(record, plan, resolutions),
            "skipped": dict(plan.skipped),
            "unfilled_seats": len(plan.unfilled),
            "include_unstaffed": decisions.include_unstaffed,
            "members": members,
            "member_options": await self.imports._member_options(
                record.organization_id
            ),
            "can_commit": bool(plan.events) and not undecided,
            "result": (record.results or {}).get("staffing"),
        }

    async def _hours_match_view(
        self,
        record: HistoricalImport,
        plan: plan_rules.Plan,
        resolutions: Mapping[str, shift_engine.MemberResolution],
    ) -> Dict[str, Any]:
        """How the roster pairs with the hours already imported, and the first
        of each side that pairs with nothing, for the reviewer to check."""

        def member_of(seat: plan_rules.PlannedSeat) -> Optional[str]:
            if seat.assigned_user_id:
                return seat.assigned_user_id
            identity = shift_engine.identity_from_values(seat.seat.member)
            resolution = resolutions.get(identity.key)
            ref = resolution.ref if resolution is not None else None
            # A member the commit would create has no hours yet.
            return ref if ref and not ref.startswith("new:") else None

        pairing, event_of = await self._pair_with_hours(record, plan, member_of)
        directory = {
            m.id: m.display_name
            for m in await self.imports.shift_imports.member_directory(
                record.organization_id, include_removed=True
            )
        }
        seats = {
            plan_rules.seat_ledger_id(seat.seat): seat
            for planned in plan.events
            for seat in planned.seats
        }
        missing: List[Dict[str, Any]] = []
        for key in pairing.unmatched_signups[:_MATCH_EXAMPLES]:
            planned = event_of[key]
            seat = seats[key]
            user_id = member_of(seat)
            missing.append(
                {
                    "date": (
                        planned.event.day.isoformat() if planned.event.day else None
                    ),
                    "activity": html.unescape(planned.event.activity),
                    "title": seat.seat.title,
                    "member": directory.get(user_id or "", ""),
                }
            )
        unclaimed = [
            {
                "date": e.day.isoformat() if e.day else None,
                "start": e.start.isoformat(),
                "end": e.end.isoformat(),
                "member": directory.get(e.user_id, ""),
            }
            for e in pairing.unmatched_hours[:_MATCH_EXAMPLES]
        ]
        return {
            "matched": len(pairing.matched),
            "signups_without_hours": len(pairing.unmatched_signups),
            "hours_without_signup": len(pairing.unmatched_hours),
            "signups_without_hours_examples": missing,
            "hours_without_signup_examples": unclaimed,
        }

    # ------------------------------------------------------------------
    # Reviewer's choices
    # ------------------------------------------------------------------

    async def set_include_unstaffed(
        self, organization_id: str, import_id: str, include: bool
    ) -> None:
        record = await self.imports.get(organization_id, import_id, for_update=True)
        decisions = mapping_rules.Decisions.from_stored(record.staffing_settings)
        decisions.include_unstaffed = bool(include)
        record.staffing_settings = decisions.to_stored()
        await self.db.commit()

    async def update_members(
        self,
        organization_id: str,
        import_id: str,
        members: Mapping[str, Optional[Mapping[str, Any]]],
    ) -> None:
        """Who a member the roster names is; shared with the import's other
        steps, so a decision made here holds there too."""
        record = await self.imports.get(organization_id, import_id, for_update=True)
        await self.imports.update_member_mappings(record, members)

    async def unfilled_view(
        self,
        organization_id: str,
        import_id: str,
        *,
        offset: int = 0,
        limit: int = 50,
    ) -> Dict[str, Any]:
        """The unfilled seats the import would write if someone held them,
        newest first, each with the member assigned to it, if any."""
        record = await self.imports.get(organization_id, import_id)
        plan, decisions, _ = await self._plan(record)
        seats, roles, _ = await self.staffing.vocabulary(record.organization_id)
        labels = {c.value: c.label for c in seats + roles}
        labels[mapping_rules.ATTENDANCE] = "Attendance"
        ordered = sorted(
            plan.unfilled,
            key=lambda item: (item[0].day or date.min, item[1].line_number),
            reverse=True,
        )
        return {
            "items": [
                {
                    "line_number": seat.line_number,
                    "date": event.day,
                    "activity": html.unescape(event.activity),
                    "title": seat.title,
                    "maps_to": labels.get(value, value),
                    "required": seat.required,
                    "assigned_user_id": decisions.seat_members.get(
                        str(seat.line_number)
                    ),
                }
                for event, seat, value in ordered[offset : offset + limit]
            ],
            "total": len(ordered),
            "assigned": len(decisions.seat_members),
            "member_options": await self.imports._member_options(
                record.organization_id
            ),
        }

    async def assign_unfilled(
        self,
        organization_id: str,
        import_id: str,
        assignments: Mapping[str, Optional[str]],
    ) -> None:
        """Assign members to unfilled seats by line; a null leaves the seat
        empty again, so it is skipped."""
        record = await self.imports.get(organization_id, import_id, for_update=True)
        directory = {
            m.id
            for m in await self.imports.shift_imports.member_directory(
                record.organization_id
            )
        }
        decisions = mapping_rules.Decisions.from_stored(record.staffing_settings)
        for line, user_id in assignments.items():
            if not str(line).isdigit():
                raise ValueError("A seat is named by its line number.")
            if not user_id:
                decisions.seat_members.pop(str(line), None)
                continue
            # Only a member of this department (pitfall #14c).
            if user_id not in directory:
                raise ValueError("Choose a member of this department.")
            decisions.seat_members[str(line)] = str(user_id)
        record.staffing_settings = decisions.to_stored()
        await self.db.commit()

    # ------------------------------------------------------------------
    # Writing
    # ------------------------------------------------------------------

    async def _ledger(
        self, record: HistoricalImport, source_ids: Sequence[str]
    ) -> Dict[str, str]:
        found: Dict[str, str] = {}
        unique = list(dict.fromkeys(source_ids))
        for start in range(0, len(unique), _LEDGER_CHUNK):
            chunk = unique[start : start + _LEDGER_CHUNK]
            rows = await self.db.execute(
                select(
                    ImportedSourceRecord.source_id, ImportedSourceRecord.record_id
                ).where(
                    ImportedSourceRecord.organization_id == record.organization_id,
                    ImportedSourceRecord.source_system == record.source_system,
                    ImportedSourceRecord.source_id.in_(chunk),
                )
            )
            found.update({sid: rid for sid, rid in rows.all()})
        return found

    def _enter(
        self,
        record: HistoricalImport,
        ledger: Dict[str, str],
        source_id: str,
        kind: ImportedRecordKind,
        record_id: str,
    ) -> None:
        ledger[source_id] = record_id
        self.db.add(
            ImportedSourceRecord(
                id=generate_uuid(),
                organization_id=record.organization_id,
                source_system=record.source_system,
                source_id=source_id,
                record_kind=kind.value,
                record_id=record_id,
                historical_import_id=record.id,
            )
        )

    @staticmethod
    def _span(event: engine.StaffingEvent, tz: ZoneInfo) -> Tuple[datetime, datetime]:
        """The event's start and end in UTC. A missing start reads as
        midnight, a missing end as the start; an end at or before the start
        runs into the next day."""
        day = event.day or date.min
        start_clock = event.start or time(0)
        end_clock = event.end or start_clock
        start = datetime.combine(day, start_clock).replace(tzinfo=tz)
        end = datetime.combine(day, end_clock).replace(tzinfo=tz)
        if event.start is not None and event.end is not None and end <= start:
            end += timedelta(days=1)
        if end <= start:
            end = start + timedelta(hours=1)
        return start.astimezone(timezone.utc), end.astimezone(timezone.utc)

    async def _shifts_by_day(
        self, organization_id: str, days: Sequence[date]
    ) -> Dict[Tuple[date, str], List[Shift]]:
        """The department's duty shifts on these dates, by date and unit."""
        found: Dict[Tuple[date, str], List[Shift]] = defaultdict(list)
        if not days:
            return found
        rows = await self.db.execute(
            select(Shift).where(
                Shift.organization_id == str(organization_id),
                Shift.shift_date >= min(days),
                Shift.shift_date <= max(days),
                Shift.is_outreach.is_(False),
                Shift.apparatus_id.isnot(None),
            )
        )
        wanted = set(days)
        for shift in rows.scalars().all():
            if shift.shift_date in wanted:
                found[(shift.shift_date, str(shift.apparatus_id))].append(shift)
        return found

    async def _assignments(self, shift_id: str) -> Dict[str, ShiftAssignment]:
        rows = await self.db.execute(
            select(ShiftAssignment).where(ShiftAssignment.shift_id == shift_id)
        )
        return {str(a.user_id): a for a in rows.scalars().all()}

    # ------------------------------------------------------------------
    # Pairing the roster with the hours
    # ------------------------------------------------------------------

    async def _hours_entries(
        self, organization_id: str, start: datetime, end: datetime
    ) -> List[hours_match.HoursEntry]:
        """Every member's attendance on the department's duty shifts that
        starts within this span: the hours side of the pairing."""
        rows = await self.db.execute(
            select(
                ShiftAttendance.id,
                ShiftAttendance.shift_id,
                ShiftAttendance.user_id,
                ShiftAttendance.checked_in_at,
                ShiftAttendance.checked_out_at,
                ShiftAttendance.duration_minutes,
                Shift.shift_date,
            )
            .join(Shift, Shift.id == ShiftAttendance.shift_id)
            .where(
                Shift.organization_id == str(organization_id),
                Shift.is_outreach.is_(False),
                ShiftAttendance.checked_in_at.isnot(None),
                ShiftAttendance.checked_in_at >= start,
                ShiftAttendance.checked_in_at < end,
            )
        )
        entries: List[hours_match.HoursEntry] = []
        for att_id, shift_id, user_id, clock_in, clock_out, minutes, day in rows:
            if clock_in is None:
                continue
            began = _aware(clock_in)
            if clock_out is not None:
                ended = _aware(clock_out)
            elif minutes:
                ended = began + timedelta(minutes=int(minutes))
            else:
                continue
            if ended <= began:
                continue
            entries.append(
                hours_match.HoursEntry(
                    attendance_id=str(att_id),
                    shift_id=str(shift_id),
                    user_id=str(user_id),
                    start=began,
                    end=ended,
                    day=day,
                )
            )
        return entries

    async def _pair_with_hours(
        self,
        record: HistoricalImport,
        plan: plan_rules.Plan,
        member_of: Any,
    ) -> Tuple[hours_match.HoursMatch, Dict[str, plan_rules.PlannedEvent]]:
        """Pair every dated seat whose member is known with that member's
        hours. Returns the pairing and each sign-up's event, by seat key."""
        tz = ZoneInfo(record.timezone)
        signups: List[hours_match.SignUp] = []
        event_of: Dict[str, plan_rules.PlannedEvent] = {}
        spans: List[Tuple[datetime, datetime]] = []
        days: set[date] = set()
        for planned in plan.events:
            if planned.event.day is None or planned.upcoming:
                continue
            days.add(planned.event.day)
            start, end = self._span(planned.event, tz)
            spans.append((start, end))
            for seat in planned.seats:
                user_id = member_of(seat)
                if not user_id:
                    continue
                key = plan_rules.seat_ledger_id(seat.seat)
                signups.append(hours_match.SignUp(key, user_id, start, end))
                event_of[key] = planned
        if not spans:
            return hours_match.match([], []), event_of
        # A day either side: an hours entry clocked in before the roster's
        # start, or an overnight that ran past its last day, still counts.
        window_start = min(s for s, _ in spans) - timedelta(days=1)
        window_end = max(e for _, e in spans) + timedelta(days=1)
        entries = await self._hours_entries(
            record.organization_id, window_start, window_end
        )
        pairing = hours_match.match(signups, entries)
        # Only a day the roster covers can be missing a sign-up; the window's
        # margin would otherwise count the days either side of it.
        pairing.unmatched_hours = [e for e in pairing.unmatched_hours if e.day in days]
        return pairing, event_of

    async def _department_seats(self, organization_id: str) -> List[str]:
        units = await self.imports.shift_imports._own_units(organization_id)
        return sorted({seat for unit in units for seat in unit.seats})

    @staticmethod
    def _reseat(
        assignment: ShiftAssignment,
        value: str,
        reseated: Dict[str, Dict[str, Optional[str]]],
        counts: Dict[str, int],
    ) -> None:
        """Put an existing seat in the roster's position, remembering the one
        it had so an undo can put that back."""
        current = getattr(assignment.position, "value", assignment.position)
        if current == value:
            counts["already_on_shift"] += 1
            return
        entry = reseated.setdefault(str(assignment.id), {"from": current})
        entry["to"] = value
        assignment.position = value
        counts["seats_updated"] += 1

    async def _place_on_hours(
        self,
        record: HistoricalImport,
        entry: hours_match.HoursEntry,
        user_id: str,
        value: Optional[str],
        ledger: Dict[str, str],
        ledger_key: str,
        committed_by: str,
        now: datetime,
        note: str,
        held_by_shift: Dict[str, Dict[str, ShiftAssignment]],
        reseated: Dict[str, Dict[str, Optional[str]]],
        counts: Dict[str, int],
    ) -> None:
        """Seat the member on the shift their hours were credited to. With no
        ``value`` the pairing is only counted: the sign-up named no crew
        seat."""
        counts["seats_matched_to_hours"] += 1
        if value is None:
            counts["matched_role_not_a_seat"] += 1
            return
        held = held_by_shift.get(entry.shift_id)
        if held is None:
            held = await self._assignments(entry.shift_id)
            held_by_shift[entry.shift_id] = held
        assignment = held.get(user_id)
        if assignment is None:
            assignment = ShiftAssignment(
                id=generate_uuid(),
                organization_id=record.organization_id,
                shift_id=entry.shift_id,
                user_id=user_id,
                position=value,
                assignment_status=AssignmentStatus.CONFIRMED,
                assigned_by=str(committed_by),
                confirmed_at=now,
                notes=note,
            )
            self.db.add(assignment)
            held[user_id] = assignment
            counts["seats_added"] += 1
        else:
            self._reseat(assignment, value, reseated, counts)
        self._enter(
            record,
            ledger,
            ledger_key,
            ImportedRecordKind.SHIFT_ASSIGNMENT,
            assignment.id,
        )

    async def commit(
        self, organization_id: str, import_id: str, committed_by: str
    ) -> Dict[str, int]:
        """Write the roster. Safe to run again: anything in the ledger is
        found, not written twice."""
        record = await self.imports.get(organization_id, import_id, for_update=True)
        plan, _, _ = await self._plan(record)
        if not plan.events:
            raise HistoricalImportNotReady(
                "Nothing to write yet: decide which activities are shifts or "
                "events and what their seat titles mean."
            )
        resolutions = await self._resolve_members(record, plan)
        unresolved = [r for r in resolutions.values() if r.ref is None]
        if unresolved:
            raise HistoricalImportNotReady(
                f"{len(unresolved)} member(s) in the roster still need a decision."
            )

        org_id = record.organization_id
        tz = ZoneInfo(record.timezone)
        now = datetime.now(timezone.utc)
        note = f"Imported from {record.source_filename} ({record.source_system})"
        counts: Dict[str, int] = defaultdict(int)
        _, user_by_key = await self.imports._settle_members(
            record, list(resolutions.values()), now, counts
        )
        members = {
            m.id for m in await self.imports.shift_imports.member_directory(org_id)
        }

        source_ids: List[str] = []
        for planned in plan.events:
            key = planned.event.key
            source_ids += [
                plan_rules.ledger_id(plan_rules.EVENT_PREFIX, key),
                plan_rules.ledger_id(plan_rules.SHIFT_PREFIX, key),
                plan_rules.ledger_id(plan_rules.SHEET_PREFIX, key),
            ]
            source_ids += [plan_rules.seat_ledger_id(s.seat) for s in planned.seats]
        ledger = await self._ledger(record, source_ids)

        units = await self._units(org_id)
        shift_days = sorted(
            {
                p.event.day
                for p in plan.events
                if p.kind == mapping_rules.SHIFT and p.event.day is not None
            }
        )
        existing_shifts = await self._shifts_by_day(org_id, shift_days)

        def member_of(seat: plan_rules.PlannedSeat) -> Optional[str]:
            if seat.assigned_user_id:
                return seat.assigned_user_id
            identity = shift_engine.identity_from_values(seat.seat.member)
            return user_by_key.get(identity.key)

        pairing, _ = await self._pair_with_hours(record, plan, member_of)
        department_seats = await self._department_seats(org_id)
        held_by_shift: Dict[str, Dict[str, ShiftAssignment]] = {}
        # Positions changed on seats that were already there, kept across a
        # second commit so the first position recorded is the one restored.
        previous = (record.results or {}).get("staffing") or {}
        reseated: Dict[str, Dict[str, Optional[str]]] = copy.deepcopy(
            previous.get("reseated") or {}
        )

        for index, planned in enumerate(plan.events):
            start, end = self._span(planned.event, tz)
            if planned.kind == mapping_rules.SHIFT:
                await self._write_shift(
                    record,
                    planned,
                    start,
                    end,
                    units,
                    existing_shifts,
                    ledger,
                    member_of,
                    members,
                    committed_by,
                    now,
                    note,
                    counts,
                    pairing.matched,
                    held_by_shift,
                    reseated,
                )
            else:
                await self._write_event(
                    record,
                    planned,
                    start,
                    end,
                    ledger,
                    member_of,
                    members,
                    committed_by,
                    now,
                    note,
                    counts,
                    pairing.matched,
                    department_seats,
                    held_by_shift,
                    reseated,
                )
            if index % _FLUSH_EVERY == _FLUSH_EVERY - 1:
                await self.imports._flush_ledgered()
        await self.imports._flush_ledgered()

        counts["signups_without_hours"] = len(pairing.unmatched_signups)
        counts["hours_without_signup"] = len(pairing.unmatched_hours)
        results = copy.deepcopy(record.results or {})
        results["staffing"] = {
            **dict(counts),
            "reseated": reseated,
            "committed_at": now.isoformat(),
            "committed_by": str(committed_by),
        }
        record.results = results
        await self.db.commit()
        logger.info(
            "Historical import {} wrote the staffing roster for org {}",
            record.id,
            org_id,
        )
        return dict(counts)

    async def _write_shift(
        self,
        record: HistoricalImport,
        planned: plan_rules.PlannedEvent,
        start: datetime,
        end: datetime,
        units: Sequence[Tuple[str, str]],
        existing_shifts: Dict[Tuple[date, str], List[Shift]],
        ledger: Dict[str, str],
        member_of: Any,
        members: set,
        committed_by: str,
        now: datetime,
        note: str,
        counts: Dict[str, int],
        matches: Mapping[str, hours_match.HoursEntry],
        held_by_shift: Dict[str, Dict[str, ShiftAssignment]],
        reseated: Dict[str, Dict[str, Optional[str]]],
    ) -> None:
        event = planned.event
        org_id = record.organization_id
        shift_key = plan_rules.ledger_id(plan_rules.SHIFT_PREFIX, event.key)
        paired = {
            key: matches[key]
            for key in (plan_rules.seat_ledger_id(s.seat) for s in planned.seats)
            if key in matches
        }
        # Seats with nowhere to go but a roster shift: no hours entry of
        # their own. When every seat paired, no roster shift is needed.
        unpaired = [
            s
            for s in planned.seats
            if plan_rules.seat_ledger_id(s.seat) not in paired
            and plan_rules.seat_ledger_id(s.seat) not in ledger
        ]
        shift: Optional[Shift] = None
        if shift_key in ledger:
            shift = await self.db.get(Shift, ledger[shift_key])
            if shift is None or shift.organization_id != org_id:
                # Deleted since the last commit: left deleted.
                counts["shifts_deleted_since"] += 1
                return
        else:
            apparatus_id = plan_rules.unit_of(event.activity, units)
            candidates = (
                existing_shifts.get((event.day, apparatus_id), [])
                if apparatus_id and event.day
                else []
            )
            if candidates:
                # The hours import's shift for this date and unit; of several,
                # the one starting nearest the roster's start.
                shift = min(
                    candidates,
                    key=lambda s: abs((_aware(s.start_time) - start).total_seconds()),
                )
                counts["shifts_filled"] += 1
                if len(candidates) > 1:
                    counts["shifts_matched_nearest"] += 1
            elif paired and unpaired:
                # No shift for this date and unit, but the crew's hours were
                # credited to one: the seats with no hours of their own join
                # the shift most of the crew worked.
                tally = Counter(e.shift_id for e in paired.values())
                best = min(tally, key=lambda sid: (-tally[sid], sid))
                shift = await self.db.get(Shift, best)
                counts["shifts_filled_by_hours"] += 1
            elif not unpaired:
                shift = None
            else:
                shift = Shift(
                    id=generate_uuid(),
                    organization_id=org_id,
                    shift_date=event.day,
                    start_time=start,
                    end_time=end,
                    apparatus_id=apparatus_id,
                    status=ShiftStatus.SCHEDULED,
                    duty_type=(
                        shift_engine.DUTY_ON_CALL
                        if plan_rules.is_on_call(event.activity)
                        else shift_engine.DUTY_IN_STATION
                    ),
                    notes=f"{html.unescape(event.activity)}. {note}",
                    positions=[
                        {"position": s.value, "required": s.seat.required}
                        for s in planned.seats
                    ],
                    is_finalized=not planned.upcoming,
                    finalized_at=None if planned.upcoming else now,
                    finalized_by=None if planned.upcoming else str(committed_by),
                    created_by=str(committed_by),
                )
                self.db.add(shift)
                await self.db.flush()
                counts["shifts_created"] += 1
            if shift is not None:
                self._enter(
                    record, ledger, shift_key, ImportedRecordKind.SHIFT, shift.id
                )

        for seat in planned.seats:
            seat_key = plan_rules.seat_ledger_id(seat.seat)
            if seat_key in ledger:
                counts["already_imported"] += 1
                continue
            user_id = member_of(seat)
            if not user_id or user_id not in members:
                counts["member_missing"] += 1
                continue
            entry = paired.get(seat_key)
            if entry is not None:
                # Seated where the hours were credited, beside the calls.
                await self._place_on_hours(
                    record,
                    entry,
                    user_id,
                    seat.value,
                    ledger,
                    seat_key,
                    committed_by,
                    now,
                    note,
                    held_by_shift,
                    reseated,
                    counts,
                )
                continue
            if shift is None:
                counts["shifts_deleted_since"] += 1
                continue
            held = held_by_shift.get(str(shift.id))
            if held is None:
                held = await self._assignments(shift.id)
                held_by_shift[str(shift.id)] = held
            assignment = held.get(user_id)
            if assignment is not None:
                # On the shift already (the hours import put them there):
                # re-seated in the seat the roster names.
                self._reseat(assignment, seat.value, reseated, counts)
            else:
                assignment = ShiftAssignment(
                    id=generate_uuid(),
                    organization_id=org_id,
                    shift_id=shift.id,
                    user_id=user_id,
                    position=seat.value,
                    assignment_status=(
                        AssignmentStatus.ASSIGNED
                        if planned.upcoming
                        else AssignmentStatus.CONFIRMED
                    ),
                    assigned_by=str(committed_by),
                    confirmed_at=None if planned.upcoming else now,
                    notes=note,
                )
                self.db.add(assignment)
                held[user_id] = assignment
                counts["seats_added"] += 1
            self._enter(
                record,
                ledger,
                seat_key,
                ImportedRecordKind.SHIFT_ASSIGNMENT,
                assignment.id,
            )

    async def _write_event(
        self,
        record: HistoricalImport,
        planned: plan_rules.PlannedEvent,
        start: datetime,
        end: datetime,
        ledger: Dict[str, str],
        member_of: Any,
        members: set,
        committed_by: str,
        now: datetime,
        note: str,
        counts: Dict[str, int],
        matches: Mapping[str, hours_match.HoursEntry],
        department_seats: Sequence[str],
        held_by_shift: Dict[str, Dict[str, ShiftAssignment]],
        reseated: Dict[str, Dict[str, Optional[str]]],
    ) -> None:
        event = planned.event
        org_id = record.organization_id
        event_key = plan_rules.ledger_id(plan_rules.EVENT_PREFIX, event.key)
        calendar: Optional[Event] = None
        if event_key in ledger:
            calendar = await self.db.get(Event, ledger[event_key])
            if calendar is None or calendar.organization_id != org_id:
                counts["events_deleted_since"] += 1
                return
        else:
            title = html.unescape(event.activity).strip() or "Imported event"
            location = html.unescape(event.location).strip()
            calendar = Event(
                id=generate_uuid(),
                organization_id=org_id,
                title=title[:_TITLE_MAX],
                description=note,
                event_type=EventType.OTHER,
                location=location[:_LOCATION_MAX] or None,
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
                send_reminders=False,
                created_by=str(committed_by),
                attendance_finalized_at=None if planned.upcoming else now,
                attendance_finalized_by=(
                    None if planned.upcoming else str(committed_by)
                ),
            )
            self.db.add(calendar)
            await self.db.flush()
            counts["events_created"] += 1
            if planned.upcoming:
                counts["upcoming_events_created"] += 1
            self._enter(
                record, ledger, event_key, ImportedRecordKind.EVENT, calendar.id
            )

        attendance = [s for s in planned.seats if s.attendance]
        roles = [s for s in planned.seats if not s.attendance]
        if attendance:
            await self._check_in(
                record,
                calendar,
                attendance,
                start,
                ledger,
                member_of,
                members,
                planned.upcoming,
                now,
                counts,
            )
        if roles:
            await self._sheet(
                record,
                planned,
                calendar.title,
                roles,
                start,
                end,
                ledger,
                member_of,
                members,
                committed_by,
                now,
                note,
                counts,
            )

        # The hours the members recorded for this event sit on a duty shift
        # of their own. A seat whose title is a crew seat takes that position
        # there; a role that is not a seat (an educator, a tour guide) pairs
        # without changing it.
        for seat in planned.seats:
            entry = matches.get(plan_rules.seat_ledger_id(seat.seat))
            if entry is None:
                continue
            hours_key = plan_rules.hours_seat_ledger_id(seat.seat)
            if hours_key in ledger:
                continue
            user_id = member_of(seat)
            if not user_id or user_id not in members:
                continue
            if seat.attendance:
                # Checked in, not seated: paired, and nothing to write.
                counts["seats_matched_to_hours"] += 1
                continue
            value = hours_match.crew_seat_for(seat.seat.title, department_seats)
            await self._place_on_hours(
                record,
                entry,
                user_id,
                value,
                ledger,
                hours_key,
                committed_by,
                now,
                note,
                held_by_shift,
                reseated,
                counts,
            )

    async def _check_in(
        self,
        record: HistoricalImport,
        calendar: Event,
        seats: Sequence[plan_rules.PlannedSeat],
        start: datetime,
        ledger: Dict[str, str],
        member_of: Any,
        members: set,
        upcoming: bool,
        now: datetime,
        counts: Dict[str, int],
    ) -> None:
        rows = await self.db.execute(
            select(EventRSVP).where(EventRSVP.event_id == calendar.id)
        )
        existing = {str(r.user_id): r for r in rows.scalars().all()}
        for seat in seats:
            seat_key = plan_rules.seat_ledger_id(seat.seat)
            if seat_key in ledger:
                counts["already_imported"] += 1
                continue
            user_id = member_of(seat)
            if not user_id or user_id not in members:
                counts["member_missing"] += 1
                continue
            rsvp = existing.get(user_id)
            if rsvp is None:
                rsvp = EventRSVP(
                    id=generate_uuid(),
                    organization_id=record.organization_id,
                    event_id=calendar.id,
                    user_id=user_id,
                    status=RSVPStatus.GOING,
                    responded_at=now,
                    checked_in=not upcoming,
                    checked_in_at=None if upcoming else start,
                )
                self.db.add(rsvp)
                existing[user_id] = rsvp
                counts["check_ins" if not upcoming else "rsvps"] += 1
            else:
                counts["already_checked_in"] += 1
            self._enter(
                record, ledger, seat_key, ImportedRecordKind.EVENT_RSVP, rsvp.id
            )

    async def _sheet(
        self,
        record: HistoricalImport,
        planned: plan_rules.PlannedEvent,
        title: str,
        seats: Sequence[plan_rules.PlannedSeat],
        start: datetime,
        end: datetime,
        ledger: Dict[str, str],
        member_of: Any,
        members: set,
        committed_by: str,
        now: datetime,
        note: str,
        counts: Dict[str, int],
    ) -> None:
        org_id = record.organization_id
        sheet_key = plan_rules.ledger_id(plan_rules.SHEET_PREFIX, planned.event.key)
        sheet: Optional[Shift] = None
        if sheet_key in ledger:
            sheet = await self.db.get(Shift, ledger[sheet_key])
            if sheet is None or sheet.organization_id != org_id:
                counts["sheets_deleted_since"] += 1
                return
        else:
            sheet = Shift(
                id=generate_uuid(),
                organization_id=org_id,
                shift_date=planned.event.day,
                start_time=start,
                end_time=end,
                status=ShiftStatus.SCHEDULED,
                is_outreach=True,
                notes=f"{title}. {note}",
                is_finalized=not planned.upcoming,
                finalized_at=None if planned.upcoming else now,
                finalized_by=None if planned.upcoming else str(committed_by),
                created_by=str(committed_by),
            )
            self.db.add(sheet)
            await self.db.flush()
            counts["sheets_created"] += 1
            self._enter(record, ledger, sheet_key, ImportedRecordKind.SHIFT, sheet.id)

        held = await self._assignments(sheet.id)
        for seat in seats:
            seat_key = plan_rules.seat_ledger_id(seat.seat)
            if seat_key in ledger:
                counts["already_imported"] += 1
                continue
            user_id = member_of(seat)
            if not user_id or user_id not in members:
                counts["member_missing"] += 1
                continue
            assignment = held.get(user_id)
            if assignment is None:
                assignment = ShiftAssignment(
                    id=generate_uuid(),
                    organization_id=org_id,
                    shift_id=sheet.id,
                    user_id=user_id,
                    position=_OUTREACH_SEAT,
                    outreach_role=seat.value,
                    assignment_status=(
                        AssignmentStatus.ASSIGNED
                        if planned.upcoming
                        else AssignmentStatus.CONFIRMED
                    ),
                    assigned_by=str(committed_by),
                    confirmed_at=None if planned.upcoming else now,
                    notes=note,
                )
                self.db.add(assignment)
                held[user_id] = assignment
                counts["outreach_seats"] += 1
            else:
                # One sheet seat per member: a second role for the same person
                # at one event keeps the first.
                counts["already_on_sheet"] += 1
            self._enter(
                record,
                ledger,
                seat_key,
                ImportedRecordKind.SHIFT_ASSIGNMENT,
                assignment.id,
            )


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
