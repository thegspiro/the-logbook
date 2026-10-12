"""Grant finance.request to the seeded Member position.

``finance.request`` is new: it lets a member create, submit and track their
own purchase requests, expense reports and check requests. Until now those
endpoints required ``finance.manage``, which only the Treasurer and the IT
Manager hold, so a member who needed reimbursement had to ask the treasurer to
raise the request on their behalf.

``DEFAULT_POSITIONS`` now grants it on the ``member`` position, which every
member holds, but that only reaches departments onboarded after this deploy
(CLAUDE.md pitfall #23). This carries the grant to the stored rows.

Only ``member``, deliberately: not the operational rank lists, and so not the
``firefighter`` / ``emt`` positions that alias them. A rank default resolves at
runtime and no department can withdraw it; a grant on the Member position can
be removed on the positions screen, which is how a department that does not
want members raising requests says so.

**Direction: adding, gated on the grant's own absence.** The rule in
``docs/rules/migrations.md`` is that an addition needs positive evidence the
row is an unrepaired seed, because an unconditional add would override a
department that removed the grant on purpose. No department can have removed
this one: the permission did not exist before this revision, so the position
editor could never have offered it. Its absence is therefore true of every
seeded row and says nothing about a department's choice, and it cannot drift
the way a whole-list snapshot does. Only ``is_system`` rows are touched; a
position a department created is theirs.

What it opens is deliberately narrow, which is why it is safe to hand to
everyone: a holder without ``finance.view`` / ``finance.manage`` sees and acts
on only the requests they raised, and the budget pages stay closed to them.
A department that does not want members raising requests removes the grant
from the Member position (see docs/UPGRADING.md).

Idempotent: a row already carrying the grant is skipped. The downgrade takes
the grant back off the same seeded rows; a department that granted it to one of
those positions deliberately after the upgrade loses it too, which is the
unavoidable cost of reversing a grant nothing distinguishes from the seed —
and the permission does not exist at the revision the downgrade returns to.

Revision ID: 7db20aa49329
Revises: 26ca07c56d0f
Create Date: 2026-10-07 23:05:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "7db20aa49329"
down_revision = "26ca07c56d0f"
branch_labels = None
depends_on = None

_PERMISSION = "finance.request"

# Frozen at this revision, not imported: a migration must keep targeting the
# rows it was written for after the registry moves on.
_SLUGS = ("member",)


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _rewrite(bind, mutate) -> None:
    for slug in _SLUGS:
        rows = bind.execute(
            sa.text(
                "SELECT id, permissions FROM positions "
                "WHERE slug = :slug AND is_system = :is_system"
            ),
            {"slug": slug, "is_system": True},
        ).fetchall()
        for row in rows:
            updated = mutate(_load_permissions(row.permissions))
            if updated is None:
                continue
            bind.execute(
                sa.text(
                    "UPDATE positions SET permissions = :permissions WHERE id = :id"
                ),
                {"permissions": json.dumps(updated), "id": row.id},
            )


def _add(permissions):
    if _PERMISSION in permissions:
        return None
    return permissions + [_PERMISSION]


def _remove(permissions):
    if _PERMISSION not in permissions:
        return None
    return [item for item in permissions if item != _PERMISSION]


def upgrade() -> None:
    bind = op.get_bind()
    # Defensive only: ``positions`` is built by the migration chain (renamed
    # from ``roles`` in 20260805_0008), so it exists by the time this runs.
    if "positions" not in sa.inspect(bind).get_table_names():
        return
    _rewrite(bind, _add)


def downgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return
    _rewrite(bind, _remove)
