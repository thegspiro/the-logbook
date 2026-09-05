"""Apply the three data repairs the pre-rename `positions` migrations could not

``20260528_0001``, ``20260720_0002`` and ``20260801_0010`` each named a table
``positions`` at a point in the chain where it was still named ``roles``. The
models were renamed to ``Position``/``positions`` long before the database was,
so each was written against the model name; when that made fresh-chain
``alembic upgrade head`` fail, existence guards were added (2026-07-29) which
turned the crash into a silent no-op. ``20260805_0008`` renamed the table six
days later and the guards were never revisited, so on every upgrade path those
three did nothing at all.

Their bodies are deliberately left exactly as they ran -- an already-deployed
migration is not edited to change its behaviour (AGENTS.md), and editing them
would not reach the installations that matter anyway: Alembic records a
revision as applied by id, so a database already past ``20260801_0010`` never
executes a rewritten body, and those are precisely the databases carrying the
un-repaired rows (CLAUDE.md pitfall #23). This revision is where the repair
belongs: the same three transformations, against ``positions``, the name the
table actually has at head.

A department whose schema came from ``create_all`` rather than the chain
already has all three, so every step below is written to no-op when its work is
already done, and to be safe to run twice.

**Order matters here.** The ``target_roles`` backfill runs BEFORE the
coordinator rename, and must keep doing so. A legacy message on an affected
organization targets the string ``Membership Committee Chair``; renaming first
would leave the name-to-id map holding only ``Membership Coordinator``, so that
message would resolve to nothing and stay undeliverable. Converting first
pins it to the position id, which the rename does not change.

**Direction of each write**, per pitfall #23:

* The rename and the ``target_roles`` rewrite are *renames*: the authority a
  position carries is unchanged, only its spelling.
* The ``inventory.check_submit`` grant is an *addition*, gated on the grant
  being absent. ``is_system`` does not mean a permission list is unedited, so
  this cannot tell "never received it" from "an administrator removed it". The
  gate is deliberate: being wrong means the grant reappears and an
  administrator removes it again on the positions screen, while withholding it
  costs those members the equipment-check read endpoints outright. No reliable
  legacy marker exists -- the permission is emittable from the positions editor
  -- so absence is the only available signal.

Not repaired here, deliberately: a row still slugged
``membership_committee_chair`` was invisible to ``20260825_1400``,
``20260901_1320`` and ``20260826_0345``, and a member row that missed the grant
also failed the whole-set gate in ``20260825_1500`` and so missed the storefront
backfill. Renaming the slug now does not retroactively grant what those
revisions skipped; each is a separate authority decision.

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

# The renamed string: 20260830_0001 moved equipment_check.* to inventory.check_*.
_PERMISSION = "inventory.check_submit"
# Wildcards that already cover it. The equipment_check spelling is included
# because it can still arrive on a database restored from an older backup.
_COVERING = ("*", "inventory.*", "equipment_check.*")

# `positions` is created by the chain -- the initial schema builds `roles` and
# 20260805_0008 renames it -- and that revision is an ancestor of this one, so
# the table is always present here. No existence guard: adding one on the
# mistaken belief that this table appears only at first boot is the error
# CLAUDE.md pitfall #26 records, and it cost a data-lossy guard on 20260826_1700.


def _position_ids(bind) -> set:
    """Every position id, so an already-targeted id is never re-resolved.

    A position's display name is free text of 1-100 characters, so nothing
    stops one position being *named* the literal id of another. A modern
    message targeting that other position by id would then look like a legacy
    name here and be rewritten to the wrong position -- delivering operational
    content to the wrong people, and invisibly, since the result still looks
    like a correctly id-targeted message. Contrived, and cheap to rule out:
    an entry that is already an id is left alone before names are considered.
    """
    return {row.id for row in bind.execute(sa.text("SELECT id FROM positions"))}


def _unambiguous_name_map(bind) -> dict:
    """``(organization_id, name) -> id``, for names that resolve to ONE position.

    ``RoleManagementService.create_role`` permits two positions to share a
    display name (it suffixes only the duplicate slug). A message targeting
    such a name previously reached the holders of *both* through the service's
    name fallback, so collapsing it to whichever id happened to be read last
    would silently drop the other position's members from the audience.
    An ambiguous name is therefore left unconverted, keeping the fallback.
    """
    counts: dict = {}
    ids: dict = {}
    for row in bind.execute(sa.text("SELECT id, organization_id, name FROM positions")):
        key = (row.organization_id, row.name)
        counts[key] = counts.get(key, 0) + 1
        ids[key] = row.id
    return {key: value for key, value in ids.items() if counts[key] == 1}


def _backfill_target_roles(bind, name_to_id: dict, known_ids: set) -> int:
    """Rewrite role-targeted messages from position names to position ids.

    Idempotent by construction: a stored id never matches a position *name*, so
    an already-converted entry is passed through untouched.
    """
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
            (
                entry
                if entry in known_ids
                else name_to_id.get((row.organization_id, entry), entry)
            )
            for entry in target
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


def _rename_coordinator(bind) -> int:
    """Rename seeded ``membership_committee_chair`` rows to the coordinator slug.

    ``idx_position_org_slug`` is UNIQUE on ``(organization_id, slug)``, so an
    organization already holding the target slug would make a blind UPDATE
    raise and take the whole upgrade down. Scoped to ``is_system``: every row
    that ever carried the old slug was seeded, and a position a department
    built for itself is theirs.

    **Skipping a collision leaves that seeded row under the retired slug**, and
    it therefore stays invisible to later slug-targeted work -- the same class
    of gap this revision's module docstring reports for ``20260825_1400`` and
    friends. That is deliberate. The alternative is reconciling two positions,
    which means choosing whose permissions survive and moving member
    assignments between them; that is an administrator's decision about who
    holds what, not something a migration should do silently and
    irreversibly to a department that built its own position. A department in
    this state has both rows visible on the positions screen and can merge them
    deliberately.
    """
    taken = {
        row.organization_id
        for row in bind.execute(
            sa.text("SELECT organization_id FROM positions WHERE slug = :slug"),
            {"slug": _NEW_SLUG},
        )
    }
    rows = bind.execute(
        sa.text(
            "SELECT id, organization_id FROM positions "
            "WHERE slug = :slug AND is_system = 1"
        ),
        {"slug": _OLD_SLUG},
    ).fetchall()

    renamed = 0
    for row in rows:
        if row.organization_id in taken:
            continue
        bind.execute(
            sa.text("UPDATE positions SET slug = :slug, name = :name WHERE id = :id"),
            {"slug": _NEW_SLUG, "name": _NEW_NAME, "id": row.id},
        )
        renamed += 1
    return renamed


def _grant_check_submit(bind) -> int:
    rows = bind.execute(
        sa.text(
            "SELECT id, permissions FROM positions "
            "WHERE slug = 'member' AND is_system = 1"
        )
    ).fetchall()

    granted = 0
    for row in rows:
        perms = row.permissions
        if isinstance(perms, str):
            perms = json.loads(perms or "[]")
        perms = list(perms or [])
        if _PERMISSION in perms or any(w in perms for w in _COVERING):
            continue
        perms.append(_PERMISSION)
        bind.execute(
            sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
            {"perms": json.dumps(perms), "id": row.id},
        )
        granted += 1
    return granted


def upgrade() -> None:
    bind = op.get_bind()
    # Before the rename -- see "Order matters here" above.
    _backfill_target_roles(bind, _unambiguous_name_map(bind), _position_ids(bind))
    _rename_coordinator(bind)
    _grant_check_submit(bind)


def downgrade() -> None:
    """Intentionally irreversible (AGENTS.md: document, rather than guess).

    This revision records nothing about which rows it changed, and every one of
    its three writes is indistinguishable afterwards from the state a healthy
    department was already in. A department built by ``create_all`` has always
    held ``inventory.check_submit`` and the ``membership_coordinator`` slug, and
    its messages have always been id-targeted, so the upgrade is a no-op there.
    Reversing unconditionally would strip a grant that migration never gave,
    rename a slug it never renamed, and rewrite ids it never wrote -- turning a
    rollback into data loss on exactly the departments that were never broken.

    Nothing here is schema, so leaving the data in its repaired state is safe:
    the rows are what the registry seeds for a new organization anyway.
    """
