"""
Email Service

Handles sending emails using SMTP or organization-specific email service configuration.
"""

import html as _html
import os
import smtplib
from datetime import datetime, timezone
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from loguru import logger

from app.core.config import settings
from app.models.user import Organization


class EmailService:
    """Service for sending emails"""

    def __init__(self, organization: Optional[Organization] = None):
        """
        Initialize email service

        Args:
            organization: Optional organization to use org-specific email settings
        """
        self.organization = organization
        self._smtp_config = self._get_smtp_config()

    @staticmethod
    def _esc(value: str) -> str:
        """HTML-escape a string for safe insertion into email HTML bodies."""
        return _html.escape(str(value)) if value else ""

    def _format_local_dt(self, dt: datetime, fmt: str = "%B %d, %Y at %I:%M %p") -> str:
        """Format a datetime in the organization's local timezone."""
        tz_name = (
            getattr(self.organization, "timezone", None) if self.organization else None
        )
        if tz_name:
            local_dt = dt.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(tz_name))
        else:
            local_dt = dt
        return local_dt.strftime(fmt)

    def _get_smtp_config(self) -> Dict[str, Any]:
        """
        Get SMTP configuration from organization settings or global config

        Priority:
        1. Organization-specific settings (if available)
        2. Global application settings
        """
        # Check if organization has custom email settings
        if self.organization and self.organization.settings:
            org_email_config = self.organization.settings.get("email_service", {})
            if org_email_config.get("enabled"):
                return {
                    "host": org_email_config.get("smtp_host"),
                    "port": org_email_config.get("smtp_port", 587),
                    "user": org_email_config.get("smtp_user"),
                    "password": org_email_config.get("smtp_password"),
                    "from_email": org_email_config.get("from_email"),
                    "from_name": org_email_config.get(
                        "from_name", self.organization.name
                    ),
                    "use_tls": org_email_config.get("use_tls", True),
                }

        # Fall back to global settings
        return {
            "host": settings.SMTP_HOST,
            "port": settings.SMTP_PORT,
            "user": settings.SMTP_USER,
            "password": settings.SMTP_PASSWORD,
            "from_email": settings.SMTP_FROM_EMAIL,
            "from_name": settings.SMTP_FROM_NAME,
            "use_tls": True,
        }

    async def send_email(
        self,
        to_emails: List[str],
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
        attachment_paths: Optional[List[str]] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None,
    ) -> tuple[int, int]:
        """
        Send an email to one or more recipients

        Args:
            to_emails: List of recipient email addresses
            subject: Email subject line
            html_body: HTML email body
            text_body: Optional plain text version of email
            attachment_paths: Optional list of file paths to attach
            cc_emails: Optional list of CC recipient email addresses
            bcc_emails: Optional list of BCC recipient email addresses (not shown in headers)

        Returns:
            Tuple of (success_count, failure_count)
        """
        if not settings.EMAIL_ENABLED and not (
            self.organization
            and self.organization.settings.get("email_service", {}).get("enabled")
        ):
            logger.info(
                f"Email disabled. Would send to {len(to_emails)} recipients: {subject}"
            )
            return 0, len(to_emails)

        success_count = 0
        failure_count = 0

        for to_email in to_emails:
            try:
                # Use mixed type when we have attachments, alternative otherwise
                if attachment_paths:
                    msg = MIMEMultipart("mixed")
                    # Create alternative sub-part for text/html
                    alt_part = MIMEMultipart("alternative")
                    if text_body:
                        alt_part.attach(MIMEText(text_body, "plain"))
                    alt_part.attach(MIMEText(html_body, "html"))
                    msg.attach(alt_part)

                    # Attach files
                    for filepath in attachment_paths:
                        if not os.path.isfile(filepath):
                            logger.warning(
                                f"Attachment not found, skipping: {filepath}"
                            )
                            continue
                        with open(filepath, "rb") as f:
                            part = MIMEBase("application", "octet-stream")
                            part.set_payload(f.read())
                        encoders.encode_base64(part)
                        filename = os.path.basename(filepath)
                        part.add_header(
                            "Content-Disposition", f'attachment; filename="{filename}"'
                        )
                        msg.attach(part)
                else:
                    msg = MIMEMultipart("alternative")
                    if text_body:
                        msg.attach(MIMEText(text_body, "plain"))
                    msg.attach(MIMEText(html_body, "html"))

                msg["From"] = (
                    f"{self._smtp_config['from_name']} <{self._smtp_config['from_email']}>"
                )
                msg["To"] = to_email
                msg["Subject"] = subject
                msg["Date"] = datetime.now(timezone.utc).strftime(
                    "%a, %d %b %Y %H:%M:%S +0000"
                )

                # Add CC and BCC recipients
                all_recipients = [to_email]
                if cc_emails:
                    msg["Cc"] = ", ".join(cc_emails)
                    all_recipients.extend(cc_emails)
                if bcc_emails:
                    # BCC recipients are NOT added to headers (invisible to other recipients)
                    all_recipients.extend(bcc_emails)

                # Send email
                with smtplib.SMTP(
                    self._smtp_config["host"], self._smtp_config["port"]
                ) as server:
                    if self._smtp_config["use_tls"]:
                        server.starttls()

                    if self._smtp_config["user"] and self._smtp_config["password"]:
                        server.login(
                            self._smtp_config["user"], self._smtp_config["password"]
                        )

                    server.sendmail(
                        self._smtp_config["from_email"],
                        all_recipients,
                        msg.as_string(),
                    )

                success_count += 1

            except Exception as e:
                logger.error(f"Failed to send email to {to_email}: {e}")
                failure_count += 1

        return success_count, failure_count

    async def send_ballot_notification(
        self,
        to_email: str,
        recipient_name: str,
        election_title: str,
        ballot_url: Optional[str],
        meeting_date: Optional[datetime],
        custom_message: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
    ) -> bool:
        """
        Send a ballot notification email

        Args:
            to_email: Recipient email address
            recipient_name: Recipient's name
            election_title: Title of the election/ballot
            ballot_url: URL to the voting page
            meeting_date: Date of the meeting
            custom_message: Optional custom message from secretary

        Returns:
            True if sent successfully
        """
        subject = f"Ballot Available: {election_title}"

        # HTML-escape user-controlled values
        esc = self._esc
        e_election_title = esc(election_title)
        e_recipient_name = esc(recipient_name)
        e_custom_message = esc(custom_message) if custom_message else ""
        e_ballot_url = esc(ballot_url) if ballot_url else ""

        # Build email body
        html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background-color: #dc2626; color: white; padding: 20px; text-align: center; }}
        .content {{ padding: 20px; background-color: #f9fafb; }}
        .button {{ display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
        .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{e_election_title}</h1>
        </div>
        <div class="content">
            <p>Hello {e_recipient_name},</p>

            <p>A ballot is now available for your review and vote.</p>

            {'<p><strong>Meeting Date:</strong> ' + self._format_local_dt(meeting_date) + '</p>' if meeting_date else ''}

            {f'<p>{e_custom_message}</p>' if e_custom_message else ''}

            {f'<p style="text-align: center;"><a href="{e_ballot_url}" class="button">Vote Now</a></p>' if e_ballot_url else ''}

            <p>Please review the ballot items and cast your vote before the voting period closes.</p>

            <p>If you have any questions, please contact the organization secretary.</p>

            <p>Thank you for your participation!</p>
        </div>
        <div class="footer">
            <p>This is an automated message from {self._smtp_config['from_name']}</p>
            <p>Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
"""

        text_body = f"""
{election_title}

Hello {recipient_name},

A ballot is now available for your review and vote.

{"Meeting Date: " + self._format_local_dt(meeting_date) if meeting_date else ''}

{custom_message if custom_message else ''}

{f"Vote Now: {ballot_url}" if ballot_url else ''}

Please review the ballot items and cast your vote before the voting period closes.

If you have any questions, please contact the organization secretary.

Thank you for your participation!

---
This is an automated message from {self._smtp_config['from_name']}
Please do not reply to this email.
"""

        success_count, failure_count = await self.send_email(
            to_emails=[to_email],
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            cc_emails=cc_emails,
        )

        return success_count > 0

    async def send_training_approval_request(
        self,
        to_emails: List[str],
        event_title: str,
        course_name: str,
        event_date: datetime,
        approval_url: str,
        attendee_count: int,
        approval_deadline: datetime,
        submitter_name: Optional[str] = None,
    ) -> tuple[int, int]:
        """
        Send training approval request notification to training officers

        Args:
            to_emails: List of training officer email addresses
            event_title: Title of the training event
            course_name: Name of the training course
            event_date: Date/time of the training event
            approval_url: URL to the approval page
            attendee_count: Number of attendees to approve
            approval_deadline: Deadline for approval
            submitter_name: Name of the person who submitted for approval

        Returns:
            Tuple of (success_count, failure_count)
        """
        subject = f"Training Approval Required: {course_name}"

        # HTML-escape user-controlled values
        esc = self._esc
        e_course_name = esc(course_name)
        e_event_title = esc(event_title)
        e_submitter_name = esc(submitter_name) if submitter_name else ""
        e_approval_url = esc(approval_url)

        html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background-color: #2563eb; color: white; padding: 20px; text-align: center; }}
        .content {{ padding: 20px; background-color: #f9fafb; }}
        .details {{ background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; }}
        .details-row {{ display: flex; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }}
        .details-label {{ font-weight: bold; width: 140px; color: #6b7280; }}
        .button {{ display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
        .warning {{ color: #dc2626; font-weight: bold; }}
        .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Training Approval Required</h1>
        </div>
        <div class="content">
            <p>A training session has been submitted for approval and requires your review.</p>

            <div class="details">
                <div class="details-row">
                    <span class="details-label">Course Name:</span>
                    <span>{e_course_name}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Event:</span>
                    <span>{e_event_title}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Date:</span>
                    <span>{self._format_local_dt(event_date)}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Attendees:</span>
                    <span>{attendee_count} member(s)</span>
                </div>
                {f'<div class="details-row"><span class="details-label">Submitted By:</span><span>{e_submitter_name}</span></div>' if e_submitter_name else ''}
                <div class="details-row">
                    <span class="details-label">Deadline:</span>
                    <span class="warning">{self._format_local_dt(approval_deadline)}</span>
                </div>
            </div>

            <p>Please review the attendee hours and approve or make adjustments as needed.</p>

            <p style="text-align: center;">
                <a href="{e_approval_url}" class="button">Review & Approve Training</a>
            </p>

            <p><small>If the button doesn't work, copy and paste this URL into your browser:<br/>{e_approval_url}</small></p>
        </div>
        <div class="footer">
            <p>This is an automated message from {self._smtp_config['from_name']}</p>
            <p>Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
"""

        text_body = f"""
Training Approval Required

A training session has been submitted for approval and requires your review.

Course Name: {course_name}
Event: {event_title}
Date: {self._format_local_dt(event_date)}
Attendees: {attendee_count} member(s)
{f"Submitted By: {submitter_name}" if submitter_name else ""}
Approval Deadline: {self._format_local_dt(approval_deadline)}

Please review the attendee hours and approve or make adjustments as needed.

Review & Approve: {approval_url}

---
This is an automated message from {self._smtp_config['from_name']}
Please do not reply to this email.
"""

        return await self.send_email(
            to_emails=to_emails,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )

    async def send_welcome_email(
        self,
        to_email: str,
        first_name: str,
        last_name: str,
        username: str,
        temp_password: str,
        organization_name: str,
        login_url: str,
        db: Any = None,
        organization_id: Optional[str] = None,
        attachment_paths: Optional[List[str]] = None,
    ) -> bool:
        """
        Send a welcome email to a newly created user.

        If a database session and organization_id are provided, loads the
        admin-configured template from the database. Otherwise falls back
        to a default template.

        Args:
            to_email: New user's email address
            first_name: New user's first name
            last_name: New user's last name
            username: Login username
            temp_password: Temporary password
            organization_name: Organization display name
            login_url: URL to the login page
            db: Optional async database session (for loading templates)
            organization_id: Optional org ID (for loading templates)
            attachment_paths: Optional list of local file paths to attach

        Returns:
            True if sent successfully
        """
        context = {
            "first_name": first_name,
            "last_name": last_name,
            "full_name": f"{first_name} {last_name}",
            "username": username,
            "temp_password": temp_password,
            "organization_name": organization_name,
            "login_url": login_url,
        }

        subject = None
        html_body = None
        text_body = None

        # Try loading the admin-configured template from the database
        if db and organization_id:
            try:
                from app.models.email_template import EmailTemplateType
                from app.services.email_template_service import EmailTemplateService

                template_service = EmailTemplateService(db)
                template = await template_service.get_template(
                    organization_id, EmailTemplateType.WELCOME
                )
                if template:
                    subject, html_body, text_body = template_service.render(
                        template, context
                    )
                    # Gather stored attachment paths if template has attachments
                    if template.allow_attachments and template.attachments:
                        stored_paths = [a.storage_path for a in template.attachments]
                        if attachment_paths:
                            attachment_paths = attachment_paths + stored_paths
                        else:
                            attachment_paths = stored_paths
            except Exception as e:
                logger.warning(
                    f"Failed to load welcome email template, using default: {e}"
                )

        # Fall back to inline default if no template loaded
        if not subject:
            import re

            from app.services.email_template_service import (
                DEFAULT_CSS,
                DEFAULT_WELCOME_HTML,
                DEFAULT_WELCOME_SUBJECT,
                DEFAULT_WELCOME_TEXT,
            )

            def _replace(text: str) -> str:
                def replacer(match):
                    var = match.group(1).strip()
                    value = str(context.get(var, match.group(0)))
                    return _html.escape(value)

                return re.sub(r"\{\{(\s*\w+\s*)\}\}", replacer, text)

            subject = _replace(DEFAULT_WELCOME_SUBJECT)
            html_body = f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style></head><body>{_replace(DEFAULT_WELCOME_HTML)}</body></html>"
            text_body = _replace(DEFAULT_WELCOME_TEXT)

        success_count, _ = await self.send_email(
            to_emails=[to_email],
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            attachment_paths=attachment_paths,
        )

        return success_count > 0

    async def send_password_reset_email(
        self,
        to_email: str,
        first_name: str,
        reset_url: str,
        organization_name: str,
        expiry_minutes: int = 30,
        db: Any = None,
        organization_id: Optional[str] = None,
    ) -> bool:
        """
        Send a password reset email.

        Only used when local authentication is enabled.

        Args:
            to_email: User's email address
            first_name: User's first name
            reset_url: Full URL to the password reset page with token
            organization_name: Organization display name
            expiry_minutes: Minutes until the reset link expires
            db: Optional async database session (for loading templates)
            organization_id: Optional org ID (for loading templates)

        Returns:
            True if sent successfully
        """
        context = {
            "first_name": first_name,
            "reset_url": reset_url,
            "organization_name": organization_name,
            "expiry_minutes": str(expiry_minutes),
            # Keep legacy key for existing custom templates that reference it
            "expiry_hours": str(expiry_minutes),
        }

        subject = None
        html_body = None
        text_body = None

        # Try loading the admin-configured template from the database
        if db and organization_id:
            try:
                from app.models.email_template import EmailTemplateType
                from app.services.email_template_service import EmailTemplateService

                template_service = EmailTemplateService(db)
                template = await template_service.get_template(
                    organization_id, EmailTemplateType.PASSWORD_RESET
                )
                if template:
                    subject, html_body, text_body = template_service.render(
                        template, context
                    )
            except Exception as e:
                logger.warning(
                    f"Failed to load password reset template, using default: {e}"
                )

        # Fall back to inline default
        if not subject:
            import re

            from app.services.email_template_service import (
                DEFAULT_CSS,
                DEFAULT_PASSWORD_RESET_HTML,
                DEFAULT_PASSWORD_RESET_SUBJECT,
                DEFAULT_PASSWORD_RESET_TEXT,
            )

            def _replace(text: str) -> str:
                def replacer(match):
                    var = match.group(1).strip()
                    value = str(context.get(var, match.group(0)))
                    return _html.escape(value)

                return re.sub(r"\{\{(\s*\w+\s*)\}\}", replacer, text)

            subject = _replace(DEFAULT_PASSWORD_RESET_SUBJECT)
            html_body = f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style></head><body>{_replace(DEFAULT_PASSWORD_RESET_HTML)}</body></html>"
            text_body = _replace(DEFAULT_PASSWORD_RESET_TEXT)

        success_count, _ = await self.send_email(
            to_emails=[to_email],
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )

        return success_count > 0

    async def send_it_password_reset_notification(
        self,
        to_emails: List[str],
        user_email: str,
        user_name: str,
        organization_name: str,
        ip_address: Optional[str] = None,
    ) -> tuple[int, int]:
        """
        Notify IT team members that a password reset was requested.

        Args:
            to_emails: IT team member email addresses
            user_email: Email of the user who requested the reset
            user_name: Display name of the user
            organization_name: Organization name
            ip_address: IP address the request originated from

        Returns:
            Tuple of (success_count, failure_count)
        """
        timestamp = self._format_local_dt(datetime.now(timezone.utc))
        ip_display = ip_address or "Unknown"

        subject = f"[IT Notice] Password Reset Requested — {organization_name}"

        # HTML-escape user-controlled values
        esc = self._esc
        e_org_name = esc(organization_name)
        e_user_name = esc(user_name)
        e_user_email = esc(user_email)
        e_ip_display = esc(ip_display)

        html_body = f"""<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background-color: #f59e0b; color: white; padding: 20px; text-align: center; }}
        .header h1 {{ margin: 0; font-size: 20px; }}
        .content {{ padding: 20px; background-color: #f9fafb; }}
        .details {{ background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #e5e7eb; }}
        .details p {{ margin: 4px 0; }}
        .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Password Reset Notification</h1>
        </div>
        <div class="content">
            <p>A password reset has been requested for a member of <strong>{e_org_name}</strong>.</p>

            <div class="details">
                <p><strong>Member:</strong> {e_user_name}</p>
                <p><strong>Email:</strong> {e_user_email}</p>
                <p><strong>Requested At:</strong> {timestamp}</p>
                <p><strong>IP Address:</strong> {e_ip_display}</p>
            </div>

            <p>This is for informational purposes. If this request appears suspicious, please investigate and consider disabling the account.</p>
        </div>
        <div class="footer">
            <p>This is an automated IT notification from {e_org_name}.</p>
        </div>
    </div>
</body>
</html>"""

        text_body = f"""Password Reset Notification — {organization_name}

A password reset has been requested for a member.

Member: {user_name}
Email: {user_email}
Requested At: {timestamp}
IP Address: {ip_display}

This is for informational purposes. If this request appears suspicious,
please investigate and consider disabling the account.

---
Automated IT notification from {organization_name}."""

        return await self.send_email(
            to_emails=to_emails,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )

    async def send_event_reminder(
        self,
        to_email: str,
        recipient_name: str,
        event_title: str,
        event_start: datetime,
        event_end: datetime,
        event_type: str,
        location_name: Optional[str] = None,
        location_details: Optional[str] = None,
        event_url: Optional[str] = None,
    ) -> bool:
        """
        Send an event reminder email.

        Args:
            to_email: Recipient email address
            recipient_name: Recipient's display name
            event_title: Title of the event
            event_start: Event start datetime (UTC)
            event_end: Event end datetime (UTC)
            event_type: Event type label (e.g. "Business Meeting")
            location_name: Optional location display name
            location_details: Optional additional location info
            event_url: Optional link to view the event

        Returns:
            True if sent successfully
        """
        start_str = self._format_local_dt(event_start)
        end_str = self._format_local_dt(event_end, "%I:%M %p")
        subject = f"Reminder: {event_title}"

        # HTML-escape user-controlled values
        esc = self._esc
        e_recipient_name = esc(recipient_name)
        e_event_title = esc(event_title)
        e_event_type = esc(event_type)

        location_html = ""
        location_text = ""
        if location_name:
            location_html = f'<div class="details-row"><span class="details-label">Location:</span><span>{esc(location_name)}</span></div>'
            location_text = f"Location: {location_name}"
            if location_details:
                location_html += f'<div class="details-row"><span class="details-label">Details:</span><span>{esc(location_details)}</span></div>'
                location_text += f"\nDetails: {location_details}"

        button_html = ""
        button_text = ""
        if event_url:
            button_html = f'<p style="text-align: center;"><a href="{esc(event_url)}" class="button">View Event</a></p>'
            button_text = f"\nView Event: {event_url}"

        html_body = f"""<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background-color: #dc2626; color: white; padding: 20px; text-align: center; }}
        .header h1 {{ margin: 0; font-size: 20px; }}
        .content {{ padding: 20px; background-color: #f9fafb; }}
        .details {{ background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #e5e7eb; }}
        .details-row {{ display: flex; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }}
        .details-label {{ font-weight: bold; width: 100px; color: #6b7280; }}
        .button {{ display: inline-block; padding: 12px 24px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
        .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Event Reminder</h1>
        </div>
        <div class="content">
            <p>Hello {e_recipient_name},</p>
            <p>This is a reminder about an upcoming event.</p>

            <div class="details">
                <div class="details-row">
                    <span class="details-label">Event:</span>
                    <span>{e_event_title}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Type:</span>
                    <span>{e_event_type}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">When:</span>
                    <span>{start_str} &ndash; {end_str}</span>
                </div>
                {location_html}
            </div>

            {button_html}
        </div>
        <div class="footer">
            <p>This is an automated reminder from {self._smtp_config['from_name']}</p>
        </div>
    </div>
</body>
</html>"""

        text_body = f"""Event Reminder

Hello {recipient_name},

This is a reminder about an upcoming event.

Event: {event_title}
Type: {event_type}
When: {start_str} - {end_str}
{location_text}
{button_text}

---
This is an automated reminder from {self._smtp_config['from_name']}"""

        success_count, _ = await self.send_email(
            to_emails=[to_email],
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )

        return success_count > 0

    async def send_inactivity_warning(
        self,
        to_emails: List[str],
        prospect_name: str,
        current_stage: str,
        days_inactive: int,
        timeout_days: int,
        organization_name: str,
    ) -> bool:
        """
        Send an inactivity warning email to coordinator(s) about a stalled prospect.

        Args:
            to_emails: Coordinator email address(es)
            prospect_name: Full name of the prospect
            current_stage: Name of the stage they are stalled on
            days_inactive: Number of days since last activity
            timeout_days: Configured inactivity timeout
            organization_name: Organization display name
        """
        subject = f"Inactivity Warning: {prospect_name} — {days_inactive} days"

        # HTML-escape user-controlled values
        esc = self._esc
        e_prospect_name = esc(prospect_name)
        e_current_stage = esc(current_stage)
        e_organization_name = esc(organization_name)

        html_body = f"""<!DOCTYPE html>
<html>
<head><style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 0; background: #f9fafb; }}
  .container {{ max-width: 560px; margin: 20px auto; background: #fff; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden; }}
  .header {{ background: #dc2626; color: #fff; padding: 20px 24px; }}
  .content {{ padding: 24px; color: #374151; line-height: 1.6; }}
  .details {{ background: #f9fafb; border-radius: 6px; padding: 16px; margin: 16px 0; }}
  .footer {{ padding: 16px 24px; font-size: 12px; color: #9ca3af; border-top: 1px solid #f3f4f6; }}
</style></head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin:0;">Inactivity Warning</h2>
    </div>
    <div class="content">
      <p>A prospective member's application has been inactive and may require your attention.</p>
      <div class="details">
        <p><strong>Applicant:</strong> {e_prospect_name}</p>
        <p><strong>Current Stage:</strong> {e_current_stage}</p>
        <p><strong>Days Inactive:</strong> {days_inactive} days</p>
        <p><strong>Timeout Threshold:</strong> {timeout_days} days</p>
      </div>
      <p>Please review this application and take appropriate action.</p>
    </div>
    <div class="footer">
      <p>Automated notification from {e_organization_name}.</p>
    </div>
  </div>
</body>
</html>"""

        text_body = f"""Inactivity Warning — {organization_name}

A prospective member's application has been inactive.

Applicant: {prospect_name}
Current Stage: {current_stage}
Days Inactive: {days_inactive} days
Timeout Threshold: {timeout_days} days

Please review this application and take appropriate action.

---
Automated notification from {organization_name}."""

        success_count, _ = await self.send_email(
            to_emails=to_emails,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )

        return success_count > 0
