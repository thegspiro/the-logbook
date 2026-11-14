"""Seed the four Federal Programs as grant opportunities

Owner decision, 2026-11-01 ("Grants — Opportunities Could Not Be Edited"): the
four Federal Programs cards on the Grant Opportunities page — AFG, SAFER, FP&S
and the Firehouse Subs Public Safety Foundation — become real opportunities a
department can start an application from, edit and retire. The page no longer
draws the cards; it lists these rows with every other opportunity.

Inserts, for every existing organization, each of the four it does not
already hold an opportunity for (matched on ``federal_program_code``, retired
ones included). A department that typed one in by hand keeps its own and is
not given a duplicate; running this twice adds nothing. New departments get
them at creation (``app/services/grant_federal_programs.py``). The text is
copied here rather than imported, so this revision keeps inserting what it
inserted the day it was written.

No existing row is changed, so no constraint is tightened. Skipped when either
table is absent; a fresh install has no organization to seed until onboarding
creates one, which seeds it.

The downgrade removes the rows that still look as this revision inserted
them: no author, the seeded name, and no grant application started from them.
A program a department renamed or applied to stays.

Revision ID: 3c1f5e2a9d47
Revises: 6dadac1674c8
Create Date: 2026-11-06 06:19:00.000000

"""

import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3c1f5e2a9d47"
down_revision: Union[str, None] = "6dadac1674c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "grant_opportunities"

# Frozen copy of app/services/grant_federal_programs.FEDERAL_PROGRAMS.
PROGRAMS = (
    (
        "AFG",
        "Assistance to Firefighters Grant (AFG)",
        "FEMA",
        "Provides funding for critically needed resources to equip and train "
        "emergency personnel, enhancing their capabilities to protect the public "
        "and reduce firefighter injuries.",
        "equipment",
    ),
    (
        "SAFER",
        "Staffing for Adequate Fire and Emergency Response (SAFER)",
        "FEMA",
        "Provides funding to help fire departments increase or maintain the "
        "number of trained firefighters available in their communities.",
        "staffing",
    ),
    (
        "FP&S",
        "Fire Prevention & Safety (FP&S)",
        "FEMA",
        "Supports projects that enhance the safety of the public and "
        "firefighters from fire and related hazards through prevention and "
        "safety activities.",
        "prevention",
    ),
    (
        "FIREHOUSE_SUBS",
        "Firehouse Subs Public Safety Foundation",
        "Firehouse Subs Foundation",
        "Provides funding for life-saving equipment, prevention education, "
        "scholarships, and continued training for first responders.",
        "equipment",
    ),
)


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if not {TABLE, "organizations"} <= _tables():
        return
    bind = op.get_bind()
    org_ids = bind.execute(sa.text("SELECT id FROM organizations")).scalars().all()
    held = {
        (row.organization_id, row.federal_program_code)
        for row in bind.execute(
            sa.text(
                f"SELECT organization_id, federal_program_code FROM {TABLE} "
                "WHERE federal_program_code IS NOT NULL"
            )
        )
    }
    insert = sa.text(
        f"INSERT INTO {TABLE} (id, organization_id, name, agency, description, "
        "category, federal_program_code, deadline_type, match_required, "
        "is_active) VALUES (:id, :org, :name, :agency, :description, "
        ":category, :code, 'recurring', 0, 1)"
    )
    for org_id in org_ids:
        for code, name, agency, description, category in PROGRAMS:
            if (org_id, code) in held:
                continue
            bind.execute(
                insert,
                {
                    "id": str(uuid.uuid4()),
                    "org": org_id,
                    "name": name,
                    "agency": agency,
                    "description": description,
                    "category": category,
                    "code": code,
                },
            )


def downgrade() -> None:
    if TABLE not in _tables():
        return
    bind = op.get_bind()
    applied = (
        "AND id NOT IN (SELECT opportunity_id FROM grant_applications "
        "WHERE opportunity_id IS NOT NULL)"
        if "grant_applications" in _tables()
        else ""
    )
    for code, name, *_ in PROGRAMS:
        bind.execute(
            sa.text(
                f"DELETE FROM {TABLE} WHERE federal_program_code = :code "
                f"AND name = :name AND created_by IS NULL {applied}"
            ),
            {"code": code, "name": name},
        )
