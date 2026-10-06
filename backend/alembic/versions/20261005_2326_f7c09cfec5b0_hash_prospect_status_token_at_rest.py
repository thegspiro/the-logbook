"""Hash the applicant status token at rest (PP-6)

``prospective_members.status_token`` is the bearer credential behind the public
application-status page, and it was stored in plaintext and matched with
``=``, so anyone holding a database dump or backup held every live link.

The token cannot simply be replaced by its hash: later pipeline emails re-send
the link, so the application has to be able to recover it. Two columns, then:

- ``status_token_hash`` — hex SHA-256 of the token, unique and indexed. Every
  lookup matches on this and only this. A plain hash rather than a KDF, because
  the token is 256 random bits; there is no dictionary to slow down.
- ``status_token`` — kept, widened to ``TEXT`` and AES-256-GCM encrypted via
  the ``EncryptedText`` column type, so a database read alone no longer yields
  it. It is never queried, so it loses its unique index.

**Links already emailed keep working.** Existing rows are converted in place:
the hash is computed from the stored plaintext and the same value is then
encrypted. The token the applicant holds does not change; the lookup simply
moves from the token to its hash. Rotating every token instead would have
been simpler and would have broken every link already in an applicant's inbox,
with no way to tell them.

Order matters within the upgrade: the plaintext column's index has to go
before the column can become ``TEXT`` (MySQL will not index a ``TEXT`` column
without a prefix length), and the column has to be ``TEXT`` before ciphertext,
about 100 characters, is written into it. Run the upgrade with the application
stopped, as for any migration: in between, a lookup by hash finds nothing.

``EncryptedText`` returns a value it cannot decrypt as legacy plaintext, so an
application started against a half-migrated table still reads tokens — but it
looks them up by hash, which is why the hash backfill is part of this upgrade
and not left to the next write.

Downgrade decrypts the tokens back to plaintext, restores the ``VARCHAR(64)``
column and its unique index, and drops the hash column. It needs the same
``ENCRYPTION_KEY`` the upgrade ran under.

Revision ID: f7c09cfec5b0
Revises: 9c1445489666
Create Date: 2026-10-05 23:26:04.156256

"""

import hashlib
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7c09cfec5b0"
down_revision: Union[str, None] = "9c1445489666"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "prospective_members"
_HASH_INDEX = "ix_prospective_members_status_token_hash"
_LEGACY_INDEX = "idx_prospect_status_token"


def _has_table() -> bool:
    return _TABLE in sa.inspect(op.get_bind()).get_table_names()


def _columns() -> dict[str, dict]:
    return {c["name"]: c for c in sa.inspect(op.get_bind()).get_columns(_TABLE)}


def _indexes_on(column: str) -> list[str]:
    """Every index whose sole column is ``column``, whatever it was named.

    The plaintext column's index was created as ``idx_prospect_status_token``
    by migration, but an installation built by ``create_all`` names it after
    the model's ``index=True`` instead.
    """
    inspector = sa.inspect(op.get_bind())
    return [
        ix["name"]
        for ix in inspector.get_indexes(_TABLE)
        if ix.get("column_names") == [column]
    ]


def _token_hash(token: str) -> str:
    # Inlined, not imported from the model: a migration must keep doing what it
    # did the day it ran.
    return hashlib.sha256(token.encode()).hexdigest()


def upgrade() -> None:
    if not _has_table():
        return

    from cryptography.fernet import InvalidToken

    from app.core.security import decrypt_data, encrypt_data

    conn = op.get_bind()

    if "status_token_hash" not in _columns():
        op.add_column(
            _TABLE, sa.Column("status_token_hash", sa.String(64), nullable=True)
        )

    # Widen first so ciphertext fits, and so no step below writes a value the
    # old column could not hold.
    for name in _indexes_on("status_token"):
        op.drop_index(name, table_name=_TABLE)
    op.alter_column(
        _TABLE,
        "status_token",
        existing_type=sa.String(64),
        type_=sa.Text(),
        existing_nullable=True,
    )

    rows = conn.execute(
        sa.text(
            "SELECT id, status_token FROM prospective_members "
            "WHERE status_token IS NOT NULL AND status_token <> ''"
        )
    ).fetchall()
    for row_id, stored in rows:
        # Re-runnable: a value this upgrade already encrypted decrypts back to
        # the token; one it has not is legacy plaintext (InvalidToken).
        try:
            token = decrypt_data(stored)
        except InvalidToken:
            token = stored
        conn.execute(
            sa.text(
                "UPDATE prospective_members SET status_token = :enc, "
                "status_token_hash = :hash WHERE id = :id"
            ),
            {"enc": encrypt_data(token), "hash": _token_hash(token), "id": row_id},
        )

    if not _indexes_on("status_token_hash"):
        op.create_index(_HASH_INDEX, _TABLE, ["status_token_hash"], unique=True)


def downgrade() -> None:
    if not _has_table():
        return

    from cryptography.fernet import InvalidToken

    from app.core.security import decrypt_data

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, status_token FROM prospective_members "
            "WHERE status_token IS NOT NULL AND status_token <> ''"
        )
    ).fetchall()
    for row_id, stored in rows:
        try:
            token = decrypt_data(stored)
        except InvalidToken:
            token = stored
        conn.execute(
            sa.text(
                "UPDATE prospective_members SET status_token = :tok WHERE id = :id"
            ),
            {"tok": token, "id": row_id},
        )

    op.alter_column(
        _TABLE,
        "status_token",
        existing_type=sa.Text(),
        type_=sa.String(64),
        existing_nullable=True,
    )
    if not _indexes_on("status_token"):
        op.create_index(_LEGACY_INDEX, _TABLE, ["status_token"], unique=True)

    for name in _indexes_on("status_token_hash"):
        op.drop_index(name, table_name=_TABLE)
    if "status_token_hash" in _columns():
        op.drop_column(_TABLE, "status_token_hash")
