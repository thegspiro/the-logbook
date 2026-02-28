"""
Email Template Service

Manages CRUD operations for email templates and renders them with context variables.
"""

import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.email_template import EmailTemplate, EmailTemplateType

# Default CSS styles shared across all email templates
DEFAULT_CSS = """
body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; padding: 20px; }
.header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
.header h1 { margin: 0; font-size: 24px; }
.content { padding: 20px; background-color: #f9fafb; }
.content p { margin: 0 0 16px 0; }
.button { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
.details { background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #e5e7eb; }
.footer { padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }
"""

# Variable definitions per template type
TEMPLATE_VARIABLES: Dict[str, List[Dict[str, str]]] = {
    "welcome": [
        {"name": "first_name", "description": "Recipient's first name"},
        {"name": "last_name", "description": "Recipient's last name"},
        {"name": "full_name", "description": "Recipient's full name"},
        {"name": "username", "description": "Login username"},
        {"name": "temp_password", "description": "Temporary password"},
        {"name": "organization_name", "description": "Organization name"},
        {"name": "login_url", "description": "URL to the login page"},
    ],
    "password_reset": [
        {"name": "first_name", "description": "Recipient's first name"},
        {"name": "reset_url", "description": "Password reset link"},
        {"name": "organization_name", "description": "Organization name"},
        {"name": "expiry_minutes", "description": "Minutes until link expires"},
    ],
    "inventory_change": [
        {"name": "first_name", "description": "Member's first name"},
        {"name": "organization_name", "description": "Organization/department name"},
        {"name": "change_date", "description": "Date the changes occurred"},
        {
            "name": "items_issued_html",
            "description": "HTML list of items issued/assigned",
        },
        {"name": "items_returned_html", "description": "HTML list of items returned"},
        {
            "name": "items_issued_text",
            "description": "Plain-text list of items issued/assigned",
        },
        {
            "name": "items_returned_text",
            "description": "Plain-text list of items returned",
        },
    ],
    "member_dropped": [
        {"name": "member_name", "description": "Full name of the dropped member"},
        {"name": "organization_name", "description": "Organization/department name"},
        {
            "name": "drop_type_display",
            "description": "Type of separation (Voluntary/Involuntary)",
        },
        {"name": "reason", "description": "Reason for the status change"},
        {"name": "effective_date", "description": "Date the drop takes effect"},
        {"name": "return_deadline", "description": "Deadline to return all property"},
        {"name": "item_count", "description": "Number of outstanding items"},
        {
            "name": "total_value",
            "description": "Total dollar value of outstanding items",
        },
        {
            "name": "performed_by_name",
            "description": "Name of the officer who performed the drop",
        },
        {"name": "performed_by_title", "description": "Title/rank of the officer"},
    ],
}

# Default welcome email HTML body
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

DEFAULT_WELCOME_SUBJECT = "Welcome to {{organization_name}} — Your Account is Ready"

# Default password reset email
DEFAULT_PASSWORD_RESET_HTML = """<div class="container">
    <div class="header">
        <h1>Password Reset Request</h1>
    </div>
    <div class="content">
        <p>Hello {{first_name}},</p>

        <p>We received a request to reset your password for <strong>{{organization_name}}</strong>.</p>

        <p>Click the button below to set a new password. This link will expire in <strong>{{expiry_minutes}} minutes</strong>.</p>

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

DEFAULT_PASSWORD_RESET_TEXT = """Password Reset Request

Hello {{first_name}},

We received a request to reset your password for {{organization_name}}.

Click the link below to set a new password. This link will expire in {{expiry_minutes}} minutes.

Reset your password: {{reset_url}}

If you did not request a password reset, you can safely ignore this email. Your password will not be changed.

---
This is an automated message from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_PASSWORD_RESET_SUBJECT = "Password Reset — {{organization_name}}"

# Default member dropped / property return email template
DEFAULT_MEMBER_DROPPED_HTML = """<div class="container">
    <div class="header">
        <h1>{{organization_name}}</h1>
    </div>
    <div class="content">
        <p><strong>Re: {{drop_type_display}} — Notice of Department Property Return</strong></p>
        <p>Dear {{member_name}},</p>
        <p>
            This message serves as formal notice that your membership status with
            <strong>{{organization_name}}</strong> has been changed to
            <strong>{{drop_type_display}}</strong> effective <strong>{{effective_date}}</strong>.
        </p>
        <p><strong>Reason:</strong> {{reason}}</p>
        <div class="details">
            <p><strong>Outstanding Items:</strong> {{item_count}} item(s)</p>
            <p><strong>Total Assessed Value:</strong> ${{total_value}}</p>
            <p><strong>Return Deadline:</strong> {{return_deadline}}</p>
        </div>
        <p>
            In accordance with department policy, all department-issued property must be
            returned in its current condition by the deadline above. Please contact the
            department administration to arrange return of these items.
        </p>
        <p>
            Respectfully,<br/>
            {{performed_by_name}}<br/>
            {{performed_by_title}}<br/>
            {{organization_name}}
        </p>
    </div>
    <div class="footer">
        <p>This is an official department notice. A copy has been placed in your member file.</p>
    </div>
</div>"""

