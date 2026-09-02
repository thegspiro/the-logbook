"""
Equipment Readiness Service

Two fleet-level views over equipment checks that the per-user checklist
endpoints cannot answer:

* **Fleet readiness** — one row per apparatus: is it good, when was it last
  checked and by whom, what is outstanding on it.
* **Check log** — expected checks left-joined onto submitted ones, so a check
  that *did not happen* is a row rather than an absence.

The second is the reason this module exists. ``shift_equipment_checks`` only
records checks that were performed, so every count derived from it alone
silently uses "checks done" as its denominator and can never fall below 100%.
The expected side is reconstructed here from (shift x resolved template), the
same pairing ``get_my_checklists`` walks for one user.

Three rules the reconstruction has to honor, each of which produced a wrong
number when it was left implicit:

1. **Grid columns are shared duty dates; rates are per-apparatus occasions.**
   A rig on a weekly check would read as neglected if its rate were measured
   against a fortnight of calendar days. Columns come from the union of dates
   any apparatus expected a check; each apparatus's rate is measured only
   against the checks *it* expected.
2. **Out of service is not missed.** A rig in the shop cannot be checked, so
   its days are excluded from the denominator rather than counted against the
   crew. Availability is reconstructed from ``apparatus_status_history``, not
   from the apparatus's current status, so a rig that has since returned to
   service still shows the days it was down.
3. **Apparatus identity comes from the shift, not the check.**
   ``ShiftEquipmentCheck.apparatus_id`` is an FK to ``apparatus.id`` and is
   NULL for a department running BasicApparatus (see
   ``utils/apparatus_ref``), so grouping checks by that column would drop
   every row for those departments. Shift-based checks are attributed through
   ``shifts.apparatus_id`` — the polymorphic value the fleet is keyed by —
   and the check's own column is only a fallback for standalone checks.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.apparatus import (
    Apparatus,
    ApparatusStatus,
    ApparatusStatusHistory,
    CheckItemDeployedLot,
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.training import (
    BasicApparatus,
    Shift,
    ShiftEquipmentCheck,
    ShiftStatus,
    ShiftTemplateEquipmentCheck,
)
from app.models.user import User

# Item outcomes that mean the crew found something wrong. "not_checked" is an
# unanswered question rather than a finding, and "not_applicable" means the
# item is not carried on this truck — neither is a deficiency.
FINDING_STATUSES = frozenset({"fail", "out_of_service"})

# Cell / entry outcomes. Ordered worst-first; `_worst` relies on this order to
# collapse several checks on one day into a single cell.
STATUS_OUT_OF_SERVICE = "out_of_service"
STATUS_MISSED = "missed"
STATUS_FAILED = "failed"
STATUS_PARTIAL = "partial"
STATUS_DUE = "due"
STATUS_SCHEDULED = "scheduled"
STATUS_PASSED = "passed"

_SEVERITY = {
    STATUS_OUT_OF_SERVICE: 0,
    STATUS_MISSED: 1,
    STATUS_FAILED: 2,
    STATUS_PARTIAL: 3,
    STATUS_DUE: 4,
    STATUS_SCHEDULED: 5,
    STATUS_PASSED: 6,
}

# Outcomes that count as "the check happened" for a completion rate.
_COUNTS_AS_DONE = frozenset({STATUS_PASSED, STATUS_FAILED})

# Outcomes excluded from a completion rate's denominator entirely: the check
# could not have been done (rig in the shop) or is not late yet.
_NOT_YET_OWED = frozenset({STATUS_OUT_OF_SERVICE, STATUS_SCHEDULED, STATUS_DUE})

# Readiness verdicts for the fleet board.
READY_IN_SERVICE = "in_service"
READY_ATTENTION = "attention"
READY_OUT_OF_SERVICE = "out_of_service"
READY_NO_CHECKS = "no_checks"

MAX_LOG_DATES = 90
DEFAULT_LOG_DATES = 14
DEFAULT_STRIP_DATES = 7
DEFAULT_EXPIRING_DAYS = 30


@dataclass
class FleetUnit:
    """One apparatus, from whichever inventory the department runs.

    ``key`` is the polymorphic ``shifts.apparatus_id`` value — the id the shift
    form was served and the id every other surface in this module keys by.
    ``full_id`` is set only for a full Apparatus record and is what
    apparatus-scoped templates and ``shift_equipment_checks.apparatus_id``
    match on.
    """

    key: str
    label: str
    name: Optional[str] = None
    type_slug: Optional[str] = None
    source: str = "apparatus"
    full_id: Optional[str] = None
    status_label: Optional[str] = None
    status_available: bool = True
    status_reason: Optional[str] = None


@dataclass
class _Occasion:
    """One expected check: a shift, a template, and whatever was submitted."""

    shift_id: str
    shift_date: date
    unit_key: str
    template_id: str
    template_name: str
    check_timing: str
    check: Optional[ShiftEquipmentCheck] = None
    status: str = STATUS_MISSED
    finding_count: int = 0
    findings: List[str] = field(default_factory=list)


def _worst(statuses: Sequence[str]) -> str:
    """The most severe of several outcomes, for collapsing a day into a cell."""
    if not statuses:
        return STATUS_SCHEDULED
    return min(statuses, key=lambda s: _SEVERITY.get(s, 99))


class EquipmentReadinessService:
    """Fleet-level readiness and check-log queries."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_check_log(
        self,
        organization_id: str,
        *,
        dates: int = DEFAULT_LOG_DATES,
        apparatus_id: Optional[str] = None,
        only_user_id: Optional[str] = None,
        today: Optional[date] = None,
    ) -> Dict[str, Any]:
        """Expected-vs-actual checks over the most recent ``dates`` duty days.

        ``only_user_id`` narrows the log to checks that member performed —
        the shape a member without ``inventory.check_view`` gets. It filters
        the *log entries*; the grid is suppressed for that scope because a
        matrix of one member's checks would read as fleet coverage.
        """
        dates = max(1, min(dates, MAX_LOG_DATES))
        today = today or date.today()

        fleet = await self._load_fleet(organization_id)
        if apparatus_id:
            fleet = {k: v for k, v in fleet.items() if k == apparatus_id}
        if not fleet:
            return self._empty_log(dates)

        occasions, columns = await self._build_occasions(
            organization_id, fleet, dates, today
        )

        rows = self._grid_rows(fleet, occasions, columns)
        entries = self._log_entries(fleet, occasions, only_user_id)
        summary = self._log_summary(occasions, only_user_id)

        return {
            "window_dates": dates,
            "dates": [d.isoformat() for d in columns],
            "rows": rows if only_user_id is None else [],
            "scope": "own" if only_user_id else "fleet",
            "entries": entries,
            "summary": summary,
        }

    async def get_fleet_readiness(
        self,
        organization_id: str,
        *,
        strip_dates: int = DEFAULT_STRIP_DATES,
        expiring_days: int = DEFAULT_EXPIRING_DAYS,
        today: Optional[date] = None,
    ) -> Dict[str, Any]:
        """One readiness row per apparatus for the fleet board."""
        strip_dates = max(1, min(strip_dates, MAX_LOG_DATES))
        today = today or date.today()

        fleet = await self._load_fleet(organization_id)
        if not fleet:
            return {
                "generated_at": datetime.now(timezone.utc),
                "expiring_window_days": expiring_days,
                "strip_dates": strip_dates,
                "apparatus": [],
                "totals": self._empty_totals(),
            }

        occasions, columns = await self._build_occasions(
            organization_id, fleet, strip_dates, today
        )
        supply = await self._supply_counts(organization_id, fleet, expiring_days, today)
        open_findings = await self._open_findings(organization_id, fleet, occasions)

        by_unit: Dict[str, List[_Occasion]] = {key: [] for key in fleet}
        for occ in occasions:
            by_unit.setdefault(occ.unit_key, []).append(occ)

        records: List[Dict[str, Any]] = []
        for key, unit in fleet.items():
            unit_occasions = by_unit.get(key, [])
            counts = supply.get(key, {"expiring": 0, "restock": 0})
            findings = open_findings.get(key, {"failed": 0, "out_of_service": 0})
            records.append(
                self._readiness_record(
                    unit, unit_occasions, columns, counts, findings, today
                )
            )

        # Worst first: the board's job is to put whatever needs a decision at
        # the top, and a fleet is short enough that stable ordering matters
        # more than a sort control.
        records.sort(
            key=lambda r: (
                {
                    READY_OUT_OF_SERVICE: 0,
                    READY_ATTENTION: 1,
                    READY_IN_SERVICE: 2,
                    READY_NO_CHECKS: 3,
                }.get(r["readiness"], 4),
                r["unit_label"],
            )
        )

        return {
            "generated_at": datetime.now(timezone.utc),
            "expiring_window_days": expiring_days,
            "strip_dates": strip_dates,
            "apparatus": records,
            "totals": self._fleet_totals(records),
        }

    # ------------------------------------------------------------------
    # Fleet + template loading
    # ------------------------------------------------------------------

    async def _load_fleet(self, organization_id: str) -> Dict[str, FleetUnit]:
        """Every apparatus the department runs, keyed by shift apparatus id.

        Mirrors the priority in ``GET /scheduling/apparatus-options`` — full
        Apparatus records, else BasicApparatus — so the keys here match the
        ids shifts actually carry.
        """
        result = await self.db.execute(
            select(Apparatus, ApparatusStatus)
            .join(ApparatusStatus, Apparatus.status_id == ApparatusStatus.id)
            .options(selectinload(Apparatus.apparatus_type))
            .where(
                Apparatus.organization_id == organization_id,
                Apparatus.is_archived.is_(False),
            )
        )
        rows = result.all()
        if rows:
            fleet: Dict[str, FleetUnit] = {}
            for apparatus, status in rows:
                type_name = getattr(apparatus.apparatus_type, "name", None)
                key = str(apparatus.id)
                fleet[key] = FleetUnit(
                    key=key,
                    label=apparatus.unit_number or apparatus.name or "",
                    name=apparatus.name,
                    type_slug=type_name.lower() if type_name else None,
                    source="apparatus",
                    full_id=key,
                    status_label=status.name,
                    status_available=bool(status.is_available),
                    status_reason=apparatus.status_reason,
                )
            return fleet

        basic_result = await self.db.execute(
            select(BasicApparatus).where(
                BasicApparatus.organization_id == organization_id,
                BasicApparatus.is_active.is_(True),
            )
        )
        return {
            str(row.id): FleetUnit(
                key=str(row.id),
                label=row.unit_number or row.name or "",
                name=row.name,
                type_slug=(row.apparatus_type or "").lower() or None,
                source="basic",
            )
            for row in basic_result.scalars().all()
        }

    async def _load_templates(self, organization_id: str) -> Tuple[
        Dict[str, List[EquipmentCheckTemplate]],
        Dict[str, List[Any]],
        Dict[str, EquipmentCheckTemplate],
    ]:
        """Active templates grouped by apparatus id, by apparatus type, and by id.

        The batched counterpart of ``EquipmentCheckService._resolve_templates``,
        which issues two queries per shift. A fortnight of a five-rig fleet is
        seventy-odd shifts, so resolving per shift is the difference between
        two queries and a hundred and forty.

        The by-id map is what a shift template's explicit links resolve
        through. It holds only *active* templates, which is why a link to a
        deactivated checklist contributes no expected check rather than a
        permanently missed one.
        """
        result = await self.db.execute(
            select(EquipmentCheckTemplate).where(
                EquipmentCheckTemplate.organization_id == organization_id,
                EquipmentCheckTemplate.is_active.is_(True),
            )
        )
        by_apparatus: Dict[str, List[EquipmentCheckTemplate]] = {}
        by_type: Dict[str, List[EquipmentCheckTemplate]] = {}
        by_id: Dict[str, EquipmentCheckTemplate] = {}
        for tmpl in result.scalars().all():
            by_id[str(tmpl.id)] = tmpl
            if tmpl.apparatus_id:
                by_apparatus.setdefault(str(tmpl.apparatus_id), []).append(tmpl)
            elif tmpl.apparatus_type:
                by_type.setdefault(tmpl.apparatus_type.lower(), []).append(tmpl)
        return by_apparatus, by_type, by_id

    async def _load_shift_template_links(
        self, organization_id: str
    ) -> Dict[str, List[str]]:
        """Checklist ids each shift template names, keyed by shift template.

        A shift template absent from this map named none, and its shifts fall
        back to apparatus resolution. One present maps to exactly what its
        officer chose — including, after inactive checklists are dropped, to
        nothing.
        """
        result = await self.db.execute(
            select(
                ShiftTemplateEquipmentCheck.shift_template_id,
                ShiftTemplateEquipmentCheck.equipment_check_template_id,
            )
            .where(ShiftTemplateEquipmentCheck.organization_id == organization_id)
            .order_by(ShiftTemplateEquipmentCheck.sort_order)
        )
        links: Dict[str, List[str]] = {}
        for shift_template_id, check_template_id in result.all():
            links.setdefault(str(shift_template_id), []).append(str(check_template_id))
        return links

    @staticmethod
    def _templates_for(
        unit: FleetUnit,
        by_apparatus: Dict[str, List[EquipmentCheckTemplate]],
        by_type: Dict[str, List[Any]],
    ) -> List[EquipmentCheckTemplate]:
        """Apparatus-specific templates, else the type's — never both.

        Same precedence as ``_resolve_templates``: a template written for this
        truck replaces the type default rather than adding to it.
        """
        if unit.full_id:
            specific = by_apparatus.get(unit.full_id)
            if specific:
                return specific
        if unit.type_slug:
            return by_type.get(unit.type_slug, [])
        return []

    # ------------------------------------------------------------------
    # Expected vs actual
    # ------------------------------------------------------------------

    async def _build_occasions(
        self,
        organization_id: str,
        fleet: Dict[str, FleetUnit],
        dates: int,
        today: date,
    ) -> Tuple[List[_Occasion], List[date]]:
        """Every expected check in the window, with whatever was submitted.

        Returns the occasions and the shared date columns (ascending). The
        window is walked backwards from today over shifts that exist, so a
        department that runs shifts three days a week gets ``dates`` columns
        of real duty days rather than a fortnight mostly made of blanks.
        """
        by_apparatus, by_type, by_id = await self._load_templates(organization_id)
        links = await self._load_shift_template_links(organization_id)

        # Look back generously to find `dates` distinct duty days, then trim.
        # Four times the window covers a department running shifts twice a
        # week; beyond that the lookback caps rather than scanning all history.
        lookback = min(max(dates * 4, dates + 30), 400)
        result = await self.db.execute(
            select(Shift).where(
                Shift.organization_id == organization_id,
                Shift.shift_date >= today - timedelta(days=lookback),
                Shift.shift_date <= today,
                Shift.status != ShiftStatus.CANCELLED,
                Shift.apparatus_id.in_(list(fleet.keys())),
            )
        )
        shifts = list(result.scalars().all())
        if not shifts:
            return [], []

        # Only dates that actually expected a check become columns — a shift on
        # a rig with no template configured is not a missed check.
        expected: List[Tuple[Shift, EquipmentCheckTemplate]] = []
        for shift in shifts:
            unit = fleet.get(str(shift.apparatus_id or ""))
            if unit is None:
                continue
            # A shift template that names checklists replaces apparatus
            # resolution, matching _resolve_templates. Disagreeing here would
            # report a rig compliant or missed against a checklist set the crew
            # was never shown.
            linked = links.get(str(getattr(shift, "template_id", None) or ""))
            templates = (
                [by_id[tid] for tid in linked if tid in by_id]
                if linked is not None
                else self._templates_for(unit, by_apparatus, by_type)
            )
            for tmpl in templates:
                expected.append((shift, tmpl))

        if not expected:
            return [], []

        column_dates = sorted({shift.shift_date for shift, _ in expected})[-dates:]
        column_set = set(column_dates)
        expected = [(s, t) for s, t in expected if s.shift_date in column_set]
        if not expected:
            return [], []

        checks = await self._load_checks(
            organization_id, [str(s.id) for s, _ in expected]
        )
        unavailable = await self._unavailable_dates(
            organization_id, fleet, column_dates[0], column_dates[-1]
        )

        occasions: List[_Occasion] = []
        for shift, tmpl in expected:
            unit_key = str(shift.apparatus_id)
            check = checks.get((str(shift.id), str(tmpl.id)))
            occ = _Occasion(
                shift_id=str(shift.id),
                shift_date=shift.shift_date,
                unit_key=unit_key,
                template_id=str(tmpl.id),
                template_name=tmpl.name,
                check_timing=tmpl.check_timing,
                check=check,
            )
            if check is not None:
                occ.status = self._status_for_check(check)
                occ.findings = [
                    item.item_name
                    for item in check.items
                    if item.status in FINDING_STATUSES
                ]
                occ.finding_count = len(occ.findings)
            elif shift.shift_date in unavailable.get(unit_key, set()):
                occ.status = STATUS_OUT_OF_SERVICE
            elif shift.shift_date > today:
                occ.status = STATUS_SCHEDULED
            elif shift.shift_date == today:
                occ.status = STATUS_DUE
            else:
                occ.status = STATUS_MISSED
            occasions.append(occ)

        return occasions, column_dates

    async def _load_checks(
        self, organization_id: str, shift_ids: List[str]
    ) -> Dict[Tuple[str, str], ShiftEquipmentCheck]:
        """Submitted checks for these shifts, keyed by (shift, template)."""
        if not shift_ids:
            return {}
        result = await self.db.execute(
            select(ShiftEquipmentCheck)
            .options(selectinload(ShiftEquipmentCheck.items))
            .where(
                ShiftEquipmentCheck.organization_id == organization_id,
                ShiftEquipmentCheck.shift_id.in_(shift_ids),
            )
        )
        checks: Dict[Tuple[str, str], ShiftEquipmentCheck] = {}
        for check in result.scalars().all():
            if not check.template_id:
                continue
            checks[(str(check.shift_id), str(check.template_id))] = check
        return checks

    @staticmethod
    def _status_for_check(check: ShiftEquipmentCheck) -> str:
        """Collapse a submitted check to one outcome.

        An out-of-service item outranks an ordinary failure: both mean the
        crew found something, but only one of them takes the truck off the
        road, and the board is read for that distinction.
        """
        if any(item.status == STATUS_OUT_OF_SERVICE for item in check.items):
            return STATUS_OUT_OF_SERVICE
        if check.overall_status == "incomplete":
            return STATUS_PARTIAL
        if (check.failed_items or 0) > 0 or check.overall_status == "fail":
            return STATUS_FAILED
        return STATUS_PASSED

    async def _unavailable_dates(
        self,
        organization_id: str,
        fleet: Dict[str, FleetUnit],
        start: date,
        end: date,
    ) -> Dict[str, Set[date]]:
        """Dates each apparatus was out of service, from status history.

        Reconstructed from the history rather than the apparatus's current
        status: a rig that went to the shop last Tuesday and came back Friday
        must still show those three days excluded, which the current status
        cannot express. The state *entering* the window comes from the last
        change before it, so a rig that has been down for a month is not read
        as available merely because nothing changed inside the window.
        """
        full_ids = [u.full_id for u in fleet.values() if u.full_id]
        if not full_ids:
            return {}

        result = await self.db.execute(
            select(ApparatusStatusHistory, ApparatusStatus.is_available)
            .join(
                ApparatusStatus,
                ApparatusStatusHistory.status_id == ApparatusStatus.id,
            )
            .where(
                ApparatusStatusHistory.organization_id == organization_id,
                ApparatusStatusHistory.apparatus_id.in_(full_ids),
            )
            .order_by(ApparatusStatusHistory.changed_at.asc())
        )
        transitions: Dict[str, List[Tuple[date, bool]]] = {}
        for history, is_available in result.all():
            changed = history.changed_at
            if changed is None:
                continue
            transitions.setdefault(str(history.apparatus_id), []).append(
                (changed.date(), bool(is_available))
            )

        unavailable: Dict[str, Set[date]] = {}
        for unit in fleet.values():
            if not unit.full_id:
                continue
            changes = transitions.get(unit.full_id)
            if not changes:
                # No history: the rig has never changed status, so its current
                # one has applied for the whole window.
                if not unit.status_available:
                    unavailable[unit.key] = self._date_range(start, end)
                continue

            available = self._state_entering(changes, start, unit.status_available)
            down: Set[date] = set()
            index = 0
            for day in self._date_range_sorted(start, end):
                while index < len(changes) and changes[index][0] <= day:
                    available = changes[index][1]
                    index += 1
                if not available:
                    down.add(day)
            if down:
                unavailable[unit.key] = down
        return unavailable

    @staticmethod
    def _state_entering(
        changes: List[Tuple[date, bool]], start: date, fallback: bool
    ) -> bool:
        """Availability on the day the window opens."""
        entering = None
        for changed_on, available in changes:
            if changed_on <= start:
                entering = available
            else:
                break
        if entering is not None:
            return entering
        # Every recorded change is after the window opened, so the earliest one
        # tells us what the rig was moving away from — not what it was. Fall
        # back to assuming it was available, which is what an absent history
        # already means everywhere else.
        return fallback if not changes else True

    @staticmethod
    def _date_range_sorted(start: date, end: date) -> List[date]:
        days: List[date] = []
        cursor = start
        while cursor <= end:
            days.append(cursor)
            cursor += timedelta(days=1)
        return days

    @classmethod
    def _date_range(cls, start: date, end: date) -> Set[date]:
        return set(cls._date_range_sorted(start, end))

    # ------------------------------------------------------------------
    # Grid, log, summary
    # ------------------------------------------------------------------

    def _grid_rows(
        self,
        fleet: Dict[str, FleetUnit],
        occasions: List[_Occasion],
        columns: List[date],
    ) -> List[Dict[str, Any]]:
        """One matrix row per apparatus, with a cell per shared date column."""
        grouped: Dict[str, Dict[date, List[_Occasion]]] = {}
        for occ in occasions:
            grouped.setdefault(occ.unit_key, {}).setdefault(occ.shift_date, []).append(
                occ
            )

        rows: List[Dict[str, Any]] = []
        for key, unit in fleet.items():
            by_date = grouped.get(key, {})
            if not by_date:
                continue
            cells = []
            for day in columns:
                day_occasions = by_date.get(day, [])
                cells.append(
                    {
                        "date": day.isoformat(),
                        "status": (
                            _worst([o.status for o in day_occasions])
                            if day_occasions
                            else None
                        ),
                        "checks": [
                            {
                                "check_id": o.check.id if o.check else None,
                                "template_name": o.template_name,
                                "check_timing": o.check_timing,
                                "status": o.status,
                                "finding_count": o.finding_count,
                            }
                            for o in sorted(
                                day_occasions,
                                key=lambda o: (
                                    0 if o.check_timing == "start_of_shift" else 1
                                ),
                            )
                        ],
                    }
                )
            unit_occasions = [o for lst in by_date.values() for o in lst]
            owed, done = self._rate_parts(unit_occasions)
            rows.append(
                {
                    "apparatus_id": key,
                    "unit_label": unit.label,
                    "apparatus_type": unit.type_slug,
                    "cells": cells,
                    "expected": owed,
                    "completed": done,
                    "completion_rate": self._rate(owed, done),
                }
            )
        rows.sort(key=lambda r: r["unit_label"])
        return rows

    def _log_entries(
        self,
        fleet: Dict[str, FleetUnit],
        occasions: List[_Occasion],
        only_user_id: Optional[str],
    ) -> List[Dict[str, Any]]:
        """Chronological rows, newest first — including the ones that did not
        happen, which is the whole point of the expected side."""
        entries: List[Dict[str, Any]] = []
        for occ in occasions:
            check = occ.check
            if only_user_id is not None:
                if check is None or str(check.checked_by or "") != only_user_id:
                    continue
            # A check not yet owed is not a log line; the grid already shows
            # it as an upcoming column.
            if check is None and occ.status in {STATUS_SCHEDULED, STATUS_DUE}:
                continue
            unit = fleet.get(occ.unit_key)
            entries.append(
                {
                    "check_id": check.id if check else None,
                    "shift_id": occ.shift_id,
                    "shift_date": occ.shift_date.isoformat(),
                    "apparatus_id": occ.unit_key,
                    "unit_label": unit.label if unit else "",
                    "template_id": occ.template_id,
                    "template_name": occ.template_name,
                    "check_timing": occ.check_timing,
                    "status": occ.status,
                    "checked_at": check.checked_at if check else None,
                    "checked_by": str(check.checked_by) if check else None,
                    "checked_by_name": None,
                    "total_items": check.total_items if check else None,
                    "completed_items": check.completed_items if check else None,
                    "failed_items": check.failed_items if check else None,
                    "finding_count": occ.finding_count,
                    "findings": occ.findings[:5],
                }
            )
        entries.sort(
            key=lambda e: (e["shift_date"], e["checked_at"] is not None), reverse=True
        )
        return entries

    def _log_summary(
        self, occasions: List[_Occasion], only_user_id: Optional[str]
    ) -> Dict[str, Any]:
        scoped = occasions
        if only_user_id is not None:
            scoped = [
                o
                for o in occasions
                if o.check is not None and str(o.check.checked_by or "") == only_user_id
            ]
        owed, done = self._rate_parts(scoped)
        return {
            "expected": owed,
            "completed": done,
            "completion_rate": self._rate(owed, done),
            "missed": sum(1 for o in scoped if o.status == STATUS_MISSED),
            "with_findings": sum(1 for o in scoped if o.finding_count > 0),
            "out_of_service_days": sum(
                1 for o in scoped if o.status == STATUS_OUT_OF_SERVICE
            ),
        }

    @staticmethod
    def _rate_parts(occasions: Sequence[_Occasion]) -> Tuple[int, int]:
        """(owed, done) for a completion rate.

        Out-of-service and not-yet-due occasions leave the denominator rather
        than counting against the crew — see rule 2 in the module docstring.
        """
        owed = sum(1 for o in occasions if o.status not in _NOT_YET_OWED)
        done = sum(1 for o in occasions if o.status in _COUNTS_AS_DONE)
        return owed, done

    @staticmethod
    def _rate(owed: int, done: int) -> Optional[float]:
        if owed <= 0:
            return None
        return round(done / owed * 100, 1)

    @staticmethod
    def _empty_totals() -> Dict[str, int]:
        return {
            "in_service": 0,
            "attention": 0,
            "out_of_service": 0,
            "no_checks": 0,
            "due_today": 0,
            "overdue": 0,
            "open_findings": 0,
            "expiring_items": 0,
        }

    @staticmethod
    def _empty_log(dates: int) -> Dict[str, Any]:
        return {
            "window_dates": dates,
            "dates": [],
            "rows": [],
            "scope": "fleet",
            "entries": [],
            "summary": {
                "expected": 0,
                "completed": 0,
                "completion_rate": None,
                "missed": 0,
                "with_findings": 0,
                "out_of_service_days": 0,
            },
        }

    # ------------------------------------------------------------------
    # Fleet readiness detail
    # ------------------------------------------------------------------

    async def _supply_counts(
        self,
        organization_id: str,
        fleet: Dict[str, FleetUnit],
        expiring_days: int,
        today: date,
    ) -> Dict[str, Dict[str, int]]:
        """Expiring and restock-needed item counts per apparatus.

        Only apparatus-scoped templates can attribute an item to a truck; a
        type-level template describes every rig of that type and its items are
        deliberately left out of a per-rig count rather than counted against
        all of them.
        """
        cutoff = today + timedelta(days=expiring_days)
        result = await self.db.execute(
            select(
                EquipmentCheckTemplate.apparatus_id,
                CheckTemplateItem.id,
                CheckTemplateItem.has_expiration,
                CheckTemplateItem.expiration_date,
                CheckTemplateItem.restock_needed,
            )
            .join(
                CheckTemplateCompartment,
                CheckTemplateCompartment.id == CheckTemplateItem.compartment_id,
            )
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id == CheckTemplateCompartment.template_id,
            )
            .where(
                EquipmentCheckTemplate.organization_id == organization_id,
                EquipmentCheckTemplate.is_active.is_(True),
                EquipmentCheckTemplate.apparatus_id.isnot(None),
            )
        )
        rows = result.all()
        if not rows:
            return {}

        item_ids = [row[1] for row in rows]
        lot_result = await self.db.execute(
            select(CheckItemDeployedLot.template_item_id).where(
                CheckItemDeployedLot.organization_id == organization_id,
                CheckItemDeployedLot.template_item_id.in_(item_ids),
                CheckItemDeployedLot.quantity > 0,
                CheckItemDeployedLot.expiration_date.isnot(None),
                CheckItemDeployedLot.expiration_date <= cutoff,
            )
        )
        expiring_by_lot = {str(r) for r in lot_result.scalars().all()}

        # Templates key on the full apparatus id; the fleet keys on the shift's
        # polymorphic one. They are the same value for a full-Apparatus
        # department and there are no apparatus-scoped templates for a basic
        # one, so this map is exact rather than lossy.
        by_full_id = {u.full_id: u.key for u in fleet.values() if u.full_id}

        counts: Dict[str, Dict[str, int]] = {}
        for apparatus_id, item_id, has_expiration, expiration, restock in rows:
            key = by_full_id.get(str(apparatus_id))
            if key is None:
                continue
            bucket = counts.setdefault(key, {"expiring": 0, "restock": 0})
            soon = bool(has_expiration and expiration and expiration <= cutoff)
            if soon or str(item_id) in expiring_by_lot:
                bucket["expiring"] += 1
            if restock:
                bucket["restock"] += 1
        return counts

    async def _open_findings(
        self,
        organization_id: str,
        fleet: Dict[str, FleetUnit],
        occasions: List[_Occasion],
    ) -> Dict[str, Dict[str, int]]:
        """Findings on each apparatus's most recent check per template.

        Derived rather than tracked: with no deficiency record, "still open"
        can only mean "the last time anyone looked, it was broken". Counting
        every failure in the window instead would keep reporting a fault that
        was fixed the next morning.
        """
        latest: Dict[Tuple[str, str], _Occasion] = {}
        for occ in occasions:
            if occ.check is None:
                continue
            key = (occ.unit_key, occ.template_id)
            current = latest.get(key)
            if current is None or occ.shift_date > current.shift_date:
                latest[key] = occ

        counts: Dict[str, Dict[str, int]] = {}
        for (unit_key, _), occ in latest.items():
            bucket = counts.setdefault(unit_key, {"failed": 0, "out_of_service": 0})
            check = occ.check
            if check is None:
                continue
            for item in check.items:
                if item.status == STATUS_OUT_OF_SERVICE:
                    bucket["out_of_service"] += 1
                elif item.status == "fail":
                    bucket["failed"] += 1
        return counts

    def _readiness_record(
        self,
        unit: FleetUnit,
        occasions: List[_Occasion],
        columns: List[date],
        supply: Dict[str, int],
        findings: Dict[str, int],
        today: date,
    ) -> Dict[str, Any]:
        """Build one fleet-board row, verdict included."""
        submitted = [o for o in occasions if o.check is not None]
        submitted.sort(
            key=lambda o: (
                o.check.checked_at or datetime.min.replace(tzinfo=timezone.utc)
            )
        )
        last = submitted[-1] if submitted else None

        due_today = sum(1 for o in occasions if o.status == STATUS_DUE)
        overdue = sum(1 for o in occasions if o.status == STATUS_MISSED)
        partial = next((o for o in occasions if o.status == STATUS_PARTIAL), None)

        by_date = {o.shift_date: [] for o in occasions}
        for occ in occasions:
            by_date[occ.shift_date].append(occ.status)
        strip = [
            {
                "date": day.isoformat(),
                "status": _worst(by_date[day]) if day in by_date else None,
            }
            for day in columns
        ]

        owed, done = self._rate_parts(occasions)
        readiness, reason = self._verdict(
            unit, occasions, findings, overdue, due_today, partial is not None
        )

        return {
            "apparatus_id": unit.key,
            "unit_label": unit.label,
            "name": unit.name,
            "apparatus_type": unit.type_slug,
            "source": unit.source,
            "readiness": readiness,
            "readiness_reason": reason,
            "status_label": unit.status_label,
            "status_reason": unit.status_reason,
            "last_check_at": last.check.checked_at if last and last.check else None,
            "last_check_by": (
                str(last.check.checked_by) if last and last.check else None
            ),
            "last_check_by_name": None,
            "last_check_status": last.status if last else None,
            "last_check_id": last.check.id if last and last.check else None,
            "open_check_id": partial.check.id if partial and partial.check else None,
            "failed_item_count": findings.get("failed", 0),
            "out_of_service_item_count": findings.get("out_of_service", 0),
            "expiring_item_count": supply.get("expiring", 0),
            "restock_item_count": supply.get("restock", 0),
            "due_today_count": due_today,
            "overdue_count": overdue,
            "expected": owed,
            "completed": done,
            "completion_rate": self._rate(owed, done),
            "recent": strip,
            "as_of": today.isoformat(),
        }

    @staticmethod
    def _verdict(
        unit: FleetUnit,
        occasions: List[_Occasion],
        findings: Dict[str, int],
        overdue: int,
        due_today: int,
        has_partial: bool,
    ) -> Tuple[str, str]:
        """Decide the readiness pill and say why in one sentence.

        This is a claim the app makes on the department's behalf, so the rule
        is deliberately conservative and every verdict carries its reason:
        an officer who disagrees can see what drove it. Only two things take a
        rig off the road — the apparatus module's own status, and an item a
        crew marked out of service — because those are the two places someone
        made that call explicitly.
        """
        if not unit.status_available:
            label = unit.status_label or "Out of service"
            return READY_OUT_OF_SERVICE, f"Apparatus status is {label}."
        if findings.get("out_of_service", 0) > 0:
            count = findings["out_of_service"]
            noun = "item" if count == 1 else "items"
            return (
                READY_OUT_OF_SERVICE,
                f"{count} {noun} marked out of service on the last check.",
            )
        if not occasions:
            return READY_NO_CHECKS, "No check templates configured for this apparatus."
        if overdue > 0:
            noun = "check" if overdue == 1 else "checks"
            return READY_ATTENTION, f"{overdue} {noun} missed."
        if findings.get("failed", 0) > 0:
            count = findings["failed"]
            noun = "item" if count == 1 else "items"
            return READY_ATTENTION, f"{count} {noun} failed on the last check."
        if has_partial:
            return READY_ATTENTION, "A check was started but not finished."
        if due_today > 0:
            noun = "check" if due_today == 1 else "checks"
            return READY_IN_SERVICE, f"{due_today} {noun} due today."
        return READY_IN_SERVICE, "Checks current, nothing outstanding."

    @staticmethod
    def _fleet_totals(records: List[Dict[str, Any]]) -> Dict[str, int]:
        totals = EquipmentReadinessService._empty_totals()
        for record in records:
            totals[record["readiness"]] = totals.get(record["readiness"], 0) + 1
            totals["due_today"] += record["due_today_count"]
            totals["overdue"] += record["overdue_count"]
            totals["open_findings"] += (
                record["failed_item_count"] + record["out_of_service_item_count"]
            )
            totals["expiring_items"] += record["expiring_item_count"]
        return totals

    # ------------------------------------------------------------------
    # Name resolution
    # ------------------------------------------------------------------

    async def resolve_user_names(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Fill in the ``*_by_name`` fields left null by the builders.

        Done in one pass at the end so the per-apparatus and per-entry builders
        stay free of queries.
        """
        user_ids: Set[str] = set()
        for record in payload.get("apparatus", []) or []:
            if record.get("last_check_by"):
                user_ids.add(record["last_check_by"])
        for entry in payload.get("entries", []) or []:
            if entry.get("checked_by"):
                user_ids.add(entry["checked_by"])
        if not user_ids:
            return payload

        result = await self.db.execute(select(User).where(User.id.in_(list(user_ids))))
        names = {
            str(u.id): f"{u.first_name or ''} {u.last_name or ''}".strip()
            for u in result.scalars().all()
        }
        for record in payload.get("apparatus", []) or []:
            record["last_check_by_name"] = names.get(record.get("last_check_by") or "")
        for entry in payload.get("entries", []) or []:
            entry["checked_by_name"] = names.get(entry.get("checked_by") or "")
        return payload


__all__ = [
    "EquipmentReadinessService",
    "FleetUnit",
    "READY_ATTENTION",
    "READY_IN_SERVICE",
    "READY_NO_CHECKS",
    "READY_OUT_OF_SERVICE",
]
