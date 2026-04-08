"""
Email Service

Handles sending emails using SMTP or organization-specific email service configuration.
"""

import asyncio
import html as _html
import os
import re
import smtplib
import time
import uuid
from datetime import datetime, timezone
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from loguru import logger

from app.core.config import settings
from app.models.email_template import EmailTemplateType
from app.models.user import Organization
from app.schemas.organization import decrypt_settings_secrets
from app.services.email_template_service import DEFAULT_CSS, EmailTemplateService

# Header injection control characters that must never appear in
# RFC 5322 unstructured fields (Subject, From display-name, etc.).
_HEADER_INJECTION_RE = re.compile(r"[\r\n\x00]")


def _sanitize_header(value: str) -> str:
    """Strip CR/LF/NUL from an email header value to prevent injection."""
    return _HEADER_INJECTION_RE.sub("", value)


def _redact_email(address: str) -> str:
    """Redact an email address for safe logging (HIPAA)."""
    if "@" in address:
        local, domain = address.rsplit("@", 1)
        return f"{local[0]}***@{domain}" if local else f"***@{domain}"
    return "***"


def inline_email_css(html: str) -> str:
    """Inline ``<style>`` CSS into HTML element ``style=""`` attributes.

    Gmail and many email clients strip ``<style>`` blocks entirely, so
    class-based CSS never applies.  This function extracts rules from the
    first ``<style>`` block, converts simple selectors to inline styles,
    and removes the ``<style>`` block.

    Supported selectors:
    * ``body { ... }``
    * ``.classname { ... }``
    * ``.parent child { ... }`` (e.g. ``.header h1``, ``.content p``)
    """
    style_match = re.search(r"<style[^>]*>(.*?)</style>", html, re.DOTALL)
    if not style_match:
        return html
    css = style_match.group(1)

    # --- parse rules --------------------------------------------------
    class_styles: Dict[str, str] = {}
    child_styles: List[Tuple[str, str, str]] = []  # (parent_cls, child_tag, styles)

    for m in re.finditer(r"([^{}]+)\{([^}]+)\}", css):
        selector = m.group(1).strip()
        styles = re.sub(r"\s+", " ", m.group(2).strip()).rstrip(";") + ";"

        # body { ... }
        if selector == "body":
            html = _merge_body_style(html, styles)
            continue

        # .parent child { ... }  (e.g. .header h1)
        compound = re.match(r"^\.([\w-]+)\s+([\w]+)$", selector)
        if compound:
            child_styles.append((compound.group(1), compound.group(2), styles))
            continue

        # .classname { ... }
        simple = re.match(r"^\.([\w-]+)$", selector)
        if simple:
            class_styles[simple.group(1)] = styles

    # --- inline class styles ------------------------------------------
    def _replace_class(match: re.Match) -> str:
        tag = match.group(0)
        cls_m = re.search(r'class="([\w-]+)"', tag)
        if not cls_m or cls_m.group(1) not in class_styles:
            return tag
        return _add_style_to_tag(tag, class_styles[cls_m.group(1)])

    html = re.sub(
        r"<[a-zA-Z]\w*\b[^>]*\bclass=\"[\w-]+\"[^>]*/?>", _replace_class, html
    )

    # --- inline compound (parent > child) styles ----------------------
    for parent_cls, child_tag, styles in child_styles:
        # Find content inside elements with parent_cls and style child tags
        pattern = (
            r"(<[a-zA-Z]\w*\b[^>]*\bclass=\"" + re.escape(parent_cls) + r"\"[^>]*>)"
            r"(.*?)"
            r"(</[a-zA-Z]\w*>)"
        )

        def _replace_children(
            outer: re.Match, ctag: str = child_tag, cstyles: str = styles
        ) -> str:
            open_tag = outer.group(1)
            inner = outer.group(2)
            close_tag = outer.group(3)
            inner = re.sub(
                rf"<{ctag}\b([^>]*)>",
                lambda m: _add_style_to_tag(m.group(0), cstyles),
                inner,
            )
            return open_tag + inner + close_tag

        html = re.sub(pattern, _replace_children, html, flags=re.DOTALL)

    # --- remove <style> block -----------------------------------------
    html = re.sub(r"\s*<style[^>]*>.*?</style>\s*", "", html, flags=re.DOTALL)

    return html


