"""In-app copies of officer alerts whose email a member may turn off.

Quartermaster duties, the third-party nominee's accept-or-decline request, and
membership and store administration were email-only. A member who turned the
email off (``email_policy``) was told nothing at all, even though the email
policy promises that turning an email off never removes the in-app bell entry.
Owner decision 2026-10-29: these alerts also create a bell entry for every
officer they are about, whether or not that officer receives the email.

Recurring digests (low stock every morning, a weekly shelf-audit list) pass
``replace_unread=True``: an officer who has not opened yesterday's entry has it
refreshed in place rather than gaining a second one, so a week of daily
low-stock runs leaves one live entry, not seven. The key that makes a rerun a
no-op is (recipient, category, ``dedupe_key``) among unread entries.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.notification import NotificationChannel, NotificationLog

# Notification metadata key holding the dedupe key, so two digests in one
# category (gear and medical low stock) are refreshed separately.
DEDUPE_METADATA_KEY = "alert_key"


async def add_in_app_copies(
    db: AsyncSession,
    *,
    organization_id: str,
    recipient_ids: Iterable[str],
    category: str,
    subject: str,
    message: str,
    action_url: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    replace_unread: bool = False,
    dedupe_key: Optional[str] = None,
) -> int:
    """Add (or refresh) one bell entry per recipient; returns how many were written.

    Does not commit: the caller's transaction decides. ``action_url`` must be a
    path inside the app; the notification card ignores anything not starting
    with "/".
    """
    ids = sorted({str(r) for r in recipient_ids if r})
    if not ids:
        return 0

    entry_metadata = dict(metadata or {})
    if dedupe_key is not None:
        entry_metadata[DEDUPE_METADATA_KEY] = dedupe_key

    existing: Dict[str, NotificationLog] = {}
    if replace_unread:
        rows = (
            await db.execute(
                select(NotificationLog).where(
                    NotificationLog.organization_id == str(organization_id),
                    NotificationLog.recipient_id.in_(ids),
                    NotificationLog.channel == NotificationChannel.IN_APP,
                    NotificationLog.category == category,
                    NotificationLog.read.is_not(True),
                )
            )
        ).scalars()
        for row in rows:
            row_key = (row.notification_metadata or {}).get(DEDUPE_METADATA_KEY)
            if row_key == dedupe_key and row.recipient_id not in existing:
                existing[str(row.recipient_id)] = row

    now = datetime.now(timezone.utc)
    for recipient_id in ids:
        current = existing.get(recipient_id)
        if current is not None:
            current.subject = subject
            current.message = message
            current.action_url = action_url
            current.notification_metadata = entry_metadata or None
            current.sent_at = now
            continue
        db.add(
            NotificationLog(
                id=generate_uuid(),
                organization_id=str(organization_id),
                recipient_id=recipient_id,
                channel=NotificationChannel.IN_APP,
                category=category,
                subject=subject,
                message=message,
                action_url=action_url,
                notification_metadata=entry_metadata or None,
                delivered=True,
            )
        )
    logger.debug(
        "In-app copies for {} in org {}: {} refreshed, {} added",
        category,
        organization_id,
        len(existing),
        len(ids) - len(existing),
    )
    return len(ids)
