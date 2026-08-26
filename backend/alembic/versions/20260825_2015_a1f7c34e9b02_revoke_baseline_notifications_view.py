"""Revoke notifications.view from the baseline member and junior-rank positions.

``notifications.view`` gates three admin tabs on the Notifications screen, and
one of them is a disclosure:

* ``GET /notifications/logs`` — the Send Log. ``NotificationsService.get_logs``
  filters on ``organization_id`` and nothing else, and ``NotificationLog``
  carries ``recipient_email``, ``subject`` and ``message``. Seeded to everyone,
  it let any member page through the body of every notification the department
  has ever sent any other member.
* ``GET /notifications/rules`` — org-wide notification configuration, read-only
  for this grant but not a member's business.
* The Email Templates tab, whose only control navigates to a route requiring
  ``settings.manage`` — a dead end for anyone holding view alone.

Members lose nothing they can act on: their own inbox (``GET
/notifications/my``) depends on ``get_current_user`` alone and is untouched.

Three seeded **positions** need rewriting: ``member``, ``firefighter`` and
``engineer``.

The two rank ones are easy to miss. ``operational_ranks`` genuinely has no
permissions column — rank defaults resolve at runtime from ``OPERATIONAL_RANKS``
— but ``DEFAULT_POSITIONS[rank]["permissions"]`` *is*
``OPERATIONAL_RANKS[rank]["default_permissions"]``, the same list object, so
onboarding also writes system positions with those slugs carrying a copy.
``dependencies.py`` unions every assigned position's stored permissions, so a
member holding the Firefighter or Engineer position would have kept the grant
if only ``member`` were rewritten here. Same shape as
``31e2816df7c3`` (``compliance.view``).

Scoped to ``is_system = True``: a department that has customized a position of
its own keeps whatever it put there.

Revision ID: a1f7c34e9b02
Revises: c4f8a2e70d19
Create Date: 2026-08-25 20:15:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "a1f7c34e9b02"
down_revision = "c4f8a2e70d19"
branch_labels = None
depends_on = None

_PERMISSION = "notifications.view"
_SLUGS = ("member", "firefighter", "engineer")


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def upgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    for slug in _SLUGS:
        rows = bind.execute(
            sa.text(
                "SELECT id, permissions FROM positions "
                "WHERE slug = :slug AND is_system = :is_system"
            ),
            {"slug": slug, "is_system": True},
        ).fetchall()
        for row in rows:
            permissions = _load_permissions(row.permissions)
            if _PERMISSION not in permissions:
                continue
            permissions = [item for item in permissions if item != _PERMISSION]
            bind.execute(
                sa.text(
                    "UPDATE positions SET permissions = :permissions WHERE id = :id"
                ),
                {"permissions": json.dumps(permissions), "id": row.id},
            )


def downgrade() -> None:
    # Restoring the grant would reopen every member's read of every other
    # member's notification subjects and bodies through the org-wide Send Log.
    pass
