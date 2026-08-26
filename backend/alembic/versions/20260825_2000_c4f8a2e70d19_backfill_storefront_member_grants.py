"""Backfill the storefront grants onto positions seeded before the module.

The storefront module's tables arrived in ``20260801_0020``. Its permissions
were added to the position registry at the same time, but nothing rewrote the
``positions`` rows an existing department had already been seeded with — and
positions are written once, at onboarding. So a department that onboarded
before the store shipped carries a ``member`` position with no storefront
grant at all, and ``/store`` (which requires ``storefront.view``) answers
Access Denied.

Ranks hid the gap rather than closing it. ``_collect_user_permissions``
unions each assigned position's stored permissions with the *runtime*
defaults of the user's operational rank, and every rank in
``OPERATIONAL_RANKS`` carries the storefront grants. Anyone holding a rank
therefore reached the store fine; a member with no rank recorded — a new
volunteer, an administrative member — did not. That is the account this was
reported from.

**No-op.** This revision and ``a4f8c1b92d17`` were written independently, off
the same parent (``c4a91b7e2f08``), for the identical bug — the same 14 slugs
and the same ``storefront.view``/``storefront.order`` grants. Both merged, so
both are on ``main``; only one should act.

``a4f8c1b92d17`` is the one that guards correctly. It rewrites a row only when
its stored permissions still exactly equal a frozen snapshot of the
pre-storefront defaults, so a department that customized the position — including
one that deliberately removed storefront access — is left untouched. This
revision checked only ``slug``/``is_system``/grant-absence, with no
defaults comparison, and ``is_system`` marks a position as protected from
deletion, not as still carrying its seed permissions (CLAUDE.md pitfall #23).
It would therefore re-grant storefront access to a row a department had
deliberately trimmed it from.

So ``upgrade``/``downgrade`` are no-ops rather than a second, weaker pass over
rows ``a4f8c1b92d17`` already covers. The revision id stays because it may
already be recorded as applied somewhere, and ``_SLUGS`` stays because
``test_storefront_baseline_grants.py`` checks it against the registry.

``storefront.manage`` was deliberately never backfilled here. It is an
administrative power (catalog, pricing, other members' orders) rather than
baseline access, and unlike view/order its absence on a row cannot be told
apart from an administrator having removed it.

Revision ID: c4f8a2e70d19
Revises: c6a3f8b41e29
Create Date: 2026-08-25 20:00:00.000000
"""

revision = "c4f8a2e70d19"
down_revision = "c6a3f8b41e29"
branch_labels = None
depends_on = None

_SLUGS = (
    "fire_chief",
    "deputy_chief",
    "assistant_chief",
    "captain",
    "lieutenant",
    "engineer",
    "firefighter",
    "president",
    "vice_president",
    "quartermaster",
    "apparatus_officer",
    "safety_officer",
    "facilities_manager",
    "member",
)

# No-op — see the module docstring. a4f8c1b92d17 backfills the same grants for
# the same slugs behind a defaults-equality guard this revision never had.


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
