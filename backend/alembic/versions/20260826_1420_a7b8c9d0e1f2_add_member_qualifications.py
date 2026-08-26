"""Add member_qualifications — what a member is certified to do.

Rank says where a member sits in the chain of command; a qualification says
what they are trained to do. They are independent, and ``User.rank`` is one
string, so a *Captain who is also a Paramedic* — an entirely ordinary member of
a volunteer department — had nowhere to be recorded as both.

The standards already separate them: Firefighter I/II is NFPA 1001, apparatus
operator is NFPA 1002, the officer ladder is NFPA 1021, and EMT/Paramedic are
EMS credentials on a different track again.

Qualifications expire and ranks do not, which is the other half of why they
cannot share a column: a member holds Captain until the department says
otherwise, and EMT until a date. Shift eligibility reads ``expires_on`` as of
the *shift* date rather than today, the rule EVOC certifications already use
for drivers — a card that is current now but lapses before the shift qualifies
nobody to work it.

Empty on creation. Nothing is inferred from existing rank or position rows:
a department that has recorded somebody as an EMT *rank* has said where they
sit, not what card they hold or when it expires, and guessing an expiry date
would be worse than having none. Departments enter these as they go.

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-08-26 14:20:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a7b8c9d0e1f2"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("member_qualifications"):
        return

    op.create_table(
        "member_qualifications",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("qualification_code", sa.String(length=50), nullable=False),
        sa.Column("granted_on", sa.Date(), nullable=True),
        # NULL means it never lapses, which is ordinary — Firefighter I does
        # not expire in most states — so readers treat NULL as current rather
        # than unknown.
        sa.Column("expires_on", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        # One row per member per qualification: renewing a card updates the
        # expiry on the row that is there rather than stacking a second, so
        # "does this member hold X" never has to pick between rows.
        sa.UniqueConstraint(
            "user_id", "qualification_code", name="uq_member_qualification"
        ),
    )
    op.create_index(
        "ix_member_qualifications_expires_on",
        "member_qualifications",
        ["expires_on"],
    )
    op.create_index(
        "ix_member_qual_org_code",
        "member_qualifications",
        ["organization_id", "qualification_code"],
    )


def downgrade() -> None:
    if not _has_table("member_qualifications"):
        return
    op.drop_index("ix_member_qual_org_code", table_name="member_qualifications")
    op.drop_index(
        "ix_member_qualifications_expires_on", table_name="member_qualifications"
    )
    op.drop_table("member_qualifications")
