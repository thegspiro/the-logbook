"""Re-apply the three data effects the pre-rename `positions` migrations skipped

``20260528_0001``, ``20260720_0002`` and ``20260801_0010`` each queried a table
named ``positions`` at a point in the chain where it was still named ``roles``.
The models were renamed to ``Position``/``positions`` long before the database
was, so each was written against the model name; when that made fresh-chain
``alembic upgrade head`` fail, existence guards were added (2026-07-29) which
turned the crash into a silent no-op. ``20260805_0008`` renamed the table six
days later and the guards were never revisited, so on every upgrade path those
three revisions did nothing at all.

Those three are corrected in the same change set as this revision, but that
only helps a database which has not yet stamped them. Alembic records a
revision as applied by id, so an installation already past ``20260801_0010``
never executes the corrected body -- and those installations are exactly the
ones the correction exists to reach (CLAUDE.md pitfall #23). This revision is
how the repair gets there: the same three transformations, against
``positions``, the name the table actually has at head.

A department that reached its current state through ``create_all`` rather than
the chain already has all three, so every step below is written to be a no-op
when its work is already done, and to be safe to run twice.

**Direction of each write**, per pitfall #23:

* The coordinator rename and the ``target_roles`` rewrite are *renames*: the
  authority a position carries is unchanged, only its spelling, so they are
  unconditional on the rows they match.
* The ``inventory.check_submit`` grant is an *addition*, gated on the grant
  being absent. If that judgement is wrong -- a department deliberately revoked
  members' equipment-check submission -- it reappears and an administrator
  removes it again on the positions screen. Withholding it instead costs those
  members the checklist read endpoints outright, which is the worse failure.

Not repaired here, deliberately: a row still slugged
``membership_committee_chair`` was invisible to ``20260825_1400``
(``training.configure``), ``20260901_1320`` and ``20260826_0345``, and a member
row that missed the grant also failed the whole-set equality gate in
``20260825_1500`` and so missed the storefront backfill. Renaming the slug now
does not retroactively grant what those revisions skipped; each is a separate
authority decision rather than a spelling correction, and belongs in its own
change set.

Revision ID: e8a1c04f6b27
Revises: c8f4a1e6b309
Create Date: 2026-09-05 16:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "e8a1c04f6b27"
down_revision = "c8f4a1e6b309"
branch_labels = None
depends_on = None

_OLD_SLUG = "membership_committee_chair"
_NEW_SLUG = "membership_coordinator"
_NEW_NAME = "Membership Coordinator"
_OLD_NAME = "Membership Committee Chair"

# The renamed string: 20260830_0001 moved equipment_check.* to inventory.check_*.
_PERMISSION = "inventory.check_submit"
# Wildcards that already cover it. The equipment_check spelling is included
# because it can still arrive on a database restored from an older backup.
_COVERING = ("*", "inventory.*", "equipment_check.*")

# `positions` is created by the chain -- the initial schema builds `roles` and
# 20260805_0008 renames it -- and that revision is an ancestor of this one, so
# the table is always present here. No existence guard: adding one on the
# mistaken belief that `positions` is create_all-only is the error CLAUDE.md
# pitfall #26 records, and it cost a data-lossy guard on 20260826_1700.


def _rename_slug(bind, old_slug: str, new_slug: str, new_name: str) -> int:
    """Rename seeded *old_slug* rows, skipping orgs that already hold the target.

    ``idx_position_org_slug`` is UNIQUE on ``(organization_id, slug)``, so an
    organization holding both would make a blind UPDATE raise and take the whole
    upgrade down. Scoped to ``is_system``: every row that ever carried the old
    slug was seeded, and a position a department built for itself is theirs.
    """
    taken = {
        row.organization_id
        for row in bind.execute(
            sa.text("SELECT organization_id FROM positions WHERE slug = :slug"),
            {"slug": new_slug},
        )
    }
    rows = bind.execute(
        sa.text(
            "SELECT id, organization_id FROM positions "
            "WHERE slug = :slug AND is_system = 1"
        ),
        {"slug": old_slug},
    ).fetchall()

    renamed = 0
    for row in rows:
        if row.organization_id in taken:
            continue
        bind.execute(
            sa.text("UPDATE positions SET slug = :slug, name = :name WHERE id = :id"),
            {"slug": new_slug, "name": new_name, "id": row.id},
        )
        renamed += 1
    return renamed


def _backfill_target_roles(bind) -> int:
    """Rewrite role-targeted messages from position names to position ids.

    Idempotent by construction: a stored id never matches a position *name*, so
    an already-converted entry is passed through untouched.
    """
    name_to_id = {}
    for row in bind.execute(sa.text("SELECT id, organization_id, name FROM positions")):
        name_to_id[(row.organization_id, row.name)] = row.id

    rows = bind.execute(
        sa.text(
            "SELECT id, organization_id, target_roles FROM department_messages "
            "WHERE target_type = 'roles' AND target_roles IS NOT NULL"
        )
    ).fetchall()

    changed = 0
    for row in rows:
        target = row.target_roles
        # MySQL JSON columns may surface as a JSON string depending on driver.
        if isinstance(target, str):
            try:
                target = json.loads(target)
            except (ValueError, TypeError):
                continue
        if not isinstance(target, list):
            continue

        new_target = [
            name_to_id.get((row.organization_id, entry), entry) for entry in target
        ]
        if new_target != target:
            bind.execute(
                sa.text(
                    "UPDATE department_messages SET target_roles = :roles "
                    "WHERE id = :id"
                ),
                {"roles": json.dumps(new_target), "id": row.id},
            )
            changed += 1
    return changed


def _member_rows(bind):
    return bind.execute(
        sa.text(
            "SELECT id, permissions FROM positions "
            "WHERE slug = 'member' AND is_system = 1"
        )
    ).fetchall()


def _permissions(row) -> list:
    perms = row.permissions
    if isinstance(perms, str):
        perms = json.loads(perms or "[]")
    return list(perms or [])


def _store(bind, row_id: str, perms: list) -> None:
    bind.execute(
        sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
        {"perms": json.dumps(perms), "id": row_id},
    )


def _grant_check_submit(bind) -> int:
    granted = 0
    for row in _member_rows(bind):
        perms = _permissions(row)
        if _PERMISSION in perms or any(w in perms for w in _COVERING):
            continue
        perms.append(_PERMISSION)
        _store(bind, row.id, perms)
        granted += 1
    return granted


def upgrade() -> None:
    bind = op.get_bind()
    _rename_slug(bind, _OLD_SLUG, _NEW_SLUG, _NEW_NAME)
    _backfill_target_roles(bind)
    _grant_check_submit(bind)


def downgrade() -> None:
    bind = op.get_bind()

    for row in _member_rows(bind):
        perms = _permissions(row)
        if _PERMISSION not in perms:
            continue
        perms.remove(_PERMISSION)
        _store(bind, row.id, perms)

    _rename_slug(bind, _NEW_SLUG, _OLD_SLUG, _OLD_NAME)

    # target_roles is deliberately left converted. The reverse rewrite is
    # best-effort by name, and a message legitimately targeted by id -- every
    # message written since 20260720_0002 -- would be turned back into a
    # name-match it never used, which is a downgrade that loses information.
