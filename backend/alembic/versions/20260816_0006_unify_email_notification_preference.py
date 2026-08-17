"""Collapse the duplicate `email` notification preference into `email_notifications`

`notification_preferences` carried two keys meaning the same thing. Seven
senders read `email_notifications`; exactly one (cert expiry alerts) read
`email`. The member's own settings screen wrote `email_notifications` while the
admin contact panel on the member profile wrote `email` — so an admin
unchecking what reads as a master email switch suppressed certification alerts
and nothing else.

`email_notifications` is the survivor because it is the key the senders
already honour. An explicit `email: false` was a real opt-out recorded through
the admin panel, so it is carried onto the surviving key before the dead one is
dropped; a member who opted out must not start receiving mail again because the
key was renamed underneath them.

(Renumbered from 20260816_0002: the storage-area barcode backfill on main
already held that id — the same-day collision ALEMBIC_MIGRATIONS.md warns
about. Chained after the current head to keep the graph linear.)

Revision ID: 20260816_0006
Revises: 20260816_0005
Create Date: 2026-08-16
"""

import sqlalchemy as sa
from alembic import op

revision = "20260816_0006"
down_revision = "20260816_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "notification_preferences" not in columns:
        return

    # Preserve the opt-out first. CAST('false' AS JSON) rather than a bare
    # FALSE so the comparison is JSON-to-JSON: MySQL would otherwise coerce
    # both sides to numbers and match JSON null as well.
    op.execute(
        sa.text(
            "UPDATE users "
            "SET notification_preferences = JSON_SET("
            "  notification_preferences, '$.email_notifications', CAST('false' AS JSON)"
            ") "
            "WHERE notification_preferences IS NOT NULL "
            "  AND JSON_CONTAINS_PATH(notification_preferences, 'one', '$.email') "
            "  AND JSON_EXTRACT(notification_preferences, '$.email') "
            "      = CAST('false' AS JSON)"
        )
    )

    op.execute(
        sa.text(
            "UPDATE users "
            "SET notification_preferences = JSON_REMOVE("
            "  notification_preferences, '$.email'"
            ") "
            "WHERE notification_preferences IS NOT NULL "
            "  AND JSON_CONTAINS_PATH(notification_preferences, 'one', '$.email')"
        )
    )


def downgrade() -> None:
    # Deliberately not restored. The key is dead on the way back down: nothing
    # reads it after this revision, and re-deriving it from
    # email_notifications would invent an opt-out for members who never had
    # one. Preferences survive the downgrade under the key the senders honour.
    pass
