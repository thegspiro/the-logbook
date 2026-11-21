"""Undo one committed step of a historical import.

Each step a historical import commits enters what it wrote in the
``imported_source_records`` ledger under the import's id. Undo reads that
ledger back and removes those records, so the department can correct a
decision and commit the step again (owner decisions 2026-11-16):

* **One step at a time.** The administrative hours, training and drill steps
  each have their own undo (the staffing roster and shift hours follow).
* **In order.** A step that a later one builds on cannot be undone while that
  step stands: the drills attach the training records, so training waits for
  the drills to be undone first.
* **Edited records are kept.** A record changed since the import wrote it is
  an officer's correction. It stays, with its ledger entry so a recommit does
  not write it a second time, and the preview lists it.
* **Former members it created go too,** but only when nothing else refers to
  them any more.

"Changed since" is judged by the record's ``updated_at`` against the time its
ledger entry was written: both are stamped by the same commit, so a record
untouched since then carries a time within ``EDIT_TOLERANCE`` of its entry.

A record already deleted by hand simply has its ledger entry removed. That
makes the step whole again: committing it once more writes every row afresh.
"""

from __future__ import annotations

import copy
import importlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import lru_cache
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, Dict, Iterable, List, Optional, Sequence

from loguru import logger
from sqlalchemy import delete, func, select, union_all, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import Base
from app.models.admin_hours import AdminHoursEntry
from app.models.call_tracking import CallSource, OrgCall, OrgCallResponse
from app.models.event import Event, EventRSVP
from app.models.external_shift_hours import ExternalShiftHours
from app.models.historical_import import (
    HistoricalImport,
    ImportedRecordKind,
    ImportedSourceRecord,
)
from app.models.shift_history_import import (
    ShiftHistoryImport,
    ShiftHistoryImportStatus,
)
from app.models.training import (
    RequirementProgressCredit,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
    TrainingRecord,
    TrainingSession,
)
from app.models.user import User, UserStatus
from app.services.qualification_service import QualificationService
from app.services.user_deletion_service import (
    count_user_references,
    release_user_references,
)
from app.utils.edit_window import EDIT_TOLERANCE, as_utc, changed_since

if TYPE_CHECKING:
    # Imported where used at runtime, as the void below is.
    from app.services.attendance_waiver_service import MemberNotice

STEP_ADMIN = "admin"
STEP_TRAINING = "training"
STEP_DRILLS = "drills"
STEP_STAFFING = "staffing"
STEP_SHIFTS = "shifts"

UNDOABLE_STEPS = (STEP_SHIFTS, STEP_ADMIN, STEP_TRAINING, STEP_DRILLS, STEP_STAFFING)

# A step and the later steps that build on it: undo those first.
_DEPENDENTS: Dict[str, Sequence[str]] = {
    STEP_TRAINING: (STEP_DRILLS,),
    # The roster fills the shifts the hours import made, and re-seats its crew.
    STEP_SHIFTS: (STEP_STAFFING,),
}

_STEP_LABELS = {
    STEP_ADMIN: "administrative hours",
    STEP_TRAINING: "training",
    STEP_DRILLS: "company drills",
    STEP_STAFFING: "staffing roster",
    STEP_SHIFTS: "shift hours",
}

_CHUNK = 500

# How many kept records the preview names; the count is always whole.
_KEPT_EXAMPLES = 20


class UndoNotAllowed(ValueError):
    """The step cannot be undone as things stand; the message says why."""


@dataclass
class KeptRecord:
    kind: str
    record_id: str
    label: str


@dataclass
class StepUndoPlan:
    step: str
    committed: bool
    blocked_by: List[str] = field(default_factory=list)
    # The sentence to show when the step cannot be undone yet.
    blocked_reason: Optional[str] = None
    removable: int = 0
    kept: List[KeptRecord] = field(default_factory=list)
    kept_total: int = 0
    already_gone: int = 0
    # Records the step used but did not make (a shift the hours import made, a
    # member re-seated on it): left as they are, and counted for the preview.
    reused: int = 0
    # Filled in by the plan's own steps, consumed by ``undo``.
    _remove_ids: List[str] = field(default_factory=list, repr=False)
    # The staffing roster removes several kinds at once, by kind.
    _remove_by_kind: Dict[str, List[str]] = field(default_factory=dict, repr=False)
    _ledger_ids: List[str] = field(default_factory=list, repr=False)


def _chunks(values: Sequence[str]) -> Iterable[List[str]]:
    for start in range(0, len(values), _CHUNK):
        yield list(values[start : start + _CHUNK])


