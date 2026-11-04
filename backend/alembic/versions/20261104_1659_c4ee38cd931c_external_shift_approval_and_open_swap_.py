"""External shift approval state, and open-swap notice ledger.

Revision ID: c4ee38cd931c
Revises: 7a1c3e9f5b20
Create Date: 2026-11-04 16:59:43.377406

Two owner decisions of 2026-11-01, built 2026-11-04:

* ``external_shift_hours.status`` may now hold ``pending`` — an outside shift
  logged while the department requires officer approval, which counts only once
  approved. The status CHECK constraint is replaced to allow it. **Existing rows
  are not touched:** every one is ``counted`` or ``rejected``, both of which the
  new constraint still allows, so the entries that counted before the upgrade
  keep counting, and the new setting defaults off. The constraint is found by
  what it checks rather than by name, because a database whose table
  ``create_all`` built carries the naming convention's doubled name
  (``ck_external_shift_hours_ck_external_shift_hours_status``) while one built
  by ``f03c9f236904`` carries the plain one; it is recreated under the name it
  had.
* ``open_swap_notices`` — one row per member told by a bell entry that a seat
  they are cleared for was offered as an open swap (W33-4). The unique key on
  (offering shift, member offering it, recipient) is what makes a second
  fan-out for the same seat a no-op.

Each step is guarded so a database whose tables ``create_all`` already built
from the current models, or one where a referenced table does not exist yet,
is left alone.

Downgrade: ``pending`` has no place in the old two-state constraint. A pending
entry never counted, so it is marked ``rejected`` with a reason saying why —
not ``counted``, which would credit hours no officer approved — before the old
constraint comes back. The notice ledger is dropped; only duplicate-notice
protection is lost.
"""

from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4ee38cd931c"
down_revision: Union[str, None] = "7a1c3e9f5b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ENTRIES = "external_shift_hours"
NOTICES = "open_swap_notices"
PLAIN_NAME = "ck_external_shift_hours_status"
THREE_STATES = "status IN ('pending', 'counted', 'rejected')"
TWO_STATES = "status IN ('counted', 'rejected')"
DOWNGRADE_REASON = (
    "Awaiting approval when the approval step was removed by a downgrade; "
    "it never counted."
)


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _status_check() -> Optional[tuple]:
    """``(name, sqltext)`` of the CHECK on ``status``, whatever it is called."""
    for check in _inspector().get_check_constraints(ENTRIES):
        text = (check.get("sqltext") or "").lower()
        if "status" in text and "counted" in text:
            return check.get("name"), text
    return None


def _replace_status_check(sql: str) -> None:
    found = _status_check()
    name = PLAIN_NAME
    if found is not None:
        name = found[0] or PLAIN_NAME
        op.drop_constraint(op.f(name), ENTRIES, type_="check")
    op.create_check_constraint(op.f(name), ENTRIES, sql)


def upgrade() -> None:
    if _has_table(ENTRIES):
        found = _status_check()
        if found is None or "pending" not in found[1]:
            _replace_status_check(THREE_STATES)

    referenced = {"organizations", "shifts", "users", "shift_swap_requests"}
    if not _has_table(NOTICES) and referenced <= set(_inspector().get_table_names()):
        op.create_table(
            NOTICES,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "offering_shift_id",
                sa.String(36),
                sa.ForeignKey("shifts.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "offered_by_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "recipient_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "swap_request_id",
                sa.String(36),
                sa.ForeignKey("shift_swap_requests.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "offering_shift_id",
                "offered_by_id",
                "recipient_id",
                name="uq_open_swap_notices_seat_recipient",
            ),
        )
        op.create_index("ix_open_swap_notices_org", NOTICES, ["organization_id"])


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {NOTICES}")
    if not _has_table(ENTRIES):
        return
    found = _status_check()
    if found is not None and "pending" in found[1]:
        op.get_bind().execute(
            sa.text(
                f"UPDATE {ENTRIES} SET status = 'rejected', "
                "rejection_reason = :reason WHERE status = 'pending'"
            ),
            {"reason": DOWNGRADE_REASON},
        )
        _replace_status_check(TWO_STATES)
