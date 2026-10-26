"""Sending through the Gmail API as a domain-wide delegated service account.

The SMTP sender's sibling for Gmail departments on the service-account method
(``app.utils.google_oauth`` explains why that method uses the API rather than
SMTP). It takes the same ``(recipients, mime)`` pairs ``_smtp_send_batch``
does, so every message is built by the same code whichever transport carries
it, and it answers the same way: one ``bool`` per message, in order, never
raising.

Two things differ from SMTP and are handled here:

* **Recipients come from the headers.** SMTP is handed the envelope recipient
  list separately, which is how a Bcc address reaches the server without
  appearing in the message. The Gmail API has no envelope: it delivers to the
  To, Cc and Bcc headers of the message it is given, and strips the Bcc
  header before delivery. So any recipient not already named in To or Cc is
  added as a Bcc header, or a Bcc recipient would silently receive nothing.
* **Limits are HTTP responses, not SMTP replies.** A throttle that asks the
  caller to wait a moment is retried once, as a 421 is; one that asks for
  longer than a batch can wait, or names a daily limit, ends the batch, as
  Gmail's 5.4.5 does, because every later message would be refused too.
"""

import asyncio
from datetime import datetime, timezone
from email.parser import HeaderParser
from email.utils import getaddresses, parsedate_to_datetime
from enum import Enum
from typing import Any, List, Optional, Sequence, Tuple

from loguru import logger

from app.utils.google_oauth import GoogleOAuthError, acquire_gmail_send_token

# The upload form of users.messages.send takes the RFC 822 message as the
# request body (up to 35 MB), so no base64 step is needed. "me" is the user
# the delegated token was issued for — the From address.
GMAIL_SEND_URL = (
    "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send"
    "?uploadType=media"
)

GMAIL_REQUEST_TIMEOUT_SECONDS = 30

# Pause between messages. Gmail meters sending per user; pacing keeps a large
# batch from spending its one retry per message on throttles it caused itself.
GMAIL_SEND_PACE_SECONDS = 0.4

# A throttle asking for a longer wait than this is treated as the account's
# limit being reached, not as a moment's congestion: a ballot batch cannot
# sit for an hour per message, and every message after it would be refused.
GMAIL_MAX_RETRY_WAIT_SECONDS = 60

_DEFAULT_RETRY_WAIT_SECONDS = 2.0

# Error reasons Google uses for rate limits on the Gmail API. Matched only to
# decide whether a 403 is a throttle (retry) or a refusal (stop); a 429 is a
# throttle whatever its reason.
_RATE_LIMIT_REASONS = frozenset({"rateLimitExceeded", "userRateLimitExceeded"})


class _Outcome(Enum):
    SENT = "sent"
    FAILED = "failed"  # this message only; the batch continues
    RETRY = "retry"  # transient; retried once
    STOP = "stop"  # nothing later in the batch can succeed


def with_bcc_header(recipients: Sequence[str], mime: str) -> str:
    """The message with a Bcc header naming recipients not in To or Cc.

    The header is prepended rather than spliced in, which RFC 5322 allows
    (header order carries no meaning) and which leaves the rest of the
    message byte-for-byte as built.
    """
    headers = HeaderParser().parsestr(mime, headersonly=True)
    shown = {
        address.lower()
        for _, address in getaddresses(
            headers.get_all("To", []) + headers.get_all("Cc", [])
        )
        if address
    }
    hidden: List[str] = []
    for recipient in recipients:
        address = recipient.replace("\r", "").replace("\n", "").strip()
        if address and address.lower() not in shown and address not in hidden:
            hidden.append(address)
    if not hidden:
        return mime
    return f"Bcc: {', '.join(hidden)}\n{mime}"


def _error_reasons(body: Any) -> Tuple[List[str], str]:
    """The ``errors[].reason`` codes and top-level message of an error body."""
    if not isinstance(body, dict):
        return [], ""
    error = body.get("error")
    if not isinstance(error, dict):
        return [], ""
    reasons = [
        str(item.get("reason"))
        for item in error.get("errors") or []
        if isinstance(item, dict) and item.get("reason")
    ]
    return reasons, str(error.get("message") or "")


def _retry_wait_seconds(response: Any, message: str) -> float:
    """How long Google asked the caller to wait before trying again.

    Read from ``Retry-After`` (seconds or an HTTP date) or, failing that, from
    the "Retry after <timestamp>" Gmail puts in the error message when a user
    has hit a sending limit. Unparseable or absent means a short default.
    """
    header = response.headers.get("Retry-After")
    if header:
        try:
            return max(0.0, float(header))
        except ValueError:
            try:
                when = parsedate_to_datetime(header)
                return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())
            except (TypeError, ValueError):
                pass
    marker = "retry after "
    lowered = message.lower()
    if marker in lowered:
        stamp = message[lowered.index(marker) + len(marker) :].split()[0]
        try:
            when = datetime.fromisoformat(stamp.rstrip(".").replace("Z", "+00:00"))
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())
        except ValueError:
            pass
    return _DEFAULT_RETRY_WAIT_SECONDS


