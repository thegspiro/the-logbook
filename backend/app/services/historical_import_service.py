"""
Historical data import: the upload, its column settings, routing, the shift
review batches it hands on, and the per-row log of what became of each row.

The rules live in ``historical_import_engine`` as pure functions. This service
loads and stores what they need. It writes no shifts, attendance or hours
itself — the shift history import does that when a batch is committed, and
enters every row it writes in the ``imported_source_records`` ledger, which is
what this service reads back to report a row as imported.
"""

import csv
import io
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Mapping, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from loguru import logger
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.historical_import import (
    HistoricalImport,
    HistoricalImportRow,
    HistoricalImportStatus,
    ImportedSourceRecord,
)
from app.models.shift_history_import import (
    ShiftHistoryImport,
    ShiftHistoryImportRow,
    ShiftHistoryImportStatus,
)
from app.models.user import Organization
from app.services import historical_import_engine as engine
from app.services.shift_history_import_service import ShiftHistoryImportService
from app.utils.org_timezone import scheduling_timezone

_DRAFT_BATCH = ShiftHistoryImportStatus.DRAFT.value

# Rows are inserted in chunks: a whole department's history is tens of
# thousands of rows, and one INSERT that size is a packet MySQL may refuse.
_INSERT_CHUNK = 2_000


class HistoricalImportNotFound(LookupError):
    pass


class HistoricalImportLocked(ValueError):
    """A change refused because review batches built from it are open."""


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
            "importable_types": list(engine.SHIFT_TYPES),
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
                return "imported", "Imported by an earlier import."
            if item.record_type in engine.SHIFT_TYPES:
                return "not_sent", "Not yet sent to shift review."
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

    async def _organization(self, organization_id: str) -> Optional[Organization]:
        result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org: Optional[Organization] = result.scalar_one_or_none()
        return org


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
