"""Encrypt a screening record's type and its requirement link at rest (MS-18)

``screening_records.status`` was encrypted by ``80fa2c83bf9d``. A dump still
read "this member — psychological evaluation — 25 Oct 2026", because the type
was a plain ENUM, and ``requirement_id`` was a plain foreign key to a
requirement whose name says the same thing ("Pre-membership Drug Screen").
The owner chose to encrypt both (2026-11-06, "type + link + audit").

Steps, in this order because each needs the one before:

1. Drop the foreign key on ``requirement_id``, whatever it is named (a
   database built by ``create_all`` and one built by migrations name it
   differently), and then any index left on that column alone. The database
   cannot match ciphertext against ``screening_requirements.id``, and MySQL
   cannot index a TEXT column without a prefix. Deleting a requirement now
   clears its records' links in the application
   (``MedicalScreeningService.delete_requirement``), which is what the
   ``ON DELETE SET NULL`` did.
2. Convert ``requirement_id`` to ``TEXT NULL`` and ``screening_type`` to
   ``TEXT NOT NULL``. Every existing value survives the conversion as text.
3. Encrypt every existing value of both columns in place. Safe to run twice:
   a value already carrying the ciphertext prefix is left alone. A legacy
   upper-case type (``PHYSICAL_EXAM``) is written as its value
   (``physical_exam``) first, so it reads back as the same type. NULL links
   stay NULL. With rows to encrypt, ``ENCRYPTION_KEY`` must be set; the
   migration refuses rather than write ciphertext nobody can read. An empty
   table needs no key.

Existing rows: nothing has to be settled before the change. Nothing narrows:
the link loses a constraint rather than gaining one, and every type value
the ENUM held is a valid value afterwards.

Effect on an upgraded installation: every record keeps its type and its
requirement, and every screen shows the same thing. Backups taken before the
upgrade still hold both in plaintext, and so do audit entries written before
it (the audit log is hash-chained and is not rewritten).

The downgrade decrypts both columns, clears any link whose requirement no
longer exists (the foreign key it restores would refuse such a row), restores
the ENUM and the ``ON DELETE SET NULL`` foreign key.

Revision ID: ac1687769b62
Revises: 55e20c02dea7
Create Date: 2026-11-08 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ac1687769b62"
down_revision: Union[str, None] = "55e20c02dea7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "screening_records"
_REQUIREMENTS = "screening_requirements"
_TYPE = "screening_type"
_LINK = "requirement_id"
_FK_NAME = "fk_screening_records_requirement_id_screening_requirements"

# Frozen on purpose: a migration must keep transforming rows the way it did the
# day it ran, so it does not import the application's enum or prefix constant.
_TYPES = (
    "physical_exam",
    "medical_clearance",
    "drug_screening",
    "vision_hearing",
    "fitness_assessment",
    "psychological",
)
_CIPHERTEXT_PREFIXES = ("$gcm1$", "$gcm2$")


def _type_enum() -> sa.Enum:
    return sa.Enum(*_TYPES, name="screening_type_enum")


def _is_ciphertext(value: str) -> bool:
    return value.startswith(_CIPHERTEXT_PREFIXES)


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table() -> bool:
    inspector = _inspector()
    if _TABLE not in inspector.get_table_names():
        return False
    return {_TYPE, _LINK} <= {c["name"] for c in inspector.get_columns(_TABLE)}


def _link_foreign_keys() -> list:
    return [
        fk["name"]
        for fk in _inspector().get_foreign_keys(_TABLE)
        if fk.get("constrained_columns") == [_LINK] and fk.get("name")
    ]


def _link_indexes() -> list:
    return [
        index["name"]
        for index in _inspector().get_indexes(_TABLE)
        if index.get("column_names") == [_LINK]
    ]


def _require_key() -> None:
    from app.core.config import settings

    if not settings.ENCRYPTION_KEY:
        raise RuntimeError(
            "ENCRYPTION_KEY must be set to encrypt screening types and "
            "requirement links; refusing to write ciphertext that cannot be "
            "read back."
        )


def _rewrite(column: str, convert) -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(f"SELECT id, {column} FROM {_TABLE}")  # nosec B608 - constants
    ).fetchall()
    for row_id, value in rows:
        if value is None or str(value).strip() == "":
            continue
        new_value = convert(str(value))
        if new_value is None or new_value == value:
            continue
        conn.execute(
            sa.text(
                f"UPDATE {_TABLE} SET {column} = :value WHERE id = :id"  # nosec B608
            ),
            {"value": new_value, "id": row_id},
        )


def upgrade() -> None:
    if not _has_table():
        return
    from app.core.security import encrypt_data

    for name in _link_foreign_keys():
        op.drop_constraint(name, _TABLE, type_="foreignkey")
    for name in _link_indexes():
        op.drop_index(name, table_name=_TABLE)

    op.alter_column(
        _TABLE,
        _LINK,
        existing_type=sa.String(36),
        type_=sa.Text(),
        existing_nullable=True,
        nullable=True,
    )
    op.alter_column(
        _TABLE,
        _TYPE,
        existing_type=_type_enum(),
        type_=sa.Text(),
        existing_nullable=False,
        nullable=False,
    )

    def encrypt_type(value: str):
        if _is_ciphertext(value):
            return None
        plain = value.strip()
        if plain not in _TYPES and plain.lower() in _TYPES:
            plain = plain.lower()
        _require_key()
        return encrypt_data(plain)

    def encrypt_link(value: str):
        if _is_ciphertext(value):
            return None
        _require_key()
        return encrypt_data(value.strip())

    _rewrite(_TYPE, encrypt_type)
    _rewrite(_LINK, encrypt_link)


def downgrade() -> None:
    if not _has_table():
        return
    from app.core.security import decrypt_data

    def decrypt_value(value: str):
        return decrypt_data(value) if _is_ciphertext(value) else None

    _rewrite(_TYPE, decrypt_value)
    _rewrite(_LINK, decrypt_value)

    # Without the foreign key a link can outlive its requirement (a requirement
    # removed outside the application). The key restored below would refuse
    # such a row, so clear the link first, as ON DELETE SET NULL would have.
    op.execute(
        sa.text(
            f"UPDATE {_TABLE} SET {_LINK} = NULL "  # nosec B608 - constants
            f"WHERE {_LINK} IS NOT NULL AND {_LINK} NOT IN "
            f"(SELECT id FROM {_REQUIREMENTS})"
        )
    )

    op.alter_column(
        _TABLE,
        _TYPE,
        existing_type=sa.Text(),
        type_=_type_enum(),
        existing_nullable=False,
        nullable=False,
    )
    op.alter_column(
        _TABLE,
        _LINK,
        existing_type=sa.Text(),
        type_=sa.String(36),
        existing_nullable=True,
        nullable=True,
    )
    if not _link_foreign_keys():
        op.create_foreign_key(
            _FK_NAME,
            _TABLE,
            _REQUIREMENTS,
            [_LINK],
            ["id"],
            ondelete="SET NULL",
        )