def _classify(response: Any) -> Tuple[_Outcome, float, str]:
    """What a Gmail API response means for this message and the batch.

    Returns the outcome, the wait before a retry, and a short reason for the
    log. The reason is Google's error code, never its message, which can
    quote the sending address.
    """
    status = response.status_code
    if 200 <= status < 300:
        return _Outcome.SENT, 0.0, "sent"
    try:
        body = response.json()
    except ValueError:
        body = None
    reasons, message = _error_reasons(body)
    reason = ",".join(reasons) or str(status)

    if status == 429 or (status == 403 and _RATE_LIMIT_REASONS & set(reasons)):
        if "daily" in message.lower() or "dailyLimitExceeded" in reasons:
            return _Outcome.STOP, 0.0, f"sending limit ({reason})"
        wait = _retry_wait_seconds(response, message)
        if wait > GMAIL_MAX_RETRY_WAIT_SECONDS:
            return _Outcome.STOP, 0.0, f"sending limit, retry in {int(wait)}s"
        return _Outcome.RETRY, wait, f"throttled ({reason})"
    if status in (401, 403):
        # The token was refused, or the account may not send (delegation
        # withdrawn, the user suspended). Every later message would get the
        # same answer.
        return _Outcome.STOP, 0.0, f"refused ({status} {reason})"
    if status >= 500:
        return _Outcome.RETRY, _DEFAULT_RETRY_WAIT_SECONDS, f"server error {status}"
    # 400 (a message Gmail cannot parse), 413 (too large): this one only.
    return _Outcome.FAILED, 0.0, f"rejected ({status} {reason})"


class GmailApiSender:
    """Send pre-built MIME messages as one Workspace user."""

    def __init__(self, service_account_key: str, from_email: str) -> None:
        self._key = service_account_key
        self._from_email = from_email

    async def _token(self) -> str:
        # Asked per message: the credential is cached, so this only requests
        # a token when the last one expired, which a long batch can outlast.
        return await asyncio.to_thread(
            acquire_gmail_send_token, self._key, self._from_email
        )

    async def _post(
        self, client: Any, token: str, mime: str
    ) -> Tuple[_Outcome, float, str]:
        import httpx

        try:
            response = await client.post(
                GMAIL_SEND_URL,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "message/rfc822",
                },
                content=mime.encode("utf-8"),
            )
        except httpx.HTTPError as e:
            return _Outcome.RETRY, _DEFAULT_RETRY_WAIT_SECONDS, type(e).__name__
        return _classify(response)

    async def send(self, messages: Sequence[Tuple[List[str], str]]) -> List[bool]:
        """Send each message in order. One result per message; never raises."""
        import httpx

        if not messages:
            return []
        results: List[bool] = []
        stop_reason: Optional[str] = None
        try:
            async with httpx.AsyncClient(
                timeout=GMAIL_REQUEST_TIMEOUT_SECONDS
            ) as client:
                for idx, (recipients, mime) in enumerate(messages):
                    try:
                        token = await self._token()
                    except GoogleOAuthError as e:
                        logger.error("Gmail API token unavailable: {}", e)
                        stop_reason = "no token"
                        break

                    raw = with_bcc_header(recipients, mime)
                    outcome, wait, reason = await self._post(client, token, raw)
                    if outcome is _Outcome.RETRY:
                        logger.warning(
                            "Gmail API message {} {}; retrying in {:.1f}s",
                            idx,
                            reason,
                            wait,
                        )
                        await asyncio.sleep(wait)
                        outcome, wait, reason = await self._post(client, token, raw)
                        if outcome is _Outcome.RETRY:
                            outcome = _Outcome.FAILED

                    results.append(outcome is _Outcome.SENT)
                    if outcome is _Outcome.STOP:
                        stop_reason = reason
                        break
                    if outcome is _Outcome.FAILED:
                        logger.error("Gmail API message {} not sent: {}", idx, reason)

                    if idx < len(messages) - 1:
                        await asyncio.sleep(GMAIL_SEND_PACE_SECONDS)
        except Exception as e:
            # Results gathered so far are kept: raising here would make the
            # caller report messages already delivered as failed.
            logger.error("Gmail API batch send failed: {}", type(e).__name__)
            stop_reason = stop_reason or "unexpected error"

        if stop_reason:
            skipped = len(messages) - len(results)
            logger.error(
                "Gmail API batch stopped ({}); {} message(s) not attempted",
                stop_reason,
                skipped,
            )
            results.extend([False] * skipped)
        logger.info(
            "Gmail API batch complete: {}/{} succeeded", sum(results), len(results)
        )
        return results
