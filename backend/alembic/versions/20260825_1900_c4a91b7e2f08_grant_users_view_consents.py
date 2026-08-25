"""Grant users.view_consents to the seeded publication-facing positions.

``users.view_consents`` is a new permission, and the photo-use consent roster
accepts it. Adding it to ``DEFAULT_POSITIONS`` only affects organizations
onboarded *after* this deploy: onboarding copies the registry's list into a
stored ``positions`` row, and every installation already past onboarding keeps
whatever was copied on the day it ran. Without this migration the Historian and
Public Outreach positions would gain the grant on new departments and nowhere
else — which is the failure CLAUDE.md pitfall 23 describes.

**``is_system = True`` does not mean "untouched".** ``RoleService.update_role``
deliberately allows a system position's ``permissions`` to be edited in place —
its docstring reads "System roles can only have their permissions and
description updated" — so the flag stays ``True`` on a position a department
has customized. Scoping the backfill on it alone would silently re-grant a
permission to a Historian whose department had deliberately cut it back, which
is the opposite of what a backfill is for.

So a row is rewritten only when its stored permission set still equals the
registry default this migration was written against, spelled out in
``_PRIOR_DEFAULTS`` below. Anything else — a permission added, one removed, the
set replaced wholesale — is a department's own decision about who may read its
members' privacy answers, and is left alone. Those departments grant the
permission themselves in Role Management if they want the page.

``_PRIOR_DEFAULTS`` is frozen on purpose. It is a snapshot of
``DEFAULT_POSITIONS`` as of this revision, not an import, because a migration
must keep matching the rows it was written to match even after the registry
moves on (the same reasoning as the inlined normalizer in
``20260819_2037_1eeb053d59b7``).

Idempotent: a row already carrying the permission no longer equals the prior
default, so it is skipped — which is also why this is safe to re-run.

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

# Snapshot of DEFAULT_POSITIONS at this revision — see the module docstring.
# The Communications Officer already reaches the roster through
# notifications.manage; it is included so the stored row states the grant it
# relies on rather than arriving by a side door.
_PRIOR_DEFAULTS = {
    "communications_officer": {
        "documents.view",
        "events.create",
        "events.edit",
        "events.manage",
        "events.view",
        "locations.view",
        "members.view",
        "notifications.manage",
        "notifications.view",
        "organization.view",
        "positions.view",
        "users.view",
        "users.view_contact",
    },
    "historian": {
        "documents.manage",
        "documents.view",
        "events.view",
        "meetings.view",
        "members.view",
        "minutes.view",
        "notifications.view",
        "organization.view",
        "users.view",
    },
    "public_outreach": {
        "events.create",
        "events.edit",
        "events.manage",
        "events.view",
        "locations.create",
        "locations.edit",
        "locations.manage",
        "locations.view",
        "members.view",
        "organization.view",
        "positions.view",
        "users.view",
        "users.view_contact",
    },
}


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
        updated = mutate(slug, permissions)
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

    def add(slug, permissions):
        if set(permissions) != _PRIOR_DEFAULTS[slug]:
            return None
        return permissions + [_PERMISSION]

    for slug in _PRIOR_DEFAULTS:
        _rewrite(bind, slug, add)


def downgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    def remove(slug, permissions):
        # Mirror of the upgrade's guard: only take the grant back off a row
        # that is otherwise exactly what the upgrade would have produced, so a
        # department that has since edited the position keeps its own set.
        if set(permissions) != _PRIOR_DEFAULTS[slug] | {_PERMISSION}:
            return None
        return [item for item in permissions if item != _PERMISSION]

    for slug in _PRIOR_DEFAULTS:
        _rewrite(bind, slug, remove)
