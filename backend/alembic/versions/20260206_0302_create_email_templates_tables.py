"""Create email templates and attachments tables

Revision ID: 20260206_0302
Revises: 20260206_0301
Create Date: 2026-02-06

Adds:
- email_templates: Configurable email templates managed by admins
- email_attachments: File attachments for email templates
- Seeds a default welcome email template per organization
"""
from alembic import op
import sqlalchemy as sa
import uuid
import json


# revision identifiers
revision = '20260206_0302'
down_revision = '20260206_0301'
branch_labels = None
depends_on = None


# Default template content for seeding
DEFAULT_CSS = """body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; padding: 20px; }
.header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
.header h1 { margin: 0; font-size: 24px; }
.content { padding: 20px; background-color: #f9fafb; }
.content p { margin: 0 0 16px 0; }
.button { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
.details { background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #e5e7eb; }
.footer { padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }"""

DEFAULT_WELCOME_HTML = """<div class="container">
    <div class="header">
        <h1>Welcome to {{organization_name}}</h1>
    </div>
    <div class="content">
        <p>Hello {{first_name}},</p>

        <p>Your account has been created for <strong>{{organization_name}}</strong>. You can now log in and access the system.</p>

        <div class="details">
            <p><strong>Username:</strong> {{username}}</p>
            <p><strong>Temporary Password:</strong> {{temp_password}}</p>
        </div>

        <p>For security, please change your password after your first login.</p>

        <p style="text-align: center;">
            <a href="{{login_url}}" class="button">Log In Now</a>
        </p>

        <p><small>If the button doesn't work, copy and paste this URL into your browser:<br/>{{login_url}}</small></p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_WELCOME_TEXT = """Welcome to {{organization_name}}

Hello {{first_name}},

Your account has been created for {{organization_name}}. You can now log in and access the system.

Username: {{username}}
Temporary Password: {{temp_password}}

For security, please change your password after your first login.

Log in at: {{login_url}}

---
This is an automated message from {{organization_name}}.
Please do not reply to this email."""

WELCOME_VARIABLES = json.dumps([
    {"name": "first_name", "description": "Recipient's first name"},
    {"name": "last_name", "description": "Recipient's last name"},
    {"name": "full_name", "description": "Recipient's full name"},
    {"name": "username", "description": "Login username"},
    {"name": "temp_password", "description": "Temporary password"},
    {"name": "organization_name", "description": "Organization name"},
    {"name": "login_url", "description": "URL to the login page"},
])


def upgrade() -> None:
    # Create email_templates table
    op.create_table(
        'email_templates',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('template_type', sa.Enum('welcome', 'password_reset', 'event_cancellation', 'event_reminder', 'training_approval', 'ballot_notification', 'custom', name='emailtemplatetype'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text()),
        sa.Column('subject', sa.String(500), nullable=False),
        sa.Column('html_body', sa.Text(), nullable=False),
        sa.Column('text_body', sa.Text()),
        sa.Column('css_styles', sa.Text()),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('allow_attachments', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('available_variables', sa.JSON()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('updated_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
    )
    op.create_index('idx_email_template_org_type', 'email_templates', ['organization_id', 'template_type'])

    # Create email_attachments table
    op.create_table(
        'email_attachments',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('template_id', sa.String(36), sa.ForeignKey('email_templates.id', ondelete='CASCADE'), nullable=False),
        sa.Column('filename', sa.String(255), nullable=False),
        sa.Column('content_type', sa.String(100), nullable=False),
        sa.Column('file_size', sa.String(20)),
        sa.Column('storage_path', sa.String(500), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('uploaded_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
    )
    op.create_index('idx_email_attachment_template', 'email_attachments', ['template_id'])

    # Seed a default welcome template for each existing organization
    conn = op.get_bind()
    orgs = conn.execute(sa.text("SELECT id FROM organizations"))
    for org in orgs:
        conn.execute(
            sa.text("""
                INSERT INTO email_templates
                    (id, organization_id, template_type, name, description,
                     subject, html_body, text_body, css_styles,
                     is_active, allow_attachments, available_variables)
                VALUES
                    (:id, :org_id, 'welcome', 'Welcome Email',
                     'Sent to new members when their account is created. Includes login credentials.',
                     :subject, :html_body, :text_body, :css_styles,
                     1, 1, :variables)
            """),
            {
                "id": str(uuid.uuid4()),
                "org_id": org[0],
                "subject": "Welcome to {{organization_name}} — Your Account is Ready",
                "html_body": DEFAULT_WELCOME_HTML,
                "text_body": DEFAULT_WELCOME_TEXT,
                "css_styles": DEFAULT_CSS,
                "variables": WELCOME_VARIABLES,
            },
        )


def downgrade() -> None:
    op.drop_table('email_attachments')
    op.drop_table('email_templates')
    op.execute("DROP TYPE IF EXISTS emailtemplatetype")
