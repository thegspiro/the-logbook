"""Backfill barcodes on existing storage areas

Storage areas now always carry a barcode — the API assigns the next code in
the organization's ``SA-`` series at create time instead of leaving the field
to whoever remembered to type one in. Areas created before that change have a
NULL barcode, so a shelf printed from an older install cannot be scanned.

This walks every barcode-less area oldest-first and hands it the next number
in its organization's series, then advances the counter stored in
``organizations.settings["storage_area_barcode"]`` so runtime generation picks
up where the backfill stopped. Codes already in use in the organization —
including ones on soft-deleted (``is_active = 0``) areas, whose labels are
still stuck to the physical shelf — are skipped rather than reused.

No unique constraint is added: ``storage_areas.barcode`` has never had one and
existing data may contain hand-entered duplicates that an index would reject
mid-upgrade. The generator's skip-if-taken loop is what keeps new codes
distinct.

Revision ID: 20260816_0002
Revises: 20260816_0001
Create Date: 2026-08-16
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "20260816_0002"
down_revision = "20260816_0001"
branch_labels = None
depends_on = None

_SETTINGS_KEY = "storage_area_barcode"
_DEFAULT_PREFIX = "SA-"
_MIN_DIGITS = 6


def _format(prefix: str, number: int) -> str:
    return f"{prefix}{number:0{_MIN_DIGITS}d}"


def _load_settings(raw):
    """organizations.settings comes back as JSON text on some drivers."""
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

    # Per-org series state: (settings dict or None when the org row is gone,
    # prefix, next number).
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
    # No-op, deliberately. This revision changes no schema — it only fills in
    # a nullable column. It records nothing about which rows it touched, so a
    # blanket clear of SA- barcodes would also wipe codes assigned after the
    # upgrade (and any an administrator entered by hand), silently unlabelling
    # shelves whose printed tags stay on the wall either way.
    pass