DEFAULT_MEMBER_DROPPED_TEXT = """Notice of Department Property Return

Dear {{member_name}},

Your membership status with {{organization_name}} has been changed to {{drop_type_display}} effective {{effective_date}}.

Reason: {{reason}}

Outstanding Items: {{item_count}} item(s)
Total Assessed Value: ${{total_value}}
Return Deadline: {{return_deadline}}

In accordance with department policy, all department-issued property must be returned in its current condition by the deadline above.

Please contact the department administration to arrange return of these items.

Respectfully,
{{performed_by_name}}
{{performed_by_title}}
{{organization_name}}

---
This is an official department notice. A copy has been placed in your member file."""


# Default inventory change notification email
DEFAULT_INVENTORY_CHANGE_HTML = """<div class="container">
    <div class="header">
        <h1>{{organization_name}}</h1>
    </div>
    <div class="content">
        <p>Hello {{first_name}},</p>
        <p>
            This message is to confirm recent changes to the department property
            assigned to you as of <strong>{{change_date}}</strong>.
        </p>

        {{items_issued_html}}

        {{items_returned_html}}

        <div class="details">
            <p><strong>Important Reminder:</strong> All items listed above remain
            the property of <strong>{{organization_name}}</strong>. Members are
            responsible for the care, maintenance, and safekeeping of all
            department-issued property. Any lost, stolen, or damaged items
            must be reported to the Quartermaster immediately.</p>
        </div>

        <p>If you believe there is an error in this notice, please contact the
        Quartermaster or department administration at your earliest convenience.</p>

        <p>Thank you,<br/>{{organization_name}}</p>
    </div>
    <div class="footer">
        <p>This is an automated inventory notice from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_INVENTORY_CHANGE_TEXT = """Inventory Change Confirmation — {{organization_name}}

Hello {{first_name}},

This message is to confirm recent changes to the department property
assigned to you as of {{change_date}}.

{{items_issued_text}}

{{items_returned_text}}

IMPORTANT REMINDER: All items listed above remain the property of
{{organization_name}}. Members are responsible for the care, maintenance,
and safekeeping of all department-issued property. Any lost, stolen, or
damaged items must be reported to the Quartermaster immediately.

If you believe there is an error in this notice, please contact the
Quartermaster or department administration at your earliest convenience.

Thank you,
{{organization_name}}

---
This is an automated inventory notice from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_INVENTORY_CHANGE_SUBJECT = "Inventory Update — {{organization_name}}"


class EmailTemplateService:
    """Service for managing and rendering email templates"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_template(
        self,
        organization_id: str,
        template_type: EmailTemplateType,
        active_only: bool = True,
    ) -> Optional[EmailTemplate]:
        """Get a specific template by type for an organization"""
        conditions = [
            EmailTemplate.organization_id == organization_id,
            EmailTemplate.template_type == template_type,
        ]
        if active_only:
            conditions.append(EmailTemplate.is_active == True)  # noqa: E712

        result = await self.db.execute(
            select(EmailTemplate)
            .where(and_(*conditions))
            .options(selectinload(EmailTemplate.attachments))
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list_templates(self, organization_id: str) -> List[EmailTemplate]:
        """List all templates for an organization"""
        result = await self.db.execute(
            select(EmailTemplate)
            .where(EmailTemplate.organization_id == str(organization_id))
            .options(selectinload(EmailTemplate.attachments))
            .order_by(EmailTemplate.template_type, EmailTemplate.name)
        )
        return list(result.scalars().all())

    async def create_template(
        self,
        organization_id: str,
        template_type: EmailTemplateType,
        name: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
        css_styles: Optional[str] = None,
        description: Optional[str] = None,
        allow_attachments: bool = False,
        created_by: Optional[str] = None,
    ) -> EmailTemplate:
        """Create a new email template"""
        template = EmailTemplate(
            id=str(uuid.uuid4()),
            organization_id=organization_id,
            template_type=template_type,
            name=name,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            css_styles=css_styles or DEFAULT_CSS,
            description=description,
            allow_attachments=allow_attachments,
            available_variables=TEMPLATE_VARIABLES.get(template_type.value, []),
            created_by=created_by,
            updated_by=created_by,
        )
        self.db.add(template)
        await self.db.flush()
        return template

    async def update_template(
        self,
        template_id: str,
        organization_id: str,
        updated_by: Optional[str] = None,
        **fields,
    ) -> Optional[EmailTemplate]:
        """Update an existing email template"""
        result = await self.db.execute(
            select(EmailTemplate)
            .where(
                EmailTemplate.id == template_id,
                EmailTemplate.organization_id == organization_id,
            )
            .options(selectinload(EmailTemplate.attachments))
        )
        template = result.scalar_one_or_none()
        if not template:
            return None

        allowed_fields = {
            "name",
            "subject",
            "html_body",
            "text_body",
            "css_styles",
            "description",
            "is_active",
            "allow_attachments",
        }
        for key, value in fields.items():
            if key in allowed_fields and value is not None:
                setattr(template, key, value)

        template.updated_by = updated_by
        await self.db.flush()
        return template

    async def delete_template(self, template_id: str, organization_id: str) -> bool:
        """Delete an email template"""
        result = await self.db.execute(
            select(EmailTemplate).where(
                EmailTemplate.id == template_id,
                EmailTemplate.organization_id == organization_id,
            )
        )
        template = result.scalar_one_or_none()
        if not template:
            return False

        await self.db.delete(template)
        await self.db.flush()
        return True

    def render(
        self,
        template: EmailTemplate,
        context: Dict[str, Any],
    ) -> Tuple[str, str, Optional[str]]:
        """
        Render a template with the given context variables.

        Returns (subject, html_body, text_body) with variables replaced.
        Variables use {{variable_name}} syntax.
        CSS styles are injected into the HTML wrapper.
        """
        subject = self._replace_variables(template.subject, context)
        html_body = self._replace_variables(template.html_body, context)
        text_body = None
        if template.text_body:
            text_body = self._replace_variables(template.text_body, context)

        # Wrap HTML body with full document structure and CSS
        css = template.css_styles or DEFAULT_CSS
        full_html = f"""<!DOCTYPE html>
