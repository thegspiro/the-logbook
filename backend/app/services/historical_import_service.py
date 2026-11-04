"""
Historical data import: the upload, its column settings, routing, the shift
review batches it hands on, and the per-row log of what became of each row.

The rules live in ``historical_import_engine`` as pure functions. This service
loads and stores what they need. It writes no shifts, attendance or hours
itself — the shift history import does that when a batch is committed, and
enters every row it writes in the ``imported_source_records`` ledger, which is
what this service reads back to report a row as imported.
"""

import copy
import csv
import io
import re
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Any, Dict, Iterator, List, Mapping, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from loguru import logger
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryMethod,
    AdminHoursEntryStatus,
)
from app.models.historical_import import (
    HistoricalImport,
    HistoricalImportRow,
    HistoricalImportStatus,
    ImportedRecordKind,
    ImportedSourceRecord,
)
from app.models.shift_history_import import (
    ShiftHistoryImport,
    ShiftHistoryImportRow,
    ShiftHistoryImportStatus,
)
from app.models.training import (
    TrainingCourse,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization
from app.services import historical_import_engine as engine
from app.services import shift_history_import_engine as shift_engine
from app.services.external_course_mapping import (
    SUGGESTION_THRESHOLD,
    course_category_id,
    normalize_course_title,
)
from app.services.shift_history_import_service import (
    ShiftHistoryImportService,
    member_mapping_entries,
)
from app.utils.org_timezone import scheduling_timezone

_DRAFT_BATCH = ShiftHistoryImportStatus.DRAFT.value

# Rows are inserted in chunks: a whole department's history is tens of
# thousands of rows, and one INSERT that size is a packet MySQL may refuse.
_INSERT_CHUNK = 2_000


class HistoricalImportNotFound(LookupError):
    pass


class HistoricalImportLocked(ValueError):
    """A change refused because review batches built from it are open."""


class HistoricalImportNotReady(ValueError):
    """A commit refused: decisions remain, or there is nothing to write."""


def read_csv(text: str) -> Tuple[List[str], List[Dict[str, str]]]:
    """Header row and data rows, refusing what cannot be read faithfully."""
    reader = csv.reader(io.StringIO(text))
    try:
        header_row = next(reader)
    except StopIteration:
        raise ValueError("The file is empty.")
    headers = [h.strip() for h in header_row]
    named = [h for h in headers if h]
    if not named:
        raise ValueError("The file has no header row.")
    if len(set(h.casefold() for h in named)) != len(named):
        raise ValueError(
            "The header row repeats a column name. Rename the duplicate so each "
            "column can be told apart."
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
    return named, rows


def _validate_timezone(name: str) -> str:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"'{name}' is not a time zone.")
    return name


def _clean_source_system(value: str) -> str:
    cleaned = " ".join(value.split())
    if not cleaned:
        raise ValueError("Name the system the file came from.")
    if len(cleaned) > 100:
        raise ValueError("The source system name is longer than 100 characters.")
    return cleaned


class HistoricalImportService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.shift_imports = ShiftHistoryImportService(db)

    # ------------------------------------------------------------------
    # Imports
    # ------------------------------------------------------------------

    async def create(
        self,
        organization_id: str,
        created_by: str,
        filename: str,
        text: str,
        source_system: str,
        timezone_name: Optional[str],
    ) -> HistoricalImport:
        headers, rows = read_csv(text)
        system = _clean_source_system(source_system)
        if timezone_name:
            tz_name = _validate_timezone(timezone_name)
        else:
            org = await self._organization(organization_id)
            tz_name = scheduling_timezone(org).key
        column_mapping = engine.detect_column_mapping(headers)
        taken = list(column_mapping.values())
        hour_columns = engine.detect_hour_columns(headers, taken)
        call_columns = engine.detect_call_columns(
            headers,
            await self.shift_imports.call_type_options(organization_id),
            taken + list(hour_columns),
        )
        record = HistoricalImport(
            id=generate_uuid(),
            organization_id=str(organization_id),
            status=HistoricalImportStatus.DRAFT.value,
            source_filename=filename[:255],
            source_system=system,
            timezone=tz_name,
            headers=headers,
            column_mapping=column_mapping,
            hour_columns=hour_columns,
            call_columns=call_columns,
            row_count=len(rows),
            created_by=str(created_by),
        )
        record.summary = engine.summarize(
            engine.route_rows(
                [
                    engine.RowInput(id=str(i), line_number=i + 2, raw=row)
                    for i, row in enumerate(rows)
                ],
                self.settings(record),
            )
        )
        self.db.add(record)
        await self.db.flush()
        for start in range(0, len(rows), _INSERT_CHUNK):
            self.db.add_all(
                HistoricalImportRow(
                    id=generate_uuid(),
                    import_id=record.id,
                    # Line 1 is the header; blank lines were dropped.
                    line_number=start + index + 2,
                    raw=row,
                )
                for index, row in enumerate(rows[start : start + _INSERT_CHUNK])
            )
            await self.db.flush()
        await self.db.commit()
        await self.db.refresh(record)
        return record

    async def list_imports(self, organization_id: str) -> List[HistoricalImport]:
        result = await self.db.execute(
            select(HistoricalImport)
            .where(HistoricalImport.organization_id == str(organization_id))
            .order_by(HistoricalImport.created_at.desc())
        )
        return list(result.scalars().all())

    async def get(
        self, organization_id: str, import_id: str, *, for_update: bool = False
    ) -> HistoricalImport:
        query = select(HistoricalImport).where(
            HistoricalImport.id == str(import_id),
            HistoricalImport.organization_id == str(organization_id),
        )
        if for_update:
            query = query.with_for_update()
        found: Optional[HistoricalImport] = (
            await self.db.execute(query)
        ).scalar_one_or_none()
        if found is None:
            raise HistoricalImportNotFound("Import not found")
        return found

    async def rows(self, record: HistoricalImport) -> List[engine.RowInput]:
        result = await self.db.execute(
            select(
                HistoricalImportRow.id,
                HistoricalImportRow.line_number,
                HistoricalImportRow.raw,
            )
            .where(HistoricalImportRow.import_id == record.id)
            .order_by(HistoricalImportRow.line_number)
        )
        return [
            engine.RowInput(id=r.id, line_number=r.line_number, raw=r.raw or {})
            for r in result.all()
        ]

    async def batches(self, record: HistoricalImport) -> List[ShiftHistoryImport]:
        result = await self.db.execute(
            select(ShiftHistoryImport)
            .where(
                ShiftHistoryImport.historical_import_id == record.id,
                ShiftHistoryImport.organization_id == record.organization_id,
            )
            .order_by(ShiftHistoryImport.created_at, ShiftHistoryImport.source_filename)
        )
        return list(result.scalars().all())

    async def discard(self, organization_id: str, import_id: str) -> int:
        """Delete the import and its batches still in review.

        Batches already committed stay: what they wrote is ordinary schedule
        data now, and the ledger keeps recognising their rows. Returns how many
        open batches went with it.
        """
        record = await self.get(organization_id, import_id, for_update=True)
        open_batches = [
            b for b in await self.batches(record) if b.status == _DRAFT_BATCH
        ]
        for batch in open_batches:
            await self.db.delete(batch)
        await self.db.delete(record)
        await self.db.commit()
        return len(open_batches)

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    def settings(self, record: HistoricalImport) -> engine.Settings:
        return engine.Settings(
            column_mapping=_as_str_mapping(record.column_mapping),
            hour_columns=_as_str_mapping(record.hour_columns),
            call_columns=_as_str_mapping(record.call_columns),
        )

    async def update_settings(
        self,
        record: HistoricalImport,
        *,
        source_system: Optional[str] = None,
        timezone_name: Optional[str] = None,
        column_mapping: Optional[Mapping[str, Optional[str]]] = None,
        hour_columns: Optional[Mapping[str, Optional[str]]] = None,
        call_columns: Optional[Mapping[str, Optional[str]]] = None,
    ) -> None:
        """Change how the file is read.

        Refused while a shift batch built from these settings is still in
        review: it would go on reading the file the old way, and its rows would
        no longer match the log. Committed batches do not lock anything — the
        ledger skips their rows if the file is routed again.
        """
        if await self._open_batch_count(record):
            raise HistoricalImportLocked(
                "Shift batches built from these settings are still in review. "
                "Commit or discard them before changing how the file is read."
            )
        headers = set(record.headers or [])
        if source_system is not None:
            record.source_system = _clean_source_system(source_system)
        if timezone_name is not None:
            record.timezone = _validate_timezone(timezone_name)

        mapping = (
            _as_str_mapping(record.column_mapping)
            if column_mapping is None
            else self._clean_column_mapping(headers, column_mapping)
        )
        hours = (
            _as_str_mapping(record.hour_columns)
            if hour_columns is None
            else self._clean_hour_columns(headers, hour_columns)
        )
        calls = (
            _as_str_mapping(record.call_columns)
            if call_columns is None
            else await self._clean_call_columns(
                record.organization_id, headers, call_columns
            )
        )
        used: Dict[str, str] = {}
        for role, columns in (
            ("a field", mapping.values()),
            ("hours", hours.keys()),
            ("calls", calls.keys()),
        ):
            for header in columns:
                if header in used:
                    raise ValueError(
                        f"'{header}' is mapped as both {used[header]} and {role}."
                    )
                used[header] = role
        record.column_mapping = mapping
        record.hour_columns = hours
        record.call_columns = calls
        _, routings = await self.route(record)
        record.summary = engine.summarize(routings)
        await self.db.commit()

    @staticmethod
    def _clean_column_mapping(
        headers: set, column_mapping: Mapping[str, Optional[str]]
    ) -> Dict[str, str]:
        cleaned: Dict[str, str] = {}
        for field_name, header in column_mapping.items():
            if field_name not in engine.FIELDS:
                raise ValueError(f"'{field_name}' is not an import field.")
            if not header:
                continue
            if header not in headers:
                raise ValueError(f"'{header}' is not a column in the file.")
            if header in cleaned.values():
                raise ValueError(f"'{header}' is mapped to two fields.")
            cleaned[field_name] = header
        return cleaned

    @staticmethod
    def _clean_hour_columns(
        headers: set, hour_columns: Mapping[str, Optional[str]]
    ) -> Dict[str, str]:
        cleaned: Dict[str, str] = {}
        for header, record_type in hour_columns.items():
            if header not in headers:
                raise ValueError(f"'{header}' is not a column in the file.")
            if not record_type or record_type == engine.IGNORE:
                continue
            if record_type not in engine.RECORD_TYPES:
                raise ValueError(f"'{record_type}' is not a kind of hours.")
            cleaned[header] = record_type
        return cleaned

    async def _clean_call_columns(
        self,
        organization_id: str,
        headers: set,
        call_columns: Mapping[str, Optional[str]],
    ) -> Dict[str, str]:
        slugs = await self.shift_imports.call_type_slugs(organization_id)
        cleaned: Dict[str, str] = {}
        for header, slug in call_columns.items():
            if header not in headers:
                raise ValueError(f"'{header}' is not a column in the file.")
            if not slug:
                continue
            if slug not in slugs:
                raise ValueError(
                    f"'{slug}' is not one of this department's call types."
                )
            if slug in cleaned.values():
                raise ValueError(f"Two columns are mapped to the '{slug}' call type.")
            cleaned[header] = slug
        return cleaned

    async def _open_batch_count(self, record: HistoricalImport) -> int:
        return sum(1 for b in await self.batches(record) if b.status == _DRAFT_BATCH)

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    async def route(
        self, record: HistoricalImport
    ) -> Tuple[List[engine.RowInput], List[engine.RowRouting]]:
        rows = await self.rows(record)
        return rows, engine.route_rows(rows, self.settings(record))

    async def imported_source_ids(
        self, record: HistoricalImport, routings: List[engine.RowRouting]
    ) -> frozenset:
        ids = sorted({i.source_id for r in routings for i in r.items})
        found: set = set()
        for start in range(0, len(ids), 1000):
            result = await self.db.execute(
                select(ImportedSourceRecord.source_id).where(
                    ImportedSourceRecord.organization_id == record.organization_id,
                    ImportedSourceRecord.source_system == record.source_system,
                    ImportedSourceRecord.source_id.in_(ids[start : start + 1000]),
                )
            )
            found.update(r[0] for r in result.all())
        return frozenset(found)

    async def detail(self, record: HistoricalImport) -> Dict[str, Any]:
        summary = record.summary
        if not isinstance(summary, dict):
            _, routings = await self.route(record)
            summary = engine.summarize(routings)
        imported = (
            await self.db.execute(
                select(func.count(ImportedSourceRecord.id)).where(
                    ImportedSourceRecord.organization_id == record.organization_id,
                    ImportedSourceRecord.historical_import_id == record.id,
                )
            )
        ).scalar() or 0
        batches = await self.batches(record)
        return {
            "import": summary_view(record),
            "headers": list(record.headers or []),
            "column_mapping": _as_str_mapping(record.column_mapping),
            "hour_columns": _as_str_mapping(record.hour_columns),
            "call_columns": _as_str_mapping(record.call_columns),
            "fields": list(engine.FIELDS),
            "record_types": list(engine.RECORD_TYPES),
            "importable_types": list(
                engine.SHIFT_TYPES + engine.ADMIN_TYPES + engine.TRAINING_TYPES_ROUTED
            ),
            "call_types": await self.shift_imports.call_type_options(
                record.organization_id
            ),
            "routing": summary,
            "rows_imported": int(imported),
            "batches": [batch_view(b) for b in batches],
            "settings_locked": any(b.status == _DRAFT_BATCH for b in batches),
        }

    async def create_shift_batches(
        self, organization_id: str, import_id: str, routed_by: str
    ) -> List[ShiftHistoryImport]:
        """Hand the shift and on-call rows to the shift history import.

        Each batch is an ordinary shift history draft, reviewed and committed
        on that screen. Rows the ledger already holds are left out, which is
        what makes routing the file again — after a batch is discarded, or to
        pick up rows an earlier pass could not read — safe.
        """
        record = await self.get(organization_id, import_id, for_update=True)
        if await self._open_batch_count(record):
            raise HistoricalImportLocked(
                "Shift batches from this file are already in review. Commit or "
                "discard them first."
            )
        settings = self.settings(record)
        if not any(t in engine.SHIFT_TYPES for t in settings.hour_columns.values()):
            raise ValueError(
                "No column is marked as shift or on-call hours, so there is "
                "nothing to send."
            )
        rows, routings = await self.route(record)
        imported = await self.imported_source_ids(record, routings)
        planned = engine.build_shift_batches(rows, routings, settings, imported)
        if not planned:
            raise ValueError(
                "Every shift and on-call row in this file has already been " "imported."
            )
        column_mapping = engine.shift_column_mapping(settings)
        headers = list(column_mapping)
        created: List[ShiftHistoryImport] = []
        for batch in planned:
            draft = ShiftHistoryImport(
                id=generate_uuid(),
                organization_id=record.organization_id,
                status=_DRAFT_BATCH,
                source_filename=f"{record.source_filename} (shifts {batch.label})"[
                    :255
                ],
                timezone=record.timezone,
                headers=headers,
                column_mapping=column_mapping,
                member_mappings={},
                unit_mappings={},
                position_mappings={},
                existing_shift_decisions={},
                historical_import_id=record.id,
                source_system=record.source_system,
                row_count=len(batch.rows),
                created_by=str(routed_by),
            )
            self.db.add(draft)
            await self.db.flush()
            for start in range(0, len(batch.rows), _INSERT_CHUNK):
                self.db.add_all(
                    ShiftHistoryImportRow(
                        id=generate_uuid(),
                        import_id=draft.id,
                        line_number=line_number,
                        raw=values,
                        excluded=False,
                    )
                    for line_number, values in batch.rows[start : start + _INSERT_CHUNK]
                )
                await self.db.flush()
            created.append(draft)
        record.status = HistoricalImportStatus.ROUTED.value
        record.routed_by = str(routed_by)
        record.routed_at = datetime.now(timezone.utc)
        await self.db.commit()
        logger.info(
            "Historical import {} sent {} shift batch(es) for org {}",
            record.id,
            len(created),
            record.organization_id,
        )
        return created

    async def discard_open_batches(self, organization_id: str, import_id: str) -> int:
        """Throw away the shift batches still in review, unlocking the settings."""
        record = await self.get(organization_id, import_id, for_update=True)
        open_ids = [
            b.id for b in await self.batches(record) if b.status == _DRAFT_BATCH
        ]
        if open_ids:
            await self.db.execute(
                delete(ShiftHistoryImport).where(
                    ShiftHistoryImport.id.in_(open_ids),
                    ShiftHistoryImport.organization_id == record.organization_id,
                )
            )
        await self.db.commit()
        return len(open_ids)

    # ------------------------------------------------------------------
    # Log
    # ------------------------------------------------------------------

    async def log_rows(self, record: HistoricalImport) -> Iterator[List[str]]:
        """One line per record a row became — or per row that became nothing —
        with where it stands: imported, in review, skipped, or still to come."""
        rows, routings = await self.route(record)
        imported = await self.imported_source_ids(record, routings)
        batches = await self.batches(record)
        batch_rows = await self._batch_rows(batches)
        by_id = {b.id: b for b in batches}

        def placement(item: engine.RoutedItem) -> Tuple[str, str]:
            found = batch_rows.get(item.source_id)
            if found is not None:
                batch = by_id[found.import_id]
                if batch.status == _DRAFT_BATCH:
                    return "in_review", f"In review in {batch.source_filename}."
                if found.outcome:
                    return found.outcome, found.outcome_detail or ""
            if item.source_id in imported:
                if item.record_type in engine.ADMIN_TYPES:
                    return "imported", "Imported as an Admin Hours entry."
                if item.record_type in engine.TRAINING_TYPES_ROUTED:
                    return "imported", "Imported as a training record."
                return "imported", "Imported by an earlier import."
            if item.record_type in engine.SHIFT_TYPES:
                return "not_sent", "Not yet sent to shift review."
            if item.record_type in engine.ADMIN_TYPES:
                return "not_sent", "Not yet committed as Admin Hours."
            if item.record_type in engine.TRAINING_TYPES_ROUTED:
                return "not_sent", "Not yet committed as training records."
            return (
                "waiting",
                f"{item.record_type.replace('_', ' ').capitalize()} hours are "
                "imported in a later step.",
            )

        def generate() -> Iterator[List[str]]:
            yield [
                "line",
                "source_id",
                "record_type",
                "hours",
                "date",
                "outcome",
                "detail",
                "clean_up",
            ]
            for routing in routings:
                if not routing.items:
                    yield [
                        str(routing.line_number),
                        "",
                        "",
                        "",
                        "",
                        "error" if routing.errors else "skipped",
                        " ".join(routing.errors) or (routing.skipped_reason or ""),
                        "",
                    ]
                    continue
                for item in routing.items:
                    outcome, detail = placement(item)
                    if routing.errors:
                        detail = " ".join(routing.errors + [detail])
                    yield [
                        str(item.line_number),
                        item.source_id,
                        item.record_type,
                        f"{item.minutes / 60:g}",
                        item.local_date.isoformat() if item.local_date else "",
                        outcome,
                        detail,
                        item.note_text,
                    ]

        return generate()

    async def _batch_rows(
        self, batches: List[ShiftHistoryImport]
    ) -> Dict[str, ShiftHistoryImportRow]:
        """Each batch row by the source id it carries. A source id appears in
        one batch at a time, because a file is only routed again once its open
        batches are gone and the ledger then removes what was committed."""
        if not batches:
            return {}
        result = await self.db.execute(
            select(ShiftHistoryImportRow).where(
                ShiftHistoryImportRow.import_id.in_([b.id for b in batches])
            )
        )
        found: Dict[str, ShiftHistoryImportRow] = {}
        order = {b.id: i for i, b in enumerate(batches)}
        for row in sorted(result.scalars().all(), key=lambda r: order[r.import_id]):
            source_id = str((row.raw or {}).get("source_id") or "")
            if source_id:
                # A later batch's row supersedes an earlier, discarded or
                # committed one carrying the same id.
                found[source_id] = row
        return found

    # ------------------------------------------------------------------
    # Administrative hours
    # ------------------------------------------------------------------

    async def admin_categories(self, organization_id: str) -> List[AdminHoursCategory]:
        result = await self.db.execute(
            select(AdminHoursCategory)
            .where(AdminHoursCategory.organization_id == str(organization_id))
            .order_by(AdminHoursCategory.sort_order, AdminHoursCategory.name)
        )
        return list(result.scalars().all())

    async def update_admin_settings(
        self, record: HistoricalImport, payload: Mapping[str, Any]
    ) -> None:
        """Store how administrative rows become entries, checked against the
        file's columns and the department's categories."""
        headers = set(record.headers or [])
        category_ids = {
            c.id for c in await self.admin_categories(record.organization_id)
        }
        settings = engine.AdminSettings.from_stored(payload)
        admin_columns = {
            h
            for h, t in self.settings(record).hour_columns.items()
            if t in engine.ADMIN_TYPES
        }
        for column in settings.description_columns:
            if column not in headers:
                raise ValueError(f"'{column}' is not a column in the file.")
        seen: set = set()
        for column, category in settings.flag_categories:
            if column not in headers:
                raise ValueError(f"'{column}' is not a column in the file.")
            if column in seen:
                raise ValueError(f"'{column}' has two category rules.")
            seen.add(column)
            if category not in category_ids:
                raise ValueError(
                    "Choose one of the department's Admin Hours categories."
                )
        for column, category in settings.default_categories.items():
            if column not in admin_columns:
                raise ValueError(
                    f"'{column}' is not a column marked as administrative hours."
                )
            if category not in category_ids:
                raise ValueError(
                    "Choose one of the department's Admin Hours categories."
                )
        record.admin_settings = settings.to_stored()
        await self.db.commit()

    async def update_member_mappings(
        self,
        record: HistoricalImport,
        members: Mapping[str, Optional[Mapping[str, Any]]],
    ) -> None:
        """Decide who a member is, for rows outside a shift review. A decision
        is merged in by key; ``None`` removes one."""
        stored = copy.deepcopy(record.member_mappings or {})
        for key, mapping in members.items():
            if mapping is None:
                stored.pop(key, None)
                continue
            stored[key] = await self.shift_imports.validated_member_mapping(
                record.organization_id, mapping
            )
        record.member_mappings = stored
        await self.db.commit()

    async def _admin_plan(self, record: HistoricalImport) -> "_AdminPlan":
        rows, routings = await self.route(record)
        imported = await self.imported_source_ids(record, routings)
        admin = engine.AdminSettings.from_stored(record.admin_settings)
        members = await self._member_resolver(record)
        raw_by_id = {r.id: r.raw for r in rows}
        plan = _AdminPlan()
        for routing in routings:
            for item in routing.items:
                if item.record_type not in engine.ADMIN_TYPES:
                    continue
                if item.source_id in imported:
                    plan.already_imported += 1
                    continue
                raw = raw_by_id.get(item.row_id, {})
                resolution = members.resolve(raw, item)
                if resolution is None:
                    plan.problems.append(
                        f"Line {item.line_number}: the row names no member."
                    )
                    continue
                category = engine.admin_category(raw, item, admin)
                if category is None:
                    plan.uncategorized += 1
                if item.local_date is None:
                    plan.problems.append(
                        f"Line {item.line_number}: the row has no date."
                    )
                plan.items.append(
                    (
                        item,
                        resolution.key,
                        category,
                        engine.admin_description(raw, admin),
                    )
                )
        plan.resolutions = members.resolutions
        plan.conflicts = engine.flag_conflicts(rows, routings, admin)
        return plan

    async def admin_preview(self, record: HistoricalImport) -> Dict[str, Any]:
        plan = await self._admin_plan(record)
        categories = await self.admin_categories(record.organization_id)
        names = {c.id: c.name for c in categories}
        by_category: Dict[str, Dict[str, Any]] = {}
        for item, _, category, _ in plan.items:
            key = category or ""
            bucket = by_category.setdefault(
                key,
                {
                    "category_id": category,
                    "name": names.get(key, ""),
                    "records": 0,
                    "minutes": 0,
                },
            )
            bucket["records"] += 1
            bucket["minutes"] += item.minutes
        unresolved = [r for r in plan.resolutions.values() if r.ref is None]
        results = record.results if isinstance(record.results, dict) else {}
        return {
            "settings": engine.AdminSettings.from_stored(
                record.admin_settings
            ).to_stored(),
            "categories": [
                {"id": c.id, "name": c.name, "is_active": bool(c.is_active)}
                for c in categories
            ],
            "pending_records": len(plan.items),
            "already_imported": plan.already_imported,
            "by_category": [
                {
                    "category_id": b["category_id"],
                    "name": b["name"],
                    "records": b["records"],
                    "hours": round(b["minutes"] / 60, 2),
                }
                for b in sorted(by_category.values(), key=lambda b: -b["records"])
            ],
            "uncategorized": plan.uncategorized,
            "flag_conflicts": plan.conflicts,
            "problems": plan.problems[:50],
            "problem_count": len(plan.problems),
            "members": _member_views(plan.resolutions),
            "member_options": await self._member_options(record.organization_id),
            "can_commit": bool(plan.items)
            and not unresolved
            and not plan.uncategorized
            and not plan.problems,
            "result": results.get("admin"),
        }

    async def commit_admin(
        self, organization_id: str, import_id: str, committed_by: str
    ) -> Dict[str, int]:
        """Write the administrative rows as approved Admin Hours entries.

        Approved, not pending: the previous system had already credited these
        hours, and the department decided they come across as they stand. The
        manual-entry path is deliberately not used — it marks every entry
        pending, caps an entry at 24 hours and locks the member for an overlap
        check, each right for a member typing today's hours and wrong for
        years of settled history.
        """
        record = await self.get(organization_id, import_id, for_update=True)
        plan = await self._admin_plan(record)
        unresolved = [r for r in plan.resolutions.values() if r.ref is None]
        if unresolved:
            raise HistoricalImportNotReady(
                f"{len(unresolved)} member(s) in the administrative rows still "
                "need a decision."
            )
        if plan.uncategorized:
            raise HistoricalImportNotReady(
                f"{plan.uncategorized} administrative row(s) have no category. "
                "Set a category for every administrative hours column."
            )
        if plan.problems:
            raise HistoricalImportNotReady(plan.problems[0])
        if not plan.items:
            raise HistoricalImportNotReady(
                "Every administrative row in this file has already been imported."
            )

        org_id = record.organization_id
        now = datetime.now(timezone.utc)
        tz = ZoneInfo(record.timezone)
        counts: Dict[str, int] = {"entries_created": 0, "members_created": 0}
        resolutions = list(plan.resolutions.values())
        created, user_by_key = await self._settle_members(
            record, resolutions, now, counts
        )

        note = f"Imported from {record.source_filename}"
        pending = 0
        for item, member_key, category, description in plan.items:
            span = engine.entry_span(item, tz)
            if span is None or category is None:
                # Both are refused above; kept so a type checker agrees.
                continue
            entry = AdminHoursEntry(
                id=generate_uuid(),
                organization_id=org_id,
                user_id=user_by_key[member_key],
                category_id=category,
                clock_in_at=span[0],
                clock_out_at=span[1],
                duration_minutes=item.minutes,
                description=(description or note)[:5000],
                entry_method=AdminHoursEntryMethod.IMPORT,
                status=AdminHoursEntryStatus.APPROVED,
                approved_by=str(committed_by),
                approved_at=now,
            )
            self.db.add(entry)
            self.db.add(
                ImportedSourceRecord(
                    id=generate_uuid(),
                    organization_id=org_id,
                    source_system=record.source_system,
                    source_id=item.source_id,
                    record_kind=ImportedRecordKind.ADMIN_HOURS_ENTRY.value,
                    record_id=entry.id,
                    historical_import_id=record.id,
                )
            )
            counts["entries_created"] += 1
            pending += 1
            if pending >= _INSERT_CHUNK:
                await self._flush_ledgered()
                pending = 0
        await self._flush_ledgered()

        await self.shift_imports.upsert_mappings(
            org_id, member_mapping_entries(resolutions, created), str(committed_by), now
        )
        results = (
            copy.deepcopy(record.results) if isinstance(record.results, dict) else {}
        )
        results["admin"] = {
            **counts,
            "committed_at": now.isoformat(),
            "committed_by": str(committed_by),
        }
        record.results = results
        await self.db.commit()
        logger.info(
            "Historical import {} committed {} admin hours entries for org {}",
            record.id,
            counts["entries_created"],
            org_id,
        )
        return counts

    # ------------------------------------------------------------------
    # Training
    # ------------------------------------------------------------------

    def training_settings(self, record: HistoricalImport) -> engine.TrainingSettings:
        if isinstance(record.training_settings, dict):
            return engine.TrainingSettings.from_stored(record.training_settings)
        return engine.detect_training_settings(record.headers or [])

    async def _courses(self, organization_id: str) -> List[TrainingCourse]:
        result = await self.db.execute(
            select(TrainingCourse)
            .where(TrainingCourse.organization_id == str(organization_id))
            .where(TrainingCourse.active.is_(True))
            .order_by(TrainingCourse.name)
        )
        return list(result.scalars().all())

    async def update_training_settings(
        self, record: HistoricalImport, payload: Mapping[str, Any]
    ) -> None:
        """Store how training rows are read, checked against the file's
        columns and the department's active courses. ``subject_courses`` is
        merged by key; a null course removes a subject's mapping."""
        headers = set(record.headers or [])
        current = self.training_settings(record)
        for key in ("subject_column", "instructor_column", "taught_column"):
            value = payload.get(key)
            if value is None:
                continue
            if value and value not in headers:
                raise ValueError(f"'{value}' is not a column in the file.")
            setattr(current, key, str(value))
        if payload.get("provider_patterns") is not None:
            patterns = [
                p
                for p in (
                    re.sub(r"[^a-z0-9]", "", str(p).casefold())
                    for p in payload["provider_patterns"]
                )
                if p
            ]
            current.provider_patterns = patterns
        if "unmatched_provider_action" in payload:
            action = payload["unmatched_provider_action"]
            if action is not None and action not in engine.UNMATCHED_ACTIONS:
                raise ValueError("Choose to import or skip the unmatched rows.")
            current.unmatched_provider_action = action
        changes = payload.get("subject_courses")
        if changes:
            course_ids = {c.id for c in await self._courses(record.organization_id)}
            merged = dict(current.subject_courses)
            for key, course_id in changes.items():
                if not course_id:
                    merged.pop(key, None)
                    continue
                if course_id not in course_ids:
                    raise ValueError("Choose one of the department's active courses.")
                merged[key] = course_id
            current.subject_courses = merged
        record.training_settings = current.to_stored()
        await self.db.commit()

    async def _training_plan(self, record: HistoricalImport) -> "_TrainingPlan":
        rows, routings = await self.route(record)
        imported = await self.imported_source_ids(record, routings)
        training = self.training_settings(record)
        members = await self._member_resolver(record)
        raw_by_id = {r.id: r.raw for r in rows}
        plan = _TrainingPlan(training)
        provider_items: List[Tuple[engine.RoutedItem, str]] = []
        for routing in routings:
            for item in routing.items:
                if item.record_type not in engine.TRAINING_TYPES_ROUTED:
                    continue
                if item.source_id in imported:
                    plan.already_imported += 1
                    continue
                raw = raw_by_id.get(item.row_id, {})
                resolution = members.resolve(raw, item)
                if resolution is None:
                    plan.problems.append(
                        f"Line {item.line_number}: the row names no member."
                    )
                    continue
                if item.local_date is None:
                    plan.problems.append(
                        f"Line {item.line_number}: the row has no date."
                    )
                subject = engine.cell(raw, training.subject_column)
                entry = _TrainingItem(item, resolution.key, subject, raw)
                plan.items.append(entry)
                instructor = engine.cell(raw, training.instructor_column)
                if engine.is_provider_row(instructor, training):
                    provider_items.append((item, resolution.key))
                    entry.provider = True
        plan.resolutions = members.resolutions
        plan.members = members
        await self._match_provider_rows(record, plan, provider_items)
        return plan

    async def _match_provider_rows(
        self,
        record: HistoricalImport,
        plan: "_TrainingPlan",
        provider_items: List[Tuple[engine.RoutedItem, str]],
    ) -> None:
        """Mark provider rows a synced record already covers.

        A synced record is a training record the provider integration wrote
        (``external_provider_id`` set) for the same member within a day of the
        row. A member the import will create has no synced records, so every
        one of their provider rows is unmatched.
        """
        user_by_key = {
            key: r.user_id
            for key, r in plan.resolutions.items()
            if r.user_id and r.status != shift_engine.MEMBER_CREATE
        }
        days = [i.local_date for i, _ in provider_items if i.local_date]
        users = sorted({user_by_key[k] for _, k in provider_items if k in user_by_key})
        synced: Dict[str, List[Any]] = {}
        if days and users:
            window = timedelta(days=engine.PROVIDER_MATCH_DAYS)
            for start in range(0, len(users), 500):
                result = await self.db.execute(
                    select(
                        TrainingRecord.user_id, TrainingRecord.completion_date
                    ).where(
                        TrainingRecord.organization_id == record.organization_id,
                        TrainingRecord.user_id.in_(users[start : start + 500]),
                        TrainingRecord.external_provider_id.isnot(None),
                        TrainingRecord.completion_date >= min(days) - window,
                        TrainingRecord.completion_date <= max(days) + window,
                    )
                )
                for user_id, day in result.all():
                    if day is not None:
                        synced.setdefault(str(user_id), []).append(day)
        matched_ids = set()
        for item, key in provider_items:
            member_id = user_by_key.get(key)
            if member_id and engine.provider_match(
                item.local_date, synced.get(member_id, [])
            ):
                matched_ids.add(item.row_id)
        for entry in plan.items:
            if not entry.provider:
                continue
            if entry.item.row_id in matched_ids:
                plan.provider_matched += 1
                entry.synced_duplicate = True
            else:
                plan.provider_unmatched += 1

    async def training_preview(
        self,
        record: HistoricalImport,
        *,
        search: str = "",
        offset: int = 0,
        limit: int = 50,
    ) -> Dict[str, Any]:
        plan = await self._training_plan(record)
        training = plan.settings
        courses = await self._courses(record.organization_id)
        course_names = {c.id: c.name for c in courses}
        subjects: Dict[str, Dict[str, Any]] = {}
        for entry in plan.items:
            key = engine.subject_key(entry.subject)
            bucket = subjects.setdefault(
                key,
                {"key": key, "subject": entry.subject, "records": 0, "minutes": 0},
            )
            bucket["records"] += 1
            bucket["minutes"] += entry.item.minutes
        wanted = normalize_course_title(search) if search else ""
        listed = sorted(
            (
                b
                for b in subjects.values()
                if not wanted or wanted in b["key"] or wanted in b["subject"].casefold()
            ),
            key=lambda b: (-b["records"], b["key"]),
        )
        page = listed[offset : offset + limit]
        library = [(normalize_course_title(c.name), c.id) for c in courses]
        mapped_records = sum(
            b["records"] for k, b in subjects.items() if k in training.subject_courses
        )
        unresolved = [r for r in plan.resolutions.values() if r.ref is None]
        needs_provider_decision = (
            plan.provider_unmatched > 0 and training.unmatched_provider_action is None
        )
        results = record.results if isinstance(record.results, dict) else {}
        return {
            "settings": training.to_stored(),
            "headers": list(record.headers or []),
            "pending_records": plan.writable,
            "already_imported": plan.already_imported,
            "provider_rows": plan.provider_matched + plan.provider_unmatched,
            "provider_matched": plan.provider_matched,
            "provider_unmatched": plan.provider_unmatched,
            "subject_count": len(subjects),
            "subjects_mapped": sum(
                1 for k in subjects if k in training.subject_courses
            ),
            "records_mapped": mapped_records,
            "subjects": [
                {
                    "key": b["key"],
                    "subject": b["subject"],
                    "records": b["records"],
                    "hours": round(b["minutes"] / 60, 2),
                    "course_id": training.subject_courses.get(b["key"]),
                    "course_name": course_names.get(
                        training.subject_courses.get(b["key"], ""), ""
                    ),
                    "suggested_course_id": _suggest(b["key"], library),
                }
                for b in page
            ],
            "subject_total": len(listed),
            "courses": [
                {
                    "id": c.id,
                    "name": c.name,
                    "training_type": _type_value(c.training_type),
                }
                for c in courses
            ],
            "problems": plan.problems[:50],
            "problem_count": len(plan.problems),
            "members": _member_views(plan.resolutions),
            "member_options": await self._member_options(record.organization_id),
            "can_commit": plan.writable > 0
            and not unresolved
            and not plan.problems
            and not needs_provider_decision,
            "result": results.get("training"),
        }

    async def accept_suggested_courses(self, record: HistoricalImport) -> int:
        """Map every subject that has a course suggestion and no mapping yet.

        A suggestion is the same evidence the Target Solutions mapping tool
        offers: a library course whose normalized name is at least
        ``SUGGESTION_THRESHOLD`` alike. Subjects with no suggestion stay as
        written. Returns how many subjects were mapped.
        """
        plan = await self._training_plan(record)
        training = plan.settings
        library = [
            (normalize_course_title(c.name), c.id)
            for c in await self._courses(record.organization_id)
        ]
        additions: Dict[str, str] = {}
        for key in {engine.subject_key(e.subject) for e in plan.items}:
            if not key or key in training.subject_courses:
                continue
            suggestion = _suggest(key, library)
            if suggestion:
                additions[key] = suggestion
        if additions:
            await self.update_training_settings(record, {"subject_courses": additions})
        return len(additions)

    async def commit_training(
        self, organization_id: str, import_id: str, committed_by: str
    ) -> Dict[str, int]:
        """Write the training rows as completed training records.

        A row a provider sync already recorded is left out. A provider row no
        synced record matches follows the reviewer's decision. A subject mapped
        to a course takes the course's name, code, type and first active
        category, exactly as a synced record mapped to that course would; any
        other subject is imported as written, as continuing education.
        """
        record = await self.get(organization_id, import_id, for_update=True)
        plan = await self._training_plan(record)
        training = plan.settings
        unresolved = [r for r in plan.resolutions.values() if r.ref is None]
        if unresolved:
            raise HistoricalImportNotReady(
                f"{len(unresolved)} member(s) in the training rows still need a "
                "decision."
            )
        if plan.problems:
            raise HistoricalImportNotReady(plan.problems[0])
        if plan.provider_unmatched and training.unmatched_provider_action is None:
            raise HistoricalImportNotReady(
                f"{plan.provider_unmatched} provider row(s) match no synced "
                "record. Choose whether to import or skip them."
            )
        if not plan.writable:
            raise HistoricalImportNotReady(
                "Every training row in this file has already been imported, or "
                "is already recorded by a provider sync."
            )

        org_id = record.organization_id
        now = datetime.now(timezone.utc)
        counts: Dict[str, int] = {
            "records_created": 0,
            "provider_duplicates_skipped": 0,
            "provider_unmatched_skipped": 0,
            "members_created": 0,
        }
        resolutions = list(plan.resolutions.values())
        created, user_by_key = await self._settle_members(
            record, resolutions, now, counts
        )
        courses = {c.id: c for c in await self._courses(org_id)}
        categories: Dict[str, Optional[str]] = {}
        note = f"Imported from {record.source_filename}"
        pending = 0
        for entry in plan.items:
            item = entry.item
            if entry.synced_duplicate:
                counts["provider_duplicates_skipped"] += 1
                continue
            if entry.provider and training.unmatched_provider_action == (
                engine.UNMATCHED_SKIP
            ):
                counts["provider_unmatched_skipped"] += 1
                continue
            if item.local_date is None:
                continue
            course = courses.get(
                training.subject_courses.get(engine.subject_key(entry.subject), "")
            )
            if course is not None and course.id not in categories:
                categories[course.id] = await course_category_id(
                    self.db, course.id, org_id
                )
            taught = engine.taught(entry.raw, training)
            instructor = engine.record_instructor(
                entry.raw, training, plan.members.display_name(entry.member_key)
            )
            start = shift_engine.parse_clock(item.start_cell)
            training_record = TrainingRecord(
                id=generate_uuid(),
                organization_id=org_id,
                user_id=user_by_key[entry.member_key],
                course_id=course.id if course else None,
                category_id=categories.get(course.id) if course else None,
                course_name=(course.name if course else entry.subject or "Training")[
                    :255
                ],
                course_code=course.code if course else None,
                training_type=(
                    course.training_type
                    if course is not None and course.training_type
                    else TrainingType.CONTINUING_EDUCATION
                ),
                completion_date=item.local_date,
                start_time=start,
                hours_completed=round(item.minutes / 60, 2),
                status=TrainingStatus.COMPLETED,
                instructor=instructor[:255] or None,
                notes=f"{note}; taught this class." if taught else note,
            )
            self.db.add(training_record)
            self.db.add(
                ImportedSourceRecord(
                    id=generate_uuid(),
                    organization_id=org_id,
                    source_system=record.source_system,
                    source_id=item.source_id,
                    record_kind=ImportedRecordKind.TRAINING_RECORD.value,
                    record_id=training_record.id,
                    historical_import_id=record.id,
                )
            )
            counts["records_created"] += 1
            pending += 1
            if pending >= _INSERT_CHUNK:
                await self._flush_ledgered()
                pending = 0
        await self._flush_ledgered()

        await self.shift_imports.upsert_mappings(
            org_id, member_mapping_entries(resolutions, created), str(committed_by), now
        )
        results = (
            copy.deepcopy(record.results) if isinstance(record.results, dict) else {}
        )
        results["training"] = {
            **counts,
            "committed_at": now.isoformat(),
            "committed_by": str(committed_by),
        }
        record.results = results
        await self.db.commit()
        logger.info(
            "Historical import {} committed {} training records for org {}",
            record.id,
            counts["records_created"],
            org_id,
        )
        return counts

    # ------------------------------------------------------------------
    # Members, shared by the administrative and training steps
    # ------------------------------------------------------------------

    async def _member_resolver(self, record: HistoricalImport) -> "_MemberResolver":
        """Who each member a row names is: the import's own decisions first,
        then decisions remembered from earlier imports (the shift review's
        included), then an exact match."""
        decisions = (
            record.member_mappings if isinstance(record.member_mappings, dict) else {}
        )
        return _MemberResolver(
            self.settings(record),
            await self.shift_imports.member_directory(record.organization_id),
            await self.shift_imports.saved_member_mappings(record.organization_id),
            decisions,
        )

    async def _member_options(self, organization_id: str) -> List[Dict[str, str]]:
        directory = await self.shift_imports.member_directory(organization_id)
        return sorted(
            (
                {
                    "id": m.id,
                    "name": m.display_name or m.username,
                    "membership_number": m.membership_number,
                    "status": m.status,
                }
                for m in directory
            ),
            key=lambda m: m["name"].casefold(),
        )

    async def _settle_members(
        self,
        record: HistoricalImport,
        resolutions: List[shift_engine.MemberResolution],
        now: datetime,
        counts: Dict[str, int],
    ) -> Tuple[Dict[str, str], Dict[str, str]]:
        """Create the former members decided on; map every member key to a
        user id. Returns ``(created refs -> ids, member key -> user id)``."""
        created = await self.shift_imports.create_former_members(
            record.organization_id,
            resolutions,
            f"historical import of {record.source_filename}",
            now,
            counts,
        )
        user_by_key: Dict[str, str] = {}
        for resolution in resolutions:
            ref = resolution.ref or ""
            user_by_key[resolution.key] = created.get(ref, ref)
        return created, user_by_key

    async def _flush_ledgered(self) -> None:
        try:
            await self.db.flush()
        except IntegrityError:
            # Another commit entered one of these rows first. Nothing here is
            # kept: the caller's session rolls back.
            raise HistoricalImportNotReady(
                "Another import recorded some of these rows at the same time. "
                "Reload and commit again."
            )

    async def _organization(self, organization_id: str) -> Optional[Organization]:
        result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org: Optional[Organization] = result.scalar_one_or_none()
        return org


class _MemberResolver:
    """Resolves the member each row names, once per distinct member."""

    def __init__(
        self,
        settings: engine.Settings,
        directory: List[shift_engine.MemberRecord],
        saved: Mapping[str, Any],
        decisions: Mapping[str, Any],
    ) -> None:
        self.settings = settings
        self.directory = directory
        self.saved = saved
        self.decisions = decisions
        self.resolutions: Dict[str, shift_engine.MemberResolution] = {}

    def resolve(
        self, raw: Mapping[str, Any], item: engine.RoutedItem
    ) -> Optional[shift_engine.MemberResolution]:
        identity = shift_engine.identity_from_values(
            engine.member_values(raw, self.settings)
        )
        if not identity.has_any:
            return None
        resolution = self.resolutions.get(identity.key)
        if resolution is None:
            mapping = self.decisions.get(identity.key, self.saved.get(identity.key))
            resolution = shift_engine.resolve_member(identity, self.directory, mapping)
            self.resolutions[identity.key] = resolution
        resolution.row_ids.append(item.row_id)
        return resolution

    def display_name(self, key: str) -> str:
        """The member's name as the department has it, for a record that has
        to name them (an instructor). Falls back to the file's name."""
        resolution = self.resolutions.get(key)
        if resolution is None:
            return ""
        record = next((m for m in self.directory if m.id == resolution.user_id), None)
        if record is not None and record.display_name:
            return record.display_name
        named = shift_engine.new_member_name(resolution)
        return " ".join(p for p in (named or ("", "")) if p)


def _member_views(
    resolutions: Mapping[str, shift_engine.MemberResolution],
) -> List[Dict[str, Any]]:
    """Members still to decide, and members the commit will create."""
    shown = [
        r
        for r in resolutions.values()
        if r.ref is None or r.status == shift_engine.MEMBER_CREATE
    ]
    return [
        {
            "key": r.key,
            "display_name": r.identity.display_name,
            "membership_number": r.identity.membership_number,
            "status": r.status,
            "reason": r.reason,
            "candidate_ids": r.candidate_ids,
            "new_first_name": r.new_first,
            "new_last_name": r.new_last,
            "row_count": len(r.row_ids),
        }
        for r in sorted(shown, key=lambda r: r.key)
    ]


class _TrainingItem:
    def __init__(
        self,
        item: engine.RoutedItem,
        member_key: str,
        subject: str,
        raw: Mapping[str, Any],
    ) -> None:
        self.item = item
        self.member_key = member_key
        self.subject = subject
        self.raw = raw
        # The instructor names a training provider whose records may be synced.
        self.provider = False
        # ...and a synced record already covers this row.
        self.synced_duplicate = False


class _TrainingPlan:
    """What a training commit would write, and what stops it."""

    def __init__(self, settings: engine.TrainingSettings) -> None:
        self.settings = settings
        self.items: List[_TrainingItem] = []
        self.resolutions: Dict[str, shift_engine.MemberResolution] = {}
        self.members: "_MemberResolver"
        self.already_imported = 0
        self.provider_matched = 0
        self.provider_unmatched = 0
        self.problems: List[str] = []

    @property
    def writable(self) -> int:
        """Records a commit would write: every pending row but those a sync
        already recorded, and the unmatched provider rows when the reviewer
        chose to skip them."""
        skip_unmatched = (
            self.settings.unmatched_provider_action == engine.UNMATCHED_SKIP
        )
        return sum(
            1
            for e in self.items
            if not e.synced_duplicate and not (e.provider and skip_unmatched)
        )


def _suggest(key: str, library: List[Tuple[str, str]]) -> Optional[str]:
    """The library course a subject most resembles, at or above the Target
    Solutions mapping tool's threshold. ``quick_ratio`` is an upper bound on
    ``ratio``, so it prunes most courses without the full comparison."""
    if not key:
        return None
    best_score, best_id = 0.0, None
    for name, course_id in library:
        if not name:
            continue
        if name == key:
            return course_id
        matcher = SequenceMatcher(None, key, name)
        if matcher.quick_ratio() < SUGGESTION_THRESHOLD:
            continue
        score = matcher.ratio()
        if score > best_score:
            best_score, best_id = score, course_id
    return best_id if best_score >= SUGGESTION_THRESHOLD else None


def _type_value(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


class _AdminPlan:
    """What an administrative commit would write, and what stops it."""

    def __init__(self) -> None:
        self.items: List[Tuple[engine.RoutedItem, str, Optional[str], str]] = []
        self.resolutions: Dict[str, shift_engine.MemberResolution] = {}
        self.already_imported = 0
        self.uncategorized = 0
        self.conflicts = 0
        self.problems: List[str] = []


def _as_str_mapping(value: Any) -> Dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(k): str(v) for k, v in value.items() if v}


def summary_view(record: HistoricalImport) -> Dict[str, Any]:
    return {
        "id": record.id,
        "status": record.status,
        "source_filename": record.source_filename,
        "source_system": record.source_system,
        "timezone": record.timezone,
        "row_count": record.row_count,
        "created_by": record.created_by,
        "created_at": record.created_at,
        "routed_at": record.routed_at,
    }


def batch_view(batch: ShiftHistoryImport) -> Dict[str, Any]:
    return {
        "id": batch.id,
        "status": batch.status,
        "source_filename": batch.source_filename,
        "row_count": batch.row_count,
        "created_at": batch.created_at,
        "committed_at": batch.committed_at,
        "summary": batch.summary,
    }
