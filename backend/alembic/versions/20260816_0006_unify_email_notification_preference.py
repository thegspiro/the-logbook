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

Revision ID: 20260816_0006
Revises: 20260816_0005

(Renumbered from 20260816_0002: the storage-area barcode backfill landed
on main under that id the same day.)
Create Date: 2026-08-16
"""

import json

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

    # Rewritten in Python rather than as a JSON_SET/JSON_REMOVE statement.
    # MariaDB 10.11 is a supported deployment target (docker-compose.arm.yml,
    # and its own CI matrix leg) and has no JSON type, so the MySQL-only
    # CAST(... AS JSON) the comparison needed is a syntax error there — the
    # migration would have failed outright on every ARM installation. Reading
    # and writing the column as text is portable across both engines, and the
    # table is small enough (one row per member) that row-at-a-time costs
    # nothing on the one occasion this runs.
    rows = bind.execute(
        sa.text(
            "SELECT id, notification_preferences FROM users "
            "WHERE notification_preferences IS NOT NULL"
        )
    ).fetchall()

    for row in rows:
        raw = row[1]
        # The column comes back as a str on some driver/engine combinations
        # and as an already-decoded dict on others.
        if isinstance(raw, (str, bytes, bytearray)):
            try:
                prefs = json.loads(raw)
            except (ValueError, TypeError):
                continue
        else:
            prefs = raw
        if not isinstance(prefs, dict) or "email" not in prefs:
            continue

        # An explicit `email: false` was a real opt-out recorded through the
        # admin panel. Carry it onto the surviving key before dropping the
        # dead one; anything else (true, or a value nobody recognises) simply
        # loses the key.
        if prefs.get("email") is False:
            prefs["email_notifications"] = False
        prefs.pop("email", None)

        bind.execute(
            sa.text(
                "UPDATE users SET notification_preferences = :prefs WHERE id = :id"
            ),
            {"prefs": json.dumps(prefs), "id": row[0]},
        )


def downgrade() -> None:
    # Deliberately not restored. The key is dead on the way back down: nothing
    # reads it after this revision, and re-deriving it from
    # email_notifications would invent an opt-out for members who never had
    # one. Preferences survive the downgrade under the key the senders honour.
    pass
