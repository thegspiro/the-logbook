"""
Shift history import: drafts, review, and the commit that writes the schedule.

The rules (parsing, matching, joining, grouping) live in
``shift_history_import_engine`` as pure functions. This service loads what
those rules need from the database, stores the reviewer's decisions on the
draft, and turns a clean analysis into records.

**What a commit writes, and what it deliberately does not.** An imported shift
is a finalized ``Shift`` with a confirmed ``ShiftAssignment`` and a
``ShiftAttendance`` per member, which is exactly what the hours report, My
Hours and shift-credited compliance count. It does **not** go through
``SchedulingService.finalize_shift``: that path notifies the officer, enforces
end-of-shift equipment checks and drafts trainee completion reports, all of
which are about a shift that just happened and would be noise — or a flood of
notifications — for one from 2019. Time on another agency's unit becomes
``ExternalShiftHours``, counted on arrival like a member's own entry.

A commit is final. There is no batch undo; imported shifts are corrected one
at a time like any other shift.
"""

import copy
import csv
import io
import re
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.apparatus import Apparatus
from app.models.external_shift_hours import (
    ExternalAgency,
    ExternalApparatus,
    ExternalShiftHours,
    ExternalShiftHoursStatus,
)
from app.models.shift_history_import import (
    ShiftHistoryImport,
    ShiftHistoryImportRow,
    ShiftHistoryImportStatus,
)
from app.models.training import (
    AssignmentStatus,
    BasicApparatus,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
    ShiftStatus,
)
from app.models.user import Organization, User, UserStatus
from app.services import shift_history_import_engine as engine
from app.services.scheduling_service import SchedulingService
from app.utils.org_timezone import scheduling_timezone
from app.utils.positions import (
    CANONICAL_POSITIONS,
    UnknownSeatError,
    resolve_department_seat,
)

_DRAFT = ShiftHistoryImportStatus.DRAFT.value
_COMMITTED = ShiftHistoryImportStatus.COMMITTED.value

# Placeholder addresses for imported former members the file gave no email.
# ``.invalid`` is reserved (RFC 2606) and can never resolve, so nothing sent to
# one can reach a stranger, and the address is plainly not a real one to
# whoever reads the member record.
_PLACEHOLDER_EMAIL_DOMAIN = "import.invalid"

_MATCH_DECISIONS = ("accept", "separate")


class ImportNotFound(LookupError):
    pass


class ImportNotDraft(ValueError):
    pass


class ImportNotReady(ValueError):
    """Commit refused: issues remain, or there is nothing to write."""


def decode_upload(contents: bytes) -> str:
    try:
        return contents.decode("utf-8-sig")
    except UnicodeDecodeError:
        # Spreadsheet exports from older Windows tools are often cp1252;
        # latin-1 decodes any byte sequence, so it is the last resort.
        return contents.decode("latin-1")


def read_csv(text: str) -> Tuple[List[str], List[Dict[str, str]]]:
    """Header row and data rows, refusing what cannot be imported faithfully."""
    reader = csv.reader(io.StringIO(text))
    try:
        header_row = next(reader)
    except StopIteration:
        raise ValueError("The file is empty.")
    headers = [h.strip() for h in header_row]
    if not any(headers):
        raise ValueError("The file has no header row.")
    named = [h for h in headers if h]
    if len(set(h.casefold() for h in named)) != len(named):
        raise ValueError(
            "The header row repeats a column name. Rename the duplicate so "
            "each column can be told apart."
        )
    rows: List[Dict[str, str]] = []
    for cells in reader:
        if not any(c.strip() for c in cells):
            continue
        rows.append(
            {
                header: (cells[i] if i < len(cells) else "")
                for i, header in enumerate(headers)
                if header
            }
        )
        if len(rows) > engine.MAX_IMPORT_ROWS:
            raise ValueError(
                f"The file has more than {engine.MAX_IMPORT_ROWS:,} rows. Split "
                "it — by year, for example — and import each part."
            )
    if not rows:
        raise ValueError("The file has a header row but no data rows.")
    return [h for h in headers if h], rows


def template_csv() -> List[List[str]]:
    return [list(engine.TEMPLATE_HEADERS)]


def _validate_timezone(name: str) -> str:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"'{name}' is not a time zone.")
    return name


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", ".", value.casefold()).strip(".")


