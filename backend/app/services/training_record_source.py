"""Where a training record came from, as one short label.

Three origins can be told apart without storing anything new:

* **provider** — synced from an external training provider; the record carries
  ``external_provider_id`` and ``external_record_id``, which only the provider
  sync sets. Labelled with the provider's product name, so a Target Solutions
  sync reads "Target Solutions" whatever the department named the connection.
* **imported** — written by the Historical Data Import, which enters every
  training record it writes in the ``imported_source_records`` ledger.
* **logbook** — everything else: entered, submitted, finalized from an event or
  session in The Logbook itself.

The older CSV importers on the Training screens leave no mark, so their records
read "The Logbook" (owner decision 2026-11-10; see KNOWN_LIMITATIONS.md).

Every screen and export that shows the label calls ``record_sources`` rather
than deciding for itself, so they cannot disagree (CLAUDE.md pitfall 29).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.historical_import import ImportedRecordKind, ImportedSourceRecord
from app.models.training import (
    ExternalProviderType,
    ExternalTrainingProvider,
    TrainingRecord,
)

SOURCE_PROVIDER = "provider"
SOURCE_IMPORTED = "imported"
SOURCE_LOGBOOK = "logbook"

IMPORTED_LABEL = "Imported"
LOGBOOK_LABEL = "The Logbook"
# For a synced record whose provider connection has since been deleted: the
# foreign key is SET NULL, but the provider's record id survives.
UNKNOWN_PROVIDER_LABEL = "Training provider"

# A custom API connection has no product name, so it falls back to the name the
# department gave the connection.
PROVIDER_LABELS: Dict[ExternalProviderType, str] = {
    ExternalProviderType.VECTOR_SOLUTIONS: "Vector Solutions",
    ExternalProviderType.TARGET_SOLUTIONS: "Target Solutions",
    ExternalProviderType.LEXIPOL: "Lexipol",
    ExternalProviderType.I_AM_RESPONDING: "I Am Responding",
}

# Keeps each IN list a reasonable size for a lifetime export.
_CHUNK = 500


def _synced(record: TrainingRecord) -> bool:
    return bool(record.external_provider_id or record.external_record_id)


@dataclass(frozen=True)
class RecordSource:
    kind: str
    label: str


LOGBOOK = RecordSource(SOURCE_LOGBOOK, LOGBOOK_LABEL)


def _chunks(values: List[str]) -> Iterable[List[str]]:
    for start in range(0, len(values), _CHUNK):
        yield values[start : start + _CHUNK]


async def record_sources(
    db: AsyncSession, organization_id: str, records: Iterable[TrainingRecord]
) -> Dict[str, RecordSource]:
    """The source of each record, keyed by record id.

    A record synced from a provider is labelled by the provider even if the
    historical import also ledgered it: the provider is where it was recorded.
    """
    records = list(records)
    org_id = str(organization_id)
    provider_ids = sorted(
        {str(r.external_provider_id) for r in records if r.external_provider_id}
    )
    provider_labels: Dict[str, str] = {}
    for chunk in _chunks(provider_ids):
        rows = await db.execute(
            select(
                ExternalTrainingProvider.id,
                ExternalTrainingProvider.provider_type,
                ExternalTrainingProvider.name,
            ).where(
                ExternalTrainingProvider.organization_id == org_id,
                ExternalTrainingProvider.id.in_(chunk),
            )
        )
        for pid, ptype, name in rows.all():
            provider_labels[str(pid)] = PROVIDER_LABELS.get(ptype) or name

    unsynced = [str(r.id) for r in records if not _synced(r)]
    imported: set[str] = set()
    for chunk in _chunks(unsynced):
        rows = await db.execute(
            select(ImportedSourceRecord.record_id).where(
                ImportedSourceRecord.organization_id == org_id,
                ImportedSourceRecord.record_kind
                == ImportedRecordKind.TRAINING_RECORD.value,
                ImportedSourceRecord.record_id.in_(chunk),
            )
        )
        imported.update(str(rid) for rid in rows.scalars().all())

    sources: Dict[str, RecordSource] = {}
    for r in records:
        rid = str(r.id)
        if _synced(r):
            label = provider_labels.get(
                str(r.external_provider_id), UNKNOWN_PROVIDER_LABEL
            )
            sources[rid] = RecordSource(SOURCE_PROVIDER, label)
        elif rid in imported:
            sources[rid] = RecordSource(SOURCE_IMPORTED, IMPORTED_LABEL)
        else:
            sources[rid] = LOGBOOK
    return sources
