"""Grant users.view_consents to the seeded publication-facing positions.

``users.view_consents`` is a new permission, and the photo-use consent roster
accepts it. Adding it to ``DEFAULT_POSITIONS`` only affects organizations
onboarded *after* this deploy: onboarding copies the registry's list into a
stored ``positions`` row, and every installation already past onboarding keeps
whatever was copied on the day it ran. Without this migration the Historian and
Public Outreach positions would gain the grant on new departments and nowhere
else — which is the failure CLAUDE.md pitfall 23 describes.

Scoped to ``is_system = True`` deliberately. A department that has customized
its own Historian position owns that row, and a migration has no business
adding grants to it.

Idempotent: a row that already carries the permission is skipped, so this is
safe on an installation whose onboarding ran after the registry change.

Revision ID: c4a91b7e2f08
Revises: e3b7c25f9a41
Create Date: 2026-08-25 19:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "c4a91b7e2f08"
down_revision = "e3b7c25f9a41"
branch_labels = None
depends_on = None

_PERMISSION = "users.view_consents"
# The Communications Officer already reaches the roster through
# notifications.manage; it is listed anyway so the stored row states the grant
# it actually relies on rather than reaching the page by a side door.
_SLUGS = ("communications_officer", "historian", "public_outreach")


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _rewrite(bind, slug, mutate):
    rows = bind.execute(
        sa.text(
            "SELECT id, permissions FROM positions "
            "WHERE slug = :slug AND is_system = :is_system"
        ),
        {"slug": slug, "is_system": True},
    ).fetchall()
    for row in rows:
        permissions = _load_permissions(row.permissions)
        updated = mutate(permissions)
        if updated is None:
            continue
        bind.execute(
            sa.text("UPDATE positions SET permissions = :permissions WHERE id = :id"),
            {"permissions": json.dumps(updated), "id": row.id},
        )


def upgrade() -> None:
    bind = op.get_bind()
    # `positions` is one of the tables no migration creates — it comes into
    # being when main.py calls create_all() (CLAUDE.md pitfall 26). CI runs
    # `alembic upgrade head` against an empty database, so reflecting it
    # unguarded would fail the whole upgrade rather than this one step.
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    def add(permissions):
        if _PERMISSION in permissions:
            return None
        return permissions + [_PERMISSION]

    for slug in _SLUGS:
        _rewrite(bind, slug, add)


def downgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    def remove(permissions):
        if _PERMISSION not in permissions:
            return None
        return [item for item in permissions if item != _PERMISSION]

    for slug in _SLUGS:
        _rewrite(bind, slug, remove)