class HistoricalImportUndoService:
    def __init__(self, db: AsyncSession):
        self.db = db
        # The emails owed to members whose pending waiver requests an undo
        # voided (its events were deleted). ``undo`` runs inside the caller's
        # transaction, so the caller sends them with ``send_member_notices``
        # once it has committed (CLAUDE.md pitfall #18).
        self.waiver_notices: List[MemberNotice] = []

    # ------------------------------------------------------------------
    # Preview
    # ------------------------------------------------------------------

    async def preview(self, record: HistoricalImport) -> Dict[str, Any]:
        """What undoing each step would remove and keep, without changing it."""
        steps = {}
        for step in UNDOABLE_STEPS:
            plan = await self.plan(record, step)
            steps[step] = {
                "committed": plan.committed,
                "blocked_by": plan.blocked_by,
                "blocked_reason": plan.blocked_reason,
                "removable": plan.removable,
                "kept_total": plan.kept_total,
                "kept": [
                    {"kind": k.kind, "record_id": k.record_id, "label": k.label}
                    for k in plan.kept[:_KEPT_EXAMPLES]
                ],
                "already_gone": plan.already_gone,
                "reused": plan.reused,
            }
        return {
            "steps": steps,
            "members_created": len(await self._created_members(record)),
        }

    async def plan(self, record: HistoricalImport, step: str) -> StepUndoPlan:
        if step not in UNDOABLE_STEPS:
            raise UndoNotAllowed("That step cannot be undone.")
        results = record.results if isinstance(record.results, dict) else {}
        if step == STEP_SHIFTS:
            committed = bool(
                await self._batches(record, ShiftHistoryImportStatus.COMMITTED)
            )
        else:
            committed = isinstance(results.get(step), dict)
        plan = StepUndoPlan(step=step, committed=committed)
        if not plan.committed:
            return plan
        plan.blocked_by = [
            _STEP_LABELS[d]
            for d in _DEPENDENTS.get(step, ())
            if isinstance(results.get(d), dict)
        ]
        if step == STEP_ADMIN:
            await self._plan_rows(
                record, plan, ImportedRecordKind.ADMIN_HOURS_ENTRY, AdminHoursEntry
            )
        elif step == STEP_TRAINING:
            await self._plan_rows(
                record, plan, ImportedRecordKind.TRAINING_RECORD, TrainingRecord
            )
        elif step == STEP_DRILLS:
            await self._plan_drills(record, plan)
        elif step == STEP_STAFFING:
            await self._plan_staffing(record, plan)
        else:
            if await self._batches(record, ShiftHistoryImportStatus.DRAFT):
                plan.blocked_reason = (
                    "Commit or discard the shift batches still in review first."
                )
            await self._plan_shifts(record, plan)
        if plan.blocked_by and not plan.blocked_reason:
            plan.blocked_reason = (
                f"Undo the {' and '.join(plan.blocked_by)} step first: it builds "
                f"on the {_STEP_LABELS[step]}."
            )
        return plan

    async def _ledger(
        self, record: HistoricalImport, kind: ImportedRecordKind
    ) -> List[ImportedSourceRecord]:
        rows = await self.db.execute(
            select(ImportedSourceRecord).where(
                ImportedSourceRecord.organization_id == record.organization_id,
                ImportedSourceRecord.historical_import_id == record.id,
                ImportedSourceRecord.record_kind == kind.value,
            )
        )
        return list(rows.scalars().all())

    async def _load(
        self, model: Any, org_id: str, ids: Sequence[str]
    ) -> Dict[str, Any]:
        found: Dict[str, Any] = {}
        for chunk in _chunks(ids):
            rows = await self.db.execute(
                select(model).where(
                    model.organization_id == org_id, model.id.in_(chunk)
                )
            )
            found.update({str(r.id): r for r in rows.scalars().all()})
        return found

    async def _plan_rows(
        self,
        record: HistoricalImport,
        plan: StepUndoPlan,
        kind: ImportedRecordKind,
        model: Any,
    ) -> None:
        ledger = await self._ledger(record, kind)
        rows = await self._load(
            model, record.organization_id, sorted({e.record_id for e in ledger})
        )
        # Several source rows may name one record (back-to-back entries joined
        # into one); it was entered when its first row was.
        entered: Dict[str, datetime] = {}
        for entry in ledger:
            at = as_utc(entry.created_at) or datetime.now(timezone.utc)
            entered[entry.record_id] = min(entered.get(entry.record_id, at), at)
        kept_ids = set()
        for record_id, row in rows.items():
            if changed_since(row.updated_at, entered[record_id]):
                kept_ids.add(record_id)
                plan.kept.append(KeptRecord(kind.value, record_id, _label(kind, row)))
            else:
                plan._remove_ids.append(record_id)
        plan.removable = len(plan._remove_ids)
        plan.kept_total = len(kept_ids)
        plan.already_gone = len({e.record_id for e in ledger} - set(rows))
        plan._ledger_ids = [e.id for e in ledger if e.record_id not in kept_ids]
        plan.kept.sort(key=lambda k: k.label)

    async def _plan_drills(self, record: HistoricalImport, plan: StepUndoPlan) -> None:
        ledger = await self._ledger(record, ImportedRecordKind.TRAINING_SESSION)
        sessions = await self._load(
            TrainingSession, record.organization_id, [e.record_id for e in ledger]
        )
        events = await self._load(
            Event,
            record.organization_id,
            [str(s.event_id) for s in sessions.values() if s.event_id],
        )
        entered = {e.record_id: as_utc(e.created_at) for e in ledger}
        kept_ids = set()
        for session_id, session in sessions.items():
            event = events.get(str(session.event_id))
            at = entered[session_id] or datetime.now(timezone.utc)
            if changed_since(session.updated_at, at) or (
                event is not None and changed_since(event.updated_at, at)
            ):
                kept_ids.add(session_id)
                plan.kept.append(
                    KeptRecord(
                        ImportedRecordKind.TRAINING_SESSION.value,
                        session_id,
                        (event.title if event is not None else session.id),
                    )
                )
            else:
                plan._remove_ids.append(session_id)
        plan.removable = len(plan._remove_ids)
        plan.kept_total = len(kept_ids)
        plan.already_gone = len(set(entered) - set(sessions))
        plan._ledger_ids = [e.id for e in ledger if e.record_id not in kept_ids]
        plan.kept.sort(key=lambda k: k.label)

    async def _plan_staffing(
        self, record: HistoricalImport, plan: StepUndoPlan
    ) -> None:
        """The roster's shifts, seats, calendar events and check-ins.

        Its ledger does not say whether a shift or seat was made or only used:
        the roster fills the hours import's shift for a date and unit, and
        re-seats a member the hours import already put on it. A record made
        by the commit was stamped with its ledger entry, so one created within
        ``EDIT_TOLERANCE`` of the entry was made by it (owner decision
        2026-11-16); anything older was used and is left as it is. A re-seated
        member keeps the roster's seat: the seat they had before was not
        recorded.

        Kept as an officer's work: a record changed since, a shift or event
        someone else has since been added to.
        """
        org_id = record.organization_id
        entries = {
            kind: await self._ledger(record, kind)
            for kind in (
                ImportedRecordKind.EVENT_RSVP,
                ImportedRecordKind.SHIFT_ASSIGNMENT,
                ImportedRecordKind.EVENT,
                ImportedRecordKind.SHIFT,
            )
        }
        models = {
            ImportedRecordKind.EVENT_RSVP: EventRSVP,
            ImportedRecordKind.SHIFT_ASSIGNMENT: ShiftAssignment,
            ImportedRecordKind.EVENT: Event,
            ImportedRecordKind.SHIFT: Shift,
        }
        rows = {
            kind: await self._load(
                models[kind], org_id, sorted({e.record_id for e in kind_entries})
            )
            for kind, kind_entries in entries.items()
        }
        remove: Dict[ImportedRecordKind, set[str]] = {k: set() for k in entries}
        keep: set[str] = set()

        def made_and_untouched(
            kind: ImportedRecordKind, row: Any, at: datetime
        ) -> Optional[bool]:
            """True: made by the commit and unchanged. False: made by it, then
            edited. None: not made by it."""
            made = as_utc(
                row.responded_at
                if kind == ImportedRecordKind.EVENT_RSVP
                else row.created_at
            )
            if made is None or abs(made - at) > EDIT_TOLERANCE:
                return None
            return not changed_since(row.updated_at, at)

        def entered(kind: ImportedRecordKind) -> Dict[str, datetime]:
            times: Dict[str, datetime] = {}
            for e in entries[kind]:
                at = as_utc(e.created_at) or datetime.now(timezone.utc)
                times[e.record_id] = min(times.get(e.record_id, at), at)
            return times

        def classify(kind: ImportedRecordKind) -> None:
            for record_id, at in entered(kind).items():
                row = rows[kind].get(record_id)
                if row is None:
                    plan.already_gone += 1
                    continue
                verdict = made_and_untouched(kind, row, at)
                if verdict is None:
                    plan.reused += 1
                elif verdict:
                    remove[kind].add(record_id)
                else:
                    keep.add(record_id)
                    plan.kept.append(
                        KeptRecord(kind.value, record_id, _label(kind, row))
                    )

        classify(ImportedRecordKind.EVENT_RSVP)
        classify(ImportedRecordKind.SHIFT_ASSIGNMENT)
        classify(ImportedRecordKind.EVENT)
        classify(ImportedRecordKind.SHIFT)

        # A seat whose member has attendance on that shift belongs to the hours
        # import, however close in time the two commits ran: the roster writes
        # no attendance. Reused, so it stays.
        seats = rows[ImportedRecordKind.SHIFT_ASSIGNMENT]
        for seat_id in sorted(remove[ImportedRecordKind.SHIFT_ASSIGNMENT]):
            seat = seats[seat_id]
            attended = await self.db.scalar(
                select(ShiftAttendance.id)
                .where(
                    ShiftAttendance.shift_id == seat.shift_id,
                    ShiftAttendance.user_id == seat.user_id,
                )
                .limit(1)
            )
            if attended is not None:
                remove[ImportedRecordKind.SHIFT_ASSIGNMENT].discard(seat_id)
                plan.reused += 1

        # A shift or event the roster made is kept when anything it did not
        # write, or keeps, is still on it.
        await self._keep_occupied(
            plan,
            remove,
            keep,
            ImportedRecordKind.EVENT,
            EventRSVP,
            EventRSVP.event_id,
            remove[ImportedRecordKind.EVENT_RSVP],
            rows,
        )
        await self._keep_occupied(
            plan,
            remove,
            keep,
            ImportedRecordKind.SHIFT,
            ShiftAssignment,
            ShiftAssignment.shift_id,
            remove[ImportedRecordKind.SHIFT_ASSIGNMENT],
            rows,
        )
        for shift_id in sorted(remove[ImportedRecordKind.SHIFT]):
            attended = await self.db.scalar(
                select(ShiftAttendance.id)
                .where(ShiftAttendance.shift_id == shift_id)
                .limit(1)
            )
            if attended is not None:
                remove[ImportedRecordKind.SHIFT].discard(shift_id)
                keep.add(shift_id)
                plan.kept.append(
                    KeptRecord(
                        ImportedRecordKind.SHIFT.value,
                        shift_id,
                        _label(
                            ImportedRecordKind.SHIFT,
                            rows[ImportedRecordKind.SHIFT][shift_id],
                        ),
                    )
                )

        plan._remove_by_kind = {k.value: sorted(v) for k, v in remove.items()}
        plan.removable = sum(len(v) for v in remove.values())
        plan.kept_total = len(keep)
        plan._ledger_ids = [
            e.id
            for kind_entries in entries.values()
            for e in kind_entries
            if e.record_id not in keep
        ]
        plan.kept.sort(key=lambda k: k.label)

    async def _keep_occupied(
        self,
        plan: StepUndoPlan,
        remove: Dict[ImportedRecordKind, set[str]],
        keep: set[str],
        parent_kind: ImportedRecordKind,
        child: Any,
        parent_column: Any,
        leaving: set[str],
        rows: Dict[ImportedRecordKind, Dict[str, Any]],
    ) -> None:
        parents = sorted(remove[parent_kind])
        for chunk in _chunks(parents):
            children = await self.db.execute(
                select(parent_column, child.id).where(parent_column.in_(chunk))
            )
            occupied = {str(p) for p, cid in children.all() if str(cid) not in leaving}
            for parent_id in occupied:
                remove[parent_kind].discard(parent_id)
                keep.add(parent_id)
                plan.kept.append(
                    KeptRecord(
                        parent_kind.value,
                        parent_id,
                        _label(parent_kind, rows[parent_kind][parent_id]),
                    )
                )

    async def _delete_staffing(self, org_id: str, plan: StepUndoPlan) -> int:
        """Check-ins and seats first, then the events and shifts they were on."""
        removed = 0
        by_kind = plan._remove_by_kind
        removed += await self._delete_ids(
            EventRSVP, org_id, by_kind.get(ImportedRecordKind.EVENT_RSVP.value, [])
        )
        removed += await self._delete_ids(
            ShiftAssignment,
            org_id,
            by_kind.get(ImportedRecordKind.SHIFT_ASSIGNMENT.value, []),
        )
        event_ids = by_kind.get(ImportedRecordKind.EVENT.value, [])
        if event_ids:
            from app.services.attendance_waiver_service import void_pending_for_events

            self.waiver_notices.extend(
                await void_pending_for_events(self.db, org_id, event_ids, "deleted")
            )
        removed += await self._delete_ids(Event, org_id, event_ids)
        removed += await self._delete_ids(
            Shift, org_id, by_kind.get(ImportedRecordKind.SHIFT.value, [])
        )
        return removed

    async def _plan_shifts(self, record: HistoricalImport, plan: StepUndoPlan) -> None:
        """The shift batches' attendance, outside-agency hours, and the shifts,
        seats and calls they made.

        Attendance has no time of last change, so it is removed whatever has
        happened to it since (owner decision 2026-11-16). Outside-agency hours
        changed since are kept. A shift or seat is the batch's when it was
        created within ``EDIT_TOLERANCE`` of the attendance it carries; a shift
        the batch only added crew to is used, and loses only that crew.
        """
        org_id = record.organization_id
        attendance_entries = await self._ledger(
            record, ImportedRecordKind.SHIFT_ATTENDANCE
        )
        hours_entries = await self._ledger(
            record, ImportedRecordKind.EXTERNAL_SHIFT_HOURS
        )

        attendance: Dict[str, ShiftAttendance] = {}
        ids = sorted({e.record_id for e in attendance_entries})
        for chunk in _chunks(ids):
            found = await self.db.execute(
                select(ShiftAttendance)
                .join(Shift, Shift.id == ShiftAttendance.shift_id)
                .where(Shift.organization_id == org_id, ShiftAttendance.id.in_(chunk))
            )
            attendance.update({str(a.id): a for a in found.scalars().all()})
        plan.already_gone += len(set(ids) - set(attendance))
        entered: Dict[str, datetime] = {}
        for e in attendance_entries:
            at = as_utc(e.created_at) or datetime.now(timezone.utc)
            entered[e.record_id] = min(entered.get(e.record_id, at), at)

        # Per shift: when its imported crew was entered, and who they are.
        crew: Dict[str, set[str]] = {}
        shift_entered: Dict[str, datetime] = {}
        for att_id, att in attendance.items():
            shift_id = str(att.shift_id)
            crew.setdefault(shift_id, set()).add(str(att.user_id))
            at = entered[att_id]
            shift_entered[shift_id] = min(shift_entered.get(shift_id, at), at)
        remove_attendance = sorted(attendance)

        shifts = await self._load(Shift, org_id, sorted(crew))
        remove_seats: List[str] = []
        seats_left: Dict[str, int] = {}
        for chunk in _chunks(sorted(shifts)):
            found = await self.db.execute(
                select(ShiftAssignment).where(ShiftAssignment.shift_id.in_(chunk))
            )
            for seat in found.scalars().all():
                shift_id = str(seat.shift_id)
                made = as_utc(seat.created_at)
                ours = (
                    str(seat.user_id) in crew.get(shift_id, set())
                    and made is not None
                    and abs(made - shift_entered[shift_id]) <= EDIT_TOLERANCE
                )
                if ours:
                    remove_seats.append(str(seat.id))
                else:
                    seats_left[shift_id] = seats_left.get(shift_id, 0) + 1

        remove_shifts: List[str] = []
        for shift_id, shift in shifts.items():
            made = as_utc(shift.created_at)
            if made is None or abs(made - shift_entered[shift_id]) > EDIT_TOLERANCE:
                plan.reused += 1
                continue
            occupied = seats_left.get(shift_id, 0) or await self._shift_has_more(
                shift_id, set(remove_attendance)
            )
            if occupied or changed_since(shift.updated_at, shift_entered[shift_id]):
                plan.kept.append(
                    KeptRecord(
                        ImportedRecordKind.SHIFT.value,
                        shift_id,
                        _label(ImportedRecordKind.SHIFT, shift),
                    )
                )
            else:
                remove_shifts.append(shift_id)

        hours = await self._load(
            ExternalShiftHours, org_id, sorted({e.record_id for e in hours_entries})
        )
        hours_at = {e.record_id: as_utc(e.created_at) for e in hours_entries}
        remove_hours: List[str] = []
        kept_hours: set[str] = set()
        for hours_id, entry in hours.items():
            at = hours_at[hours_id] or datetime.now(timezone.utc)
            if changed_since(entry.updated_at, at):
                kept_hours.add(hours_id)
                plan.kept.append(
                    KeptRecord(
                        ImportedRecordKind.EXTERNAL_SHIFT_HOURS.value,
                        hours_id,
                        (
                            f"Outside-agency hours on {entry.shift_date.isoformat()}"
                            if entry.shift_date
                            else "Outside-agency hours"
                        ),
                    )
                )
            else:
                remove_hours.append(hours_id)
        plan.already_gone += len(set(hours_at) - set(hours))

        plan._remove_by_kind = {
            ImportedRecordKind.SHIFT_ATTENDANCE.value: remove_attendance,
            ImportedRecordKind.SHIFT_ASSIGNMENT.value: sorted(remove_seats),
            ImportedRecordKind.SHIFT.value: sorted(remove_shifts),
            ImportedRecordKind.EXTERNAL_SHIFT_HOURS.value: sorted(remove_hours),
            # Every shift the batches touched, for its calls and totals.
            "touched_shifts": sorted(shifts),
        }
        plan.removable = (
            len(remove_attendance)
            + len(remove_seats)
            + len(remove_shifts)
            + len(remove_hours)
        )
        plan.kept_total = len(plan.kept)
        plan._ledger_ids = [e.id for e in attendance_entries] + [
            e.id for e in hours_entries if e.record_id not in kept_hours
        ]
        plan.kept.sort(key=lambda k: k.label)

    async def _shift_has_more(self, shift_id: str, leaving: set[str]) -> bool:
        """Whether anything but the batch's own crew and calls is on a shift:
        attendance it did not write, or a row in any other table that refers
        to the shift (a completion report, an equipment check, a swap)."""
        attendance = await self.db.execute(
            select(ShiftAttendance.id).where(ShiftAttendance.shift_id == shift_id)
        )
        if any(str(a) not in leaving for a in attendance.scalars().all()):
            return True
        responses = await self.db.execute(
            select(OrgCallResponse.id)
            .join(OrgCall, OrgCall.id == OrgCallResponse.call_id)
            .where(
                OrgCallResponse.shift_id == shift_id,
                OrgCall.source != CallSource.IMPORT,
            )
            .limit(1)
        )
        if responses.scalar_one_or_none() is not None:
            return True
        return bool(await count_shift_references(self.db, shift_id))

    async def _delete_shifts(self, org_id: str, plan: StepUndoPlan) -> int:
        by_kind = plan._remove_by_kind
        touched = by_kind.get("touched_shifts", [])
        removed = 0
        # The calls the batches filed: an imported call whose every response
        # is on one of these shifts. A call shared with another shift, or
        # filed any other way, stays.
        import_calls: List[str] = []
        for chunk in _chunks(touched):
            rows = await self.db.execute(
                select(OrgCall.id)
                .join(OrgCallResponse, OrgCallResponse.call_id == OrgCall.id)
                .where(
                    OrgCall.organization_id == org_id,
                    OrgCall.source == CallSource.IMPORT,
                    OrgCallResponse.shift_id.in_(chunk),
                )
                .distinct()
            )
            import_calls.extend(str(c) for c in rows.scalars().all())
        touched_set = set(touched)
        solely: List[str] = []
        for chunk in _chunks(sorted(set(import_calls))):
            pairs = await self.db.execute(
                select(OrgCallResponse.call_id, OrgCallResponse.shift_id).where(
                    OrgCallResponse.call_id.in_(chunk)
                )
            )
            on: Dict[str, set[Optional[str]]] = {}
            for call_id, shift_id in pairs.all():
                on.setdefault(str(call_id), set()).add(
                    str(shift_id) if shift_id else None
                )
            solely.extend(c for c, s in on.items() if s <= touched_set)
        recalled: set[str] = set()
        for chunk in _chunks(sorted(solely)):
            rows = await self.db.execute(
                select(OrgCallResponse.shift_id).where(
                    OrgCallResponse.call_id.in_(chunk)
                )
            )
            recalled.update(str(s) for s in rows.scalars().all() if s)
        # Not counted in "removed": the preview counts records, and a call is
        # a shift's figure, recomputed below where the shift stays.
        await self._delete_ids(OrgCall, org_id, sorted(solely))

        for chunk in _chunks(
            by_kind.get(ImportedRecordKind.SHIFT_ATTENDANCE.value, [])
        ):
            result = await self.db.execute(
                delete(ShiftAttendance)
                .where(ShiftAttendance.id.in_(chunk))
                .where(
                    ShiftAttendance.shift_id.in_(
                        select(Shift.id).where(Shift.organization_id == org_id)
                    )
                )
                .execution_options(synchronize_session=False)
            )
            removed += int(getattr(result, "rowcount", 0) or 0)
        removed += await self._delete_ids(
            ShiftAssignment,
            org_id,
            by_kind.get(ImportedRecordKind.SHIFT_ASSIGNMENT.value, []),
        )
        removed += await self._delete_ids(
            ExternalShiftHours,
            org_id,
            by_kind.get(ImportedRecordKind.EXTERNAL_SHIFT_HOURS.value, []),
        )
        gone = set(by_kind.get(ImportedRecordKind.SHIFT.value, []))
        removed += await self._delete_ids(Shift, org_id, sorted(gone))

        # A shift that stays: its calls and totals are recomputed from what is
        # left on it, as the import computed them when it added the crew.
        from app.services.pre_shift_work_service import PreShiftWorkService

        totals = PreShiftWorkService(self.db)
        for shift_id in sorted(touched_set - gone):
            values: Dict[str, Any] = {}
            if shift_id in recalled:
                values["call_count"] = None
            shift = await self.db.get(Shift, shift_id)
            if shift is not None and shift.is_finalized:
                values["total_hours"] = await totals.shift_total_hours(shift_id)
            if values:
                await self.db.execute(
                    update(Shift)
                    .where(Shift.id == shift_id, Shift.organization_id == org_id)
                    .values(**values)
                    .execution_options(synchronize_session=False)
                )
        return removed

    # ------------------------------------------------------------------
    # Undo
    # ------------------------------------------------------------------

    async def undo(
        self, record: HistoricalImport, step: str, undone_by: str
    ) -> Dict[str, Any]:
        """Remove what the step wrote, keep what was edited, and mark it undone.

        The caller holds the import row locked and commits.
        """
        plan = await self.plan(record, step)
        if not plan.committed:
            raise UndoNotAllowed(
                f"The {_STEP_LABELS[step]} step has not been committed."
            )
        if plan.blocked_reason:
            raise UndoNotAllowed(plan.blocked_reason)
        org_id = record.organization_id
        counts: Dict[str, Any] = {"removed": 0, "kept": plan.kept_total}
        if step == STEP_ADMIN:
            counts["removed"] = await self._delete_ids(
                AdminHoursEntry, org_id, plan._remove_ids
            )
        elif step == STEP_TRAINING:
            counts["removed"] = await self._delete_training(
                org_id, plan._remove_ids, undone_by
            )
        elif step == STEP_DRILLS:
            counts["removed"] = await self._delete_drills(record, plan._remove_ids)
        elif step == STEP_STAFFING:
            counts["removed"] = await self._delete_staffing(org_id, plan)
        else:
            counts["removed"] = await self._delete_shifts(org_id, plan)
        for chunk in _chunks(plan._ledger_ids):
            await self.db.execute(
                delete(ImportedSourceRecord).where(
                    ImportedSourceRecord.organization_id == org_id,
                    ImportedSourceRecord.id.in_(chunk),
                )
            )
        counts["members_removed"], counts["members_kept"] = (
            await self._remove_unused_members(record)
        )

        if step == STEP_SHIFTS:
            # The batches' rows are routable again once their ledger entries
            # are gone; the committed drafts would only read as still standing.
            await self.db.execute(
                delete(ShiftHistoryImport).where(
                    ShiftHistoryImport.organization_id == org_id,
                    ShiftHistoryImport.historical_import_id == record.id,
                    ShiftHistoryImport.status
                    == ShiftHistoryImportStatus.COMMITTED.value,
                )
            )
        now = datetime.now(timezone.utc)
        results = (
            copy.deepcopy(record.results) if isinstance(record.results, dict) else {}
        )
        undone = results.pop(step, None)
        history = list(results.get("undone") or [])
        history.append(
            {
                "step": step,
                "undone_at": now.isoformat(),
                "undone_by": str(undone_by),
                "committed_at": (undone or {}).get("committed_at"),
                **counts,
            }
        )
        results["undone"] = history
        record.results = results
        logger.info(
            "Historical import {} undid its {} step for org {}: {} removed, {} kept",
            record.id,
            step,
            org_id,
            counts["removed"],
            counts["kept"],
        )
        return counts

    async def _delete_ids(self, model: Any, org_id: str, ids: Sequence[str]) -> int:
        removed = 0
        for chunk in _chunks(ids):
            result = await self.db.execute(
                delete(model)
                .where(model.organization_id == org_id, model.id.in_(chunk))
                .execution_options(synchronize_session=False)
            )
            removed += int(getattr(result, "rowcount", 0) or 0)
        return removed

    async def _delete_training(
        self, org_id: str, ids: Sequence[str], undone_by: str
    ) -> int:
        """Delete the records, then take back what they gave: pipeline credit
        and the qualifications their courses granted."""
        records = list((await self._load(TrainingRecord, org_id, ids)).values())
        credited: set[str] = set()
        for chunk in _chunks(ids):
            credited.update(
                (
                    await self.db.execute(
                        select(RequirementProgressCredit.source_id).where(
                            RequirementProgressCredit.source_id.in_(chunk)
                        )
                    )
                )
                .scalars()
                .all()
            )
        if credited:
            from app.services.training_program_service import TrainingProgramService

            programs = TrainingProgramService(self.db)
            for source_id in sorted(credited):
                await programs.reverse_credits_for_source(
                    organization_id=org_id,
                    source_id=source_id,
                    verified_by=undone_by,
                )
        regrade = {(str(r.user_id), str(r.course_id)) for r in records if r.course_id}
        removed = await self._delete_ids(TrainingRecord, org_id, ids)
        qualifications = QualificationService(self.db)
        for user_id, course_id in sorted(regrade):
            # A recompute from the records still standing: one that no longer
            # supports a granted qualification removes it.
            await qualifications.sync_from_training_record(
                SimpleNamespace(
                    organization_id=org_id, user_id=user_id, course_id=course_id
                )
            )
        return removed

    async def _delete_drills(
        self, record: HistoricalImport, session_ids: Sequence[str]
    ) -> int:
        """Delete each drill's session and its event, and detach its records.

        Detaching restores each record's own timestamp when the drill step was
        its only change, so undoing training afterwards sees it as written by
        the import and not as an officer's edit.
        """
        org_id = record.organization_id
        sessions = await self._load(TrainingSession, org_id, session_ids)
        event_ids = [str(s.event_id) for s in sessions.values() if s.event_id]
        if not event_ids:
            return 0
        drill_times = [
            as_utc(e.created_at)
            for e in await self._ledger(record, ImportedRecordKind.TRAINING_SESSION)
        ]
        imported_at = {
            e.record_id: as_utc(e.created_at)
            for e in await self._ledger(record, ImportedRecordKind.TRAINING_RECORD)
        }
        for chunk in _chunks(event_ids):
            attached = (
                await self.db.execute(
                    select(TrainingRecord.id, TrainingRecord.updated_at).where(
                        TrainingRecord.organization_id == org_id,
                        TrainingRecord.source_event_id.in_(chunk),
                    )
                )
            ).all()
            for record_id, updated_at in attached:
                restore = imported_at.get(str(record_id))
                touched_only_by_drills = any(
                    t is not None and not changed_since(updated_at, t)
                    for t in drill_times
                )
                await self.db.execute(
                    update(TrainingRecord)
                    .where(TrainingRecord.id == record_id)
                    .values(
                        source_event_id=None,
                        # Set explicitly, so the ORM's onupdate does not stamp
                        # the detach as an edit.
                        updated_at=(
                            restore
                            if restore is not None and touched_only_by_drills
                            else TrainingRecord.updated_at
                        ),
                    )
                    .execution_options(synchronize_session=False)
                )

        from app.services.attendance_waiver_service import void_pending_for_events

        self.waiver_notices.extend(
            await void_pending_for_events(self.db, org_id, event_ids, "deleted")
        )
        # The session and its requirement links cascade from the event.
        return await self._delete_ids(Event, org_id, event_ids)

    # ------------------------------------------------------------------
    # Former members the import created
    # ------------------------------------------------------------------

    async def _created_members(self, record: HistoricalImport) -> List[User]:
        """Former members this import made: by its own steps, and by the shift
        batches it sent to the shift history import, each of which names
        itself in the member's status reason."""
        reasons = [f"Created by historical import of {record.source_filename}"]
        reasons += [
            f"Created by shift history import of {b.source_filename}"
            for b in await self._batches(record)
        ]
        rows = await self.db.execute(
            select(User).where(
                User.organization_id == record.organization_id,
                User.status == UserStatus.ARCHIVED,
                User.status_change_reason.in_([r[:1000] for r in reasons]),
                User.password_hash.is_(None),
            )
        )
        return list(rows.scalars().all())

    async def _batches(
        self,
        record: HistoricalImport,
        status: Optional[ShiftHistoryImportStatus] = None,
    ) -> List[ShiftHistoryImport]:
        query = select(ShiftHistoryImport).where(
            ShiftHistoryImport.organization_id == record.organization_id,
            ShiftHistoryImport.historical_import_id == record.id,
        )
        if status is not None:
            query = query.where(ShiftHistoryImport.status == status.value)
        return list((await self.db.execute(query)).scalars().all())

    async def _remove_unused_members(self, record: HistoricalImport) -> tuple[int, int]:
        """Delete the former members this import created that nothing refers
        to any more; count the ones kept."""
        removed = kept = 0
        for member in await self._created_members(record):
            if await count_user_references(self.db, str(member.id)):
                kept += 1
                continue
            await release_user_references(self.db, str(member.id))
            await self.db.execute(
                delete(User).where(
                    User.id == member.id,
                    User.organization_id == record.organization_id,
                )
            )
            removed += 1
        if removed:
            await self._forget_created_members(record)
        return removed, kept

    async def _forget_created_members(self, record: HistoricalImport) -> None:
        """Point decisions that named a removed member back at "create", so a
        recommit makes them again instead of failing on a missing member."""
        stored = (
            record.member_mappings if isinstance(record.member_mappings, dict) else {}
        )
        if not stored:
            return
        ids = {
            str(v.get("user_id"))
            for v in stored.values()
            if isinstance(v, dict) and v.get("action") == "map" and v.get("user_id")
        }
        if not ids:
            return
        present: set[str] = set()
        for chunk in _chunks(sorted(ids)):
            present.update(
                str(i)
                for i in (
                    await self.db.execute(select(User.id).where(User.id.in_(chunk)))
                )
                .scalars()
                .all()
            )
        changed = copy.deepcopy(stored)
        for key, value in stored.items():
            if (
                isinstance(value, dict)
                and value.get("action") == "map"
                and str(value.get("user_id")) not in present
            ):
                changed[key] = {"action": "create"}
        record.member_mappings = changed


