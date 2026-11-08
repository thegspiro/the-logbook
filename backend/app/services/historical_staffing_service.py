"""
Historical staffing: storing a roster export beside a historical import and
reporting how its files join, before anything is decided or written.

The rules live in ``historical_staffing_engine`` as pure functions. This
service loads and stores what they need. It writes no shifts or events.
"""

from datetime import datetime
from typing import Any, Dict, Mapping, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.historical_import import (
    HistoricalImport,
    HistoricalStaffingFile,
    HistoricalStaffingRow,
)
from app.services import historical_staffing_engine as engine
from app.services.historical_import_service import (
    HistoricalImportService,
    read_csv,
)

# Rows are inserted in chunks, as the historical import's are: one INSERT of a
# whole roster is a packet MySQL may refuse.
_INSERT_CHUNK = 2_000


class HistoricalStaffingService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.imports = HistoricalImportService(db)

    async def _file(
        self, record: HistoricalImport, kind: str
    ) -> Optional[HistoricalStaffingFile]:
        # Constrained by the import, already resolved in the caller's
        # organization, and by the organization again (pitfall #14).
        return (
            await self.db.execute(
                select(HistoricalStaffingFile).where(
                    HistoricalStaffingFile.historical_import_id == record.id,
                    HistoricalStaffingFile.organization_id == record.organization_id,
                    HistoricalStaffingFile.kind == kind,
                )
            )
        ).scalar_one_or_none()

    async def files(
        self, record: HistoricalImport
    ) -> Dict[str, HistoricalStaffingFile]:
        found = (
            (
                await self.db.execute(
                    select(HistoricalStaffingFile).where(
                        HistoricalStaffingFile.historical_import_id == record.id,
                        HistoricalStaffingFile.organization_id
                        == record.organization_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        return {f.kind: f for f in found}

    async def upload(
        self,
        organization_id: str,
        import_id: str,
        kind: str,
        filename: str,
        text: str,
        uploaded_by: str,
    ) -> HistoricalStaffingFile:
        """Store a seats or events file, replacing one of that kind."""
        if kind not in engine.KINDS:
            raise ValueError("Upload a seats file or an events file.")
        headers, rows = read_csv(text)
        record = await self.imports.get(organization_id, import_id, for_update=True)
        existing = await self._file(record, kind)
        if existing is not None:
            await self.db.delete(existing)
            await self.db.flush()
        staffing_file = HistoricalStaffingFile(
            id=generate_uuid(),
            organization_id=record.organization_id,
            historical_import_id=record.id,
            kind=kind,
            source_filename=filename[:255],
            headers=headers,
            column_mapping=engine.detect_mapping(kind, headers),
            row_count=len(rows),
            created_by=str(uploaded_by),
        )
        self.db.add(staffing_file)
        try:
            await self.db.flush()
        except IntegrityError:
            # Locking the import serializes uploads to it, so this is only
            # reached by a database without that lock honoured.
            await self.db.rollback()
            raise ValueError(
                "Another upload of this file finished first. Reload the page."
            )
        for start in range(0, len(rows), _INSERT_CHUNK):
            self.db.add_all(
                HistoricalStaffingRow(
                    id=generate_uuid(),
                    file_id=staffing_file.id,
                    # Line 1 is the header; blank lines were dropped.
                    line_number=start + index + 2,
                    raw=row,
                )
                for index, row in enumerate(rows[start : start + _INSERT_CHUNK])
            )
            await self.db.flush()
        await self.db.commit()
        await self.db.refresh(staffing_file)
        return staffing_file

    async def update_mapping(
        self,
        organization_id: str,
        import_id: str,
        kind: str,
        mapping: Mapping[str, Any],
    ) -> None:
        """Replace which header feeds which field of one file."""
        if kind not in engine.KINDS:
            raise ValueError("Choose the seats file or the events file.")
        record = await self.imports.get(organization_id, import_id, for_update=True)
        staffing_file = await self._file(record, kind)
        if staffing_file is None:
            raise ValueError("Upload that file first.")
        staffing_file.column_mapping = engine.clean_mapping(
            kind, staffing_file.headers, mapping
        )
        await self.db.commit()

    async def remove(self, organization_id: str, import_id: str, kind: str) -> bool:
        """Delete one file and its rows. False when there was none."""
        if kind not in engine.KINDS:
            raise ValueError("Choose the seats file or the events file.")
        record = await self.imports.get(organization_id, import_id, for_update=True)
        removed = (
            await self.db.execute(
                delete(HistoricalStaffingFile).where(
                    HistoricalStaffingFile.historical_import_id == record.id,
                    HistoricalStaffingFile.organization_id == record.organization_id,
                    HistoricalStaffingFile.kind == kind,
                )
            )
        ).rowcount
        await self.db.commit()
        return bool(removed)

    async def _input(self, staffing_file: HistoricalStaffingFile) -> engine.FileInput:
        rows = (
            await self.db.execute(
                select(HistoricalStaffingRow.line_number, HistoricalStaffingRow.raw)
                .where(HistoricalStaffingRow.file_id == staffing_file.id)
                .order_by(HistoricalStaffingRow.line_number)
            )
        ).all()
        return engine.FileInput(
            mapping=dict(staffing_file.column_mapping or {}),
            rows=[(line, raw) for line, raw in rows],
        )

    async def preview(self, organization_id: str, import_id: str) -> Dict[str, Any]:
        """The files, their mappings, and how they join."""
        record = await self.imports.get(organization_id, import_id)
        stored = await self.files(record)
        seats = (
            await self._input(stored[engine.SEATS]) if engine.SEATS in stored else None
        )
        events = (
            await self._input(stored[engine.EVENTS])
            if engine.EVENTS in stored
            else None
        )
        problems = engine.mapping_problems(seats, events)
        summary: Optional[Dict[str, Any]] = None
        if seats is not None and not problems:
            today = datetime.now(ZoneInfo(record.timezone)).date()
            summary = engine.summarize(engine.join(seats, events), today)
        return {
            "files": [_file_view(stored[k]) for k in engine.KINDS if k in stored],
            "fields": {k: list(v) for k, v in engine.FIELDS_BY_KIND.items()},
            "flat_file": events is None
            and seats is not None
            and engine.flat_file(seats),
            "problems": problems,
            "summary": summary,
        }


def _file_view(staffing_file: HistoricalStaffingFile) -> Dict[str, Any]:
    return {
        "kind": staffing_file.kind,
        "source_filename": staffing_file.source_filename,
        "headers": list(staffing_file.headers or []),
        "column_mapping": dict(staffing_file.column_mapping or {}),
        "row_count": staffing_file.row_count,
        "created_at": staffing_file.created_at,
    }


def file_audit_data(staffing_file: HistoricalStaffingFile) -> Dict[str, Any]:
    """What an audit entry records about a file: ids and counts, no cells."""
    return {
        "organization_id": staffing_file.organization_id,
        "import_id": staffing_file.historical_import_id,
        "kind": staffing_file.kind,
        "filename": staffing_file.source_filename,
        "row_count": staffing_file.row_count,
    }
