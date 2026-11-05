"""Hash and encrypt the event-request status token at rest

``event_requests.status_token`` is the bearer credential behind the public
``/event-request/status/<token>`` page, from which a requester follows their
request and cancels it. It was stored in plaintext and matched with ``=``, so
anyone holding a database dump or backup held every live link. The owner
decided on 2026-11-01 to give it the protection the applicant status token got
under PP-6 (migration ``f7c09cfec5b0``), and this mirrors that one:

- ``status_token_hash`` — hex SHA-256 of the token, unique and indexed. Every
  lookup matches on this and only this. A plain hash rather than a KDF, because
  the token is 256 random bits; there is no dictionary to slow down.
- ``status_token`` — kept, widened to ``TEXT`` and AES-256-GCM encrypted via
  the ``EncryptedText`` column type, so a database read alone no longer yields
  it. The coordinator's **Copy status link** control still has to show the
  link, which is why the token cannot simply be replaced by its hash. It is
  never queried, so it loses its unique index.

**Links already shared keep working.** Existing rows are converted in place:
the hash is computed from the stored plaintext and the same value is then
encrypted over it, so no plaintext token remains in the column. The token the
requester holds does not change; the lookup moves from the token to its hash.

Order matters: the plaintext column's index has to go before the column can
become ``TEXT`` (MySQL will not index a ``TEXT`` column without a prefix
length), and the column has to be ``TEXT`` before ciphertext, about 100
characters, is written into it. Run the upgrade with the application stopped:
in between, a lookup by hash finds nothing.

``event_requests`` is built by ``create_all`` and by no migration (CLAUDE.md
Pitfall #26), so every step is guarded on the table existing. On a database
that has not built it yet the upgrade does nothing, which is correct: the table
``create_all`` builds later comes from the model, which already declares both
columns.

**Reversible, given the same key.** Downgrade decrypts the tokens back to
plaintext, restores the ``VARCHAR(64)`` column and its unique index, and drops
the hash column. It needs the ``ENCRYPTION_KEY`` the upgrade ran under; a token
it cannot decrypt is left as it is stored.

Revision ID: e429ae62992e
Revises: 61e85742f52b
Create Date: 2026-11-05 05:31:29.718843

"""

import hashlib
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e429ae62992e"
down_revision: Union[str, None] = "61e85742f52b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can point it at a scratch table.
_TABLE = "event_requests"


def _hash_index() -> str:
    return f"ix_{_TABLE}_status_token_hash"


def _legacy_index() -> str:
    return f"ix_{_TABLE}_status_token"


def _has_table() -> bool:
    return _TABLE in sa.inspect(op.get_bind()).get_table_names()


def _columns() -> dict[str, dict]:
    return {c["name"]: c for c in sa.inspect(op.get_bind()).get_columns(_TABLE)}


def _indexes_on(column: str) -> list[str]:
    """Every index whose sole column is ``column``, whatever it was named."""
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


def _stored_tokens(conn) -> list:
    return conn.execute(
        sa.text(
            f"SELECT id, status_token FROM {_TABLE} "
            "WHERE status_token IS NOT NULL AND status_token <> ''"
        )
    ).fetchall()


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

    for row_id, stored in _stored_tokens(conn):
        # Re-runnable: a value this upgrade already encrypted decrypts back to
        # the token; one it has not is legacy plaintext (InvalidToken).
        try:
            token = decrypt_data(stored)
        except InvalidToken:
            token = stored
        conn.execute(
            sa.text(
                f"UPDATE {_TABLE} SET status_token = :enc, "
                "status_token_hash = :hash WHERE id = :id"
            ),
            {"enc": encrypt_data(token), "hash": _token_hash(token), "id": row_id},
        )

    if not _indexes_on("status_token_hash"):
        op.create_index(_hash_index(), _TABLE, ["status_token_hash"], unique=True)


def downgrade() -> None:
    if not _has_table():
        return

    from cryptography.fernet import InvalidToken

    from app.core.security import decrypt_data

    conn = op.get_bind()
    for row_id, stored in _stored_tokens(conn):
        try:
            token = decrypt_data(stored)
        except InvalidToken:
            token = stored
        conn.execute(
            sa.text(f"UPDATE {_TABLE} SET status_token = :tok WHERE id = :id"),
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
        op.create_index(_legacy_index(), _TABLE, ["status_token"], unique=True)

    for name in _indexes_on("status_token_hash"):
        op.drop_index(name, table_name=_TABLE)
    if "status_token_hash" in _columns():
        op.drop_column(_TABLE, "status_token_hash")
