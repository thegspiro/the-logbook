"""Record when an applicant changed their own identifying details

Revision ID: 809893462b67
Revises: 1ba6979f9408, fc5584a22199
Create Date: 2026-11-21 19:00:00.000000

``prospective_members`` gains ``identity_edited_by_applicant_at``
(``DateTime(timezone=True)``, nullable). It is set when the applicant changes
their email, name or date of birth through a follow-up form, and cleared when a
coordinator changes one of them. While it is set, the self-access guard
(``app/api/prospect_privacy.py``) matches the record to a member only by
``transferred_user_id`` (ADV2-10, owner decision 2026-11-21): an applicant who
typed a coordinator's details would otherwise hide their own file from that
coordinator.

Existing rows are backfilled from ``prospect_activity_log`` (owner decision:
apply the rule to applications already edited). Each application's events are
replayed in order, the same rule the application now applies as it goes:

- ``follow_up_form_submitted`` whose ``changed_fields`` names an identity field
  stamps the row with that event's time;
- ``prospect_updated`` whose ``changes`` names an identity field clears it.

Rows with neither stay NULL, which is the guard's previous behaviour (CLAUDE.md
pitfall #35). The backfill runs only with the column's creation, so a re-run
changes nothing. Skipped
when ``create_all`` has not built either table yet (pitfall #26). The logic is
inlined rather than imported, so this revision keeps doing what it did the day
it ran (pitfall #20). The downgrade drops the column, and with it the record of
which applications were edited; the guard then matches on every identifier
again.
"""

import json
from typing import Any, Dict, Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "809893462b67"
# Also joins main's two heads, so ``alembic upgrade head`` runs again:
# 1ba6979f9408 and fc5584a22199, two merges of the same pair (67f75ff116ae
# and 9cce83b31c70) that landed minutes apart on 2026-11-22. Kept on one line
# for the migration-chain validators, which read it line by line.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("1ba6979f9408", "fc5584a22199")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "prospective_members"
LOG = "prospect_activity_log"
COLUMN = "identity_edited_by_applicant_at"
IDENTITY_FIELDS = frozenset({"email", "first_name", "last_name", "date_of_birth"})


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    return COLUMN in {c["name"] for c in inspector.get_columns(TABLE)}


def _details(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (str, bytes)):
        try:
            parsed = json.loads(raw)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _touches_identity(action: str, details: Dict[str, Any]) -> Optional[bool]:
    """True: the applicant changed an identity field. False: a coordinator did.
    None: the event says nothing about them."""
    if action == "follow_up_form_submitted":
        fields = details.get("changed_fields") or []
        if isinstance(fields, list) and IDENTITY_FIELDS.intersection(map(str, fields)):
            return True
    elif action == "prospect_updated":
        changes = details.get("changes") or {}
        if isinstance(changes, dict) and IDENTITY_FIELDS.intersection(changes):
            return False
    return None


def _backfill() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            f"SELECT prospect_id, action, details, created_at FROM {LOG} "
            "WHERE action IN ('follow_up_form_submitted', 'prospect_updated') "
            "ORDER BY prospect_id, created_at, id"
        )
    ).fetchall()
    stamped: Dict[str, Any] = {}
    for prospect_id, action, raw, created_at in rows:
        verdict = _touches_identity(action, _details(raw))
        if verdict is True:
            stamped[prospect_id] = created_at
        elif verdict is False:
            stamped.pop(prospect_id, None)
    for prospect_id, created_at in stamped.items():
        if created_at is None:
            continue
        bind.execute(
            sa.text(
                f"UPDATE {TABLE} SET {COLUMN} = :at "
                f"WHERE id = :id AND {COLUMN} IS NULL"
            ),
            {"at": created_at, "id": prospect_id},
        )


def upgrade() -> None:
    if not _has_table(TABLE) or _has_column():
        return
    op.add_column(TABLE, sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True))
    # Only alongside the column: a re-run must not re-stamp a row a
    # coordinator has since cleared.
    if _has_table(LOG):
        _backfill()


def downgrade() -> None:
    if _has_table(TABLE) and _has_column():
        op.drop_column(TABLE, COLUMN)
