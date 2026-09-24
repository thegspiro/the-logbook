"""Seed the Compliance Officer position and Compliance suggestion box

``DEFAULT_POSITIONS`` is materialized only when an organization is onboarded,
so the new ``compliance_officer`` system position would reach fresh installs
and nobody else. It matters beyond the positions screen: the slug is what
``DEFAULT_COMPLIANCE_OFFICER_ROLES`` names for the certification-expiry CC,
which until now resolved to nobody, and it is the reviewer of the default
Compliance suggestion box this revision also creates.

One idempotent pass over every onboarded organization (one holding any system
position):

* **Position.** Created, with the permission set from ``DEFAULT_POSITIONS``,
  where the organization has no position under this slug. A department that
  already created one keeps its own — the ``(organization_id, slug)`` unique
  index would refuse a second, and theirs is the one their members hold.
* **Box.** Created where the organization has no box named ``Compliance``
  (``uq_suggestion_box_org_name`` would refuse a second, and an existing one is
  the department's). Its reviewer is whichever position holds the slug, seeded
  or custom. It is created **inactive**: the seeded position has no holder yet,
  and a live box whose only reviewer is an empty position would accept
  compliance reports nobody can read. An administrator appoints the officer and
  switches the box on.

Revision ID: 3c918c06466d
Revises: 941e1251ad74
Create Date: 2026-09-24 19:06:13.229839

"""

import json
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3c918c06466d"
down_revision: Union[str, None] = "941e1251ad74"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Frozen copies of DEFAULT_POSITIONS["compliance_officer"] and of
# SuggestionService's default box as of this revision. A migration must keep
# writing what it wrote the day it ran, so it does not import either.
_POSITION = {
    "name": "Compliance Officer",
    "slug": "compliance_officer",
    "description": (
        "Compliance records, attestations, annual compliance reporting, "
        "and compliance concerns"
    ),
    "priority": 60,
    "permissions": [
        "users.view",
        "members.view",
        "positions.view",
        "organization.view",
        "storefront.view",
        "storefront.order",
        "training.view",
        "training.view_all",
        "training.manage",
        "training.configure",
        "compliance.view",
        "compliance.manage",
        "reports.view",
        "reports.manage",
        "documents.view",
        "documents.manage",
        "forms.view",
        "events.view",
        "notifications.view",
    ],
}

_BOX = {
    "name": "Compliance",
    "description": (
        "Report a compliance concern: a policy, safety, training-record or "
        "regulatory issue. Reviewed by the Compliance Officer."
    ),
}


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    tables = _tables()
    # Defensive only: both tables are created by the migration chain.
    if "positions" not in tables:
        return
    seed_box = {"suggestion_boxes", "suggestion_box_reviewers"} <= tables

    org_rows = bind.execute(
        sa.text("SELECT DISTINCT organization_id FROM positions WHERE is_system = 1")
    ).fetchall()
    for org_row in org_rows:
        org_id = org_row.organization_id
        position_id = bind.execute(
            sa.text(
                "SELECT id FROM positions "
                "WHERE organization_id = :org AND slug = :slug"
            ),
            {"org": org_id, "slug": _POSITION["slug"]},
        ).scalar()
        if position_id is None:
            position_id = str(uuid.uuid4())
            bind.execute(
                sa.text(
                    "INSERT INTO positions "
                    "(id, organization_id, name, slug, description, permissions, "
                    " is_system, priority) "
                    "VALUES (:id, :org, :name, :slug, :description, :permissions, "
                    " 1, :priority)"
                ),
                {
                    "id": position_id,
                    "org": org_id,
                    "name": _POSITION["name"],
                    "slug": _POSITION["slug"],
                    "description": _POSITION["description"],
                    "permissions": json.dumps(_POSITION["permissions"]),
                    "priority": _POSITION["priority"],
                },
            )

        if not seed_box:
            continue
        box_exists = bind.execute(
            sa.text(
                "SELECT id FROM suggestion_boxes "
                "WHERE organization_id = :org AND name = :name"
            ),
            {"org": org_id, "name": _BOX["name"]},
        ).fetchone()
        if box_exists:
            continue
        box_id = str(uuid.uuid4())
        bind.execute(
            sa.text(
                "INSERT INTO suggestion_boxes "
                "(id, organization_id, name, description, anonymity_mode, "
                " follow_up_enabled, is_active) "
                "VALUES (:id, :org, :name, :description, 'allowed', 1, 0)"
            ),
            {
                "id": box_id,
                "org": org_id,
                "name": _BOX["name"],
                "description": _BOX["description"],
            },
        )
        bind.execute(
            sa.text(
                "INSERT INTO suggestion_box_reviewers "
                "(id, organization_id, box_id, position_id) "
                "VALUES (:id, :org, :box, :position)"
            ),
            {
                "id": str(uuid.uuid4()),
                "org": org_id,
                "box": box_id,
                "position": position_id,
            },
        )


def downgrade() -> None:
    bind = op.get_bind()
    tables = _tables()

    # The box goes only where it is still exactly what this revision wrote —
    # no creator, the seeded description — and has received nothing, so a
    # department's own "Compliance" box and every submitted report survive.
    # Its reviewer rows follow by ON DELETE CASCADE.
    if {"suggestion_boxes", "suggestions"} <= tables:
        bind.execute(
            sa.text(
                "DELETE FROM suggestion_boxes "
                "WHERE name = :name AND description = :description "
                "AND created_by IS NULL "
                "AND id NOT IN (SELECT box_id FROM suggestions)"
            ),
            {"name": _BOX["name"], "description": _BOX["description"]},
        )

    if "positions" not in tables:
        return
    # Removed only where no member holds it, so a department that already
    # appointed an officer does not silently lose the assignment. A same-slug
    # position the department created itself is not ``is_system`` and is never
    # touched.
    bind.execute(
        sa.text(
            "DELETE FROM positions WHERE slug = :slug AND is_system = 1 "
            "AND id NOT IN (SELECT position_id FROM user_positions)"
        ),
        {"slug": _POSITION["slug"]},
    )
