"""Give the corporate positions store access on existing departments

Thirteen seeded positions carried no storefront grant at all: treasurer,
secretary, board of directors, EMS supply officer, public outreach,
communications officer, historian, membership coordinator, training officer,
fundraising chair, assistant secretary, scheduling officer and meeting hall
coordinator. A member holding one of them can buy a job shirt like anyone
else — the store is a member amenity, not an officer tool — and the omission
only ever hid because permissions union across positions and every operational
rank grants the store. It bit exactly the member whose *only* position is one
of these and who has no rank recorded.

Both grants, not just ``storefront.view``. ``/store`` opens on view, but
submitting the order requires ``storefront.order``: view alone would let a
treasurer browse, fill a cart and reach checkout, then fail on submit — a
worse dead end than the missing button, and the shape of failure this whole
line of work has been removing. Every other position holding view holds order.

``storefront.manage`` is deliberately not granted. It is the admin console —
catalog, pricing, other members' orders, payment reconciliation — and none of
these positions runs the store.

Guarded the way ``a4f8c1b92d17`` is: a row is rewritten only when its stored
permission set still equals the registry default this migration was written
against, frozen inline as ``_PRIOR_DEFAULTS``. A department that has
customized one of these positions owns that row and keeps it; they grant the
store themselves in Role Management. Skipping costs them the status quo, not a
regression.

``_PRIOR_DEFAULTS`` is frozen rather than imported for the reason the inlined
normalizer in ``20260819_2037_1eeb053d59b7`` is: a migration must keep matching
the rows it was written to match after the registry moves on.
``tests/test_corporate_storefront_grants.py`` fails if the two drift.

Idempotent: a row already carrying the grants no longer equals the prior
default, so it is skipped — which is also why this is safe to re-run.

Revision ID: b3e8d1f45a27
Revises: d7f4a2c81b93
Create Date: 2026-08-26 03:45:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b3e8d1f45a27"
down_revision = "d7f4a2c81b93"
branch_labels = None
depends_on = None


_GRANTS = ("storefront.view", "storefront.order")

# Snapshot of DEFAULT_POSITIONS at this revision, minus the grants added here —
# i.e. what a pristine stored row looks like when this migration runs.
_PRIOR_DEFAULTS: dict[str, set[str]] = {
    "treasurer": {
        "audit.view",
        "documents.manage",
        "documents.view",
        "facilities.view",
        "facilities.view_sensitive",
        "finance.manage",
        "finance.view",
        "fundraising.manage",
        "fundraising.view",
        "legal.propose",
        "meetings.view",
        "members.view",
        "notifications.view",
        "organization.view",
        "positions.view",
        "reports.manage",
        "reports.view",
        "settings.view",
        "users.view",
        "users.view_contact",
    },
    "secretary": {
        "apparatus.view",
        "compliance.manage",
        "compliance.view",
        "documents.manage",
        "documents.view",
        "elections.manage",
        "elections.view",
        "events.manage",
        "events.view",
        "facilities.view",
        "forms.manage",
        "forms.view",
        "legal.propose",
        "locations.view",
        "meetings.manage",
        "meetings.view",
        "members.assign_positions",
        "members.check_in",
        "members.create",
        "members.manage",
        "members.manage_id_cards",
        "members.view",
        "minutes.manage",
        "minutes.view",
        "notifications.view",
        "organization.view",
        "positions.view",
        "prospective_members.manage",
        "reports.manage",
        "reports.view",
        "settings.manage_contact_visibility",
        "settings.view",
        "training.view",
        "users.create",
        "users.update_positions",
        "users.view",
        "users.view_contact",
    },
    "board_of_directors": {
        "audit.view",
        "documents.view",
        "elections.view",
        "fundraising.view",
        "legal.propose",
        "meetings.view",
        "members.view",
        "minutes.view",
        "notifications.view",
        "organization.view",
        "positions.view",
        "reports.manage",
        "reports.view",
        "settings.view",
        "users.view",
        "users.view_contact",
    },
    "ems_supply_officer": {
        "apparatus.view",
        "equipment_check.manage",
        "equipment_check.view",
        "inventory.manage_medical",
        "inventory.view_medical",
        "locations.view",
        "members.view",
        "organization.view",
        "positions.view",
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
        "users.view_consents",
        "users.view_contact",
    },
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
        "users.view_consents",
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
        "users.view_consents",
    },
    "membership_coordinator": {
        "compliance.view",
        "events.view",
        "legal.propose",
        "members.assign_positions",
        "members.check_in",
        "members.create",
        "members.manage",
        "members.manage_id_cards",
        "members.view",
        "notifications.view",
        "organization.view",
        "positions.view",
        "prospective_members.manage",
        "settings.view",
        "training.configure",
        "users.create",
        "users.edit",
        "users.update_positions",
        "users.view",
        "users.view_contact",
    },
    "training_officer": {
        "apparatus.view",
        "compliance.manage",
        "compliance.view",
        "documents.view",
        "events.create",
        "events.edit",
        "events.manage",
        "events.view",
        "facilities.view",
        "locations.create",
        "locations.edit",
        "locations.manage",
        "locations.view",
        "members.view",
        "notifications.view",
        "organization.view",
        "positions.view",
        "reports.manage",
        "reports.view",
        "scheduling.view",
        "training.configure",
        "training.manage",
        "training.view",
        "training.view_all",
        "users.view",
        "users.view_contact",
    },
    "fundraising_chair": {
        "compliance.view",
        "documents.view",
        "events.create",
        "events.edit",
        "events.view",
        "fundraising.manage",
        "fundraising.view",
        "locations.view",
        "members.view",
        "notifications.view",
        "organization.view",
        "reports.manage",
        "reports.view",
        "users.view",
        "users.view_contact",
    },
    "assistant_secretary": {
        "documents.manage",
        "documents.view",
        "events.view",
        "legal.propose",
        "meetings.manage",
        "meetings.view",
        "members.check_in",
        "members.manage",
        "members.manage_id_cards",
        "members.view",
        "minutes.manage",
        "minutes.view",
        "notifications.view",
        "organization.view",
        "positions.view",
        "settings.view",
        "users.view",
        "users.view_contact",
    },
    "scheduling_officer": {
        "equipment_check.manage",
        "equipment_check.submit",
        "equipment_check.view",
        "events.view",
        "members.view",
        "notifications.view",
        "organization.view",
        "positions.view",
        "scheduling.assign",
        "scheduling.manage",
        "scheduling.report",
        "scheduling.swap",
        "scheduling.view",
        "users.view",
        "users.view_contact",
    },
    "meeting_hall_coordinator": {
        "events.create",
        "events.edit",
        "events.manage",
        "events.view",
        "locations.create",
        "locations.edit",
        "locations.manage",
        "locations.view",
        "members.view",
        "notifications.view",
        "organization.view",
        "scheduling.view",
        "users.view",
        "users.view_contact",
    },
}


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def upgrade() -> None:
    bind = op.get_bind()
    # ``positions`` is one of the tables no migration creates — create_all()
    # builds it on first boot (CLAUDE.md pitfall 26). CI runs
    # ``alembic upgrade head`` against an empty database, so reflecting it
    # unguarded would fail the whole upgrade rather than this one step.
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    for slug, prior in _PRIOR_DEFAULTS.items():
        rows = bind.execute(
            sa.text(
                "SELECT id, permissions FROM positions "
                "WHERE slug = :slug AND is_system = :is_system"
            ),
            {"slug": slug, "is_system": True},
        ).fetchall()

        for row in rows:
            permissions = _load_permissions(row[1])
            # Only a row still carrying exactly the seeded set is ours to
            # rewrite; anything else the department has made its own.
            if set(permissions) != prior:
                continue
            bind.execute(
                sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
                {"perms": json.dumps(permissions + list(_GRANTS)), "id": row[0]},
            )


def downgrade() -> None:
    """No-op: this backfill records no provenance, so it cannot revoke safely.

    The upgrade only appends grants that were missing, and nothing marks which
    rows it touched. Stripping them on rollback would also revoke the store
    from departments that onboarded after these grants entered the registry and
    so always had them legitimately — putting it back out of reach for exactly
    the members this migration exists to serve, on a rollback meant to change
    nothing.
    """
