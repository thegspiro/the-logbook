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
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Dict, Iterable, List, Optional, Sequence

from loguru import logger
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_hours import AdminHoursEntry
from app.models.event import Event
from app.models.historical_import import (
    HistoricalImport,
    ImportedRecordKind,
    ImportedSourceRecord,
)
from app.models.training import (
    RequirementProgressCredit,
    TrainingRecord,
    TrainingSession,
)
from app.models.user import User, UserStatus
from app.services.qualification_service import QualificationService
from app.services.user_deletion_service import (
    count_user_references,
    release_user_references,
)

#: How far apart a record's own timestamp and its ledger entry may be and still
#: count as written by the same commit. Commits run in seconds; two minutes
#: leaves room for a slow one without reaching an officer's later edit.
EDIT_TOLERANCE = timedelta(minutes=2)

STEP_ADMIN = "admin"
STEP_TRAINING = "training"
STEP_DRILLS = "drills"

UNDOABLE_STEPS = (STEP_ADMIN, STEP_TRAINING, STEP_DRILLS)

# A step and the later steps that build on it: undo those first.
_DEPENDENTS: Dict[str, Sequence[str]] = {STEP_TRAINING: (STEP_DRILLS,)}

_STEP_LABELS = {
    STEP_ADMIN: "administrative hours",
    STEP_TRAINING: "training",
    STEP_DRILLS: "company drills",
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
    removable: int = 0
    kept: List[KeptRecord] = field(default_factory=list)
    kept_total: int = 0
    already_gone: int = 0
    # Filled in by the plan's own steps, consumed by ``undo``.
    _remove_ids: List[str] = field(default_factory=list, repr=False)
    _ledger_ids: List[str] = field(default_factory=list, repr=False)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def changed_since(updated_at: Optional[datetime], entered_at: datetime) -> bool:
    """Was the record changed after the commit that wrote it?"""
    updated = _aware(updated_at)
    entered = _aware(entered_at)
    if updated is None or entered is None:
        return False
    return updated - entered > EDIT_TOLERANCE


def _chunks(values: Sequence[str]) -> Iterable[List[str]]:
    for start in range(0, len(values), _CHUNK):
        yield list(values[start : start + _CHUNK])


class HistoricalImportUndoService:
    def __init__(self, db: AsyncSession):
        self.db = db

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
                "removable": plan.removable,
                "kept_total": plan.kept_total,
                "kept": [
                    {"kind": k.kind, "record_id": k.record_id, "label": k.label}
                    for k in plan.kept[:_KEPT_EXAMPLES]
                ],
                "already_gone": plan.already_gone,
            }
        return {
            "steps": steps,
            "members_created": len(await self._created_members(record)),
        }

    async def plan(self, record: HistoricalImport, step: str) -> StepUndoPlan:
        if step not in UNDOABLE_STEPS:
            raise UndoNotAllowed("That step cannot be undone.")
        results = record.results if isinstance(record.results, dict) else {}
        plan = StepUndoPlan(step=step, committed=isinstance(results.get(step), dict))
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
        else:
            await self._plan_drills(record, plan)
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
            at = _aware(entry.created_at) or datetime.now(timezone.utc)
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
        entered = {e.record_id: _aware(e.created_at) for e in ledger}
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
        if plan.blocked_by:
            raise UndoNotAllowed(
                f"Undo the {' and '.join(plan.blocked_by)} step first: it builds on "
                f"the {_STEP_LABELS[step]}."
            )
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
        else:
            counts["removed"] = await self._delete_drills(record, plan._remove_ids)
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
            _aware(e.created_at)
            for e in await self._ledger(record, ImportedRecordKind.TRAINING_SESSION)
        ]
        imported_at = {
            e.record_id: _aware(e.created_at)
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

        await void_pending_for_events(self.db, org_id, event_ids, "deleted")
        # The session and its requirement links cascade from the event.
        return await self._delete_ids(Event, org_id, event_ids)

    # ------------------------------------------------------------------
    # Former members the import created
    # ------------------------------------------------------------------

    async def _created_members(self, record: HistoricalImport) -> List[User]:
        reason = f"Created by historical import of {record.source_filename}"[:1000]
        rows = await self.db.execute(
            select(User).where(
                User.organization_id == record.organization_id,
                User.status == UserStatus.ARCHIVED,
                User.status_change_reason == reason,
                User.password_hash.is_(None),
            )
        )
        return list(rows.scalars().all())

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


def _label(kind: ImportedRecordKind, row: Any) -> str:
    """A short description of a kept record for the preview."""
    if kind == ImportedRecordKind.TRAINING_RECORD:
        day = row.completion_date.isoformat() if row.completion_date else "undated"
        return f"{row.course_name} ({day})"
    if kind == ImportedRecordKind.ADMIN_HOURS_ENTRY:
        start = _aware(row.clock_in_at)
        return (
            f"{start.date().isoformat() if start else 'undated'}: "
            f"{round((row.duration_minutes or 0) / 60, 2)} h"
        )
    return str(row.id)
