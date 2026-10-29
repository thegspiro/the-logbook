"""positions.kind, and the four seeded committee positions

A position was one thing: a permission-bearing office. A member's committee
work -- the history committee, the community-education outreach team -- had
nowhere to be recorded except as a free-text node on the org chart. A position
now carries a ``kind``: ``office`` (Treasurer, Quartermaster), ``committee`` (a
group a member serves on, granting nothing of its own) or ``system`` (the
platform's own: the baseline ``member``, the ``it_manager`` owner and the
mirrors of the operational ranks). The member screens group a held position
by it; permissions stay on ``permissions``.

Existing rows: the column is added with a server default of ``office``, which
settles every row that exists (pitfall #35); then the seeded system slugs are
marked ``system`` -- only where ``is_system`` is set, because a department's
own position that happens to be called ``captain`` is its own office -- and
the four committee rows are inserted for every organization that does not
already have one under that slug, each carrying a copy of the baseline
``member`` permission list. Running twice inserts nothing twice.

The committee slugs, names and the system-slug list are inlined rather than
imported (pitfall #20): a migration keeps doing what it did the day it ran.

The downgrade removes only the seeded committee rows that nobody holds: a
held position is never stripped from a member by a schema move. A held one
survives as an ordinary office, and the column and index are dropped.

Revision ID: d8f1a4c27b93
Revises: c4d7e2a91b60
Create Date: 2026-10-29 13:00:00.000000

"""

import json
from typing import Sequence, Union
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "d8f1a4c27b93"
down_revision: Union[str, None] = "c4d7e2a91b60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SYSTEM_SLUGS = (
    "fire_chief",
    "deputy_chief",
    "assistant_chief",
    "captain",
    "lieutenant",
    "engineer",
    "firefighter",
    "emt",
    "member",
    "it_manager",
)

# The baseline `member` position's permission list as of this revision, which
# a committee carries as its own copy so a member whose only position is a
# committee reaches the member screens. Frozen here (pitfall #20).
_BASELINE_PERMISSIONS = [
    "members.view",
    "organization.view",
    "training.view",
    "scheduling.view",
    "scheduling.swap",
    "inventory.check_submit",
    "inventory.view",
    "storefront.view",
    "storefront.order",
    "meetings.view",
    "elections.view",
    "events.view",
    "forms.view",
    "minutes.view",
    "documents.view",
    "locations.view",
    "finance.request",
]

# slug -> (name, description)
_COMMITTEES = {
    "community_outreach_team": (
        "Community Education / Outreach Team",
        "Members who deliver community education and public outreach events",
    ),
    "history_committee": (
        "History Committee",
        "Members who keep the department's history, archives and memorials",
    ),
    "fundraising_committee": (
        "Fundraising Committee",
        "Members who plan and run the department's fundraising",
    ),
    "membership_committee": (
        "Membership Committee",
        "Members who review applications and interview prospective members",
    ),
}


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _has_index(table: str, name: str) -> bool:
    return name in {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    if not _has_table("positions"):
        return
    bind = op.get_bind()

    if not _has_column("positions", "kind"):
        op.add_column(
            "positions",
            sa.Column(
                "kind", sa.String(length=20), nullable=False, server_default="office"
            ),
        )
    if not _has_index("positions", "ix_positions_kind"):
        op.create_index("ix_positions_kind", "positions", ["kind"])

    system = ", ".join(f"'{slug}'" for slug in _SYSTEM_SLUGS)
    bind.execute(
        sa.text(
            "UPDATE positions SET kind = 'system' "
            f"WHERE is_system = 1 AND slug IN ({system}) AND kind <> 'system'"
        )
    )
    committees = ", ".join(f"'{slug}'" for slug in _COMMITTEES)
    bind.execute(
        sa.text(
            "UPDATE positions SET kind = 'committee' "
            f"WHERE slug IN ({committees}) AND kind <> 'committee'"
        )
    )

    if not _has_table("organizations"):
        return
    org_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM organizations"))]
    if not org_ids:
        return
    existing = {
        (row[0], row[1])
        for row in bind.execute(
            sa.text(
                f"SELECT organization_id, slug FROM positions WHERE slug IN ({committees})"
            )
        )
    }
    insert = sa.text(
        "INSERT INTO positions (id, organization_id, name, slug, description, "
        "permissions, is_system, priority, kind) VALUES (:id, :org, :name, :slug, "
        ":description, :permissions, 1, 10, 'committee')"
    )
    for org_id in org_ids:
        for slug, (name, description) in _COMMITTEES.items():
            if (org_id, slug) in existing:
                continue
            bind.execute(
                insert,
                {
                    "id": str(uuid4()),
                    "org": org_id,
                    "name": name,
                    "slug": slug,
                    "description": description,
                    "permissions": json.dumps(_BASELINE_PERMISSIONS),
                },
            )


def downgrade() -> None:
    if not _has_table("positions") or not _has_column("positions", "kind"):
        return
    bind = op.get_bind()
    committees = ", ".join(f"'{slug}'" for slug in _COMMITTEES)
    held_filter = (
        "AND id NOT IN (SELECT position_id FROM user_positions)"
        if _has_table("user_positions")
        else ""
    )
    bind.execute(
        sa.text(
            "DELETE FROM positions WHERE is_system = 1 AND kind = 'committee' "
            f"AND slug IN ({committees}) {held_filter}"
        )
    )
    if _has_index("positions", "ix_positions_kind"):
        op.drop_index("ix_positions_kind", table_name="positions")
    op.drop_column("positions", "kind")