def _merge_body_style(html: str, styles: str) -> str:
    """Add *styles* to the ``<body>`` tag, preserving existing inline styles."""
    body_m = re.search(r"<body\b([^>]*)>", html)
    if not body_m:
        return html
    attrs = body_m.group(1)
    existing = re.search(r'style="([^"]*)"', attrs)
    if existing:
        merged = f"{styles} {existing.group(1)}".strip()
        new_attrs = (
            attrs[: existing.start()] + f'style="{merged}"' + attrs[existing.end() :]
        )
    else:
        new_attrs = f'{attrs} style="{styles}"'
    return html[: body_m.start()] + f"<body{new_attrs}>" + html[body_m.end() :]


def _add_style_to_tag(tag: str, new_styles: str) -> str:
    """Add inline styles to an opening HTML tag.

    Existing inline styles take precedence (they are appended *after*
    the new class-derived styles so later declarations win).
    """
    existing_m = re.search(r'style="([^"]*)"', tag)
    if existing_m:
        merged = f"{new_styles} {existing_m.group(1)}".strip()
        return tag[: existing_m.start()] + f'style="{merged}"' + tag[existing_m.end() :]
    # Insert style before the closing > (or />)
    if tag.endswith("/>"):
        return tag[:-2] + f' style="{new_styles}" />'
    return tag[:-1] + f' style="{new_styles}">'


