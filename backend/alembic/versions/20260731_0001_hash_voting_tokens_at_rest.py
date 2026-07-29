"""Hash voting tokens at rest (module-audit ELEC-5)

Voting tokens were stored and compared in plaintext, so database read access
yielded live ballot credentials. The application now stores SHA-256(token)
and hashes the presented token before lookup; this migration hashes the
existing rows in place so in-flight emailed links (which carry the raw
token) keep resolving.

Idempotence: raw tokens are `secrets.token_urlsafe(64)` values — 86 chars of
URL-safe base64, never a bare 64-char lowercase-hex string — so the WHERE
guard skips rows that are already SHA-256 hex digests and the UPDATE can run
safely more than once.

Downgrade is a deliberate no-op: hashing is one-way, and the raw values are
unrecoverable by design.

Revision ID: 20260731_0001
Revises: 20260730_0001
Create Date: 2026-07-28 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260731_0001"
down_revision = "20260730_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE voting_tokens SET token = SHA2(token, 256) "
            "WHERE NOT (CHAR_LENGTH(token) = 64 "
            "AND token REGEXP '^[a-f0-9]+$')"
        )
    )


def downgrade() -> None:
    # One-way by design: raw tokens are never stored, so the hash cannot be
    # reversed. Rolling back the code without re-issuing ballots would break
    # token lookup; re-send ballots after a downgrade instead.
    pass
