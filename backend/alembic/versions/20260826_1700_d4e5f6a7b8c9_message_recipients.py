"""Add durable department message recipient fan-out.

Revision ID: e5f6a7b8c9d0
Revises: 5128feb36dd2
"""

import json
import uuid

import sqlalchemy as sa
from alembic import op

revision = "e5f6a7b8c9d0"
down_revision = "5128feb36dd2"
branch_labels = None
depends_on = None


def _array(value):
    if value is None or isinstance(value, list):
        return value or []
    return json.loads(value)


def upgrade():
    op.create_table(
        "department_message_recipients",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("message_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["message_id"], ["department_messages.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("message_id", "user_id", name="uq_dept_msg_recipient_user"),
    )
    op.create_index(
        "idx_dept_msg_recipient_org_user_message",
        "department_message_recipients",
        ["organization_id", "user_id", "message_id"],
    )
    op.create_index(
        "idx_dept_msg_recipient_unread",
        "department_message_recipients",
        ["organization_id", "user_id", "read_at"],
    )
    op.create_index(
        "idx_dept_msg_recipient_unacknowledged",
        "department_message_recipients",
        ["organization_id", "user_id", "acknowledged_at"],
    )

    bind = op.get_bind()
    # `positions`/`user_positions` are reflected unconditionally here on
    # purpose: they are not create_all-only (CLAUDE.md Pitfall #26 does not
    # apply). `20260805_0008_rename_roles_to_positions.py` renames
    # `roles`/`user_roles` — created outright by the initial schema
    # migration — to these names, and is a required upgrade-path ancestor of
    # this revision, so a fresh database always has both tables by the time
    # this runs. Verified empirically: `alembic upgrade head` against a
    # freshly created, empty database completes with no NoSuchTableError.
    # `backend/tests/test_migration_create_all_tables.py`'s
    # `_tables_created_by_migrations` recognizes `op.rename_table`
    # destinations for exactly this reason.
    meta = sa.MetaData()
    messages = sa.Table("department_messages", meta, autoload_with=bind)
    users = sa.Table("users", meta, autoload_with=bind)
    positions = sa.Table("positions", meta, autoload_with=bind)
    user_positions = sa.Table("user_positions", meta, autoload_with=bind)
    reads = sa.Table("department_message_reads", meta, autoload_with=bind)
    recipients = sa.Table("department_message_recipients", meta, autoload_with=bind)
    role_rows = bind.execute(
        sa.select(user_positions.c.user_id, positions.c.id, positions.c.name).join(
            positions, positions.c.id == user_positions.c.position_id
        )
    ).all()
    roles = {}
    for uid, rid, name in role_rows:
        roles.setdefault(str(uid), set()).update((str(rid), name))
    read_map = {
        (str(r.message_id), str(r.user_id)): r
        for r in bind.execute(sa.select(reads)).mappings()
    }
    rows = []
    for message in bind.execute(
        sa.select(messages).where(messages.c.scheduled_at.is_(None))
    ).mappings():
        target = getattr(message["target_type"], "value", message["target_type"])
        for user in bind.execute(
            sa.select(users).where(
                users.c.organization_id == message["organization_id"],
                users.c.status == "active",
                users.c.deleted_at.is_(None),
            )
        ).mappings():
            uid = str(user["id"])
            matched = (
                target == "all"
                or (target == "members" and uid in _array(message["target_member_ids"]))
                or (
                    target == "statuses"
                    and str(user["status"]) in _array(message["target_statuses"])
                )
                or (
                    target == "roles"
                    and bool(
                        roles.get(uid, set()) & set(_array(message["target_roles"]))
                    )
                )
            )
            if matched:
                old = read_map.get((str(message["id"]), uid))
                rows.append(
                    {
                        "id": str(uuid.uuid4()),
                        "message_id": message["id"],
                        "user_id": user["id"],
                        "organization_id": message["organization_id"],
                        "read_at": old["read_at"] if old else None,
                        "acknowledged_at": old["acknowledged_at"] if old else None,
                    }
                )
    if rows:
        bind.execute(recipients.insert(), rows)


def downgrade():
    bind = op.get_bind()
    meta = sa.MetaData()
    reads = sa.Table("department_message_reads", meta, autoload_with=bind)
    recipients = sa.Table("department_message_recipients", meta, autoload_with=bind)
    for recipient in bind.execute(sa.select(recipients)).mappings():
        existing = (
            bind.execute(
                sa.select(reads).where(
                    reads.c.message_id == recipient["message_id"],
                    reads.c.user_id == recipient["user_id"],
                )
            )
            .mappings()
            .first()
        )
        values = {
            "read_at": recipient["read_at"],
            "acknowledged_at": recipient["acknowledged_at"],
        }
        if existing:
            bind.execute(
                reads.update().where(reads.c.id == existing["id"]).values(**values)
            )
        elif (
            recipient["read_at"] is not None or recipient["acknowledged_at"] is not None
        ):
            bind.execute(
                reads.insert().values(
                    id=str(uuid.uuid4()),
                    message_id=recipient["message_id"],
                    user_id=recipient["user_id"],
                    **values,
                )
            )
    op.drop_table("department_message_recipients")
