"""Web Push delivery.

Sends encrypted payloads to browser push services (Apple, Google, Mozilla) so
an installed PWA can raise a notification while it is closed. Subscriptions are
per device, and delivery is strictly best-effort: a push that fails must never
surface as an error on the action that triggered it.
"""

import asyncio
import hashlib
import ipaddress
import json
import logging
import socket
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, urlsplit, urlunsplit
from uuid import UUID

import requests
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


# Hostnames that are never a real browser push service and, if a stored
# endpoint pointed at one, would turn every push into a request to an internal
# target.
_BLOCKED_HOST_SUFFIXES = (".localhost", ".local", ".internal")
_PUSH_SERVICE_HOSTS = frozenset(
    {
        "fcm.googleapis.com",
        "android.googleapis.com",
        "updates.push.services.mozilla.com",
        "updates-autopush.stage.mozaws.net",
        "web.push.apple.com",
        "webpush.push.apple.com",
        "wns.notify.windows.com",
    }
)


class PermanentPushEndpointError(ValueError):
    """A stored endpoint can never be a valid browser push endpoint."""


def validate_push_endpoint(endpoint: str) -> None:
    """Reject a push endpoint that could aim the server at an internal host.

    The endpoint is a client-supplied URL that `webpush` later POSTs to, so an
    authenticated member registering an internal URL (cloud metadata,
    localhost, an intranet service) would turn each push to themselves into a
    blind SSRF. Real browser push endpoints are always HTTPS on a public DNS
    hostname, so require exactly that: HTTPS scheme, and a hostname that is
    neither an IP literal nor a loopback/internal name. Raises ValueError
    (→ 400 at the endpoint) on anything else.

    Delivery performs a second validation and binds its TLS connection to the
    public address returned by that send-time resolution.
    """
    try:
        parsed = urlparse(endpoint)
        port = parsed.port
    except ValueError as exc:
        raise PermanentPushEndpointError("Invalid push endpoint") from exc
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
        or port not in (None, 443)
    ):
        raise PermanentPushEndpointError("Invalid push endpoint")
    host = parsed.hostname.lower()
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise PermanentPushEndpointError("Invalid push endpoint") from exc
    if "%" in host or host.endswith("."):
        raise PermanentPushEndpointError("Invalid push endpoint")
    if host == "localhost" or host.endswith(_BLOCKED_HOST_SUFFIXES):
        raise PermanentPushEndpointError("Invalid push endpoint")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        # Exact comparison is intentional: suffix matching would admit names
        # such as fcm.googleapis.com.attacker.example. Browser subscriptions
        # are issued only by these vendor-operated push services.
        if host not in _PUSH_SERVICE_HOSTS:
            raise PermanentPushEndpointError("Invalid push endpoint")
        return
    # A bare IP literal (169.254.x metadata, 127.x, 10.x, ::1, and even public
    # IPs) is never a legitimate push endpoint — reject it.
    raise PermanentPushEndpointError("Invalid push endpoint")


def _resolve_public_address(endpoint: str) -> tuple[str, str]:
    """Resolve once and return an address that was checked for this delivery.

    Every answer must be globally routable. Rejecting a mixed answer prevents
    an attacker from relying on address-selection differences between this
    check and the HTTP client.
    """
    validate_push_endpoint(endpoint)
    hostname = urlsplit(endpoint).hostname
    if hostname is None:  # validate_push_endpoint has already rejected this
        raise PermanentPushEndpointError("Invalid push endpoint")
    answers = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
    addresses = {answer[4][0] for answer in answers}
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
        raise ValueError("Push endpoint does not resolve exclusively to public IPs")
    return hostname, sorted(addresses)[0]


class _NoRedirectSession(requests.Session):
    def request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        kwargs["allow_redirects"] = False
        return super().request(method, url, **kwargs)


class _PinnedHTTPSAdapter(requests.adapters.HTTPAdapter):
    """Connect to one validated IP while authenticating the endpoint name."""

    def __init__(self, address: str, hostname: str) -> None:
        self.address = address
        self.hostname = hostname
        super().__init__()

    def init_poolmanager(
        self,
        connections: int,
        maxsize: int,
        block: bool = False,
        **kwargs: Any,
    ) -> None:
        kwargs.update(assert_hostname=self.hostname, server_hostname=self.hostname)
        super().init_poolmanager(connections, maxsize, block=block, **kwargs)

    def send(
        self, request: requests.PreparedRequest, **kwargs: Any
    ) -> requests.Response:
        parsed = urlsplit(request.url)
        address = f"[{self.address}]" if ":" in self.address else self.address
        request.url = urlunsplit(("https", address, parsed.path, parsed.query, ""))
        request.headers["Host"] = self.hostname
        return super().send(request, **kwargs)


def _pinned_session(endpoint: str) -> requests.Session:
    hostname, address = _resolve_public_address(endpoint)
    session = _NoRedirectSession()
    session.trust_env = False
    session.mount("https://", _PinnedHTTPSAdapter(address, hostname))
    return session


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

        The endpoint is validated (SSRF guard) at the API boundary
        (``subscribe_to_push``) before this is called, since that is where the
        untrusted client value enters.
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
        session = None
        if settings.ENVIRONMENT in ("production", "staging"):
            # pywebpush accepts a requests session. Its adapter pins the socket
            # to the address validated above while preserving SNI and hostname
            # verification, closing the check/use DNS-rebinding window.
            session = _pinned_session(sub_info["endpoint"])
        try:
            webpush(
                subscription_info=sub_info,
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
                timeout=10,
                requests_session=session,
            )
        finally:
            if session is not None:
                session.close()

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
            except PermanentPushEndpointError as e:
                # Legacy rows predate endpoint validation. Their immutable URL
                # is structurally invalid, so retrying can never recover.
                stale.append(sub.endpoint_hash)
                logger.warning("Removing invalid push subscription %s: %s", sub.id, e)
            except ValueError as e:
                # NOTIF2-3: the endpoint now resolves to a non-public host
                # (DNS rebinding, or a subscription that has gone bad). Skip it
                # — never dispatch to an internal target — but quarantine it
                # in place: a transient DNS/provider incident can recover and
                # must not silently unsubscribe the member.
                logger.warning(
                    "Skipping web push to a non-public endpoint (subscription %s): %s",
                    sub.id,
                    e,
                )
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
            except requests.exceptions.RequestException as e:
                # pywebpush does not wrap transport errors in
                # WebPushException, so a push service outage arrives as a raw
                # requests error. It affects every device at once, so logging a
                # traceback per subscription per notification would flood ERROR
                # for a condition that is transient and non-fatal by design.
                logger.warning(
                    "Web push transport error for subscription %s: %s",
                    sub.id,
                    type(e).__name__,
                )
            except Exception:
                logger.exception("Unexpected error sending web push")

        if stale:
            try:
                await self._delete_by_hashes(stale)
            except Exception:
                logger.exception("Failed to prune stale push subscriptions")

        return sent
