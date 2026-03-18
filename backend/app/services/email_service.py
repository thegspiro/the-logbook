"""
Email Service

Handles sending emails using SMTP or organization-specific email service configuration.
"""

import asyncio
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
from app.schemas.organization import decrypt_settings_secrets


def build_email_logo_img(organization: Optional[Organization]) -> str:
    """Build a bare <img> tag for the org logo, or empty string.

    Use this when inserting into a template that already provides its own
    wrapper element (e.g. ``<div class="logo">{{organization_logo_img}}</div>``).
    """
    if not organization:
        return ""
    logo_url = getattr(organization, "logo", None) or ""
    if not logo_url:
        return ""
    org_name = getattr(organization, "name", "Organization")
    safe_url = _html.escape(str(logo_url))
    safe_name = _html.escape(str(org_name))
    return (
        f'<img src="{safe_url}" alt="{safe_name}" '
        f'style="max-height:80px;max-width:200px;" />'
    )


def build_email_logo_html(organization: Optional[Organization]) -> str:
    """Build an <img> tag (inside a centered div) for the org logo.

    Returns an empty string when the organization has no logo configured.
    Use this in inline HTML emails where no wrapper element exists.
    """
    img = build_email_logo_img(organization)
    if not img:
        return ""
    return f'<div style="text-align:center;padding:16px 0;">' f"{img}</div>"


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

    def _build_logo_img(self) -> str:
        """Build an <img> tag for the organization logo, or empty string.

        Returns the bare <img> tag (no wrapper div) for use in template
        variable substitution where the template itself provides the wrapper.
        """
        return build_email_logo_img(self.organization)

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
            # Decrypt secret fields (smtp_password, etc.) before reading
            decrypted = decrypt_settings_secrets(self.organization.settings)
            org_email_config = decrypted.get("email_service", {})
            if org_email_config.get("enabled"):
                encryption = org_email_config.get("smtp_encryption", "tls")
                return {
                    "host": org_email_config.get("smtp_host"),
                    "port": org_email_config.get("smtp_port", 587),
                    "user": org_email_config.get("smtp_user"),
                    "password": org_email_config.get("smtp_password"),
                    "from_email": org_email_config.get("from_email"),
                    "from_name": org_email_config.get(
                        "from_name", self.organization.name
                    ),
                    "encryption": encryption,
                }

        # Fall back to global settings
        return {
            "host": settings.SMTP_HOST,
            "port": settings.SMTP_PORT,
            "user": settings.SMTP_USER,
            "password": settings.SMTP_PASSWORD,
            "from_email": settings.SMTP_FROM_EMAIL,
            "from_name": settings.SMTP_FROM_NAME,
            "encryption": getattr(settings, "SMTP_ENCRYPTION", "tls"),
        }

    def _smtp_send(self, recipients: List[str], message: str) -> None:
        """Synchronous SMTP send — called via asyncio.to_thread."""
        import ssl

        host = self._smtp_config["host"]
        port = self._smtp_config["port"]
        encryption = self._smtp_config.get("encryption", "tls")

        if not host or not self._smtp_config.get("from_email"):
            raise ValueError("SMTP host and from_email are required")

        timeout = 30
        context = ssl.create_default_context()

        if encryption == "ssl":
            # Implicit TLS (port 465) — entire connection is encrypted
            server = smtplib.SMTP_SSL(host, port, context=context, timeout=timeout)
        elif encryption in ("tls", "starttls"):
            # STARTTLS (port 587) — upgrade plain connection to encrypted
            server = smtplib.SMTP(host, port, timeout=timeout)
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
        else:
            # No encryption (port 25) — plain SMTP, not recommended
            server = smtplib.SMTP(host, port, timeout=timeout)
            server.ehlo()

        try:
            if self._smtp_config["user"] and self._smtp_config["password"]:
                server.login(
                    self._smtp_config["user"],
                    self._smtp_config["password"],
                )
            server.sendmail(
                self._smtp_config["from_email"],
                recipients,
                message,
            )
        finally:
            server.quit()

    async def send_email(
        self,
        to_emails: List[str],
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
        attachment_paths: Optional[List[str]] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None,
        db: Any = None,
        template_type: Optional[str] = None,
        sent_by: Optional[str] = None,
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
            db: Optional async database session (for logging to message_history)
            template_type: Optional template type string (for message_history)
            sent_by: Optional user ID who triggered the send (for message_history)

        Returns:
            Tuple of (success_count, failure_count)
        """
        if not settings.EMAIL_ENABLED and not (
            self.organization
            and (self.organization.settings or {})
            .get("email_service", {})
            .get("enabled")
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

                # Send email in a thread to avoid blocking the event loop
                await asyncio.to_thread(
                    self._smtp_send,
                    all_recipients,
                    msg.as_string(),
                )

                success_count += 1

            except Exception as e:
                logger.error(f"Failed to send email to {to_email}: {e}")
                failure_count += 1

        # Log to message_history when a db session is available
        if db:
            try:
                await self._log_message_history(
                    db,
                    to_emails=to_emails,
                    subject=subject,
                    cc_emails=cc_emails,
                    bcc_emails=bcc_emails,
                    template_type=template_type,
                    sent_by=sent_by,
                    success_count=success_count,
                    failure_count=failure_count,
                )
            except Exception as e:
                logger.warning(f"Failed to log message history: {e}")

        return success_count, failure_count

    async def _log_message_history(
        self,
        db: Any,
        to_emails: List[str],
        subject: str,
        cc_emails: Optional[List[str]],
        bcc_emails: Optional[List[str]],
        template_type: Optional[str],
        sent_by: Optional[str],
        success_count: int,
        failure_count: int,
    ) -> None:
        """Write a MessageHistory record for the send attempt."""
        from app.core.utils import generate_uuid
        from app.models.email_template import (
            MessageHistory,
            MessageHistoryStatus,
        )

        org_id = str(self.organization.id) if self.organization else None
        status = (
            MessageHistoryStatus.SENT
            if success_count > 0
            else MessageHistoryStatus.FAILED
        )
        history = MessageHistory(
            id=generate_uuid(),
            organization_id=org_id,
            to_email=", ".join(to_emails),
            cc_emails=cc_emails,
            bcc_emails=bcc_emails,
            subject=subject,
            template_type=template_type,
            status=status,
            recipient_count=len(to_emails),
            sent_by=sent_by,
        )
        if failure_count > 0 and success_count == 0:
            history.error_message = (
                f"Failed to deliver to all {failure_count} recipient(s)"
            )
        db.add(history)
        await db.flush()

    async def send_ballot_notification(
        self,
        to_email: str,
        recipient_name: str,
        election_title: str,
        ballot_url: Optional[str],
        meeting_date: Optional[datetime],
        custom_message: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        positions: Optional[List[str]] = None,
        ballot_items_html: str = "",
        ballot_items_text: str = "",
        admin_contact_name: str = "",
        admin_contact_email: str = "",
        db: Any = None,
        organization_id: Optional[str] = None,
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
            cc_emails: Optional CC recipient list
            start_date: When voting opens (UTC)
            end_date: When voting closes (UTC)
            positions: List of positions being voted on
            ballot_items_html: HTML list of ballot items this voter is eligible for
            ballot_items_text: Plain-text list of ballot items
            admin_contact_name: Election administrator's display name
            admin_contact_email: Election administrator's email address
            db: Optional async database session (for loading templates)
            organization_id: Optional org ID (for loading templates)

        Returns:
            True if sent successfully
        """
        org_name = ""
        if self.organization:
            org_name = getattr(self.organization, "name", "")
        org_logo = ""
        if self.organization:
            org_logo = getattr(self.organization, "logo", None) or ""

        # Build custom_message_html: wraps the message in a <p> tag if
        # present, or yields an empty string so the placeholder disappears.
        custom_message_html = ""
        if custom_message:
            custom_message_html = f"<p>{_html.escape(custom_message)}</p>"

        context = {
            "recipient_name": recipient_name,
            "election_title": election_title,
            "ballot_url": ballot_url or "",
            "meeting_date": self._format_local_dt(meeting_date) if meeting_date else "",
            "custom_message": custom_message or "",
            "custom_message_html": custom_message_html,
            "voting_opens": self._format_local_dt(start_date) if start_date else "",
            "voting_closes": self._format_local_dt(end_date) if end_date else "",
            "positions": ", ".join(positions) if positions else "",
            "ballot_items_html": ballot_items_html,
            "ballot_items_text": ballot_items_text,
            "admin_contact_name": admin_contact_name,
            "admin_contact_email": admin_contact_email,
            "organization_name": org_name,
            "organization_logo": org_logo,
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
                    organization_id, EmailTemplateType.BALLOT_NOTIFICATION
                )
                if template:
                    subject, html_body, text_body = template_service.render(
                        template, context, organization=self.organization
                    )
            except Exception as e:
                logger.warning(
                    f"Failed to load ballot notification template, using default: {e}"
                )

        # Fall back to inline default if no template loaded
        if not subject:
            import re

            from app.services.email_template_service import (
                DEFAULT_BALLOT_NOTIFICATION_HTML,
                DEFAULT_BALLOT_NOTIFICATION_SUBJECT,
                DEFAULT_BALLOT_NOTIFICATION_TEXT,
                DEFAULT_CSS,
            )

            context["organization_logo_img"] = self._build_logo_img()
            _raw_html_vars = {
                "organization_logo_img",
                "ballot_items_html",
                "custom_message_html",
            }

            def _replace(text: str) -> str:
                def replacer(match):
                    var = match.group(1).strip()
                    value = str(context.get(var, match.group(0)))
                    if var in _raw_html_vars:
                        return value
                    return _html.escape(value)

                return re.sub(r"\{\{(\s*\w+\s*)\}\}", replacer, text)

            subject = _replace(DEFAULT_BALLOT_NOTIFICATION_SUBJECT)
            html_body = f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style></head><body>{_replace(DEFAULT_BALLOT_NOTIFICATION_HTML)}</body></html>"
            text_body = _replace(DEFAULT_BALLOT_NOTIFICATION_TEXT)

        success_count, failure_count = await self.send_email(
            to_emails=[to_email],
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            cc_emails=cc_emails,
            db=db,
            template_type="ballot_notification",
        )

        return success_count > 0

    async def send_election_report(
        self,
        to_emails: List[str],
        recipient_name: str,
        election_title: str,
        election_type: str,
        start_date: str,
        end_date: str,
        total_eligible_voters: int,
        total_votes_cast: int,
        voter_turnout_percentage: float,
        quorum_status: str,
        quorum_detail: str,
        results_html: str,
        results_text: str,
        ballot_recipients_html: str,
        ballot_recipients_text: str,
        skipped_voters_html: str,
        skipped_voters_text: str,
        cc_emails: Optional[List[str]] = None,
        db: Any = None,
        organization_id: Optional[str] = None,
    ) -> tuple[int, int]:
        """
        Send an election report email to the secretary/leadership.

        Returns:
            Tuple of (success_count, failure_count)
        """
        org_name = ""
        if self.organization:
            org_name = getattr(self.organization, "name", "")

        context = {
            "recipient_name": recipient_name,
            "election_title": election_title,
            "election_type": election_type,
            "start_date": start_date,
            "end_date": end_date,
            "total_eligible_voters": str(total_eligible_voters),
            "total_votes_cast": str(total_votes_cast),
            "voter_turnout_percentage": f"{voter_turnout_percentage:.1f}",
            "quorum_status": quorum_status,
            "quorum_detail": quorum_detail,
            "results_html": results_html,
            "results_text": results_text,
            "ballot_recipients_html": ballot_recipients_html,
            "ballot_recipients_text": ballot_recipients_text,
            "skipped_voters_html": skipped_voters_html,
            "skipped_voters_text": skipped_voters_text,
            "organization_name": org_name,
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
                    organization_id, EmailTemplateType.ELECTION_REPORT
                )
                if template:
                    subject, html_body, text_body = template_service.render(
                        template, context, organization=self.organization
                    )
            except Exception as e:
                logger.warning(
                    f"Failed to load election report template, using default: {e}"
                )

        # Fall back to inline default if no template loaded
        if not subject:
            import re

            from app.services.email_template_service import (
                DEFAULT_CSS,
                DEFAULT_ELECTION_REPORT_HTML,
                DEFAULT_ELECTION_REPORT_SUBJECT,
                DEFAULT_ELECTION_REPORT_TEXT,
            )

            context["organization_logo_img"] = self._build_logo_img()
            _raw_html_vars = {
                "organization_logo_img",
                "results_html",
                "ballot_recipients_html",
                "skipped_voters_html",
            }

            def _replace(text: str) -> str:
                def replacer(match):
                    var = match.group(1).strip()
                    value = str(context.get(var, match.group(0)))
                    if var in _raw_html_vars:
                        return value
                    return _html.escape(value)

                return re.sub(r"\{\{(\s*\w+\s*)\}\}", replacer, text)

            subject = _replace(DEFAULT_ELECTION_REPORT_SUBJECT)
            html_body = (
                f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style></head>"
                f"<body>{_replace(DEFAULT_ELECTION_REPORT_HTML)}</body></html>"
            )
            text_body = _replace(DEFAULT_ELECTION_REPORT_TEXT)

        success_count, failure_count = await self.send_email(
            to_emails=to_emails,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            cc_emails=cc_emails,
            db=db,
            template_type="election_report",
        )

        return success_count, failure_count

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
        db: Optional[Any] = None,
        organization_id: Optional[str] = None,
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
            db: Optional database session for loading templates
            organization_id: Optional org ID for loading templates

        Returns:
            Tuple of (success_count, failure_count)
        """
        context = {
            "course_name": course_name,
            "event_title": event_title,
            "event_date": self._format_local_dt(event_date),
            "attendee_count": str(attendee_count),
            "approval_deadline": self._format_local_dt(approval_deadline),
            "submitter_name": submitter_name or "",
            "approval_url": approval_url,
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
                    organization_id, EmailTemplateType.TRAINING_APPROVAL
                )
                if template:
                    subject, html_body, text_body = template_service.render(
                        template, context, organization=self.organization
                    )
            except Exception as e:
                logger.warning(
                    f"Failed to load training approval template, using default: {e}"
                )

        # Fall back to inline default if no template loaded
        if not subject:
            import re

            from app.services.email_template_service import (
                DEFAULT_CSS,
                DEFAULT_TRAINING_APPROVAL_HTML,
                DEFAULT_TRAINING_APPROVAL_SUBJECT,
                DEFAULT_TRAINING_APPROVAL_TEXT,
            )

            context["organization_logo_img"] = self._build_logo_img()
            subject = DEFAULT_TRAINING_APPROVAL_SUBJECT
            rendered_html = DEFAULT_TRAINING_APPROVAL_HTML
            rendered_text = DEFAULT_TRAINING_APPROVAL_TEXT
            for key, val in context.items():
                pattern = r"\{\{\s*" + re.escape(key) + r"\s*\}\}"
                subject = re.sub(pattern, str(val), subject)
                rendered_html = re.sub(pattern, str(val), rendered_html)
                rendered_text = re.sub(pattern, str(val), rendered_text)
            html_body = f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style></head><body>{rendered_html}</body></html>"
            text_body = rendered_text

        return await self.send_email(
            to_emails=to_emails,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            db=db,
            template_type="training_approval_request",
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
        org_logo = ""
        if self.organization:
            org_logo = getattr(self.organization, "logo", None) or ""

        context = {
            "first_name": first_name,
            "last_name": last_name,
            "full_name": f"{first_name} {last_name}",
            "username": username,
            "temp_password": temp_password,
            "organization_name": organization_name,
            "organization_logo": org_logo,
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
                        template, context, organization=self.organization
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

            context["organization_logo_img"] = self._build_logo_img()
            _raw_html_vars = {"organization_logo_img"}

            def _replace(text: str) -> str:
                def replacer(match):
                    var = match.group(1).strip()
                    value = str(context.get(var, match.group(0)))
                    if var in _raw_html_vars:
                        return value
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
            db=db,
            template_type="welcome",
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
        org_logo = ""
        if self.organization:
            org_logo = getattr(self.organization, "logo", None) or ""

        context = {
            "first_name": first_name,
            "reset_url": reset_url,
            "organization_name": organization_name,
            "organization_logo": org_logo,
            "expiry_minutes": str(expiry_minutes),
            # Keep legacy key for existing custom templates that reference it
            "expiry_hours": str(max(1, expiry_minutes // 60)),
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
                        template, context, organization=self.organization
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

            context["organization_logo_img"] = self._build_logo_img()
            _raw_html_vars = {"organization_logo_img"}

            def _replace(text: str) -> str:
                def replacer(match):
                    var = match.group(1).strip()
                    value = str(context.get(var, match.group(0)))
                    if var in _raw_html_vars:
                        return value
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
            db=db,
            template_type="password_reset",
        )

        return success_count > 0

    async def send_it_password_reset_notification(
        self,
        to_emails: List[str],
        user_email: str,
        user_name: str,
        organization_name: str,
        ip_address: Optional[str] = None,
        db: Optional[Any] = None,
        organization_id: Optional[str] = None,
    ) -> tuple[int, int]:
        """
        Notify IT team members that a password reset was requested.

        Args:
            to_emails: IT team member email addresses
            user_email: Email of the user who requested the reset
            user_name: Display name of the user
            organization_name: Organization name
            ip_address: IP address the request originated from
            db: Optional database session for loading templates
            organization_id: Optional org ID for loading templates

        Returns:
            Tuple of (success_count, failure_count)
        """
        timestamp = self._format_local_dt(datetime.now(timezone.utc))
        ip_display = ip_address or "Unknown"

        context = {
            "user_name": user_name,
            "user_email": user_email,
            "request_time": timestamp,
            "ip_address": ip_display,
            "organization_name": organization_name,
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
                    organization_id, EmailTemplateType.IT_PASSWORD_NOTIFICATION
                )
                if template:
                    subject, html_body, text_body = template_service.render(
                        template, context, organization=self.organization
                    )
            except Exception as e:
                logger.warning(
                    f"Failed to load IT password notification template, using default: {e}"
                )

        # Fall back to inline default if no template loaded
        if not subject:
            import re

            from app.services.email_template_service import (
                DEFAULT_CSS,
                DEFAULT_IT_PASSWORD_NOTIFICATION_HTML,
                DEFAULT_IT_PASSWORD_NOTIFICATION_SUBJECT,
                DEFAULT_IT_PASSWORD_NOTIFICATION_TEXT,
            )

            context["organization_logo_img"] = self._build_logo_img()
            subject = DEFAULT_IT_PASSWORD_NOTIFICATION_SUBJECT
            rendered_html = DEFAULT_IT_PASSWORD_NOTIFICATION_HTML
            rendered_text = DEFAULT_IT_PASSWORD_NOTIFICATION_TEXT
            for key, val in context.items():
                pattern = r"\{\{\s*" + re.escape(key) + r"\s*\}\}"
                subject = re.sub(pattern, str(val), subject)
                rendered_html = re.sub(pattern, str(val), rendered_html)
                rendered_text = re.sub(pattern, str(val), rendered_text)
            html_body = f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style></head><body>{rendered_html}</body></html>"
            text_body = rendered_text

        return await self.send_email(
            to_emails=to_emails,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            db=db,
            template_type="it_password_reset_notification",
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
        db: Optional[Any] = None,
        organization_id: Optional[str] = None,
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
            db: Optional database session for loading templates
            organization_id: Optional org ID for loading templates

        Returns:
            True if sent successfully
        """
        start_str = self._format_local_dt(event_start)
        end_str = self._format_local_dt(event_end, "%I:%M %p")

        context = {
            "recipient_name": recipient_name,
            "event_title": event_title,
            "event_type": event_type,
            "event_start": start_str,
            "event_end": end_str,
            "location_name": location_name or "",
            "location_details": location_details or "",
            "event_url": event_url or "",
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
                    organization_id, EmailTemplateType.EVENT_REMINDER
                )
                if template:
                    subject, html_body, text_body = template_service.render(
                        template, context, organization=self.organization
                    )
            except Exception as e:
                logger.warning(
                    f"Failed to load event reminder template, using default: {e}"
                )

        # Fall back to inline default if no template loaded
        if not subject:
            import re

            from app.services.email_template_service import (
                DEFAULT_CSS,
                DEFAULT_EVENT_REMINDER_HTML,
                DEFAULT_EVENT_REMINDER_SUBJECT,
                DEFAULT_EVENT_REMINDER_TEXT,
            )

            context["organization_logo_img"] = self._build_logo_img()
            subject = DEFAULT_EVENT_REMINDER_SUBJECT
            rendered_html = DEFAULT_EVENT_REMINDER_HTML
            rendered_text = DEFAULT_EVENT_REMINDER_TEXT
            for key, val in context.items():
                pattern = r"\{\{\s*" + re.escape(key) + r"\s*\}\}"
                subject = re.sub(pattern, str(val), subject)
                rendered_html = re.sub(pattern, str(val), rendered_html)
                rendered_text = re.sub(pattern, str(val), rendered_text)
            html_body = f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style></head><body>{rendered_html}</body></html>"
            text_body = rendered_text

        success_count, _ = await self.send_email(
            to_emails=[to_email],
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            db=db,
            template_type="event_reminder",
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
        coordinator_name: str = "",
        prospect_url: str = "",
        db: Optional[Any] = None,
        organization_id: Optional[str] = None,
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
            coordinator_name: Name of the pipeline coordinator
            prospect_url: Link to the prospect's profile
            db: Optional database session for loading templates
            organization_id: Optional org ID for loading templates
        """
        context = {
            "coordinator_name": coordinator_name or "Coordinator",
            "prospect_name": prospect_name,
            "days_inactive": str(days_inactive),
            "timeout_days": str(timeout_days),
            "pipeline_stage": current_stage,
            "organization_name": organization_name,
            "prospect_url": prospect_url,
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
                    organization_id, EmailTemplateType.INACTIVITY_WARNING
                )
                if template:
                    subject, html_body, text_body = template_service.render(
                        template, context, organization=self.organization
                    )
            except Exception as e:
                logger.warning(
                    f"Failed to load inactivity warning template, using default: {e}"
                )

        # Fall back to inline default if no template loaded
        if not subject:
            import re

            from app.services.email_template_service import (
                DEFAULT_CSS,
                DEFAULT_INACTIVITY_WARNING_HTML,
                DEFAULT_INACTIVITY_WARNING_SUBJECT,
                DEFAULT_INACTIVITY_WARNING_TEXT,
            )

            context["organization_logo_img"] = self._build_logo_img()
            subject = DEFAULT_INACTIVITY_WARNING_SUBJECT
            rendered_html = DEFAULT_INACTIVITY_WARNING_HTML
            rendered_text = DEFAULT_INACTIVITY_WARNING_TEXT
            for key, val in context.items():
                pattern = r"\{\{\s*" + re.escape(key) + r"\s*\}\}"
                subject = re.sub(pattern, str(val), subject)
                rendered_html = re.sub(pattern, str(val), rendered_html)
                rendered_text = re.sub(pattern, str(val), rendered_text)
            html_body = f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style></head><body>{rendered_html}</body></html>"
            text_body = rendered_text

        success_count, _ = await self.send_email(
            to_emails=to_emails,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            db=db,
            template_type="inactivity_warning",
        )

        return success_count > 0

    async def send_duplicate_application_email(
        self,
        to_email: str,
        applicant_name: str,
        organization_name: str,
        original_date: str,
        bcc_emails: Optional[List[str]] = None,
        db: Optional[Any] = None,
        organization_id: Optional[str] = None,
    ) -> bool:
        """
        Notify an applicant that a duplicate application was detected.

        The department's email is included as BCC so leadership is aware.

        Args:
            to_email: Applicant's email address
            applicant_name: Applicant's full name
            organization_name: Organization display name
            original_date: Formatted date of the original application
            bcc_emails: Department/org email(s) to BCC
            db: Optional database session for loading templates
            organization_id: Optional org ID for loading templates
        """
        context = {
            "applicant_name": applicant_name,
            "organization_name": organization_name,
            "original_date": original_date,
        }

        subject = None
        html_body = None
        text_body = None

        if db and organization_id:
            try:
                from app.models.email_template import EmailTemplateType
                from app.services.email_template_service import EmailTemplateService

                template_service = EmailTemplateService(db)
                template = await template_service.get_template(
                    organization_id, EmailTemplateType.DUPLICATE_APPLICATION
                )
                if template:
                    subject, html_body, text_body = template_service.render(
                        template, context, organization=self.organization
                    )
            except Exception as e:
                logger.warning(
                    f"Failed to load duplicate application template, using default: {e}"
                )

        if not subject:
            import re

            from app.services.email_template_service import (
                DEFAULT_CSS,
                DEFAULT_DUPLICATE_APPLICATION_HTML,
                DEFAULT_DUPLICATE_APPLICATION_SUBJECT,
                DEFAULT_DUPLICATE_APPLICATION_TEXT,
            )

            context["organization_logo_img"] = self._build_logo_img()
            subject = DEFAULT_DUPLICATE_APPLICATION_SUBJECT
            rendered_html = DEFAULT_DUPLICATE_APPLICATION_HTML
            rendered_text = DEFAULT_DUPLICATE_APPLICATION_TEXT
            for key, val in context.items():
                pattern = r"\{\{\s*" + re.escape(key) + r"\s*\}\}"
                subject = re.sub(pattern, str(val), subject)
                rendered_html = re.sub(pattern, str(val), rendered_html)
                rendered_text = re.sub(pattern, str(val), rendered_text)
            html_body = (
                f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style>"
                f"</head><body>{rendered_html}</body></html>"
            )
            text_body = rendered_text

        success_count, _ = await self.send_email(
            to_emails=[to_email],
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            bcc_emails=bcc_emails,
            db=db,
            template_type="duplicate_application",
        )

        return success_count > 0
