"""Repair the grants three slug-targeted migrations could not reach

Follow-up to #2265 (``e8a1c04f6b27``), which repaired the three data
transformations that never ran because ``20260528_0001``, ``20260720_0002`` and
``20260801_0010`` named a table ``positions`` while it was still called
``roles``. This revision repairs two consequences of those no-ops that the
earlier one deliberately left alone, because each is a decision about who holds
which permission rather than a spelling correction.

**1. The member storefront backfill.** ``20260825_1500`` rewrites a row only
when its stored permission set equals the registry default it froze inline, and
that frozen ``member`` set contains ``equipment_check.submit`` -- the grant
``20260801_0010`` was supposed to add and never did. Every department that
upgraded through the chain therefore failed the comparison and was skipped, so
their members never received ``storefront.view`` / ``storefront.order``.

Re-running ``20260825_1500`` cannot help: its snapshot holds the pre-rename
spelling, while ``20260830_0001`` renamed the permission and ``e8a1c04f6b27``
has since added ``inventory.check_submit`` to these rows, so they will never
equal it. This is the third time a whole-row snapshot has proved pinned to the
build that produced it (CLAUDE.md pitfall #23), and it is why the gate below
matches the shape such a row has *at head* rather than any historical one.

The match is exact and was measured, not reasoned: staging a database before
``20260801_0010``, seeding an affected and an unaffected department, and
running to head leaves the two differing by exactly the two storefront grants.
``_MEMBER_UNREPAIRED`` is that observed shape. Matching it repairs precisely the
rows ``20260825_1500`` would have repaired but for the no-op, and nothing else:
a department whose member row differs for any other reason was already outside
that migration's scope and stays outside this one's.

**2. The Membership Coordinator's slug-targeted grants.** A row still slugged
``membership_committee_chair`` was never *selected* by ``20260825_1400``
(``training.configure``) or ``20260826_0345`` (the corporate storefront grants),
which both query by the ``membership_coordinator`` slug. ``e8a1c04f6b27``
renamed the slug, but renaming does not retroactively grant what those
revisions skipped when they ran.

No whole-set gate is possible here, and that asymmetry is the point: because
every slug-targeted migration skipped these rows, each is frozen at whatever
registry state its department onboarded with, so there is no single shape to
match. Only per-permission absence gating is available, and absence cannot
distinguish "never received it" from "an administrator removed it since".

The direction is deliberate, per pitfall #23. ``20260825_1400`` grants
``training.configure`` to this exact slug *unconditionally*, on the stated
grounds that it was a new capability rather than a rename of an old one, so no
prior removal could express an intent about it -- there was nothing to remove.
That reasoning transfers to the rows it could not see. Being wrong means a
department that removed one of these since August gets it back and an
administrator removes it again on the positions screen; withholding them leaves
a coordinator unable to configure training or reach the store on every
department that upgraded through the chain.

Both repairs skip a row whose stored permissions already cover the grant
through a wildcard, and both are scoped to ``is_system``: a position a
department built for itself is theirs.

Not repaired here: the nine-permission set ``20260901_1320`` restores to
``membership_coordinator`` (``members.manage``, ``members.create``,
``members.assign_positions`` and others). That is a materially larger authority
grant than these three and deserves its own decision -- see the follow-up issue.

Revision ID: d4f81a02c6e7
Revises: a1c7e93b2d54
Create Date: 2026-09-05 18:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "d4f81a02c6e7"
down_revision = "a1c7e93b2d54"
branch_labels = None
depends_on = None

_STOREFRONT = ("storefront.view", "storefront.order")
_TRAINING = "training.configure"

#: What a `member` row that missed 20260801_0010 looks like AT HEAD -- observed
#: by running the chain, not assembled by hand. Frozen deliberately: a
#: migration must keep matching the rows it was written to match after the
#: registry moves on (the reason 20260826_0345 freezes its own snapshot).
#: `tests/test_retired_chair_slug_grant_repair.py` fails if this drifts from
#: what the chain actually produces.
_MEMBER_UNREPAIRED = frozenset(
    {
        "documents.view",
        "elections.view",
        "events.view",
        "forms.view",
        "inventory.check_submit",
        "inventory.view",
        "locations.view",
        "meetings.view",
        "members.view",
        "minutes.view",
        "organization.view",
        "scheduling.swap",
        "scheduling.view",
        "training.view",
    }
)

# `positions` is created by the chain -- the initial schema builds `roles` and
# 20260805_0008 renames it -- and that revision is an ancestor here, so the
# table is always present. No existence guard: adding one on the mistaken
# belief that this table appears only at first boot is the error pitfall #26
# records, and it cost a data-lossy guard on 20260826_1700.


def _load(raw) -> list:
    """Normalize JSON returned differently by different drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _covers(permissions, grant: str) -> bool:
    """True when *permissions* already conveys *grant*, wildcard included."""
    if grant in permissions:
        return True
    if "*" in permissions:
        return True
    module = grant.split(".", 1)[0]
    return f"{module}.*" in permissions


def _store(bind, row_id: str, permissions: list) -> None:
    bind.execute(
        sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
        {"perms": json.dumps(permissions), "id": row_id},
    )


def _rows(bind, slug: str):
    return bind.execute(
        sa.text(
            "SELECT id, permissions FROM positions "
            "WHERE slug = :slug AND is_system = 1"
        ),
        {"slug": slug},
    ).fetchall()


def _repair_member_storefront(bind) -> int:
    """Add the storefront grants to member rows 20260825_1500 skipped.

    Whole-set match, as that migration and 20260826_0345 both use: only a row
    still carrying exactly the unrepaired shape is ours. A department that has
    since customized its member position owns that row and keeps it.
    """
    repaired = 0
    for row in _rows(bind, "member"):
        permissions = _load(row.permissions)
        if set(permissions) != _MEMBER_UNREPAIRED:
            continue
        _store(bind, row.id, permissions + list(_STOREFRONT))
        repaired += 1
    return repaired


def _repair_coordinator(bind) -> int:
    """Add the grants the two slug-targeted migrations could not select.

    Per-permission rather than whole-set, because these rows are frozen at
    whatever registry state their department onboarded with -- see the module
    docstring for why no single shape exists to match.
    """
    repaired = 0
    for row in _rows(bind, "membership_coordinator"):
        permissions = _load(row.permissions)
        missing = [
            grant
            for grant in (*_STOREFRONT, _TRAINING)
            if not _covers(permissions, grant)
        ]
        if not missing:
            continue
        _store(bind, row.id, permissions + missing)
        repaired += 1
    return repaired


def upgrade() -> None:
    bind = op.get_bind()
    _repair_member_storefront(bind)
    _repair_coordinator(bind)


def downgrade() -> None:
    """Intentionally irreversible (AGENTS.md: document rather than guess).

    This records nothing about which rows it touched, and every grant it adds
    is one a healthy department already holds -- the registry seeds all three
    for a new organization. Revoking unconditionally would strip the store and
    training configuration from departments this migration never touched, which
    is the failure mode ``20260826_0345``'s own downgrade documents refusing:
    putting the store back out of reach of exactly the members it exists to
    serve, on a rollback meant to change nothing.
    """
