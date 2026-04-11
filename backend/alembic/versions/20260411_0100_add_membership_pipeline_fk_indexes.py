"""Add missing FK indexes to membership pipeline tables

Adds indexes on foreign key columns that lacked them:
created_by on membership_pipelines, email_template_id on
membership_pipeline_steps, and uploaded_by on prospect_documents.
These prevent full table scans on JOINs at scale.

Revision ID: 20260411_0100
Revises: 20260404_0500
Create Date: 2026-04-11
"""

from alembic import op


revision = "20260411_0100"
down_revision = "20260404_0500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_membership_pipelines_created_by",
        "membership_pipelines",
        ["created_by"],
    )
    op.create_index(
        "ix_membership_pipeline_steps_email_template_id",
        "membership_pipeline_steps",
        ["email_template_id"],
    )
    op.create_index(
        "ix_prospect_documents_uploaded_by",
        "prospect_documents",
        ["uploaded_by"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_prospect_documents_uploaded_by",
        table_name="prospect_documents",
    )
    op.drop_index(
        "ix_membership_pipeline_steps_email_template_id",
        table_name="membership_pipeline_steps",
    )
    op.drop_index(
        "ix_membership_pipelines_created_by",
        table_name="membership_pipelines",
    )
