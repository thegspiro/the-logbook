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

**No-op as of the #1831 merge-heads review.** This revision and
``a4f8c1b92d17`` were written independently, off the same parent
(``c4a91b7e2f08``), for the identical bug — same 14 slugs, same
``storefront.view``/``storefront.order`` grants. ``a4f8c1b92d17`` guards
correctly: it only rewrites a row whose stored permissions still exactly
equal its frozen snapshot of the pre-storefront defaults, so a department
that customized the position — including one that deliberately removed
storefront access — is left alone. This revision's own guard checked only
``slug``/``is_system``/grant-absence, with no defaults comparison, so it
would silently re-grant storefront access to a customized row a department
had trimmed it from. A Codex review on #1831 (the PR that merged this fork
back into a single head) caught it. Rather than duplicate the unsafe check's
job, ``upgrade``/``downgrade`` are now no-ops — ``a4f8c1b92d17`` already
covers ``storefront.view``/``storefront.order`` for every slug listed below.
The revision id and ``_SLUGS`` stay, since ``test_storefront_baseline_grants.py``
checks the latter against the registry and the id may already be recorded as
applied in some environment.

``storefront.manage`` was deliberately never backfilled here. It is an
administrative power (catalog, pricing, other members' orders) rather than
baseline access, and unlike view/order its absence on a row cannot be told
apart from an administrator having removed it.

Revision ID: c4f8a2e70d19
Revises: c4a91b7e2f08
Create Date: 2026-08-25 20:00:00.000000
"""

revision = "c4f8a2e70d19"
down_revision = "c4a91b7e2f08"
branch_labels = None
depends_on = None

# Every seeded slug whose registry entry carries these grants today. Kept
# (unlike the rest of this revision's former logic) because
# test_storefront_baseline_grants.py checks it against the registry directly.
# The rank names are here for the reason Pitfall #23 in CLAUDE.md gives:
# onboarding writes rank-mirroring *positions* holding a copy of the rank's
# list, and a member can hold the Firefighter position with no rank recorded
# on their user row, which is exactly the case the runtime rank union does
# not cover.
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


# No-op — see the module docstring. a4f8c1b92d17 backfills the same grants
# for the same slugs with a defaults-equality guard this revision never had;
# duplicating its job here with a weaker check would re-grant storefront
# access to a position a department had deliberately trimmed it from.


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
