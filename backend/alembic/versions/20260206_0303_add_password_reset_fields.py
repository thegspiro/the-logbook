"""Add password reset token fields to users table and seed password reset template

Revision ID: 20260206_0303
Revises: 20260206_0302
Create Date: 2026-02-06

Adds:
- password_reset_token and password_reset_expires_at columns to users table
- Seeds a default password reset email template per organization
"""
from alembic import op
import sqlalchemy as sa
import uuid
import json


# revision identifiers
revision = '20260206_0303'
down_revision = '20260206_0302'
branch_labels = None
depends_on = None


DEFAULT_CSS = """body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; padding: 20px; }
.header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
.header h1 { margin: 0; font-size: 24px; }
.content { padding: 20px; background-color: #f9fafb; }
.content p { margin: 0 0 16px 0; }
.button { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
.details { background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #e5e7eb; }
.footer { padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }"""

DEFAULT_RESET_HTML = """<div class="container">
    <div class="header">
        <h1>Password Reset Request</h1>
    </div>
    <div class="content">
        <p>Hello {{first_name}},</p>

        <p>We received a request to reset your password for <strong>{{organization_name}}</strong>.</p>

        <p>Click the button below to set a new password. This link will expire in <strong>{{expiry_hours}} minutes</strong>.</p>

        <p style="text-align: center;">
            <a href="{{reset_url}}" class="button">Reset Password</a>
        </p>

        <p><small>If the button doesn't work, copy and paste this URL into your browser:<br/>{{reset_url}}</small></p>

        <p>If you did not request a password reset, you can safely ignore this email. Your password will not be changed.</p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_RESET_TEXT = """Password Reset Request

Hello {{first_name}},

We received a request to reset your password for {{organization_name}}.

Click the link below to set a new password. This link will expire in {{expiry_hours}} minutes.

Reset your password: {{reset_url}}

If you did not request a password reset, you can safely ignore this email. Your password will not be changed.

---
This is an automated message from {{organization_name}}.
Please do not reply to this email."""

RESET_VARIABLES = json.dumps([
    {"name": "first_name", "description": "Recipient's first name"},
    {"name": "reset_url", "description": "Password reset link"},
    {"name": "organization_name", "description": "Organization name"},
    {"name": "expiry_hours", "description": "Minutes until link expires"},
])


def upgrade() -> None:
    # Add password reset columns to users table
    op.add_column('users', sa.Column('password_reset_token', sa.String(128), nullable=True))
    op.add_column('users', sa.Column('password_reset_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_users_password_reset_token', 'users', ['password_reset_token'])

    # Seed a default password reset template for each existing organization
    conn = op.get_bind()
    orgs = conn.execute(sa.text("SELECT id FROM organizations WHERE deleted_at IS NULL"))
    for org in orgs:
        conn.execute(
            sa.text("""
                INSERT INTO email_templates
                    (id, organization_id, template_type, name, description,
                     subject, html_body, text_body, css_styles,
                     is_active, allow_attachments, available_variables)
                VALUES
                    (:id, :org_id, 'password_reset', 'Password Reset',
                     'Sent when a member requests a password reset. Only used with local authentication.',
                     :subject, :html_body, :text_body, :css_styles,
                     1, 0, :variables)
            """),
            {
                "id": str(uuid.uuid4()),
                "org_id": org[0],
                "subject": "Password Reset — {{organization_name}}",
                "html_body": DEFAULT_RESET_HTML,
                "text_body": DEFAULT_RESET_TEXT,
                "css_styles": DEFAULT_CSS,
                "variables": RESET_VARIABLES,
            },
        )


def downgrade() -> None:
    op.drop_index('ix_users_password_reset_token', 'users')
    op.drop_column('users', 'password_reset_expires_at')
    op.drop_column('users', 'password_reset_token')
    # Remove seeded password_reset templates
    op.execute("DELETE FROM email_templates WHERE template_type = 'password_reset'")