<html>
<head>
<style>
{css}
</style>
</head>
<body>
{html_body}
</body>
</html>"""

        return subject, full_html, text_body

    def _replace_variables(self, text: str, context: Dict[str, Any]) -> str:
        """Replace {{variable_name}} placeholders with context values.

        All values are HTML-escaped to prevent injection of malicious
        HTML/JS through user-controlled template variables (e.g.
        election titles, custom messages, recipient names).
        """
        import html as _html

        def replacer(match):
            var_name = match.group(1).strip()
            value = str(context.get(var_name, match.group(0)))
            return _html.escape(value)

        return re.sub(r"\{\{(\s*\w+\s*)\}\}", replacer, text)

    async def ensure_default_templates(
        self,
        organization_id: str,
        created_by: Optional[str] = None,
    ) -> List[EmailTemplate]:
        """
        Ensure default templates exist for an organization.
        Creates any missing default templates. Idempotent.
        """
        created = []

        # Check for welcome template
        existing = await self.get_template(
            organization_id, EmailTemplateType.WELCOME, active_only=False
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.WELCOME,
                name="Welcome Email",
                subject=DEFAULT_WELCOME_SUBJECT,
                html_body=DEFAULT_WELCOME_HTML,
                text_body=DEFAULT_WELCOME_TEXT,
                description="Sent to new members when their account is created. Includes login credentials.",
                allow_attachments=True,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default welcome email template for org {organization_id}"
            )

        # Check for password reset template
        existing = await self.get_template(
            organization_id, EmailTemplateType.PASSWORD_RESET, active_only=False
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.PASSWORD_RESET,
                name="Password Reset",
                subject=DEFAULT_PASSWORD_RESET_SUBJECT,
                html_body=DEFAULT_PASSWORD_RESET_HTML,
                text_body=DEFAULT_PASSWORD_RESET_TEXT,
                description="Sent when a member requests a password reset. Only used with local authentication.",
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default password reset email template for org {organization_id}"
            )

        # Check for member dropped template
        existing = await self.get_template(
            organization_id, EmailTemplateType.MEMBER_DROPPED, active_only=False
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.MEMBER_DROPPED,
                name="Member Dropped — Property Return Notice",
                subject="Notice of Department Property Return — {{organization_name}}",
                html_body=DEFAULT_MEMBER_DROPPED_HTML,
                text_body=DEFAULT_MEMBER_DROPPED_TEXT,
                description=(
                    "Sent to a member when their status changes to dropped. "
                    "Includes the reason for separation and a notice to return all department property. "
                    "CC recipients are controlled in Organization Settings > Drop Notifications."
                ),
                allow_attachments=True,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default member dropped email template for org {organization_id}"
            )

        # Check for inventory change template
        existing = await self.get_template(
            organization_id, EmailTemplateType.INVENTORY_CHANGE, active_only=False
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.INVENTORY_CHANGE,
                name="Inventory Change Confirmation",
                subject=DEFAULT_INVENTORY_CHANGE_SUBJECT,
                html_body=DEFAULT_INVENTORY_CHANGE_HTML,
                text_body=DEFAULT_INVENTORY_CHANGE_TEXT,
                description=(
                    "Sent to a member approximately one hour after inventory changes "
                    "(items issued, assigned, returned, etc.). Multiple changes within "
                    "the window are consolidated into a single email. Offsetting actions "
                    "(e.g. issue + return of the same item) are netted out."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default inventory change email template for org {organization_id}"
            )

        return created
