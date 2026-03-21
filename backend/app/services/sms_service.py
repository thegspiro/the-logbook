"""
SMS Service

Lightweight wrapper around Twilio for sending SMS notifications.
Only sends if TWILIO_ENABLED is True and credentials are configured.
"""

import logging
from typing import List

logger = logging.getLogger(__name__)


class SMSService:
    """Send SMS messages via Twilio."""

    def __init__(self):
        from app.core.config import settings

        self.enabled = settings.TWILIO_ENABLED
        self.account_sid = settings.TWILIO_ACCOUNT_SID
        self.auth_token = settings.TWILIO_AUTH_TOKEN
        self.from_number = settings.TWILIO_PHONE_NUMBER
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from twilio.rest import Client

                self._client = Client(self.account_sid, self.auth_token)
            except ImportError:
                logger.warning("twilio package not installed — SMS disabled")
                self.enabled = False
                return None
            except Exception as e:
                logger.error(f"Failed to initialize Twilio client: {e}")
                self.enabled = False
                return None
        return self._client

    async def send_sms(self, to_number: str, body: str) -> bool:
        """Send a single SMS message. Returns True on success."""
        if not self.enabled or not self.from_number:
            logger.debug("SMS not enabled — skipping send")
            return False

        client = self._get_client()
        if not client:
            return False

        try:
            message = client.messages.create(
                body=body,
                from_=self.from_number,
                to=to_number,
            )
            logger.info(f"SMS sent to {to_number}: SID={message.sid}")
            return True
        except Exception as e:
            logger.error(f"Failed to send SMS to {to_number}: {e}")
            return False

    async def send_bulk_sms(self, phone_numbers: List[str], body: str) -> int:
        """Send the same SMS to multiple numbers. Returns count of successful sends."""
        sent = 0
        for number in phone_numbers:
            if await self.send_sms(number, body):
                sent += 1
        return sent
