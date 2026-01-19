"""
Email Service

Handles sending emails using SMTP or organization-specific email service configuration.
"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Optional, Dict
from datetime import datetime

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

    def _get_smtp_config(self) -> Dict[str, any]:
        """
        Get SMTP configuration from organization settings or global config

        Priority:
        1. Organization-specific settings (if available)
        2. Global application settings
        """
        # Check if organization has custom email settings
        if self.organization and self.organization.settings:
            org_email_config = self.organization.settings.get('email_service', {})
            if org_email_config.get('enabled'):
                return {
                    'host': org_email_config.get('smtp_host'),
                    'port': org_email_config.get('smtp_port', 587),
                    'user': org_email_config.get('smtp_user'),
                    'password': org_email_config.get('smtp_password'),
                    'from_email': org_email_config.get('from_email'),
                    'from_name': org_email_config.get('from_name', self.organization.name),
                    'use_tls': org_email_config.get('use_tls', True),
                }

        # Fall back to global settings
        return {
            'host': settings.SMTP_HOST,
            'port': settings.SMTP_PORT,
            'user': settings.SMTP_USER,
            'password': settings.SMTP_PASSWORD,
            'from_email': settings.SMTP_FROM_EMAIL,
            'from_name': settings.SMTP_FROM_NAME,
            'use_tls': True,
        }

    async def send_email(
        self,
        to_emails: List[str],
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
    ) -> tuple[int, int]:
        """
        Send an email to one or more recipients

        Args:
            to_emails: List of recipient email addresses
            subject: Email subject line
            html_body: HTML email body
            text_body: Optional plain text version of email

        Returns:
            Tuple of (success_count, failure_count)
        """
        if not settings.EMAIL_ENABLED and not (self.organization and
                                                self.organization.settings.get('email_service', {}).get('enabled')):
            # Email not enabled, just log and return
            print(f"Email disabled. Would send to {len(to_emails)} recipients: {subject}")
            return 0, len(to_emails)

        success_count = 0
        failure_count = 0

        for to_email in to_emails:
            try:
                msg = MIMEMultipart('alternative')
                msg['From'] = f"{self._smtp_config['from_name']} <{self._smtp_config['from_email']}>"
                msg['To'] = to_email
                msg['Subject'] = subject
                msg['Date'] = datetime.utcnow().strftime('%a, %d %b %Y %H:%M:%S +0000')

                # Attach text and HTML versions
                if text_body:
                    part1 = MIMEText(text_body, 'plain')
                    msg.attach(part1)

                part2 = MIMEText(html_body, 'html')
                msg.attach(part2)

                # Send email
                with smtplib.SMTP(self._smtp_config['host'], self._smtp_config['port']) as server:
                    if self._smtp_config['use_tls']:
                        server.starttls()

                    if self._smtp_config['user'] and self._smtp_config['password']:
                        server.login(self._smtp_config['user'], self._smtp_config['password'])

                    server.send_message(msg)

                success_count += 1

            except Exception as e:
                print(f"Failed to send email to {to_email}: {str(e)}")
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
            <h1>{election_title}</h1>
        </div>
        <div class="content">
            <p>Hello {recipient_name},</p>

            <p>A ballot is now available for your review and vote.</p>

            {'<p><strong>Meeting Date:</strong> ' + meeting_date.strftime('%B %d, %Y at %I:%M %p') + '</p>' if meeting_date else ''}

            {f'<p>{custom_message}</p>' if custom_message else ''}

            {f'<p><a href="{ballot_url}" class="button">Cast Your Vote</a></p>' if ballot_url else ''}

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

{"Meeting Date: " + meeting_date.strftime('%B %d, %Y at %I:%M %p') if meeting_date else ''}

{custom_message if custom_message else ''}

{f"Cast your vote: {ballot_url}" if ballot_url else ''}

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
        )

        return success_count > 0
