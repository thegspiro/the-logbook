"""
Historical staffing: storing a roster export beside a historical import and
reporting how its files join, before anything is decided or written.

The rules live in ``historical_staffing_engine`` and
``historical_staffing_mapping`` as pure functions. This service loads and
stores what they need. It writes no shifts or events.
"""

from datetime import datetime
from typing import Any, Dict, List, Mapping, Optional, Tuple
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
from app.models.training import BasicApparatus
from app.models.user import Organization
from app.services import historical_staffing_engine as engine
from app.services import historical_staffing_mapping as mapping_rules
from app.services.event_request_service import get_outreach_roles
from app.services.historical_import_service import (
    HistoricalImportNotReady,
    HistoricalImportService,
    read_csv,
)
from app.services.scheduling_module_config_service import (
    SchedulingModuleConfigService,
)
from app.utils.positions import custom_seat_labels, position_label

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
        except IntegrityError:
            # Locking the import serializes uploads to it, so this is only
            # reached by a database without that lock honoured.
            await self.db.rollback()
            raise ValueError(
                "Another upload of this file finished first. Reload the page."
            )
        except Exception:
            # Leave no half-written file behind, and the session usable.
            await self.db.rollback()
            raise
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
        result = await self.db.execute(
            delete(HistoricalStaffingFile).where(
                HistoricalStaffingFile.historical_import_id == record.id,
                HistoricalStaffingFile.organization_id == record.organization_id,
                HistoricalStaffingFile.kind == kind,
            )
        )
        await self.db.commit()
        # A DELETE's result is a CursorResult; the generic Result type the
        # async session declares does not carry rowcount.
        return bool(getattr(result, "rowcount", 0))

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

    # ------------------------------------------------------------------
    # Activities and seat titles
    # ------------------------------------------------------------------

    async def _joined(self, record: HistoricalImport) -> engine.Joined:
        stored = await self.files(record)
        seats = (
            await self._input(stored[engine.SEATS]) if engine.SEATS in stored else None
        )
        events = (
            await self._input(stored[engine.EVENTS])
            if engine.EVENTS in stored
            else None
        )
        if seats is None or engine.mapping_problems(seats, events):
            raise HistoricalImportNotReady(
                "Upload the staffing files and choose their columns first."
            )
        return engine.join(seats, events)

    async def vocabulary(
        self, organization_id: str
    ) -> Tuple[List[mapping_rules.Choice], List[mapping_rules.Choice], List[str]]:
        """The department's crew seats, outreach roles and unit names.

        Seats are the ones Scheduling offers (the enabled built-ins and the
        department's Position Names); roles are its outreach roles. These are
        the only values a title may map to.
        """
        settings, _ = await SchedulingModuleConfigService(self.db).get_settings(
            organization_id
        )
        custom = settings.get("custom_positions") or []
        labels = custom_seat_labels(custom)
        seat_values: List[str] = []
        for value in list(settings.get("enabled_positions") or []) + [
            str(entry.get("value") or "") for entry in custom if isinstance(entry, dict)
        ]:
            if value and value not in seat_values:
                seat_values.append(value)
        seats = [
            mapping_rules.Choice(value, position_label(value, labels))
            for value in seat_values
        ]
        org = await self.db.get(Organization, str(organization_id))
        roles = [
            mapping_rules.Choice(str(r["value"]), str(r.get("label") or r["value"]))
            for r in get_outreach_roles(org)
            if isinstance(r, dict) and r.get("value")
        ]
        units = (
            await self.db.execute(
                select(BasicApparatus.unit_number, BasicApparatus.name).where(
                    BasicApparatus.organization_id == str(organization_id)
                )
            )
        ).all()
        unit_names = [n for row in units for n in row if n]
        return seats, roles, unit_names

    async def _lists(self, record: HistoricalImport) -> Tuple[
        mapping_rules.Lists,
        List[mapping_rules.Choice],
        List[mapping_rules.Choice],
    ]:
        joined = await self._joined(record)
        seats, roles, unit_names = await self.vocabulary(record.organization_id)
        lists = mapping_rules.build_lists(
            joined,
            mapping_rules.Decisions.from_stored(record.staffing_settings),
            unit_names,
            seats,
            roles,
        )
        return lists, seats, roles

    async def mapping_view(
        self,
        organization_id: str,
        import_id: str,
        list_name: str,
        *,
        search: str = "",
        offset: int = 0,
        limit: int = 50,
    ) -> Dict[str, Any]:
        """One page of one list, the choices it may take, and progress."""
        if list_name not in mapping_rules.LISTS:
            raise ValueError("Choose activities, shift seat titles or event titles.")
        record = await self.imports.get(organization_id, import_id)
        lists, seats, roles = await self._lists(record)
        items = lists.get(list_name)
        found = mapping_rules.search(items, search)
        return {
            "list": list_name,
            "items": [_item_view(i) for i in found[offset : offset + limit]],
            "total": len(found),
            "progress": {
                name: mapping_rules.progress(lists.get(name))
                for name in mapping_rules.LISTS
            },
            "seat_choices": [_choice_view(c) for c in seats],
            "role_choices": [_choice_view(c) for c in roles],
        }

    async def update_decisions(
        self,
        organization_id: str,
        import_id: str,
        list_name: str,
        updates: Mapping[str, Optional[str]],
    ) -> None:
        """Merge decisions into one list; a null clears a key."""
        record = await self.imports.get(organization_id, import_id, for_update=True)
        seats, roles, _ = await self.vocabulary(record.organization_id)
        merged = mapping_rules.merge(
            mapping_rules.Decisions.from_stored(record.staffing_settings),
            list_name,
            updates,
            seats,
            roles,
        )
        record.staffing_settings = merged.to_stored()
        await self.db.commit()

    async def accept_suggestions(
        self, organization_id: str, import_id: str, list_name: str
    ) -> int:
        """Take every suggestion in one list that has no decision yet.

        Items with no suggestion stay undecided. Returns how many were taken.
        """
        if list_name not in mapping_rules.LISTS:
            raise ValueError("Choose activities, shift seat titles or event titles.")
        record = await self.imports.get(organization_id, import_id, for_update=True)
        lists, seats, roles = await self._lists(record)
        additions = {
            i.key: i.suggestion
            for i in lists.get(list_name)
            if not i.choice and i.suggestion
        }
        if additions:
            merged = mapping_rules.merge(
                mapping_rules.Decisions.from_stored(record.staffing_settings),
                list_name,
                additions,
                seats,
                roles,
            )
            record.staffing_settings = merged.to_stored()
            await self.db.commit()
        return len(additions)


def _item_view(item: mapping_rules.Item) -> Dict[str, Any]:
    return {
        "key": item.key,
        "label": item.label,
        "seats": item.seats,
        "events": item.events,
        "suggestion": item.suggestion,
        "choice": item.choice,
        "examples": item.examples,
    }


def _choice_view(choice: mapping_rules.Choice) -> Dict[str, str]:
    return {"value": choice.value, "label": choice.label}


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
