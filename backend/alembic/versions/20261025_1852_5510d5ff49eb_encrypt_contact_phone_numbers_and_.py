"""Encrypt contact phone numbers and addresses at rest

Personal phone numbers and postal addresses were stored as plain text, so any
database dump or backup carried them readable. They are now AES-256-GCM
ciphertext through the ``EncryptedText`` column type: members, both prospect
tables, external event attendees, storefront customers, donors, check-request
payees, officer overrides, facility emergency contacts, contractors, insurance
agents, occupant contacts, vendor contact people and public event requesters.

Left plain on purpose, because they are a department's or a business's own
published details rather than a person's: the organization's address and
phone, facility and location addresses, vendor and service-provider company
details, utility-company lines, the org chart's office lines, the store's
check mailing address and a fuel log's station address. Two of those (vendor
phone, facility city) are also searched with ``LIKE``, which ciphertext would
break. ``address_country`` stays plain too: on its own it identifies no one.

Ciphertext is longer than the ``VARCHAR(20)`` some of these columns were, so
each becomes ``TEXT`` first, and then every existing value is encrypted in
place. The backfill is part of the upgrade rather than left to
encrypt-on-next-write: without it the values stay readable in the database
until each record is edited. Both steps are safe to run twice. Altering a
column that is already ``TEXT`` changes nothing, and a value that already
carries the ciphertext prefix is not encrypted again. Values are encrypted
exactly as stored, without trimming.

When there are rows to encrypt, ``ENCRYPTION_KEY`` must be set, as it must be
for the backend to start; the migration refuses to run without it rather than
writing ciphertext nobody can read back. An empty database needs no key.

Not searchable afterwards: nothing in the application filtered, sorted or
indexed any of these columns in SQL.

The downgrade decrypts every value and restores the original types. A value
longer than its original ``VARCHAR`` (possible only if something wrote one
after the upgrade) stops it under strict SQL mode rather than being truncated.

Revision ID: 5510d5ff49eb
Revises: 0a8d11fcada1, b7e4c2a91d35
Create Date: 2026-10-25 18:52:01.449986

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "5510d5ff49eb"
# Also the merge point of the two heads that branched from 3f2593e8071e
# (allow-embed on forms, guest check-in token) and reached main unjoined.
down_revision: Union[str, Sequence[str], None] = ("0a8d11fcada1", "b7e4c2a91d35")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PERSON = [
    ("phone", sa.String(20)),
    ("mobile", sa.String(20)),
    ("address_street", sa.String(255)),
    ("address_city", sa.String(100)),
    ("address_state", sa.String(50)),
    ("address_zip", sa.String(20)),
]

# table -> [(column, type before)]; every table's primary key is ``id``.
_COLUMNS = {
    "users": _PERSON,
    "prospects": _PERSON,
    "prospective_members": _PERSON,
    "event_external_attendees": [("phone", sa.String(50))],
    "store_orders": [
        ("customer_phone", sa.String(50)),
        ("shipping_address", sa.Text()),
    ],
    "donors": [
        ("phone", sa.String(20)),
        ("address_line1", sa.String(255)),
        ("address_line2", sa.String(255)),
        ("city", sa.String(100)),
        ("state", sa.String(50)),
        ("postal_code", sa.String(20)),
    ],
    "check_requests": [("payee_address", sa.Text())],
    "organization_officers": [("phone", sa.String(50))],
    "facility_emergency_contacts": [
        ("phone", sa.String(50)),
        ("alt_phone", sa.String(50)),
    ],
    "facility_capital_projects": [("contractor_phone", sa.String(50))],
    "facility_insurance_policies": [("agent_phone", sa.String(50))],
    "facility_occupants": [("contact_phone", sa.String(50))],
    "inventory_vendor_contacts": [("phone", sa.String(50))],
    "event_requests": [
        ("contact_phone", sa.String(50)),
        ("venue_address", sa.Text()),
    ],
}

# Frozen on purpose: a migration must keep transforming rows the way it did the
# day it ran, so it does not import the application's prefix constant.
_CIPHERTEXT_PREFIXES = ("$gcm1$", "$gcm2$")


def _is_ciphertext(value: str) -> bool:
    return value.startswith(_CIPHERTEXT_PREFIXES)


def _present_columns(table: str, columns: list) -> list:
    """The listed columns that exist; none when the table does not.

    Four of these tables (``prospects``, ``check_requests``,
    ``inventory_vendor_contacts``, ``event_requests``) are built only by
    ``create_all`` at startup, so on an empty
    database being migrated by CI they are not there yet. Skipping them is
    correct: ``create_all`` builds them from the models, already ``TEXT``.
    """
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return []
    existing = {c["name"] for c in inspector.get_columns(table)}
    return [(name, before) for name, before in columns if name in existing]


def _require_key() -> None:
    from app.core.config import settings

    if not settings.ENCRYPTION_KEY:
        raise RuntimeError(
            "ENCRYPTION_KEY must be set to encrypt phone numbers and addresses; "
            "refusing to write ciphertext that cannot be read back."
        )


def _rewrite(table: str, columns: list[str], convert) -> int:
    """Apply ``convert`` to every non-empty value; return how many rows changed."""
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(f"SELECT id, {', '.join(columns)} FROM {table}")
    ).fetchall()
    changed = 0
    for row in rows:
        updates = {}
        for column, value in zip(columns, row[1:]):
            if value is None or str(value) == "":
                continue
            new_value = convert(str(value))
            if new_value is not None and new_value != value:
                updates[column] = new_value
        if not updates:
            continue
        sets = ", ".join(f"{c} = :{c}" for c in updates)
        conn.execute(
            sa.text(f"UPDATE {table} SET {sets} WHERE id = :row_id"),
            {**updates, "row_id": row[0]},
        )
        changed += 1
    return changed


def upgrade() -> None:
    from app.core.security import encrypt_data

    def encrypt_plain(value: str):
        if _is_ciphertext(value):
            return None
        _require_key()
        return encrypt_data(value)

    for table, columns in _COLUMNS.items():
        present = _present_columns(table, columns)
        if not present:
            continue
        for column, before in present:
            if isinstance(before, sa.Text):
                continue
            op.alter_column(
                table,
                column,
                existing_type=before,
                type_=sa.Text(),
                existing_nullable=True,
            )
        _rewrite(table, [name for name, _ in present], encrypt_plain)


def downgrade() -> None:
    from app.core.security import decrypt_data

    def decrypt_value(value: str):
        return decrypt_data(value) if _is_ciphertext(value) else None

    for table, columns in reversed(list(_COLUMNS.items())):
        present = _present_columns(table, columns)
        if not present:
            continue
        _rewrite(table, [name for name, _ in present], decrypt_value)
        for column, before in present:
            if isinstance(before, sa.Text):
                continue
            op.alter_column(
                table,
                column,
                existing_type=sa.Text(),
                type_=before,
                existing_nullable=True,
            )
