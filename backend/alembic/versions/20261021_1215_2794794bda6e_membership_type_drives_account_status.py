"""Account status follows membership type for probationary members

Owner decision 2026-10-20: membership type drives account status, one way,
and only between the two statuses that say nothing about leave or
separation. From this revision on ``_reconcile_membership`` keeps them in
step at every write. This migration settles the rows already there:

* status ``active`` with membership type ``probationary`` -> ``probationary``
* status ``probationary`` with any other membership type -> ``active``

Every other status (inactive, suspended, leave, retired, dropped, archived)
is left as it is, as the rule says, and so is every soft-deleted member.

Reversible, and logged per member. Each change is recorded as an audit row
(``event_type`` ``account_status_backfilled``, ``event_data`` carrying this
revision id, the direction, the user and both statuses). The rows are
written with the chain columns NULL, exactly as the application writes its
own, and the sealer joins them to the hash chain afterwards. The downgrade
reads them back and restores the previous status wherever the member still
holds the status this migration wrote — a status an officer changed since is
not touched — and records each reversal as another audit row. Audit rows are
never deleted: they are part of the chain.

``users`` and ``audit_logs`` are both created by the migration chain, so on a
fresh database they exist and are empty; the guard is for a database that
has neither yet (pitfall #26), where there is nothing to settle.

Revision ID: 2794794bda6e
Revises: 1eb43da769b2
Create Date: 2026-10-21 12:15:00.000000

"""

import json
import time
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2794794bda6e"
down_revision: Union[str, None] = "1eb43da769b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EVENT_TYPE = "account_status_backfilled"
PROBATIONARY = "probationary"
ACTIVE = "active"
REASON = "Follows membership type"


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _status_for(membership_type, status):
    """The rule, inlined: a migration must keep doing what it did the day it ran."""
    probationary = (membership_type or "").strip().lower() == PROBATIONARY
    if probationary and status == ACTIVE:
        return PROBATIONARY
    if not probationary and status == PROBATIONARY:
        return ACTIVE
    return None


def _audit(bind, direction: str, row, previous: str, new: str, now: datetime) -> None:
    bind.execute(
        sa.text(
            "INSERT INTO audit_logs (timestamp, timestamp_nanos, event_type, "
            "event_category, severity, user_id, username, organization_id, "
            "event_data, created_at) VALUES (:ts, :nanos, :type, "
            "'user_management', 'info', NULL, NULL, :org, :data, :ts)"
        ),
        {
            "ts": now,
            "nanos": time.time_ns(),
            "type": EVENT_TYPE,
            "org": row["organization_id"],
            "data": json.dumps(
                {
                    "revision": revision,
                    "direction": direction,
                    "target_user_id": row["id"],
                    "username": row["username"],
                    "membership_type": row["membership_type"],
                    "previous_status": previous,
                    "new_status": new,
                    "reason": f"{REASON} '{row['membership_type']}'",
                }
            ),
        },
    )


def _set_status(bind, user_id: str, expected: str, new: str, reason: str, now):
    return bind.execute(
        sa.text(
            "UPDATE users SET status = :new, status_changed_at = :now, "
            "status_change_reason = :reason WHERE id = :id AND status = :expected"
        ),
        {"new": new, "now": now, "reason": reason, "id": user_id, "expected": expected},
    )


def upgrade() -> None:
    tables = _tables()
    if "users" not in tables or "audit_logs" not in tables:
        return
    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    rows = (
        bind.execute(
            sa.text(
                "SELECT id, organization_id, username, status, membership_type "
                "FROM users WHERE deleted_at IS NULL "
                "AND status IN ('active', 'probationary') ORDER BY id"
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        new = _status_for(row["membership_type"], row["status"])
        if new is None:
            continue
        reason = f"{REASON} '{row['membership_type']}'"
        if _set_status(bind, row["id"], row["status"], new, reason, now).rowcount:
            _audit(bind, "upgrade", row, row["status"], new, now)


def downgrade() -> None:
    tables = _tables()
    if "users" not in tables or "audit_logs" not in tables:
        return
    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    rows = (
        bind.execute(
            sa.text(
                "SELECT id, event_data FROM audit_logs "
                "WHERE event_type = :type ORDER BY id"
            ),
            {"type": EVENT_TYPE},
        )
        .mappings()
        .all()
    )
    for entry in rows:
        data = entry["event_data"]
        if isinstance(data, (str, bytes)):
            data = json.loads(data)
        if data.get("revision") != revision or data.get("direction") != "upgrade":
            continue
        user = (
            bind.execute(
                sa.text(
                    "SELECT id, organization_id, username, status, membership_type "
                    "FROM users WHERE id = :id"
                ),
                {"id": data["target_user_id"]},
            )
            .mappings()
            .first()
        )
        if user is None:
            continue
        previous, written = data["previous_status"], data["new_status"]
        reason = f"Restored by downgrade of {revision}"
        if _set_status(bind, user["id"], written, previous, reason, now).rowcount:
            _audit(bind, "downgrade", user, written, previous, now)