# Tables whose rows on a shift the undo accounts for itself: the batch's crew,
# seats and calls. Any other row that refers to a shift is somebody's work.
_SHIFT_CHILDREN_HANDLED = frozenset(
    {"shift_attendance", "shift_assignments", "org_call_responses"}
)


@lru_cache(maxsize=1)
def _shift_references() -> tuple[tuple[str, str], ...]:
    importlib.import_module("app.models")
    found = []
    for table in Base.metadata.sorted_tables:
        if table.name in _SHIFT_CHILDREN_HANDLED:
            continue
        for column in table.columns:
            for fk in column.foreign_keys:
                if fk.target_fullname.split(".")[-2:] == ["shifts", "id"]:
                    found.append((table.name, column.name))
    return tuple(sorted(found))


async def count_shift_references(db: AsyncSession, shift_id: str) -> int:
    """Rows in any other table that refer to the shift, in one statement."""
    branches = [
        select(func.count().label("n"))
        .select_from(Base.metadata.tables[t])
        .where(Base.metadata.tables[t].c[c] == shift_id)
        for t, c in _shift_references()
    ]
    if not branches:
        return 0
    return sum(int(n or 0) for (n,) in (await db.execute(union_all(*branches))).all())


def _label(kind: ImportedRecordKind, row: Any) -> str:
    """A short description of a kept record for the preview."""
    if kind == ImportedRecordKind.TRAINING_RECORD:
        day = row.completion_date.isoformat() if row.completion_date else "undated"
        return f"{row.course_name} ({day})"
    if kind == ImportedRecordKind.ADMIN_HOURS_ENTRY:
        start = as_utc(row.clock_in_at)
        return (
            f"{start.date().isoformat() if start else 'undated'}: "
            f"{round((row.duration_minutes or 0) / 60, 2)} h"
        )
    if kind == ImportedRecordKind.EVENT:
        start = as_utc(row.start_datetime)
        return f"{row.title} ({start.date().isoformat() if start else 'undated'})"
    if kind == ImportedRecordKind.SHIFT:
        day = row.shift_date.isoformat() if row.shift_date else "undated"
        return f"Shift on {day}" + (" (outreach sheet)" if row.is_outreach else "")
    if kind == ImportedRecordKind.SHIFT_ASSIGNMENT:
        return f"Seat: {row.outreach_role or row.position or 'unnamed'}"
    if kind == ImportedRecordKind.EVENT_RSVP:
        return "Event check-in"
    return str(row.id)
