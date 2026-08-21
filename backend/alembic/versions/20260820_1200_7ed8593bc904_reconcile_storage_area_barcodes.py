"""Backfill storage-area barcodes skipped by a revision-id collision

The vendor migration was briefly released as ``20260816_0002`` before being
renumbered to ``20260816_0003``.  That id now belongs to the storage-area
barcode backfill, so databases upgraded during that window are interpreted by
Alembic as having run the backfill even though they have not.

The revision stamp is valid and cannot distinguish the two histories.  Repeat
the idempotent backfill downstream instead: normally this is a no-op, while an
affected database receives its missing barcodes and corrected series counter.

Revision ID: 7ed8593bc904
Revises: 1eeb053d59b7
Create Date: 2026-08-20
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "7ed8593bc904"
down_revision = "1eeb053d59b7"
branch_labels = None
depends_on = None

_SETTINGS_KEY = "storage_area_barcode"
_DEFAULT_PREFIX = "SA-"
_MIN_DIGITS = 6


def _format(prefix: str, number: int) -> str:
    return f"{prefix}{number:0{_MIN_DIGITS}d}"


def _load_settings(raw):
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        raw = json.loads(raw or "{}")
    return dict(raw or {})


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "storage_areas" not in tables or "organizations" not in tables:
        return

    pending = bind.execute(
        sa.text(
            "SELECT id, organization_id FROM storage_areas "
            "WHERE barcode IS NULL OR barcode = '' "
            "ORDER BY created_at, id"
        )
    ).fetchall()
    if not pending:
        return

    taken: dict[str, set[str]] = {}
    for row in bind.execute(
        sa.text(
            "SELECT organization_id, barcode FROM storage_areas "
            "WHERE barcode IS NOT NULL AND barcode <> ''"
        )
    ):
        taken.setdefault(row.organization_id, set()).add(row.barcode)

    series: dict[str, tuple[dict | None, str, int]] = {}
    for org_id in {row.organization_id for row in pending}:
        raw = bind.execute(
            sa.text("SELECT settings FROM organizations WHERE id = :id"),
            {"id": org_id},
        ).scalar()
        settings = _load_settings(raw) if raw is not None else None
        cfg = (settings or {}).get(_SETTINGS_KEY) or {}
        series[org_id] = (
            settings,
            cfg.get("prefix") or _DEFAULT_PREFIX,
            int(cfg.get("next_number") or 1),
        )

    for row in pending:
        settings, prefix, number = series[row.organization_id]
        used = taken.setdefault(row.organization_id, set())
        barcode = _format(prefix, number)
        while barcode in used:
            number += 1
            barcode = _format(prefix, number)
        used.add(barcode)
        series[row.organization_id] = (settings, prefix, number + 1)
        bind.execute(
            sa.text("UPDATE storage_areas SET barcode = :barcode WHERE id = :id"),
            {"barcode": barcode, "id": row.id},
        )

    for org_id, (settings, prefix, number) in series.items():
        if settings is None:
            continue
        settings[_SETTINGS_KEY] = {"prefix": prefix, "next_number": number}
        bind.execute(
            sa.text("UPDATE organizations SET settings = :settings WHERE id = :id"),
            {"settings": json.dumps(settings), "id": org_id},
        )


def downgrade() -> None:
    # The original backfill remains applied when this reconciliation is
    # reversed, and we cannot identify which barcodes either revision wrote.
    pass
