"""Which records an import wrote, for the Source column outside training.

Training records carry their own rules (``training_record_source``: a provider
sync, an import, or The Logbook). Events, event check-ins and Admin Hours
entries have no provider, so their source is one of two labels:

* **Imported** — the Historical Data Import wrote it. Every event, check-in and
  drill it writes is entered in the ``imported_source_records`` ledger; an Admin
  Hours entry also carries ``entry_method = import``.
* **The Logbook** — everything else.

Owner decision 2026-11-16: a Source column goes on every export whose rows can
be told apart this way, and on no other.
"""

from __future__ import annotations

from typing import Iterable, List, Sequence, Set

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_hours import AdminHoursEntryMethod
from app.models.historical_import import ImportedRecordKind, ImportedSourceRecord
from app.models.training import TrainingSession
from app.services.training_record_source import (
    IMPORTED_LABEL,
    LOGBOOK_LABEL,
    SOURCE_IMPORTED,
    SOURCE_LOGBOOK,
)

_CHUNK = 500


def _chunks(values: Sequence[str]) -> Iterable[List[str]]:
    for start in range(0, len(values), _CHUNK):
        yield list(values[start : start + _CHUNK])


async def imported_record_ids(
    db: AsyncSession,
    organization_id: str,
    kind: ImportedRecordKind,
    record_ids: Iterable[str],
) -> Set[str]:
    """The ids among ``record_ids`` the ledger says an import wrote."""
    ids = sorted({str(i) for i in record_ids if i})
    found: Set[str] = set()
    for chunk in _chunks(ids):
        rows = await db.execute(
            select(ImportedSourceRecord.record_id).where(
                ImportedSourceRecord.organization_id == str(organization_id),
                ImportedSourceRecord.record_kind == kind.value,
                ImportedSourceRecord.record_id.in_(chunk),
            )
        )
        found.update(str(r) for r in rows.scalars().all())
    return found


async def imported_event_ids(
    db: AsyncSession, organization_id: str, event_ids: Iterable[str]
) -> Set[str]:
    """Events an import wrote: calendar events from the staffing roster, and
    the events behind the drill sessions made from a training file."""
    ids = sorted({str(i) for i in event_ids if i})
    found = await imported_record_ids(
        db, organization_id, ImportedRecordKind.EVENT, ids
    )
    for chunk in _chunks(ids):
        rows = await db.execute(
            select(TrainingSession.event_id).where(
                TrainingSession.organization_id == str(organization_id),
                TrainingSession.event_id.in_(chunk),
                TrainingSession.id.in_(
                    select(ImportedSourceRecord.record_id).where(
                        ImportedSourceRecord.organization_id == str(organization_id),
                        ImportedSourceRecord.record_kind
                        == ImportedRecordKind.TRAINING_SESSION.value,
                    )
                ),
            )
        )
        found.update(str(r) for r in rows.scalars().all())
    return found


def label_for(imported: bool) -> str:
    return IMPORTED_LABEL if imported else LOGBOOK_LABEL


def kind_for(imported: bool) -> str:
    return SOURCE_IMPORTED if imported else SOURCE_LOGBOOK


def admin_hours_imported(entry_method: object) -> bool:
    """An Admin Hours entry an import wrote: the historical import marks its
    entries ``entry_method = import``, and no other path uses it."""
    value = getattr(entry_method, "value", entry_method)
    return value == AdminHoursEntryMethod.IMPORT.value
