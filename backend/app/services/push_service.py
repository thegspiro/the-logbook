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
from sqlalchemy import delete, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.notification import PushSubscription
from app.models.user import User

logger = logging.getLogger(__name__)

_DEADLOCK_MYSQL_CODE = 1213


def _is_deadlock(exc: OperationalError) -> bool:
    """Whether *exc* is InnoDB error 1213 (deadlock), not some other
    operational failure a blanket retry would otherwise silently mask."""
    if exc.orig and hasattr(exc.orig, "args") and exc.orig.args:
        code = exc.orig.args[0]
        if isinstance(code, int):
            return code == _DEADLOCK_MYSQL_CODE
    return "deadlock" in str(exc).lower()


# A real member has a handful of devices (phone, tablet, station computer).
# With no cap, an authenticated caller could register unbounded distinct
# endpoints (each a real hostname on the vendor allowlist, so
# validate_push_endpoint alone does not stop this) and turn every future
# notification into a many-thousand-fold fan-out of blocking send_to_user
# calls. Generous enough that no legitimate use ever hits it.
_MAX_PUSH_SUBSCRIPTIONS_PER_USER = 20

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

        Retries once on a genuine InnoDB deadlock (MySQL error 1213). The
        locking below is ordered to avoid the deadlock shapes this rotation
        found and fixed, but proving a lock-ordering scheme deadlock-free
        under *arbitrary* concurrent interleavings (three or more callers,
        each racing a different pair of endpoints/users) is a different,
        much harder claim than closing the specific two-party shapes that
        were actually found. A deadlock is not a correctness or data-
        integrity failure -- InnoDB cleanly aborts and fully rolls back
        exactly one side -- so retrying the loser once is the standard,
        safe response, the same shape ``app/utils/db_retry.py`` already
        uses for transient connection errors (that helper is not reused
        directly: its exponential backoff is tuned for waiting out a
        database restart, not for a lock that is typically already free by
        the time a retry runs).
        """
        for attempt in (1, 2):
            try:
                return await self._subscribe_once(
                    organization_id, user_id, endpoint, p256dh, auth, user_agent
                )
            except OperationalError as exc:
                if attempt == 2 or not _is_deadlock(exc):
                    raise
                logger.warning(
                    "Deadlock on push subscribe for user %s, retrying once",
                    user_id,
                )
                await self.db.rollback()
        raise AssertionError("unreachable")  # pragma: no cover

    async def _subscribe_once(
        self,
        organization_id: UUID,
        user_id: UUID,
        endpoint: str,
        p256dh: str,
        auth: str,
        user_agent: Optional[str],
    ) -> PushSubscription:
        endpoint_hash = hash_endpoint(endpoint)

        # A plain peek, never a locking read: a ``FOR UPDATE`` query that
        # might match nothing takes an InnoDB *gap* lock over the index
        # range instead of a record lock, and unlike a record lock, a gap
        # lock is compatible with another transaction's gap lock on the
        # same range -- two callers registering different brand-new
        # endpoints that happen to hash into the same gap can each acquire
        # one, then each block on the other's later insert-intention lock:
        # a deadlock neither is holding anything exclusive to cause. Same
        # shape, same fix, as FAC-45 in ``documents_service.py``: peek
        # first with a plain read, and only take a real lock via a point
        # lookup on an id the peek already found. The peek is also allowed
        # to be stale for a different reason -- this transaction's
        # snapshot was already fixed when `current_user` was loaded
        # upstream -- which is fine here, since it only decides which User
        # rows to lock below, never anything about the endpoint itself.
        peeked = await self.db.execute(
            select(PushSubscription.id, PushSubscription.user_id).where(
                PushSubscription.endpoint_hash == endpoint_hash
            )
        )
        peeked_row = peeked.first()
        peeked_id = peeked_row.id if peeked_row else None
        guessed_owner = peeked_row.user_id if peeked_row else None

        # Lock every user this call might touch, in a fixed order (sorted
        # by id, not by which side of a swap either request is on) --
        # BEFORE taking any lock on the endpoint row itself. Two callers
        # trading endpoints with each other (A claims B's device, B claims
        # A's, at the same time) would otherwise each lock their own
        # target's endpoint row first and then block on the other's
        # endpoint row while holding it: a textbook AB/BA deadlock, still
        # reachable even with the user-row locks below if an endpoint-row
        # lock were taken before them (reproduced in CI on an earlier
        # version of this fix — see the deadlock guard test). Acquiring
        # every request's locks in the same global order, endpoint-row
        # locks included, makes one fully finish before the other can even
        # attempt its own endpoint-row lock, instead of each holding one
        # half of a cycle. The count that follows must then be a *locking*
        # read of its own — under REPEATABLE READ, merely acquiring this
        # lock does not refresh what a plain SELECT would see
        # (CLAUDE.md pitfall #27): only a locking read is defined to
        # return the latest committed rows.
        lock_user_ids = {str(user_id)}
        if guessed_owner is not None:
            lock_user_ids.add(guessed_owner)
        for uid in sorted(lock_user_ids):
            await self.db.execute(select(User).where(User.id == uid).with_for_update())

        # The authoritative read: a point lookup by id (a real record lock,
        # never a query that might match nothing), and only now -- after
        # the shared user-row locks above, never before. A plain read here
        # could still decide "I already own this" from data already stale
        # relative to a concurrent transfer, overwriting the row's
        # encryption keys while leaving `user_id` pointing at the new
        # owner: a notification meant for the new owner would then be
        # encrypted with keys only the OLD owner's device holds the
        # matching private key for, and delivered there instead. If the
        # row was deleted between the peek and here, this simply finds
        # nothing and falls through to the brand-new-subscription path
        # below, exactly like a peek that found nothing in the first place.
        existing = None
        if peeked_id is not None:
            result = await self.db.execute(
                select(PushSubscription)
                .where(PushSubscription.id == peeked_id)
                .with_for_update()
            )
            existing = result.scalar_one_or_none()

        # A genuine refresh (the caller already owns this exact endpoint) is
        # the only case exempt from the cap below — reassigning someone
        # else's device to this user is a new subscription for them and must
        # be counted against their own limit, or two accounts trading a
        # device back and forth could grow one of them past it indefinitely.
        if existing and existing.user_id == str(user_id):
            existing.organization_id = str(organization_id)
            existing.p256dh = p256dh
            existing.auth = auth
            existing.user_agent = user_agent
            await self.db.commit()
            await self.db.refresh(existing)
            return existing

        count_result = await self.db.execute(
            select(func.count())
            .select_from(PushSubscription)
            .where(PushSubscription.user_id == str(user_id))
            .with_for_update()
        )
        if count_result.scalar_one() >= _MAX_PUSH_SUBSCRIPTIONS_PER_USER:
            raise ValueError(
                f"Maximum of {_MAX_PUSH_SUBSCRIPTIONS_PER_USER} push "
                "subscriptions reached. Remove an old device first."
            )

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
