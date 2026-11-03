"""Create the History module tables

The department archive's first tables: the managed title list, past members
with their service periods, the titles held in each period and family links,
the shared change history, and the department clearance list with its
requests and decisions.

New tables only, so no existing row is touched. Each step is skipped when its
table already exists, so a database ``create_all`` built first upgrades
cleanly.

Downgrade drops every table and everything recorded in them. Once a department
uses the module that is the loss of its archive: take a database backup
(``scripts/backup.sh``) before downgrading past this revision.

Revision ID: 038ade7a5cd0
Revises: 02c94bb742d6
Create Date: 2026-11-03 02:05:11.512894

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "038ade7a5cd0"
down_revision: Union[str, None] = "02c94bb742d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copies of the enum values at this revision.
_PRECISION = ("day", "month", "year")
_VISIBILITY = ("historian", "members", "public")


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def _id() -> sa.Column:
    return sa.Column("id", sa.String(36), primary_key=True)


def _org() -> sa.Column:
    return sa.Column(
        "organization_id",
        sa.String(36),
        sa.ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )


def _user_fk(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _updated_at() -> sa.Column:
    return sa.Column(
        "updated_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _flag(name: str) -> sa.Column:
    return sa.Column(name, sa.Boolean(), nullable=False, server_default="0")


def _precision(name: str, default: str) -> sa.Column:
    return sa.Column(
        name,
        sa.Enum(*_PRECISION, name="dateprecision"),
        nullable=False,
        server_default=default,
    )


def _visibility(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.Enum(*_VISIBILITY, name="fieldvisibility"),
        nullable=False,
        server_default="historian",
    )


def upgrade() -> None:
    if not _has_table("history_titles"):
        op.create_table(
            "history_titles",
            _id(),
            _org(),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("name_key", sa.String(150), nullable=False),
            sa.Column(
                "source",
                sa.Enum("rank", "position", "custom", name="titlesource"),
                nullable=False,
                server_default="custom",
            ),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            _flag("is_retired"),
            _user_fk("created_by"),
            _created_at(),
            _updated_at(),
            sa.UniqueConstraint(
                "organization_id", "name_key", name="uq_history_title_key"
            ),
        )

    if not _has_table("historical_members"):
        op.create_table(
            "historical_members",
            _id(),
            _org(),
            _user_fk("user_id"),
            sa.Column("first_name", sa.String(100), nullable=True),
            sa.Column("middle_name", sa.String(100), nullable=True),
            sa.Column("last_name", sa.String(100), nullable=False),
            sa.Column("suffix", sa.String(20), nullable=True),
            sa.Column("nickname", sa.String(100), nullable=True),
            sa.Column("badge_number", sa.String(50), nullable=True),
            # Encrypted ISO-8601 text, not DATE.
            sa.Column("birth_date", sa.Text(), nullable=True),
            _precision("birth_date_precision", "day"),
            _flag("birth_date_circa"),
            sa.Column("biography", sa.Text(), nullable=True),
            sa.Column("addresses", sa.Text(), nullable=True),
            sa.Column("verification_sources", sa.Text(), nullable=True),
            sa.Column("research_notes", sa.Text(), nullable=True),
            _flag("is_memorial"),
            _flag("is_line_of_duty_death"),
            sa.Column("death_date", sa.Date(), nullable=True),
            _precision("death_date_precision", "day"),
            _flag("death_date_circa"),
            _visibility("death_date_visibility"),
            sa.Column("death_circumstances", sa.Text(), nullable=True),
            _visibility("death_circumstances_visibility"),
            sa.Column("burial_location", sa.Text(), nullable=True),
            _visibility("burial_location_visibility"),
            sa.Column(
                "publication_level",
                sa.Enum("draft", "members", "public", name="publicationlevel"),
                nullable=False,
                server_default="draft",
            ),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            _user_fk("published_by"),
            sa.Column("public_snapshot", sa.JSON(), nullable=True),
            sa.Column("public_revision_number", sa.Integer(), nullable=True),
            sa.Column(
                "substantial_revision_number",
                sa.Integer(),
                nullable=False,
                server_default="1",
            ),
            sa.Column(
                "revision_number", sa.Integer(), nullable=False, server_default="1"
            ),
            _user_fk("created_by"),
            _user_fk("updated_by"),
            _created_at(),
            _updated_at(),
        )
        op.create_index(
            "ix_historical_members_org_last",
            "historical_members",
            ["organization_id", "last_name"],
        )
        op.create_index(
            "ix_historical_members_org_level",
            "historical_members",
            ["organization_id", "publication_level"],
        )
        op.create_index(
            "ix_historical_members_org_lodd",
            "historical_members",
            ["organization_id", "is_line_of_duty_death"],
        )

    if not _has_table("historical_member_service_periods"):
        op.create_table(
            "historical_member_service_periods",
            _id(),
            sa.Column(
                "member_id",
                sa.String(36),
                sa.ForeignKey("historical_members.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("start_date", sa.Date(), nullable=True),
            _precision("start_precision", "year"),
            _flag("start_circa"),
            sa.Column("end_date", sa.Date(), nullable=True),
            _precision("end_precision", "year"),
            _flag("end_circa"),
            _flag("is_ongoing"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        )
        op.create_index(
            "ix_hist_service_periods_member",
            "historical_member_service_periods",
            ["member_id"],
        )

    if not _has_table("historical_member_period_titles"):
        op.create_table(
            "historical_member_period_titles",
            sa.Column(
                "period_id",
                sa.String(36),
                sa.ForeignKey(
                    "historical_member_service_periods.id", ondelete="CASCADE"
                ),
                primary_key=True,
            ),
            sa.Column(
                "title_id",
                sa.String(36),
                sa.ForeignKey("history_titles.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
        )

    if not _has_table("historical_member_relations"):
        op.create_table(
            "historical_member_relations",
            _id(),
            _org(),
            sa.Column(
                "member_id",
                sa.String(36),
                sa.ForeignKey("historical_members.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "related_member_id",
                sa.String(36),
                sa.ForeignKey("historical_members.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "relation_type",
                sa.Enum(
                    "parent_of",
                    "grandparent_of",
                    "sibling",
                    "spouse",
                    "other",
                    name="relationtype",
                ),
                nullable=False,
            ),
            sa.Column("label", sa.String(100), nullable=True),
            _user_fk("created_by"),
            _created_at(),
            sa.UniqueConstraint(
                "member_id",
                "related_member_id",
                "relation_type",
                name="uq_historical_member_relation",
            ),
        )
        op.create_index(
            "ix_hist_relations_related",
            "historical_member_relations",
            ["related_member_id"],
        )

    if not _has_table("history_revisions"):
        op.create_table(
            "history_revisions",
            _id(),
            _org(),
            sa.Column("record_type", sa.String(30), nullable=False),
            sa.Column("record_id", sa.String(36), nullable=False),
            sa.Column("revision_number", sa.Integer(), nullable=False),
            sa.Column(
                "kind",
                sa.Enum(
                    "created",
                    "minor",
                    "substantial",
                    "published",
                    "unpublished",
                    "submitted",
                    "cleared",
                    "returned",
                    "withdrawn",
                    name="revisionkind",
                ),
                nullable=False,
            ),
            # Encrypted JSON text.
            sa.Column("snapshot", sa.Text(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            _user_fk("actor_id"),
            _created_at(),
        )
        op.create_index(
            "ix_history_revisions_record",
            "history_revisions",
            ["organization_id", "record_type", "record_id", "created_at"],
        )

    if not _has_table("history_clearance_steps"):
        op.create_table(
            "history_clearance_steps",
            _id(),
            _org(),
            sa.Column("step_order", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column(
                "position_id",
                sa.String(36),
                sa.ForeignKey("positions.id", ondelete="SET NULL"),
                nullable=True,
            ),
            _created_at(),
            _updated_at(),
        )
        op.create_index(
            "ix_history_clearance_steps_org",
            "history_clearance_steps",
            ["organization_id", "step_order"],
        )

    if not _has_table("history_clearance_requests"):
        op.create_table(
            "history_clearance_requests",
            _id(),
            _org(),
            sa.Column("record_type", sa.String(30), nullable=False),
            sa.Column("record_id", sa.String(36), nullable=False),
            sa.Column("revision_number", sa.Integer(), nullable=False),
            sa.Column(
                "purpose",
                sa.Enum("public", "review", name="clearancepurpose"),
                nullable=False,
            ),
            sa.Column(
                "status",
                sa.Enum(
                    "pending",
                    "cleared",
                    "returned",
                    "withdrawn",
                    name="clearancestatus",
                ),
                nullable=False,
                server_default="pending",
            ),
            sa.Column("steps", sa.JSON(), nullable=False),
            sa.Column(
                "current_step_index", sa.Integer(), nullable=False, server_default="0"
            ),
            _user_fk("submitted_by"),
            sa.Column(
                "submitted_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "ix_history_clearance_requests_record",
            "history_clearance_requests",
            ["organization_id", "record_type", "record_id"],
        )
        op.create_index(
            "ix_history_clearance_requests_status",
            "history_clearance_requests",
            ["organization_id", "status"],
        )

    if not _has_table("history_clearance_decisions"):
        op.create_table(
            "history_clearance_decisions",
            _id(),
            sa.Column(
                "request_id",
                sa.String(36),
                sa.ForeignKey("history_clearance_requests.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("step_index", sa.Integer(), nullable=False),
            sa.Column("step_name", sa.String(150), nullable=False),
            sa.Column(
                "decision",
                sa.Enum("cleared", "returned", name="clearancedecisionkind"),
                nullable=False,
            ),
            _user_fk("decided_by"),
            _flag("decided_by_author"),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column(
                "decided_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index(
            "ix_history_clearance_decisions_req",
            "history_clearance_decisions",
            ["request_id"],
        )


def downgrade() -> None:
    # Children before parents, so no foreign key blocks a drop.
    for table in (
        "history_clearance_decisions",
        "history_clearance_requests",
        "history_clearance_steps",
        "history_revisions",
        "historical_member_relations",
        "historical_member_period_titles",
        "historical_member_service_periods",
        "historical_members",
        "history_titles",
    ):
        if _has_table(table):
            op.drop_table(table)
