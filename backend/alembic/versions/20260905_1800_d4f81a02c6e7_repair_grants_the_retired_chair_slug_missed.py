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

The shapes matched were measured, not reasoned: staging a database before
``20260801_0010``, seeding departments through each onboarding path, and
running to head produces exactly two unrepaired member shapes, listed in
``_MEMBER_SHAPES``. One is missing both storefront grants; the other -- written
by an onboarding wizard run with no heuristic markers ticked -- holds
``storefront.view`` and is missing only ``storefront.order``, which is the
population that could browse the store and fail at checkout. Matching those two
repairs precisely the rows ``20260825_1500`` would have repaired but for the
no-op, and nothing else: a department whose member row differs for any other
reason was already outside that migration's scope and stays outside this one's.

**2. The Membership Coordinator's slug-targeted grants.** A row still slugged
``membership_committee_chair`` was never *selected* by ``20260825_1400``
(``training.configure``) or ``20260826_0345`` (the corporate storefront grants),
which both query by the ``membership_coordinator`` slug. ``e8a1c04f6b27``
renamed the slug, but renaming does not retroactively grant what those
revisions skipped when they ran.

No whole-set gate is possible here -- because every slug-targeted migration
skipped these rows, each is frozen at whatever registry state its department
onboarded with, so there is no single shape to match. But absence gating is not
the only alternative, and it is the wrong one: absence cannot distinguish "never
received it" from "an administrator removed it since", so it would quietly
overturn a deliberate removal.

The gate is instead that the row holds **none** of the three, which is positive
evidence rather than absence (pitfall #23, the ``c7a4e91d3b68`` pattern). The
two migrations ran a day apart and each grants all of what it grants at once:
``20260825_1400`` gives ``training.configure`` to this slug *unconditionally*,
and ``20260826_0345`` gives both storefront permissions together. So a row that
carried the ``membership_coordinator`` slug while they ran holds all three, and
a row still slugged ``membership_committee_chair`` holds none. Holding *some* of
them is a state no build could have produced: it means the row was reached and
has since been edited, and that department keeps what it chose.

What being wrong costs, in the one direction still open: a department that
removed all three since August gets them back, and an administrator removes them
again on the positions screen. Withholding instead leaves a coordinator unable
to configure training or reach the store on every department that upgraded
through the chain.

Both repairs skip a row whose stored permissions already cover the grant
through a wildcard, and both are scoped to ``is_system``: a position a
department built for itself is theirs.

Not repaired here: the nine-permission set ``20260901_1320`` restores to
``membership_coordinator`` (``members.manage``, ``members.create``,
``members.assign_positions`` and others). That is a materially larger authority
grant than these three and deserves its own decision -- see the follow-up issue.

Revision ID: d4f81a02c6e7
Revises: a3d7e2f18c45
Create Date: 2026-09-05 18:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "d4f81a02c6e7"
down_revision = "a3d7e2f18c45"
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


#: The two shapes an unrepaired member row actually reaches head in, mapped to
#: what each is still missing. Both were measured by running the chain, not
#: reasoned about.
#:
#: The second is the one that is easy to miss. A department that unticked all
#: four onboarding heuristic markers holds a wizard-written row that
#: ``20260904_2050_f3b8d0c26a17`` documents as permanently unable to order:
#: the ``storefront.order`` restoration in ``20260904_1640_d1c7f4a92e63`` is
#: marker-gated, so a marker-less row never receives it, while the wizard did
#: write ``storefront.view``. Requiring both grants to be absent would leave
#: exactly those members able to browse, fill a cart and fail at checkout --
#: the dead end ``20260826_0345`` calls worse than a missing button.
_MEMBER_SHAPES = (
    (_MEMBER_UNREPAIRED, _STOREFRONT),
    (_MEMBER_UNREPAIRED | {"storefront.view"}, ("storefront.order",)),
)


def _repair_member_storefront(bind) -> int:
    """Add the storefront grants to member rows 20260825_1500 skipped.

    Whole-set match, as that migration and 20260826_0345 both use: only a row
    still carrying exactly one of the known unrepaired shapes is ours. A
    department that has since customized its member position owns that row and
    keeps it.
    """
    repaired = 0
    for row in _rows(bind, "member"):
        permissions = _load(row.permissions)
        stored = set(permissions)
        for shape, missing in _MEMBER_SHAPES:
            if stored == shape:
                _store(bind, row.id, permissions + list(missing))
                repaired += 1
                break
    return repaired


def _repair_coordinator(bind) -> int:
    """Add the grants the two slug-targeted migrations could not select.

    Gated on the row holding **none** of the three, which is positive evidence
    that neither migration ever reached it rather than mere absence.

    The two ran a day apart and in a known order: ``20260825_1400`` grants
    ``training.configure`` to this slug *unconditionally*, and
    ``20260826_0345`` grants both storefront permissions together. A row that
    carried the ``membership_coordinator`` slug while they ran therefore holds
    all three; a row still slugged ``membership_committee_chair`` holds none.
    Confirmed against the frozen sets those two migrations were written
    against: the chair-era registry entry contains neither the storefront
    grants nor ``training.configure`` -- which is precisely why each migration
    existed.

    So a row holding *some* of the three was reached and has since been edited,
    and an edit is a decision this migration does not overturn. That is the
    ``c7a4e91d3b68`` pattern: gate on a state no build could have produced,
    rather than on absence, which cannot tell "never received it" from "an
    administrator removed it".
    """
    grants = (*_STOREFRONT, _TRAINING)
    repaired = 0
    for row in _rows(bind, "membership_coordinator"):
        permissions = _load(row.permissions)
        if any(_covers(permissions, grant) for grant in grants):
            continue
        _store(bind, row.id, permissions + list(grants))
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