class ShiftHistoryImportService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Drafts
    # ------------------------------------------------------------------

    async def create_draft(
        self,
        organization_id: str,
        created_by: str,
        filename: str,
        text: str,
        timezone_name: Optional[str],
    ) -> ShiftHistoryImport:
        headers, rows = read_csv(text)
        if timezone_name:
            tz_name = _validate_timezone(timezone_name)
        else:
            org = await self._organization(organization_id)
            tz_name = scheduling_timezone(org).key
        draft = ShiftHistoryImport(
            id=generate_uuid(),
            organization_id=str(organization_id),
            status=_DRAFT,
            source_filename=filename[:255],
            timezone=tz_name,
            headers=headers,
            column_mapping=engine.detect_column_mapping(headers),
            member_mappings={},
            unit_mappings={},
            position_mappings={},
            existing_shift_decisions={},
            row_count=len(rows),
            created_by=str(created_by),
        )
        self.db.add(draft)
        await self.db.flush()
        self.db.add_all(
            ShiftHistoryImportRow(
                id=generate_uuid(),
                import_id=draft.id,
                # Line 1 is the header; blank lines were dropped, so this is
                # the data row's position, which matches the file whenever it
                # has no blank lines in it.
                line_number=index + 2,
                raw=row,
                excluded=False,
            )
            for index, row in enumerate(rows)
        )
        await self.db.commit()
        await self.db.refresh(draft)
        return draft

    async def list_imports(self, organization_id: str) -> List[ShiftHistoryImport]:
        result = await self.db.execute(
            select(ShiftHistoryImport)
            .where(ShiftHistoryImport.organization_id == str(organization_id))
            .order_by(ShiftHistoryImport.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_import(
        self, organization_id: str, import_id: str, *, for_update: bool = False
    ) -> ShiftHistoryImport:
        query = select(ShiftHistoryImport).where(
            ShiftHistoryImport.id == str(import_id),
            ShiftHistoryImport.organization_id == str(organization_id),
        )
        if for_update:
            query = query.with_for_update()
        found: Optional[ShiftHistoryImport] = (
            await self.db.execute(query)
        ).scalar_one_or_none()
        if found is None:
            raise ImportNotFound("Import not found")
        return found

    async def get_draft(
        self, organization_id: str, import_id: str, *, for_update: bool = False
    ) -> ShiftHistoryImport:
        draft = await self.get_import(organization_id, import_id, for_update=for_update)
        if draft.status != _DRAFT:
            raise ImportNotDraft(
                "This import has been committed and can no longer be changed. "
                "Correct its shifts individually."
            )
        return draft

    async def rows(self, draft: ShiftHistoryImport) -> List[ShiftHistoryImportRow]:
        result = await self.db.execute(
            select(ShiftHistoryImportRow)
            .where(ShiftHistoryImportRow.import_id == draft.id)
            .order_by(ShiftHistoryImportRow.line_number)
        )
        return list(result.scalars().all())

    async def discard(self, organization_id: str, import_id: str) -> None:
        draft = await self.get_draft(organization_id, import_id, for_update=True)
        await self.db.delete(draft)
        await self.db.commit()

    # ------------------------------------------------------------------
    # Review edits
    # ------------------------------------------------------------------

    async def update_settings(
        self,
        draft: ShiftHistoryImport,
        *,
        timezone_name: Optional[str] = None,
        column_mapping: Optional[Mapping[str, Optional[str]]] = None,
    ) -> None:
        if timezone_name is not None:
            draft.timezone = _validate_timezone(timezone_name)
        if column_mapping is not None:
            headers = set(draft.headers or [])
            cleaned: Dict[str, str] = {}
            for field_name, header in column_mapping.items():
                if field_name not in engine.FIELDS:
                    raise ValueError(f"'{field_name}' is not an import field.")
                if header is None or header == "":
                    continue
                if header not in headers:
                    raise ValueError(f"'{header}' is not a column in the file.")
                if header in cleaned.values():
                    raise ValueError(f"'{header}' is mapped to two fields.")
                cleaned[field_name] = header
            draft.column_mapping = cleaned
        await self.db.commit()

    async def update_row(
        self,
        draft: ShiftHistoryImport,
        row_id: str,
        *,
        edits: Optional[Mapping[str, Optional[str]]] = None,
        excluded: Optional[bool] = None,
        match_decision: Optional[str] = None,
        clear_match_decision: bool = False,
    ) -> ShiftHistoryImportRow:
        row: Optional[ShiftHistoryImportRow] = (
            await self.db.execute(
                select(ShiftHistoryImportRow).where(
                    ShiftHistoryImportRow.id == str(row_id),
                    ShiftHistoryImportRow.import_id == draft.id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise ImportNotFound("Row not found")
        if edits is not None:
            merged = copy.deepcopy(row.edits or {})
            for field_name, value in edits.items():
                if field_name not in engine.FIELDS:
                    raise ValueError(f"'{field_name}' is not an import field.")
                if value is None:
                    merged.pop(field_name, None)
                else:
                    merged[field_name] = str(value)
            row.edits = merged or None
        if excluded is not None:
            row.excluded = excluded
        if clear_match_decision:
            row.match_decision = None
        elif match_decision is not None:
            if match_decision not in _MATCH_DECISIONS:
                raise ValueError("Decision must be 'accept' or 'separate'.")
            row.match_decision = match_decision
        await self.db.commit()
        return row

    async def update_mappings(
        self,
        draft: ShiftHistoryImport,
        *,
        members: Optional[Mapping[str, Optional[Mapping[str, Any]]]] = None,
        units: Optional[Mapping[str, Optional[Mapping[str, Any]]]] = None,
        positions: Optional[Mapping[str, Optional[Mapping[str, Any]]]] = None,
        existing_shifts: Optional[Mapping[str, Optional[str]]] = None,
    ) -> None:
        org = draft.organization_id
        if members:
            stored = copy.deepcopy(draft.member_mappings or {})
            for key, mapping in members.items():
                if mapping is None:
                    stored.pop(key, None)
                    continue
                stored[key] = await self._validated_member_mapping(org, mapping)
            draft.member_mappings = stored
        if units:
            stored = copy.deepcopy(draft.unit_mappings or {})
            for key, mapping in units.items():
                if mapping is None:
                    stored.pop(key, None)
                    continue
                stored[key] = await self._validated_unit_mapping(org, mapping)
            draft.unit_mappings = stored
        if positions:
            stored = copy.deepcopy(draft.position_mappings or {})
            seats = await SchedulingService(self.db).department_seat_names(org)
            for key, mapping in positions.items():
                if mapping is None:
                    stored.pop(key, None)
                    continue
                try:
                    seat = resolve_department_seat(mapping.get("seat"), seats)
                except UnknownSeatError as exc:
                    raise ValueError(str(exc))
                stored[key] = {"seat": seat}
            draft.position_mappings = stored
        if existing_shifts:
            stored = copy.deepcopy(draft.existing_shift_decisions or {})
            for key, decision in existing_shifts.items():
                if decision is None:
                    stored.pop(key, None)
                elif decision in _MATCH_DECISIONS:
                    stored[key] = decision
                else:
                    raise ValueError("Decision must be 'accept' or 'separate'.")
            draft.existing_shift_decisions = stored
        await self.db.commit()

    async def _validated_member_mapping(
        self, organization_id: str, mapping: Mapping[str, Any]
    ) -> Dict[str, Any]:
        action = mapping.get("action")
        if action == "create":
            return {"action": "create"}
        if action == "map":
            user_id = str(mapping.get("user_id") or "")
            found = (
                await self.db.execute(
                    select(User.id).where(
                        User.id == user_id,
                        User.organization_id == str(organization_id),
                        User.deleted_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if found is None:
                raise ValueError("Invalid member")
            return {"action": "map", "user_id": user_id}
        raise ValueError("Member mapping action must be 'map' or 'create'.")

    async def _validated_unit_mapping(
        self, organization_id: str, mapping: Mapping[str, Any]
    ) -> Dict[str, Any]:
        action = mapping.get("action")
        org = str(organization_id)
        if action == engine.OWN:
            unit_id = str(mapping.get("id") or "")
            own = await self._own_units(org)
            if not any(u.id == unit_id for u in own):
                raise ValueError("Invalid apparatus")
            return {"action": engine.OWN, "id": unit_id}
        if action == engine.EXTERNAL:
            unit_id = str(mapping.get("id") or "")
            found = (
                await self.db.execute(
                    select(ExternalApparatus.id).where(
                        ExternalApparatus.id == unit_id,
                        ExternalApparatus.organization_id == org,
                    )
                )
            ).scalar_one_or_none()
            if found is None:
                raise ValueError("Invalid outside apparatus")
            return {"action": engine.EXTERNAL, "id": unit_id}
        if action == "create_external":
            agency_name = str(mapping.get("agency_name") or "").strip()
            unit_name = str(mapping.get("unit_name") or "").strip()
            if not agency_name or not unit_name:
                raise ValueError("A new outside unit needs an agency and a unit name.")
            if len(agency_name) > 255 or len(unit_name) > 100:
                raise ValueError("The agency or unit name is too long.")
            return {
                "action": "create_external",
                "agency_name": agency_name,
                "unit_name": unit_name,
            }
        raise ValueError(
            "Unit mapping action must be 'own', 'external' or 'create_external'."
        )

    # ------------------------------------------------------------------
    # Analysis
    # ------------------------------------------------------------------

    async def _organization(self, organization_id: str) -> Optional[Organization]:
        result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org: Optional[Organization] = result.scalar_one_or_none()
        return org

    async def _members(
        self, organization_id: str, *, include_removed: bool = False
    ) -> List[engine.MemberRecord]:
        query = select(User).where(User.organization_id == str(organization_id))
        if not include_removed:
            query = query.where(User.deleted_at.is_(None))
        result = await self.db.execute(query)
        return [
            engine.MemberRecord(
                id=u.id,
                first_name=u.first_name or "",
                last_name=u.last_name or "",
                preferred_name=u.preferred_name or "",
                membership_number=u.membership_number or "",
                email=u.email or "",
                personal_email=u.personal_email or "",
                username=u.username or "",
                status=str(getattr(u.status, "value", u.status) or ""),
            )
            for u in result.scalars().all()
        ]

    async def _own_units(self, organization_id: str) -> List[engine.OwnUnit]:
        # Both inventories: a department on full apparatus management and one
        # on the basic list both run shifts against their units, and a shift's
        # ``apparatus_id`` may name either (see ``resolve_apparatus_ref``).
        # Retired units are included — years of history ran on them.
        full = await self.db.execute(
            select(Apparatus.id, Apparatus.unit_number, Apparatus.name).where(
                Apparatus.organization_id == str(organization_id)
            )
        )
        basic = await self.db.execute(
            select(
                BasicApparatus.id, BasicApparatus.unit_number, BasicApparatus.name
            ).where(BasicApparatus.organization_id == str(organization_id))
        )
        return [
            engine.OwnUnit(id=r.id, unit_number=r.unit_number or "", name=r.name or "")
            for r in list(full.all()) + list(basic.all())
        ]

    async def _external_units(self, organization_id: str) -> List[engine.ExternalUnit]:
        result = await self.db.execute(
            select(
                ExternalApparatus.id,
                ExternalApparatus.name,
                ExternalAgency.id.label("agency_id"),
                ExternalAgency.name.label("agency_name"),
            )
            .join(ExternalAgency, ExternalAgency.id == ExternalApparatus.agency_id)
            .where(
                ExternalApparatus.organization_id == str(organization_id),
                ExternalAgency.organization_id == str(organization_id),
            )
        )
        return [
            engine.ExternalUnit(
                id=r.id, name=r.name, agency_id=r.agency_id, agency_name=r.agency_name
            )
            for r in result.all()
        ]

    async def _existing_shifts(
        self,
        organization_id: str,
        apparatus_ids: List[str],
        span: Tuple[Any, Any],
    ) -> List[engine.ExistingShift]:
        if not apparatus_ids:
            return []
        result = await self.db.execute(
            select(Shift).where(
                Shift.organization_id == str(organization_id),
                Shift.apparatus_id.in_(apparatus_ids),
                Shift.shift_date >= span[0],
                Shift.shift_date <= span[1],
                Shift.status != ShiftStatus.CANCELLED,
            )
        )
        shifts = list(result.scalars().all())
        attendees: Dict[str, set] = {s.id: set() for s in shifts}
        if shifts:
            att = await self.db.execute(
                select(ShiftAttendance.shift_id, ShiftAttendance.user_id).where(
                    ShiftAttendance.shift_id.in_(list(attendees))
                )
            )
            for shift_id, user_id in att.all():
                attendees[shift_id].add(user_id)
        return [
            engine.ExistingShift(
                id=s.id,
                apparatus_id=s.apparatus_id or "",
                shift_date=s.shift_date,
                start=_aware(s.start_time),
                end=_aware(s.end_time) if s.end_time else None,
                attendee_ids=frozenset(attendees[s.id]),
            )
            for s in shifts
        ]

    async def _existing_external(
        self, organization_id: str, span: Tuple[Any, Any]
    ) -> List[engine.ExistingExternalEntry]:
        result = await self.db.execute(
            select(ExternalShiftHours).where(
                ExternalShiftHours.organization_id == str(organization_id),
                ExternalShiftHours.status == ExternalShiftHoursStatus.COUNTED.value,
                ExternalShiftHours.shift_date >= span[0],
                ExternalShiftHours.shift_date <= span[1],
            )
        )
        return [
            engine.ExistingExternalEntry(
                user_id=e.user_id,
                external_apparatus_id=e.external_apparatus_id,
                shift_date=e.shift_date,
                start=_aware(e.start_at) if e.start_at else None,
                end=_aware(e.end_at) if e.end_at else None,
            )
            for e in result.scalars().all()
        ]

    async def analyze(
        self,
        draft: ShiftHistoryImport,
        *,
        now: Optional[datetime] = None,
    ) -> Tuple[engine.Analysis, List[ShiftHistoryImportRow]]:
        org_id = draft.organization_id
        stored_rows = await self.rows(draft)
        parsed = engine.parse_rows(
            (
                engine.RowInput(
                    id=r.id,
                    line_number=r.line_number,
                    raw=r.raw or {},
                    edits=r.edits,
                    excluded=bool(r.excluded),
                    match_decision=r.match_decision,
                )
                for r in stored_rows
            ),
            draft.column_mapping or {},
            ZoneInfo(draft.timezone),
            now or datetime.now(timezone.utc),
        )
        org = await self._organization(org_id)
        own_units = await self._own_units(org_id)
        context = engine.AnalysisContext(
            organization_name=org.name if org else "",
            members=await self._members(org_id),
            identifier_holders=await self._members(org_id, include_removed=True),
            own_units=own_units,
            external_units=await self._external_units(org_id),
            department_seats=await SchedulingService(self.db).department_seat_names(
                org_id
            ),
            member_mappings=_as_mapping(draft.member_mappings),
            unit_mappings=_as_mapping(draft.unit_mappings),
            position_mappings=_as_mapping(draft.position_mappings),
            existing_shift_decisions=_as_mapping(draft.existing_shift_decisions),
        )
        span = engine.date_span(parsed)
        if span is not None:
            context.existing_shifts = await self._existing_shifts(
                org_id, [u.id for u in own_units], span
            )
            context.existing_external = await self._existing_external(org_id, span)
        return engine.analyze(parsed, context), stored_rows

    async def detail(self, draft: ShiftHistoryImport) -> Dict[str, Any]:
        detail: Dict[str, Any] = {
            "import": summary_view(draft),
            "headers": list(draft.headers or []),
            "column_mapping": dict(draft.column_mapping or {}),
            "fields": list(engine.FIELDS),
            "member_mappings": _as_mapping(draft.member_mappings),
            "unit_mappings": _as_mapping(draft.unit_mappings),
            "position_mappings": _as_mapping(draft.position_mappings),
            "existing_shift_decisions": _as_mapping(draft.existing_shift_decisions),
            "analysis": None,
        }
        if draft.status != _DRAFT:
            return detail
        analysis, stored_rows = await self.analyze(draft)
        detail["analysis"] = analysis_view(
            analysis, stored_rows, await self._options(draft.organization_id)
        )
        return detail

    async def _options(self, organization_id: str) -> Dict[str, Any]:
        members = await self._members(organization_id)
        units: List[Dict[str, Any]] = [
            {
                "kind": engine.OWN,
                "id": u.id,
                "name": " - ".join(p for p in (u.unit_number, u.name) if p),
            }
            for u in await self._own_units(organization_id)
        ]
        units.extend(
            {
                "kind": engine.EXTERNAL,
                "id": u.id,
                "name": u.name,
                "agency_name": u.agency_name,
            }
            for u in await self._external_units(organization_id)
        )
        seats = sorted(
            set(CANONICAL_POSITIONS)
            | set(
                await SchedulingService(self.db).department_seat_names(organization_id)
            )
        )
        return {
            "members": sorted(
                (
                    {
                        "id": m.id,
                        "name": m.display_name or m.username,
                        "membership_number": m.membership_number,
                        "status": m.status,
                    }
                    for m in members
                ),
                key=lambda m: m["name"].casefold(),
            ),
            "units": units,
            "seats": seats,
        }

    # ------------------------------------------------------------------
    # Commit
    # ------------------------------------------------------------------

    async def commit(
        self, organization_id: str, import_id: str, committed_by: str
    ) -> ShiftHistoryImport:
        # Locked for the whole commit so two admins pressing Commit on the
        # same draft cannot both write it: the second waits, then finds it no
        # longer a draft.
        draft = await self.get_draft(organization_id, import_id, for_update=True)
        analysis, _ = await self.analyze(draft)
        if analysis.blocking_issue_count:
            raise ImportNotReady(
                f"{analysis.blocking_issue_count} issue(s) still need a decision "
                "before this import can be committed."
            )
        if not analysis.can_commit:
            raise ImportNotReady(
                "Nothing in this import is new: every row is excluded, skipped "
                "or already recorded."
            )

        org_id = str(organization_id)
        now = datetime.now(timezone.utc)
        note = f"Imported from {draft.source_filename}"
        counts = {
            "shifts_created": 0,
            "shifts_updated": 0,
            "attendance_created": 0,
            "external_hours_created": 0,
            "members_created": 0,
            "agencies_created": 0,
            "external_units_created": 0,
            "duplicates_skipped": 0,
            "rows_skipped": sum(1 for r in analysis.rows if r.skipped_reason),
            "rows_excluded": sum(1 for r in analysis.rows if r.excluded),
        }

        new_members = await self._create_members(org_id, analysis, draft, now, counts)
        new_units = await self._create_external_units(org_id, analysis, counts)

        def member_id(ref: str) -> str:
            return new_members[ref] if ref.startswith("new:") else ref

        for proposed in analysis.shifts:
            work = [a for a in proposed.attendances if not a.duplicate_existing]
            counts["duplicates_skipped"] += len(proposed.attendances) - len(work)
            if not work:
                continue
            shift: Optional[Shift] = None
            if proposed.attaches_to_existing and proposed.existing_shift_id:
                # None if the shift was cancelled since the review; the crew
                # then gets a shift of its own rather than being dropped.
                shift = await self._lock_existing_shift(
                    org_id, proposed.existing_shift_id
                )
            if shift is not None:
                counts["shifts_updated"] += 1
                existing_attendees, existing_assignees = await self._shift_people(
                    shift.id
                )
            else:
                shift = Shift(
                    id=generate_uuid(),
                    organization_id=org_id,
                    shift_date=proposed.shift_date,
                    start_time=min(a.start for a in work),
                    end_time=max(a.end for a in work),
                    apparatus_id=proposed.apparatus_id,
                    status=ShiftStatus.SCHEDULED,
                    notes=note,
                    is_finalized=True,
                    finalized_at=now,
                    finalized_by=str(committed_by),
                    created_by=str(committed_by),
                )
                self.db.add(shift)
                await self.db.flush()
                counts["shifts_created"] += 1
                existing_attendees, existing_assignees = set(), set()

            for att in work:
                user_id = member_id(att.member_ref)
                if user_id in existing_attendees:
                    counts["duplicates_skipped"] += 1
                    continue
                if user_id not in existing_assignees:
                    self.db.add(
                        ShiftAssignment(
                            id=generate_uuid(),
                            organization_id=org_id,
                            shift_id=shift.id,
                            user_id=user_id,
                            position=att.seat,
                            assignment_status=AssignmentStatus.CONFIRMED,
                            assigned_by=str(committed_by),
                            confirmed_at=now,
                            notes=note,
                        )
                    )
                    existing_assignees.add(user_id)
                self.db.add(
                    ShiftAttendance(
                        id=generate_uuid(),
                        shift_id=shift.id,
                        user_id=user_id,
                        checked_in_at=att.start,
                        checked_out_at=att.end,
                        duration_minutes=att.minutes,
                        call_count=att.call_count,
                    )
                )
                existing_attendees.add(user_id)
                counts["attendance_created"] += 1
            await self.db.flush()
            await self._snapshot_totals(shift, work)

        units_by_id = {u.id: u for u in await self._external_units(org_id)}
        for att in analysis.external:
            if att.duplicate_existing:
                counts["duplicates_skipped"] += 1
                continue
            kind, ref = att.unit_ref
            unit_id = new_units[ref] if kind == engine.NEW_EXTERNAL else ref
            unit = units_by_id[unit_id]
            self.db.add(
                ExternalShiftHours(
                    id=generate_uuid(),
                    organization_id=org_id,
                    user_id=member_id(att.member_ref),
                    shift_date=att.local_date,
                    duration_minutes=att.minutes,
                    start_at=att.start,
                    end_at=att.end,
                    external_apparatus_id=unit.id,
                    agency_name=unit.agency_name,
                    apparatus_name=unit.name,
                    role=att.role[:100] or None,
                    notes=note,
                    status=ExternalShiftHoursStatus.COUNTED.value,
                )
            )
            counts["external_hours_created"] += 1

        draft.status = _COMMITTED
        draft.committed_by = str(committed_by)
        draft.committed_at = now
        draft.summary = counts
        await self.db.commit()
        logger.info(
            "Shift history import {} committed for org {}: {}",
            draft.id,
            org_id,
            counts,
        )
        return draft

    async def _create_members(
        self,
        organization_id: str,
        analysis: engine.Analysis,
        draft: ShiftHistoryImport,
        now: datetime,
        counts: Dict[str, int],
    ) -> Dict[str, str]:
        """Inactive member records for the people the reviewer chose to create.

        No password and no invitation: these are records of people who served,
        not accounts. An inactive member cannot sign in, and no email is sent.
        """
        created: Dict[str, str] = {}
        taken_usernames = {
            (u.username or "").casefold()
            for u in (
                await self.db.execute(
                    select(User.username).where(
                        User.organization_id == str(organization_id)
                    )
                )
            ).all()
        }
        for resolution in analysis.members:
            if resolution.status != engine.MEMBER_CREATE:
                continue
            identity = resolution.identity
            username = identity.username
            if not username:
                base = _slug(f"{identity.first} {identity.last}") or "former.member"
                username = f"{base[:80]}.{secrets.token_hex(3)}"
                while username.casefold() in taken_usernames:
                    username = f"{base[:80]}.{secrets.token_hex(3)}"
            taken_usernames.add(username.casefold())
            user = User(
                id=generate_uuid(),
                organization_id=str(organization_id),
                username=username,
                email=identity.email
                or f"former-member-{secrets.token_hex(6)}@{_PLACEHOLDER_EMAIL_DOMAIN}",
                first_name=identity.first or None,
                last_name=identity.last or None,
                membership_number=identity.membership_number or None,
                password_hash=None,
                email_verified=False,
                status=UserStatus.INACTIVE,
                status_changed_at=now,
                status_change_reason=(
                    f"Created by shift history import of {draft.source_filename}"
                )[:1000],
            )
            self.db.add(user)
            created[resolution.ref or ""] = user.id
            counts["members_created"] += 1
        await self.db.flush()
        return created

    async def _create_external_units(
        self,
        organization_id: str,
        analysis: engine.Analysis,
        counts: Dict[str, int],
    ) -> Dict[str, str]:
        """Outside agencies and units the reviewer chose to add, by unit key.

        Reuses an agency or unit of the same name if one exists by commit time
        — another admin may have added it while this draft sat — since both
        names are unique per organization / agency.
        """
        created: Dict[str, str] = {}
        org = str(organization_id)
        for unit in analysis.units:
            if unit.target_kind != engine.NEW_EXTERNAL:
                continue
            agency = (
                await self.db.execute(
                    select(ExternalAgency).where(
                        ExternalAgency.organization_id == org,
                        func.lower(ExternalAgency.name)
                        == unit.new_agency_name.casefold(),
                    )
                )
            ).scalar_one_or_none()
            if agency is None:
                agency = ExternalAgency(
                    id=generate_uuid(), organization_id=org, name=unit.new_agency_name
                )
                self.db.add(agency)
                await self.db.flush()
                counts["agencies_created"] += 1
            apparatus = (
                await self.db.execute(
                    select(ExternalApparatus).where(
                        ExternalApparatus.organization_id == org,
                        ExternalApparatus.agency_id == agency.id,
                        func.lower(ExternalApparatus.name)
                        == unit.new_unit_name.casefold(),
                    )
                )
            ).scalar_one_or_none()
            if apparatus is None:
                apparatus = ExternalApparatus(
                    id=generate_uuid(),
                    organization_id=org,
                    agency_id=agency.id,
                    name=unit.new_unit_name,
                )
                self.db.add(apparatus)
                await self.db.flush()
                counts["external_units_created"] += 1
            created[unit.key] = apparatus.id
        return created

    async def _lock_existing_shift(
        self, organization_id: str, shift_id: str
    ) -> Optional[Shift]:
        result = await self.db.execute(
            select(Shift)
            .where(
                Shift.id == str(shift_id),
                Shift.organization_id == str(organization_id),
                Shift.status != ShiftStatus.CANCELLED,
            )
            .with_for_update()
        )
        shift: Optional[Shift] = result.scalar_one_or_none()
        return shift

    async def _shift_people(self, shift_id: str) -> Tuple[set, set]:
        # Locking reads: the shift row is locked, but this transaction's
        # REPEATABLE READ snapshot predates that lock (pitfall #27), so a plain
        # read could miss a check-in committed while the commit waited.
        attendees = await self.db.execute(
            select(ShiftAttendance.user_id)
            .where(ShiftAttendance.shift_id == shift_id)
            .with_for_update()
        )
        assignees = await self.db.execute(
            select(ShiftAssignment.user_id)
            .where(ShiftAssignment.shift_id == shift_id)
            .with_for_update()
        )
        return {r[0] for r in attendees.all()}, {r[0] for r in assignees.all()}

    async def _snapshot_totals(
        self, shift: Shift, imported: List[engine.Attendance]
    ) -> None:
        """Keep a finalized shift's stored totals agreeing with its rows.

        ``total_hours`` is the sum of attendance, as ``finalize_shift`` takes
        it. ``call_count`` is the shift's calls, not a sum over the crew —
        four members on one call is one call — so the best a per-member file
        can say is the largest count any one member logged. An existing
        shift's call count is left alone when it already has one.
        """
        if not shift.is_finalized:
            return
        total = (
            await self.db.execute(
                select(
                    func.coalesce(func.sum(ShiftAttendance.duration_minutes), 0)
                ).where(ShiftAttendance.shift_id == shift.id)
            )
        ).scalar() or 0
        shift.total_hours = round(float(total) / 60.0, 1) if total > 0 else 0.0
        if shift.call_count is None:
            counts = [a.call_count for a in imported if a.call_count is not None]
            if counts:
                shift.call_count = max(counts)


def _aware(value: datetime) -> datetime:
    # MySQL returns naive datetimes for DateTime(timezone=True); they are UTC.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _as_mapping(value: Any) -> Dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


# ----------------------------------------------------------------------
# Presentation
# ----------------------------------------------------------------------


def summary_view(draft: ShiftHistoryImport) -> Dict[str, Any]:
    return {
        "id": draft.id,
        "status": draft.status,
        "source_filename": draft.source_filename,
        "timezone": draft.timezone,
        "row_count": draft.row_count,
        "created_by": draft.created_by,
        "committed_by": draft.committed_by,
        "created_at": draft.created_at,
        "committed_at": draft.committed_at,
        "summary": draft.summary,
    }


def _attendance_view(att: engine.Attendance) -> Dict[str, Any]:
    return {
        "key": att.key,
        "row_ids": [r.id for r in att.rows],
        "line_numbers": [r.line_number for r in att.rows],
        "member_ref": att.member_ref,
        "unit_kind": att.unit_ref[0],
        "unit_ref": att.unit_ref[1],
        "seat": att.seat,
        "role": att.role,
        "start": att.start,
        "end": att.end,
        "local_date": att.local_date,
        "minutes": att.minutes,
        "call_count": att.call_count,
        "joined": att.joined,
        "confidence": att.confidence,
        "needs_confirmation": att.needs_confirmation,
        "duplicate_existing": att.duplicate_existing,
    }


def analysis_view(
    analysis: engine.Analysis,
    stored_rows: List[ShiftHistoryImportRow],
    options: Dict[str, Any],
) -> Dict[str, Any]:
    stored = {r.id: r for r in stored_rows}
    placement: Dict[str, Dict[str, str]] = {}
    for shift in analysis.shifts:
        for att in shift.attendances:
            for row in att.rows:
                placement[row.id] = {"shift_key": shift.key, "attendance_key": att.key}
    for att in analysis.external:
        for row in att.rows:
            placement[row.id] = {"external_key": att.key, "attendance_key": att.key}

    rows = []
    for row in analysis.rows:
        source = stored.get(row.id)
        rows.append(
            {
                "id": row.id,
                "line_number": row.line_number,
                "raw": (source.raw if source else {}) or {},
                "edits": source.edits if source else None,
                "values": row.values,
                "excluded": row.excluded,
                "match_decision": row.match_decision,
                "skipped_reason": row.skipped_reason,
                "errors": row.errors,
                "start": row.start,
                "end": row.end,
                "local_date": row.local_date,
                "minutes": row.minutes,
                "member_key": row.identity.key if row.identity.has_any else None,
                "unit_key": row.unit_key if row.values["unit"] else None,
                "position_key": row.position_key,
                **placement.get(row.id, {}),
            }
        )

    attendances = [a for s in analysis.shifts for a in s.attendances]
    duplicates = sum(1 for a in attendances + analysis.external if a.duplicate_existing)
    return {
        "can_commit": analysis.can_commit,
        "blocking_issue_count": analysis.blocking_issue_count,
        "counts": {
            "rows": len(analysis.rows),
            "excluded": sum(1 for r in analysis.rows if r.excluded),
            "skipped": sum(
                1 for r in analysis.rows if r.skipped_reason and not r.excluded
            ),
            "with_errors": sum(
                1
                for r in analysis.rows
                if r.errors and not r.excluded and not r.skipped_reason
            ),
            "new_shifts": sum(1 for s in analysis.shifts if not s.attaches_to_existing),
            "existing_shifts": sum(
                1 for s in analysis.shifts if s.attaches_to_existing
            ),
            "attendances": len(attendances),
            "external_entries": len(analysis.external),
            "duplicates": duplicates,
        },
        "rows": rows,
        "members": [
            {
                "key": m.key,
                "display_name": m.identity.display_name,
                "first_name": m.identity.first,
                "last_name": m.identity.last,
                "membership_number": m.identity.membership_number,
                "email": m.identity.email,
                "username": m.identity.username,
                "status": m.status,
                "user_id": m.user_id,
                "candidate_ids": m.candidate_ids,
                "reason": m.reason,
                "row_count": len(m.row_ids),
            }
            for m in analysis.members
        ],
        "units": [
            {
                "key": u.key,
                "unit": u.unit,
                "agency": u.agency,
                "status": u.status,
                "target_kind": u.target_kind,
                "target_id": u.target_id,
                "candidates": [{"kind": k, "id": i} for k, i in u.candidates],
                "new_agency_name": u.new_agency_name,
                "new_unit_name": u.new_unit_name,
                "row_count": len(u.row_ids),
            }
            for u in analysis.units
        ],
        "positions": [
            {
                "key": p.key,
                "source": p.source,
                "status": p.status,
                "seat": p.seat,
                "row_count": len(p.row_ids),
            }
            for p in analysis.positions
        ],
        "shifts": [
            {
                "key": s.key,
                "apparatus_id": s.apparatus_id,
                "shift_date": s.shift_date,
                "start": s.start,
                "end": s.end,
                "existing_shift_id": s.existing_shift_id,
                "existing_confidence": s.existing_confidence,
                "existing_status": s.existing_status,
                "attendances": [_attendance_view(a) for a in s.attendances],
            }
            for s in analysis.shifts
        ],
        "external": [_attendance_view(a) for a in analysis.external],
        "issues": [
            {
                "code": i.code,
                "message": i.message,
                "blocking": i.blocking,
                "row_ids": i.row_ids,
                "ref": i.ref,
            }
            for i in analysis.issues
        ],
        "options": options,
    }
