"""Backfill eligible_positions for existing operational ranks

Existing organizations have eligible_positions = NULL on all ranks
because the seed defaults only run for new orgs. This migration
populates sensible defaults based on rank_code.

Revision ID: a9f3e7c10004
Revises: a9f3e7c10003
Create Date: 2026-03-17 02:00:00.000000
"""

import json

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "a9f3e7c10004"
down_revision = "a9f3e7c10003"
branch_labels = None
depends_on = None


# Same defaults used in operational_rank_service.py DEFAULT_RANKS
_ALL = [
    "officer", "driver", "firefighter", "ems",
    "captain", "lieutenant", "probationary", "volunteer", "other",
]

_DEFAULTS_BY_CODE = {
    "fire_chief": _ALL,
    "deputy_chief": _ALL,
    "assistant_chief": _ALL,
    "captain": ["captain", "officer", "driver", "firefighter", "ems", "lieutenant"],
    "lieutenant": ["lieutenant", "officer", "driver", "firefighter", "ems"],
    "engineer": ["driver", "firefighter", "ems"],
    "firefighter": ["firefighter", "ems"],
    "emt": ["ems", "firefighter"],
}


def upgrade() -> None:
    conn = op.get_bind()
    for code, positions in _DEFAULTS_BY_CODE.items():
        conn.execute(
            sa.text(
                "UPDATE operational_ranks "
                "SET eligible_positions = :positions "
                "WHERE rank_code = :code AND eligible_positions IS NULL"
            ),
            {"code": code, "positions": json.dumps(positions)},
        )


def downgrade() -> None:
    # No destructive downgrade — leave data in place.
    pass
