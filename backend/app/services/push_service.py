"""Web Push delivery.

Sends encrypted payloads to browser push services (Apple, Google, Mozilla) so
an installed PWA can raise a notification while it is closed. Subscriptions are
per device, and delivery is strictly best-effort: a push that fails must never
surface as an error on the action that triggered it.
"""

import asyncio
import hashlib
import json
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.notification import PushSubscription

logger = logging.getLogger(__name__)

# pywebpush is optional: deployments with PUSH_ENABLED=false should not be
# forced to install it. Import failure degrades to "push unavailable" rather
# than breaking application start.
try:  # pragma: no cover - import guard
    from pywebpush import WebPushException, webpush

    PYWEBPUSH_AVAILABLE = True
except ImportError:  # pragma: no cover - import guard
    webpush = None  # type: ignore[assignment]
    WebPushException = Exception  # type: ignore[misc,assignment]
    PYWEBPUSH_AVAILABLE = False


def hash_endpoint(endpoint: str) -> str:
    """SHA-256 of a push endpoint, used as its unique key.

    Endpoints are unbounded URLs, which MySQL cannot uniquely index at full
    width, so the hash carries the uniqueness constraint instead.
    """
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()


class PushService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def is_configured() -> bool:
        """Whether push can actually be sent from this deployment."""
        return bool(
            settings.PUSH_ENABLED
            and PYWEBPUSH_AVAILABLE
            and settings.VAPID_PUBLIC_KEY
            and settings.VAPID_PRIVATE_KEY
        )

    async def subscribe(
        self,
        organization_id: UUID,
        user_id: UUID,
        endpoint: str,
        p256dh: str,
        auth: str,
        user_agent: Optional[str] = None,
    ) -> PushSubscription:
        """Register (or re-register) a device endpoint for this user.

        Browsers re-issue the same endpoint when a subscription is refreshed,
        and the same physical device can change hands between members, so an
        existing row is re-pointed at the current user rather than duplicated.
        """
        endpoint_hash = hash_endpoint(endpoint)
        result = await self.db.execute(
            select(PushSubscription).where(
                PushSubscription.endpoint_hash == endpoint_hash
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.organization_id = str(organization_id)
            existing.user_id = str(user_id)
            existing.p256dh = p256dh
            existing.auth = auth
            existing.user_agent = user_agent
            await self.db.commit()
            await self.db.refresh(existing)
            return existing

        sub = PushSubscription(
            organization_id=str(organization_id),
            user_id=str(user_id),
            endpoint=endpoint,
            endpoint_hash=endpoint_hash,
            p256dh=p256dh,
            auth=auth,
            user_agent=user_agent,
        )
        self.db.add(sub)
        await self.db.commit()
        await self.db.refresh(sub)
        return sub

    async def unsubscribe(self, organization_id: UUID, endpoint: str) -> bool:
        """Remove a device endpoint. Org-scoped so one tenant cannot delete
        another's subscription by submitting a known endpoint."""
        result = await self.db.execute(
            delete(PushSubscription).where(
                PushSubscription.endpoint_hash == hash_endpoint(endpoint),
                PushSubscription.organization_id == str(organization_id),
            )
        )
        await self.db.commit()
        return bool(result.rowcount)

    async def _delete_by_hashes(self, hashes: List[str]) -> None:
        if not hashes:
            return
        await self.db.execute(
            delete(PushSubscription).where(PushSubscription.endpoint_hash.in_(hashes))
        )
        await self.db.commit()

    def _send_one(self, sub_info: Dict[str, Any], payload: str) -> None:
        """Blocking pywebpush call, run off the event loop by the caller."""
        webpush(
            subscription_info=sub_info,
            data=payload,
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": settings.VAPID_SUBJECT},
            timeout=10,
        )

    async def send_to_user(
        self,
        organization_id: UUID,
        user_id: UUID,
        title: str,
        body: str,
        url: str = "/notifications?tab=inbox",
        tag: Optional[str] = None,
    ) -> int:
        """Push a notification to every device the user has registered.

        Returns the number of endpoints successfully delivered to. Never
        raises: push is an enhancement to an already-recorded in-app
        notification, so a push service outage must not fail the caller's
        request or roll back its transaction.
        """
        if not self.is_configured():
            return 0

        try:
            result = await self.db.execute(
                select(PushSubscription).where(
                    PushSubscription.organization_id == str(organization_id),
                    PushSubscription.user_id == str(user_id),
                )
            )
            subs = list(result.scalars().all())
        except Exception:
            logger.exception("Failed to load push subscriptions")
            return 0

        if not subs:
            return 0

        payload = json.dumps(
            {"title": title, "body": body, "url": url, "tag": tag or "logbook"}
        )

        sent = 0
        stale: List[str] = []
        for sub in subs:
            sub_info = {
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            }
            try:
                # pywebpush is synchronous and does network I/O; running it
                # inline would block the event loop for every device.
                await asyncio.to_thread(self._send_one, sub_info, payload)
                sent += 1
            except WebPushException as e:
                status = getattr(getattr(e, "response", None), "status_code", None)
                # 404/410 mean the browser dropped the subscription — the app
                # was uninstalled or site data cleared. There is no unsubscribe
                # callback, so pruning on send is the only way these go away.
                if status in (404, 410):
                    stale.append(sub.endpoint_hash)
                else:
                    logger.warning(
                        "Web push failed (status=%s) for subscription %s",
                        status,
                        sub.id,
                    )
            except Exception:
                logger.exception("Unexpected error sending web push")

        if stale:
            try:
                await self._delete_by_hashes(stale)
            except Exception:
                logger.exception("Failed to prune stale push subscriptions")

        return sent
