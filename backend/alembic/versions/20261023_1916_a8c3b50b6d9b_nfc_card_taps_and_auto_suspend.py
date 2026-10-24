"""NFC card taps and auto-suspend

Adds what the Member ID Cards admin page needs:

* ``nfc_card_taps`` — one row per tap of a member ID card at a check-in station
  or a room kiosk, refusals included, so the page can filter the tap log by
  card, member and outcome. History starts when this migration runs: the audit
  log never recorded refused taps or which card was tapped, so there is nothing
  to backfill from.
* ``nfc_tags.auto_suspended`` — marks a card the system suspended because its
  holder left, so the card can come back by itself when the member returns
  without also undoing a suspension an officer chose.

**Data change.** Active cards whose holder is already inactive, suspended,
dropped (either kind), archived or deleted are set to ``suspended`` with
``auto_suspended`` true. Taps on those cards were already refused at the reader
(``_BLOCKED_MEMBER_STATUSES`` in ``app/services/nfc_tag_service.py``), so no
member loses a working card; the card's stored status simply stops reading
"Active" while it fails. Retired and on-leave members are not in that set and
keep working cards.

Each step is skipped when its table is not there yet or the change is already
made. The downgrade returns every auto-suspended card to ``active`` — taps on
them are still refused by the member-status check, so this restores the exact
pre-migration behaviour — then drops the column and the table. The tap history
is lost with the table.

Revision ID: a8c3b50b6d9b
Revises: a0195b397bf3
Create Date: 2026-10-23 19:16:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8c3b50b6d9b"
down_revision: Union[str, None] = "a0195b397bf3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TAGS = "nfc_tags"
TAPS = "nfc_card_taps"

# Frozen copy of _BLOCKED_MEMBER_STATUSES as it stood when this ran. A
# migration must keep doing what it did the day it shipped, so it does not
# import the service's set, which is free to change.
_BLOCKED = (
    "inactive",
    "suspended",
    "dropped_voluntary",
    "dropped_involuntary",
    "archived",
)
_REASON = "Suspended automatically: the card holder is no longer an active member"


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def upgrade() -> None:
    inspector = _inspector()
    tables = set(inspector.get_table_names())

    if TAGS in tables:
        have = {c["name"] for c in inspector.get_columns(TAGS)}
        if "auto_suspended" not in have:
            op.add_column(
                TAGS,
                sa.Column(
                    "auto_suspended",
                    sa.Boolean(),
                    nullable=False,
                    server_default="0",
                ),
            )

        if "users" in tables:
            blocked = ", ".join(f"'{s}'" for s in _BLOCKED)
            op.get_bind().execute(
                sa.text(f"""
                    UPDATE {TAGS} t
                    JOIN users u
                      ON u.id = t.user_id
                     AND u.organization_id = t.organization_id
                    SET t.status = 'suspended',
                        t.auto_suspended = 1,
                        t.revoked_at = UTC_TIMESTAMP(),
                        t.revoked_reason = :reason
                    WHERE t.status = 'active'
                      AND (u.status IN ({blocked}) OR u.deleted_at IS NOT NULL)
                    """),
                {"reason": _REASON},
            )

    if TAPS not in tables:
        op.create_table(
            TAPS,
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(length=36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "tag_id",
                sa.String(length=36),
                sa.ForeignKey("nfc_tags.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "user_id",
                sa.String(length=36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("unknown_uid_hash", sa.String(length=64), nullable=True),
            sa.Column(
                "source",
                sa.Enum("station", "kiosk", name="nfctapsource"),
                nullable=False,
            ),
            sa.Column(
                "location_id",
                sa.String(length=36),
                sa.ForeignKey("locations.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "operator_id",
                sa.String(length=36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "target_type",
                sa.Enum("shift", "event", "admin_hours", name="nfccheckintarget"),
                nullable=True,
            ),
            sa.Column("target_id", sa.String(length=36), nullable=True),
            sa.Column("target_name", sa.String(length=255), nullable=True),
            sa.Column(
                "outcome",
                sa.Enum(
                    "checked_in",
                    "checked_out",
                    "already_checked_in",
                    "already_checked_out",
                    "unknown_card",
                    "card_inactive",
                    "member_inactive",
                    "refused",
                    name="nfccheckinstatus",
                ),
                nullable=False,
            ),
            sa.Column(
                "tapped_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index(
            "idx_nfc_card_tap_org_time", TAPS, ["organization_id", "tapped_at"]
        )
        op.create_index("idx_nfc_card_tap_org_tag", TAPS, ["organization_id", "tag_id"])
        op.create_index(
            "idx_nfc_card_tap_org_user", TAPS, ["organization_id", "user_id"]
        )
        op.create_index(
            "idx_nfc_card_tap_org_location", TAPS, ["organization_id", "location_id"]
        )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TAPS}")

    inspector = _inspector()
    if TAGS in set(inspector.get_table_names()):
        have = {c["name"] for c in inspector.get_columns(TAGS)}
        if "auto_suspended" in have:
            op.execute(f"""
                UPDATE {TAGS}
                SET status = 'active', revoked_at = NULL, revoked_reason = NULL
                WHERE auto_suspended = 1
                """)
            op.drop_column(TAGS, "auto_suspended")