def build_email_logo_img(organization: Optional[Organization]) -> str:
    """Build a bare <img> tag for the org logo, or empty string.

    Use this when inserting into a template that already provides its own
    wrapper element (e.g. ``<div class="logo">{{organization_logo_img}}</div>``).

    Base64 data URIs are skipped because they can easily exceed Gmail's
    102 KB message-clipping threshold.
    """
    if not organization:
        return ""
    logo_url = getattr(organization, "logo", None) or ""
    if not logo_url:
        return ""
    # Data URIs embed the full image payload in the HTML, often 100–500 KB,
    # which pushes the email over Gmail's 102 KB clipping limit.
    if logo_url.startswith("data:"):
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

    def _make_message_id(self) -> str:
        """Generate a unique RFC 5322 Message-ID header value.

        Gmail and other strict SMTP servers reject messages without a
        Message-ID.  The format is ``<uuid@domain>``.
        """
        from_email = self._smtp_config.get("from_email", "")
        domain = from_email.split("@")[1] if "@" in from_email else "localhost"
        return f"<{uuid.uuid4()}@{domain}>"

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

    async def _render_with_fallback(
        self,
        template_type: EmailTemplateType,
        context: Dict[str, Any],
        db: Any = None,
        organization_id: Optional[str] = None,
        template: Any = None,
        default_subject: str = "",
        default_html: str = "",
        default_text: str = "",
    ) -> Tuple[str, str, Optional[str]]:
        """Load an admin template or fall back to built-in defaults.

        Centralises the pattern repeated across every ``send_*`` method:
        1. If a pre-loaded *template* is provided, render it.
        2. Else if *db* and *organization_id* are given, try loading from DB.
        3. Fall back to *default_subject* / *default_html* / *default_text*
           with proper HTML escaping via ``EmailTemplateService``.

        Returns ``(subject, html_body, text_body)``.
        """
        loaded = template

        if not loaded and db and organization_id:
            try:
                svc = EmailTemplateService(db)
                loaded = await svc.get_template(organization_id, template_type)
            except Exception as e:
                logger.warning(
                    "Failed to load %s template, using default: %s",
                    template_type.value,
                    e,
                )

        if loaded:
            return EmailTemplateService.render_static(
                loaded, context, organization=self.organization
            )

        context["organization_logo_img"] = self._build_logo_img()

        def _replace(text: str) -> str:
            def replacer(match: re.Match) -> str:
                var = match.group(1).strip()
                value = str(context.get(var, match.group(0)))
                if var in EmailTemplateService._RAW_HTML_VARIABLES:
                    return value
                return _html.escape(value)

            return re.sub(r"\{\{(\s*\w+\s*)\}\}", replacer, text)

        subject = _replace(default_subject)
        html_body = (
            f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style>"
            f"</head><body>{_replace(default_html)}</body></html>"
        )
        text_body = _replace(default_text)
        return subject, html_body, text_body

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

    def _get_ehlo_hostname(self) -> str:
        """Return the hostname used for SMTP EHLO/HELO.

        Priority:
        1. ``SMTP_EHLO_HOSTNAME`` from config
        2. Organization-specific SMTP host (if org email settings are active)
        3. Domain portion of the ``from_email`` address

        Microsoft's Enhanced Filtering rejects connections whose EHLO
        hostname doesn't resolve in DNS, so using the actual sending
        domain is critical.
        """
        # Explicit config takes top priority
        explicit = getattr(settings, "SMTP_EHLO_HOSTNAME", None)
        if explicit:
            return explicit
        from_email = self._smtp_config.get("from_email", "")
        if "@" in from_email:
            return from_email.split("@")[1]
        return "localhost"

    def _smtp_connect(self) -> smtplib.SMTP:
        """Create an authenticated SMTP connection (synchronous)."""
        import ssl

        host = self._smtp_config["host"]
        port = self._smtp_config["port"]
        encryption = self._smtp_config.get("encryption", "tls")

        if not host or not self._smtp_config.get("from_email"):
            raise ValueError("SMTP host and from_email are required")

        timeout = 30
        context = ssl.create_default_context()
        ehlo_hostname = self._get_ehlo_hostname()

        if encryption == "ssl":
            server = smtplib.SMTP_SSL(
                host,
                port,
                local_hostname=ehlo_hostname,
                context=context,
                timeout=timeout,
            )
        elif encryption in ("tls", "starttls"):
            server = smtplib.SMTP(
                host, port, local_hostname=ehlo_hostname, timeout=timeout
            )
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
        else:
            server = smtplib.SMTP(
                host, port, local_hostname=ehlo_hostname, timeout=timeout
            )
            server.ehlo()

        if self._smtp_config["user"] and self._smtp_config["password"]:
            server.login(
                self._smtp_config["user"],
                self._smtp_config["password"],
            )
        logger.info(
            "SMTP connected host=%s port=%s encryption=%s auth=%s",
            host,
            port,
            encryption,
            bool(self._smtp_config["user"]),
        )
        return server

    def _smtp_send(self, recipients: List[str], message: str) -> None:
        """Synchronous SMTP send — called via asyncio.to_thread."""
        server = self._smtp_connect()
        try:
            server.sendmail(
                self._smtp_config["from_email"],
                recipients,
                message,
            )
        finally:
            server.quit()

    def _smtp_send_batch(self, messages: List[Tuple[List[str], str]]) -> List[bool]:
        """Send multiple emails through a single SMTP connection.

        Includes rate-limit mitigation:
        * ``RSET`` between messages to cleanly reset the envelope
        * 0.25 s pause between sends to stay within provider rate limits
        * Automatic reconnection if the server drops the connection
        """
        server = self._smtp_connect()
        results: List[bool] = []
        from_email = self._smtp_config["from_email"]
        try:
            for idx, (recipients, msg_str) in enumerate(messages):
                try:
                    server.sendmail(from_email, recipients, msg_str)
                    results.append(True)
                except smtplib.SMTPServerDisconnected:
                    # Server dropped the connection (rate limit, timeout,
                    # etc.) — reconnect and retry this message once.
                    logger.warning(
                        "SMTP server disconnected during batch send, reconnecting"
                    )
                    try:
                        server = self._smtp_connect()
                        server.sendmail(from_email, recipients, msg_str)
                        results.append(True)
                    except Exception as e2:
                        logger.error("Batch email retry failed: %s", e2)
                        results.append(False)
                except smtplib.SMTPResponseException as e:
                    logger.error(
                        "Batch email rejected (code=%s): %s", e.smtp_code, e.smtp_error
                    )
                    results.append(False)
                    # 421/451/452 = rate limit / too many connections
                    if e.smtp_code in (421, 451, 452):
                        logger.warning("Rate limit detected, reconnecting after 2 s")
                        time.sleep(2)
                        try:
                            server.quit()
                        except Exception:
                            pass
                        server = self._smtp_connect()
                except Exception as e:
                    logger.error("Batch email send failed: %s", e)
                    results.append(False)

                # Brief pause between messages to avoid rate limiting
                if idx < len(messages) - 1:
                    try:
                        server.rset()
                    except Exception:
                        pass
                    time.sleep(0.25)
        finally:
            try:
                server.quit()
            except Exception:
                pass
        succeeded = sum(1 for r in results if r)
        logger.info("Batch send complete: %d/%d succeeded", succeeded, len(results))
        return results

    def build_message(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None,
        reply_to: Optional[str] = None,
        list_unsubscribe: Optional[str] = None,
    ) -> Tuple[List[str], str]:
        """Build a MIME email message without sending.

        Args:
            reply_to: Optional Reply-To email address.
            list_unsubscribe: Optional List-Unsubscribe URL (RFC 8058).
                Required by Gmail/Microsoft for bulk email.

        Returns ``(all_recipients, mime_message_string)``.
        """
        html_body = inline_email_css(html_body)

        msg = MIMEMultipart("alternative")
        if text_body:
            msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        safe_from_name = _sanitize_header(self._smtp_config["from_name"])
        safe_subject = _sanitize_header(subject)

        msg["From"] = f"{safe_from_name} <{self._smtp_config['from_email']}>"
        msg["To"] = to_email
        msg["Subject"] = safe_subject
        msg["Date"] = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
        msg["Message-ID"] = self._make_message_id()
        msg["MIME-Version"] = "1.0"
        msg["X-Auto-Response-Suppress"] = "OOF, DR, RN, NRN, AutoReply"
        if reply_to:
            msg["Reply-To"] = reply_to
        if list_unsubscribe:
            msg["List-Unsubscribe"] = f"<{list_unsubscribe}>"
            msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

        all_recipients = [to_email]
        if cc_emails:
            msg["Cc"] = ", ".join(cc_emails)
            all_recipients.extend(cc_emails)
        if bcc_emails:
            all_recipients.extend(bcc_emails)

        return all_recipients, msg.as_string()

    async def send_batch(self, messages: List[Tuple[List[str], str]]) -> List[bool]:
        """Send pre-built messages through a single SMTP connection.

        Each item is ``(all_recipients, mime_message_string)`` as returned
        by :meth:`build_message`.
        """
        if not messages:
            return []
        if not settings.EMAIL_ENABLED and not (
            self.organization
            and (self.organization.settings or {})
            .get("email_service", {})
            .get("enabled")
        ):
            logger.info("Email disabled. Would batch-send %d messages.", len(messages))
            return [False] * len(messages)
        return await asyncio.to_thread(self._smtp_send_batch, messages)

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
        reply_to: Optional[str] = None,
        list_unsubscribe: Optional[str] = None,
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
                "Email disabled. Would send to %d recipients: %s",
                len(to_emails),
                subject,
            )
            return 0, len(to_emails)

        # Inline CSS: convert <style> class rules to inline style=""
        # attributes so they survive Gmail's <style> stripping.
        html_body = inline_email_css(html_body)

        safe_from_name = _sanitize_header(self._smtp_config["from_name"])
        safe_subject = _sanitize_header(subject)

        # Pre-read attachment payloads once (avoids re-reading per recipient)
        attachment_parts: List[MIMEBase] = []
        for filepath in attachment_paths or []:
            resolved = os.path.realpath(filepath)
            if not os.path.isfile(resolved):
                logger.warning("Attachment not found, skipping")
                continue
            with open(resolved, "rb") as f:
                part = MIMEBase("application", "octet-stream")
                part.set_payload(f.read())
            encoders.encode_base64(part)
            filename = _sanitize_header(os.path.basename(resolved))
            part.add_header(
                "Content-Disposition", "attachment", filename=filename
            )
            attachment_parts.append(part)

        # Build one MIME message per recipient
        batch: List[Tuple[List[str], str]] = []
        for to_email in to_emails:
            try:
                if attachment_parts:
                    msg = MIMEMultipart("mixed")
                    alt_part = MIMEMultipart("alternative")
                    if text_body:
                        alt_part.attach(MIMEText(text_body, "plain", "utf-8"))
                    alt_part.attach(MIMEText(html_body, "html", "utf-8"))
                    msg.attach(alt_part)
                    for part in attachment_parts:
                        msg.attach(part)
                else:
                    msg = MIMEMultipart("alternative")
                    if text_body:
                        msg.attach(MIMEText(text_body, "plain", "utf-8"))
                    msg.attach(MIMEText(html_body, "html", "utf-8"))

                msg["From"] = f"{safe_from_name} <{self._smtp_config['from_email']}>"
                msg["To"] = to_email
                msg["Subject"] = safe_subject
                msg["Date"] = datetime.now(timezone.utc).strftime(
                    "%a, %d %b %Y %H:%M:%S +0000"
                )
                msg["Message-ID"] = self._make_message_id()
                msg["MIME-Version"] = "1.0"
                msg["X-Auto-Response-Suppress"] = "OOF, DR, RN, NRN, AutoReply"
                if reply_to:
                    msg["Reply-To"] = reply_to
                if list_unsubscribe:
                    msg["List-Unsubscribe"] = f"<{list_unsubscribe}>"
                    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

                all_recipients = [to_email]
                if cc_emails:
                    msg["Cc"] = ", ".join(cc_emails)
                    all_recipients.extend(cc_emails)
                if bcc_emails:
                    all_recipients.extend(bcc_emails)

                batch.append((all_recipients, msg.as_string()))
            except Exception as e:
                logger.error(f"Failed to build email for {_redact_email(to_email)}: {e}")

        # Send through a single SMTP connection when possible
        if len(batch) == 1:
            try:
                await asyncio.to_thread(self._smtp_send, batch[0][0], batch[0][1])
                results = [True]
            except Exception as e:
                logger.error(
                    "Failed to send email to %s: %s",
                    _redact_email(to_emails[0] if to_emails else "?"),
                    e,
                )
                results = [False]
        elif batch:
            results = await asyncio.to_thread(self._smtp_send_batch, batch)
        else:
            results = []

        success_count = sum(1 for r in results if r)
        failure_count = len(to_emails) - success_count

        logger.info(
            f"Email send complete: {success_count} succeeded, "
            f"{failure_count} failed, subject={subject[:80]!r}, "
            f"template={template_type or 'none'}"
        )

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
                logger.warning("Failed to log message history: %s", e)

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

    async def render_ballot_notification(
        self,
        recipient_name: str,
        election_title: str,
        ballot_url: Optional[str],
        meeting_date: Optional[datetime],
        custom_message: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        positions: Optional[List[str]] = None,
        ballot_items_html: str = "",
        ballot_items_text: str = "",
        admin_contact_name: str = "",
        admin_contact_email: str = "",
        template: Any = None,
    ) -> Tuple[str, str, Optional[str]]:
        """Render ballot notification email content without sending.

        If *template* (an ``EmailTemplate`` instance) is provided it is
        used; otherwise the built-in default template is rendered.

        Returns ``(subject, html_body, text_body)``.
        """
        from app.services.email_template_service import (
            DEFAULT_BALLOT_NOTIFICATION_HTML,
            DEFAULT_BALLOT_NOTIFICATION_SUBJECT,
            DEFAULT_BALLOT_NOTIFICATION_TEXT,
        )

        org_name = getattr(self.organization, "name", "") if self.organization else ""
        org_logo = (
            (getattr(self.organization, "logo", None) or "")
            if self.organization
            else ""
        )

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

        return await self._render_with_fallback(
            template_type=EmailTemplateType.BALLOT_NOTIFICATION,
            context=context,
            template=template,
            default_subject=DEFAULT_BALLOT_NOTIFICATION_SUBJECT,
            default_html=DEFAULT_BALLOT_NOTIFICATION_HTML,
            default_text=DEFAULT_BALLOT_NOTIFICATION_TEXT,
        )

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
        template: Any = None,
    ) -> bool:
        """
        Send a ballot notification email.

        When *template* is provided the DB lookup is skipped.  Pass
        ``db`` / ``organization_id`` only when no pre-loaded template is
        available (they trigger a per-call DB query).

        Returns:
            True if sent successfully
        """
        from app.services.email_template_service import (
            DEFAULT_BALLOT_NOTIFICATION_HTML,
            DEFAULT_BALLOT_NOTIFICATION_SUBJECT,
            DEFAULT_BALLOT_NOTIFICATION_TEXT,
        )

        org_name = getattr(self.organization, "name", "") if self.organization else ""
        org_logo = (
            (getattr(self.organization, "logo", None) or "")
            if self.organization
            else ""
        )

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

        subject, html_body, text_body = await self._render_with_fallback(
            template_type=EmailTemplateType.BALLOT_NOTIFICATION,
            context=context,
            db=db,
            organization_id=organization_id,
            template=template,
            default_subject=DEFAULT_BALLOT_NOTIFICATION_SUBJECT,
            default_html=DEFAULT_BALLOT_NOTIFICATION_HTML,
            default_text=DEFAULT_BALLOT_NOTIFICATION_TEXT,
        )

        success_count, _ = await self.send_email(
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
        from app.services.email_template_service import (
            DEFAULT_ELECTION_REPORT_HTML,
            DEFAULT_ELECTION_REPORT_SUBJECT,
            DEFAULT_ELECTION_REPORT_TEXT,
        )

        org_name = getattr(self.organization, "name", "") if self.organization else ""

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

        subject, html_body, text_body = await self._render_with_fallback(
            template_type=EmailTemplateType.ELECTION_REPORT,
            context=context,
            db=db,
            organization_id=organization_id,
            default_subject=DEFAULT_ELECTION_REPORT_SUBJECT,
            default_html=DEFAULT_ELECTION_REPORT_HTML,
            default_text=DEFAULT_ELECTION_REPORT_TEXT,
        )

        return await self.send_email(
            to_emails=to_emails,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            cc_emails=cc_emails,
            db=db,
            template_type="election_report",
        )

    async def send_eligibility_summary(
        self,
        to_emails: List[str],
        recipient_name: str,
        election_title: str,
        sent_count: int,
        skipped_count: int,
        total_checked_in: int,
        recipients_html: str,
        recipients_text: str,
        skipped_voters_html: str,
        skipped_voters_text: str,
        cc_emails: Optional[List[str]] = None,
        db: Any = None,
        organization_id: Optional[str] = None,
    ) -> tuple[int, int]:
        """
        Send a ballot eligibility summary email to the secretary after
        ballot emails are dispatched.

        Lists who received ballots and who was skipped with reasons.

        Returns:
            Tuple of (success_count, failure_count)
        """
        from app.services.email_template_service import (
            DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_HTML,
            DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_SUBJECT,
            DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_TEXT,
        )

        org_name = getattr(self.organization, "name", "") if self.organization else ""

        context = {
            "recipient_name": recipient_name,
            "election_title": election_title,
            "sent_count": str(sent_count),
            "skipped_count": str(skipped_count),
            "total_checked_in": str(total_checked_in),
            "recipients_html": recipients_html,
            "recipients_text": recipients_text,
            "skipped_voters_html": skipped_voters_html,
            "skipped_voters_text": skipped_voters_text,
            "organization_name": org_name,
        }

        subject, html_body, text_body = await self._render_with_fallback(
            template_type=EmailTemplateType.BALLOT_ELIGIBILITY_SUMMARY,
            context=context,
            db=db,
            organization_id=organization_id,
            default_subject=DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_SUBJECT,
            default_html=DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_HTML,
            default_text=DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_TEXT,
        )

        return await self.send_email(
            to_emails=to_emails,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            cc_emails=cc_emails,
            db=db,
            template_type="ballot_eligibility_summary",
        )

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
        Send training approval request notification to training officers.

        Returns:
            Tuple of (success_count, failure_count)
        """
        from app.services.email_template_service import (
            DEFAULT_TRAINING_APPROVAL_HTML,
            DEFAULT_TRAINING_APPROVAL_SUBJECT,
            DEFAULT_TRAINING_APPROVAL_TEXT,
        )

        context = {
            "course_name": course_name,
            "event_title": event_title,
            "event_date": self._format_local_dt(event_date),
            "attendee_count": str(attendee_count),
            "approval_deadline": self._format_local_dt(approval_deadline),
            "submitter_name": submitter_name or "",
            "approval_url": approval_url,
        }

        subject, html_body, text_body = await self._render_with_fallback(
            template_type=EmailTemplateType.TRAINING_APPROVAL,
            context=context,
            db=db,
            organization_id=organization_id,
            default_subject=DEFAULT_TRAINING_APPROVAL_SUBJECT,
            default_html=DEFAULT_TRAINING_APPROVAL_HTML,
            default_text=DEFAULT_TRAINING_APPROVAL_TEXT,
        )

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

        Returns:
            True if sent successfully
        """
        from app.services.email_template_service import (
            DEFAULT_WELCOME_HTML,
            DEFAULT_WELCOME_SUBJECT,
            DEFAULT_WELCOME_TEXT,
        )

        org_logo = (
            (getattr(self.organization, "logo", None) or "")
            if self.organization
            else ""
        )

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

        # Welcome template supports attachments stored on the template itself
        loaded_template = None
        if db and organization_id:
            try:
                svc = EmailTemplateService(db)
                loaded_template = await svc.get_template(
                    organization_id, EmailTemplateType.WELCOME
                )
                if loaded_template and loaded_template.allow_attachments and loaded_template.attachments:
                    stored_paths = [a.storage_path for a in loaded_template.attachments]
                    attachment_paths = (attachment_paths or []) + stored_paths
            except Exception as e:
                logger.warning(
                    "Failed to load welcome email template, using default: %s", e
                )

        subject, html_body, text_body = await self._render_with_fallback(
            template_type=EmailTemplateType.WELCOME,
            context=context,
            template=loaded_template,
            default_subject=DEFAULT_WELCOME_SUBJECT,
            default_html=DEFAULT_WELCOME_HTML,
            default_text=DEFAULT_WELCOME_TEXT,
        )

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

        Returns:
            True if sent successfully
        """
        from app.services.email_template_service import (
            DEFAULT_PASSWORD_RESET_HTML,
            DEFAULT_PASSWORD_RESET_SUBJECT,
            DEFAULT_PASSWORD_RESET_TEXT,
        )

        org_logo = (
            (getattr(self.organization, "logo", None) or "")
            if self.organization
            else ""
        )

        context = {
            "first_name": first_name,
            "reset_url": reset_url,
            "organization_name": organization_name,
            "organization_logo": org_logo,
            "expiry_minutes": str(expiry_minutes),
            # Keep legacy key for existing custom templates that reference it
            "expiry_hours": str(max(1, expiry_minutes // 60)),
        }

        subject, html_body, text_body = await self._render_with_fallback(
            template_type=EmailTemplateType.PASSWORD_RESET,
            context=context,
            db=db,
            organization_id=organization_id,
            default_subject=DEFAULT_PASSWORD_RESET_SUBJECT,
            default_html=DEFAULT_PASSWORD_RESET_HTML,
            default_text=DEFAULT_PASSWORD_RESET_TEXT,
        )

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

        Returns:
            Tuple of (success_count, failure_count)
        """
        from app.services.email_template_service import (
            DEFAULT_IT_PASSWORD_NOTIFICATION_HTML,
            DEFAULT_IT_PASSWORD_NOTIFICATION_SUBJECT,
            DEFAULT_IT_PASSWORD_NOTIFICATION_TEXT,
        )

        context = {
            "user_name": user_name,
            "user_email": user_email,
            "request_time": self._format_local_dt(datetime.now(timezone.utc)),
            "ip_address": ip_address or "Unknown",
            "organization_name": organization_name,
        }

        subject, html_body, text_body = await self._render_with_fallback(
            template_type=EmailTemplateType.IT_PASSWORD_NOTIFICATION,
            context=context,
            db=db,
            organization_id=organization_id,
            default_subject=DEFAULT_IT_PASSWORD_NOTIFICATION_SUBJECT,
            default_html=DEFAULT_IT_PASSWORD_NOTIFICATION_HTML,
            default_text=DEFAULT_IT_PASSWORD_NOTIFICATION_TEXT,
        )

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

        Returns:
            True if sent successfully
        """
        from app.services.email_template_service import (
            DEFAULT_EVENT_REMINDER_HTML,
            DEFAULT_EVENT_REMINDER_SUBJECT,
            DEFAULT_EVENT_REMINDER_TEXT,
        )

        context = {
            "recipient_name": recipient_name,
            "event_title": event_title,
            "event_type": event_type,
            "event_start": self._format_local_dt(event_start),
            "event_end": self._format_local_dt(event_end, "%I:%M %p"),
            "location_name": location_name or "",
            "location_details": location_details or "",
            "event_url": event_url or "",
        }

        subject, html_body, text_body = await self._render_with_fallback(
            template_type=EmailTemplateType.EVENT_REMINDER,
            context=context,
            db=db,
            organization_id=organization_id,
            default_subject=DEFAULT_EVENT_REMINDER_SUBJECT,
            default_html=DEFAULT_EVENT_REMINDER_HTML,
            default_text=DEFAULT_EVENT_REMINDER_TEXT,
        )

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
        """Send an inactivity warning email to coordinator(s) about a stalled prospect."""
        from app.services.email_template_service import (
            DEFAULT_INACTIVITY_WARNING_HTML,
            DEFAULT_INACTIVITY_WARNING_SUBJECT,
            DEFAULT_INACTIVITY_WARNING_TEXT,
        )

        context = {
            "coordinator_name": coordinator_name or "Coordinator",
            "prospect_name": prospect_name,
            "days_inactive": str(days_inactive),
            "timeout_days": str(timeout_days),
            "pipeline_stage": current_stage,
            "organization_name": organization_name,
            "prospect_url": prospect_url,
        }

        subject, html_body, text_body = await self._render_with_fallback(
            template_type=EmailTemplateType.INACTIVITY_WARNING,
            context=context,
            db=db,
            organization_id=organization_id,
            default_subject=DEFAULT_INACTIVITY_WARNING_SUBJECT,
            default_html=DEFAULT_INACTIVITY_WARNING_HTML,
            default_text=DEFAULT_INACTIVITY_WARNING_TEXT,
        )

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
        """Notify an applicant that a duplicate application was detected."""
        from app.services.email_template_service import (
            DEFAULT_DUPLICATE_APPLICATION_HTML,
            DEFAULT_DUPLICATE_APPLICATION_SUBJECT,
            DEFAULT_DUPLICATE_APPLICATION_TEXT,
        )

        context = {
            "applicant_name": applicant_name,
            "organization_name": organization_name,
            "original_date": original_date,
        }

        subject, html_body, text_body = await self._render_with_fallback(
            template_type=EmailTemplateType.DUPLICATE_APPLICATION,
            context=context,
            db=db,
            organization_id=organization_id,
            default_subject=DEFAULT_DUPLICATE_APPLICATION_SUBJECT,
            default_html=DEFAULT_DUPLICATE_APPLICATION_HTML,
            default_text=DEFAULT_DUPLICATE_APPLICATION_TEXT,
        )

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
