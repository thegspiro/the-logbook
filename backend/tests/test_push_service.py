"""Tests for Web Push delivery (app/services/push_service.py).

These run against the real MySQL test database and a real HTTP server standing
in for the browser push service, so the encryption, the VAPID signing, and the
migration-created ``push_subscriptions`` table are all genuinely exercised —
not mocked. Mocking ``webpush`` here would test almost nothing: the parts that
actually break in production are the wire format (a malformed
``applicationServerKey`` or an unsigned token gets a silent 401 from Apple) and
the DB constraints (a duplicate endpoint hits the unique index).

The local push service returns 201 for most paths and 410 for ``/gone``, which
is how a real push service reports that the browser has dropped the
subscription.
"""

import base64
import json
import os
import threading
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid02
from sqlalchemy import text

from app.core.config import settings
from app.services.push_service import (
    PYWEBPUSH_AVAILABLE,
    PushService,
    hash_endpoint,
)

# integration: these need a live database. CI's unit job runs without one and
# selects on this marker, so an unmarked DB test errors there instead of
# running in the MySQL/MariaDB matrix where it belongs.
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not PYWEBPUSH_AVAILABLE, reason="pywebpush not installed"),
]

# Port 9 is the discard service: reserved, and never listening. Connecting to
# it fails immediately, which is what makes the transport-error test fast.
UNREACHABLE_ENDPOINT = "http://127.0.0.1:9/push/dead"


class _PushServiceHandler(BaseHTTPRequestHandler):
    received: List[Dict[str, Any]] = []

    def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler's naming
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        type(self).received.append(
            {
                "path": self.path,
                "headers": {k.lower(): v for k, v in self.headers.items()},
                "body": body,
            }
        )
        self.send_response(410 if self.path.endswith("/gone") else 201)
        self.end_headers()

    def log_message(self, *args):
        """Silence the default stderr access log."""


@pytest.fixture(scope="module")
def push_service_url():
    """A real HTTP server acting as the browser vendor's push endpoint."""
    server = HTTPServer(("127.0.0.1", 0), _PushServiceHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()


@pytest.fixture
def received():
    _PushServiceHandler.received = []
    return _PushServiceHandler.received


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _client_keys() -> tuple[str, str]:
    """A browser subscription's real keys, so pywebpush actually encrypts."""
    key = ec.generate_private_key(ec.SECP256R1())
    p256dh = _b64url(
        key.public_key().public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
    )
    return p256dh, _b64url(os.urandom(16))


@pytest.fixture
def vapid_keys(monkeypatch):
    """Configure the process with a fresh VAPID pair, exactly as
    scripts/generate_vapid_keys.py emits it. A wrong encoding here is the
    failure mode that silently produces 401s from real push services."""
    from scripts.generate_vapid_keys import generate

    private, public = generate()
    monkeypatch.setattr(settings, "PUSH_ENABLED", True)
    monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY", private)
    monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY", public)
    monkeypatch.setattr(settings, "VAPID_SUBJECT", "mailto:ops@example.org")
    return public


@pytest.fixture
async def two_orgs(db_session):
    """Two orgs each with one user, for the cross-tenant assertions.

    Inserted as raw rows rather than through the models: the subscription table
    only needs the two foreign keys to resolve, and building full Organization
    and User objects would couple this test to unrelated required columns.
    """
    orgs = {}
    for label in ("a", "b"):
        org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
        await db_session.execute(
            text("INSERT INTO organizations (id, name, slug) VALUES (:i,:n,:s)"),
            {"i": org_id, "n": f"Dept {label}", "s": f"dept-{org_id[:8]}"},
        )
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, email)"
                " VALUES (:i,:o,:u,:e)"
            ),
            {
                "i": user_id,
                "o": org_id,
                "u": f"user-{user_id[:8]}",
                "e": f"user-{user_id[:8]}@example.org",
            },
        )
        orgs[label] = (org_id, user_id)
    await db_session.commit()
    return orgs


async def _count(db, column: str, value: str) -> int:
    result = await db.execute(
        text(f"SELECT COUNT(*) FROM push_subscriptions WHERE {column} = :v"),
        {"v": value},
    )
    return result.scalar() or 0


class TestSubscribe:
    async def test_subscribe_stores_hashed_endpoint(self, db_session, two_orgs):
        org_id, user_id = two_orgs["a"]
        p256dh, auth = _client_keys()
        svc = PushService(db_session)

        sub = await svc.subscribe(
            org_id, user_id, "https://push.example/abc", p256dh, auth, "iPhone"
        )

        assert sub.endpoint_hash == hash_endpoint("https://push.example/abc")
        assert await _count(db_session, "user_id", user_id) == 1

    async def test_resubscribe_updates_in_place(self, db_session, two_orgs):
        """Browsers re-issue the same endpoint on refresh. Inserting again
        would hit the unique index, so the row must be re-pointed instead."""
        org_id, user_id = two_orgs["a"]
        p256dh, auth = _client_keys()
        svc = PushService(db_session)

        first = await svc.subscribe(
            org_id, user_id, "https://push.example/abc", p256dh, auth, "iOS 17"
        )
        again = await svc.subscribe(
            org_id, user_id, "https://push.example/abc", p256dh, auth, "iOS 18"
        )

        assert again.id == first.id
        assert again.user_agent == "iOS 18"
        assert await _count(db_session, "user_id", user_id) == 1

    async def test_device_can_change_hands_between_members(self, db_session, two_orgs):
        """A station tablet re-subscribed by a different member must follow
        that member, not keep pushing the previous one's notifications."""
        org_a, user_a = two_orgs["a"]
        org_b, user_b = two_orgs["b"]
        p256dh, auth = _client_keys()
        svc = PushService(db_session)

        await svc.subscribe(org_a, user_a, "https://push.example/t", p256dh, auth)
        moved = await svc.subscribe(
            org_b, user_b, "https://push.example/t", p256dh, auth
        )

        assert moved.user_id == str(user_b)
        assert moved.organization_id == str(org_b)
        assert await _count(db_session, "user_id", user_a) == 0


class TestSend:
    async def test_request_is_a_valid_encrypted_vapid_push(
        self, db_session, two_orgs, push_service_url, received, vapid_keys
    ):
        org_id, user_id = two_orgs["a"]
        p256dh, auth = _client_keys()
        svc = PushService(db_session)
        await svc.subscribe(org_id, user_id, f"{push_service_url}/ok", p256dh, auth)

        sent = await svc.send_to_user(
            org_id, user_id, "Structure fire", "Box 4-1", url="/events/9"
        )

        assert sent == 1
        assert len(received) == 1
        request = received[0]
        headers = request["headers"]

        assert headers["content-encoding"] == "aes128gcm"
        assert "ttl" in headers

        # A push service rejects an unsigned or malformed token with 401, and
        # the browser drops a message whose k= is not the applicationServerKey
        # it subscribed with. Both are invisible without checking the wire.
        authorization = headers["authorization"]
        assert Vapid02.verify(authorization)
        parts = dict(
            token.split("=", 1) for token in authorization.split(" ", 1)[1].split(",")
        )
        assert parts["k"] == vapid_keys
        claims = json.loads(base64.urlsafe_b64decode(parts["t"].split(".")[1] + "=="))
        assert claims["aud"] == push_service_url
        assert claims["sub"] == settings.VAPID_SUBJECT

        # The push service must never be able to read the notification.
        assert request["body"]
        assert b"Structure fire" not in request["body"]
        assert b"/events/9" not in request["body"]

    async def test_payload_matches_what_the_service_worker_reads(
        self, db_session, two_orgs, push_service_url, received, vapid_keys
    ):
        """push-sw.js destructures these four keys; a rename here shows up as a
        notification titled "undefined" and nothing else."""
        org_id, user_id = two_orgs["a"]
        p256dh, auth = _client_keys()
        svc = PushService(db_session)
        await svc.subscribe(org_id, user_id, f"{push_service_url}/ok", p256dh, auth)

        captured: Dict[str, str] = {}
        original = svc._send_one

        def spy(sub_info, payload):
            captured["payload"] = payload
            return original(sub_info, payload)

        svc._send_one = spy  # type: ignore[method-assign]
        await svc.send_to_user(
            org_id, user_id, "Roll call", "Tonight 1900", url="/e/9", tag="events"
        )

        assert json.loads(captured["payload"]) == {
            "title": "Roll call",
            "body": "Tonight 1900",
            "url": "/e/9",
            "tag": "events",
        }

    async def test_reaches_every_device_the_member_registered(
        self, db_session, two_orgs, push_service_url, received, vapid_keys
    ):
        org_id, user_id = two_orgs["a"]
        svc = PushService(db_session)
        for name in ("phone", "tablet"):
            p256dh, auth = _client_keys()
            await svc.subscribe(
                org_id, user_id, f"{push_service_url}/{name}", p256dh, auth
            )

        sent = await svc.send_to_user(org_id, user_id, "Drill", "1900")

        assert sent == 2
        assert {r["path"] for r in received} == {"/phone", "/tablet"}

    async def test_unconfigured_deployment_sends_nothing(
        self,
        db_session,
        two_orgs,
        push_service_url,
        received,
        vapid_keys,
        monkeypatch,
    ):
        org_id, user_id = two_orgs["a"]
        p256dh, auth = _client_keys()
        svc = PushService(db_session)
        await svc.subscribe(org_id, user_id, f"{push_service_url}/ok", p256dh, auth)
        monkeypatch.setattr(settings, "PUSH_ENABLED", False)

        assert not svc.is_configured()
        assert await svc.send_to_user(org_id, user_id, "x", "y") == 0
        assert received == []


class TestStaleSubscriptionPruning:
    async def test_410_prunes_only_the_dropped_endpoint(
        self, db_session, two_orgs, push_service_url, received, vapid_keys
    ):
        """Browsers give no unsubscribe callback, so pruning on a 410 is the
        only thing that stops a dead endpoint being retried forever."""
        org_id, user_id = two_orgs["a"]
        svc = PushService(db_session)
        for path in ("ok", "gone"):
            p256dh, auth = _client_keys()
            await svc.subscribe(
                org_id, user_id, f"{push_service_url}/{path}", p256dh, auth
            )

        sent = await svc.send_to_user(org_id, user_id, "Drill", "1900")

        assert sent == 1
        assert len(received) == 2
        gone = hash_endpoint(f"{push_service_url}/gone")
        live = hash_endpoint(f"{push_service_url}/ok")
        assert await _count(db_session, "endpoint_hash", gone) == 0
        assert await _count(db_session, "endpoint_hash", live) == 1

    async def test_transport_error_does_not_prune_or_raise(
        self, db_session, two_orgs, push_service_url, received, vapid_keys
    ):
        """A push service outage is transient. Dropping subscriptions over it
        would silently unsubscribe the whole department, and the send must not
        fail the notification that triggered it."""
        org_id, user_id = two_orgs["a"]
        svc = PushService(db_session)
        for endpoint in (f"{push_service_url}/ok", UNREACHABLE_ENDPOINT):
            p256dh, auth = _client_keys()
            await svc.subscribe(org_id, user_id, endpoint, p256dh, auth)

        sent = await svc.send_to_user(org_id, user_id, "Drill", "1900")

        assert sent == 1
        dead = hash_endpoint(UNREACHABLE_ENDPOINT)
        assert await _count(db_session, "endpoint_hash", dead) == 1

    async def test_blocking_http_call_runs_off_the_event_loop(
        self, db_session, two_orgs, push_service_url, received, vapid_keys
    ):
        """pywebpush is synchronous and does network I/O; send_to_user offloads
        it with asyncio.to_thread. Calling it inline would stall every other
        request in the worker for the duration of the push, once per device.

        Asserted on the thread identity rather than on elapsed time: a timing
        proxy still passes when the offload is removed, because the awaits
        around the call yield anyway.
        """
        org_id, user_id = two_orgs["a"]
        p256dh, auth = _client_keys()
        svc = PushService(db_session)
        await svc.subscribe(org_id, user_id, f"{push_service_url}/ok", p256dh, auth)

        loop_thread = threading.get_ident()
        send_threads: List[int] = []
        original = svc._send_one

        def spy(sub_info, payload):
            send_threads.append(threading.get_ident())
            return original(sub_info, payload)

        svc._send_one = spy  # type: ignore[method-assign]
        assert await svc.send_to_user(org_id, user_id, "Drill", "1900") == 1

        assert len(send_threads) == 1
        assert loop_thread not in send_threads


class TestOrgScoping:
    async def test_another_org_cannot_unsubscribe_this_endpoint(
        self, db_session, two_orgs
    ):
        """Endpoints appear in client-side code and logs. Without the org
        filter, knowing one would be enough to silence another department."""
        org_a, user_a = two_orgs["a"]
        org_b, _ = two_orgs["b"]
        endpoint = "https://push.example/abc"
        p256dh, auth = _client_keys()
        svc = PushService(db_session)
        await svc.subscribe(org_a, user_a, endpoint, p256dh, auth)

        assert await svc.unsubscribe(org_b, endpoint) is False
        assert await _count(db_session, "endpoint_hash", hash_endpoint(endpoint)) == 1

        assert await svc.unsubscribe(org_a, endpoint) is True
        assert await _count(db_session, "endpoint_hash", hash_endpoint(endpoint)) == 0

    async def test_send_is_scoped_by_org_and_user(
        self, db_session, two_orgs, push_service_url, received, vapid_keys
    ):
        org_a, user_a = two_orgs["a"]
        org_b, user_b = two_orgs["b"]
        p256dh, auth = _client_keys()
        svc = PushService(db_session)
        await svc.subscribe(org_a, user_a, f"{push_service_url}/ok", p256dh, auth)

        assert await svc.send_to_user(org_b, user_b, "x", "y") == 0
        # org A's user paired with org B's id must not resolve either
        assert await svc.send_to_user(org_b, user_a, "x", "y") == 0
        assert received == []


class TestCascade:
    async def test_deleting_the_user_removes_their_subscriptions(
        self, db_session, two_orgs
    ):
        """A departed member's devices must stop receiving department traffic
        without a separate cleanup step."""
        org_id, user_id = two_orgs["a"]
        p256dh, auth = _client_keys()
        svc = PushService(db_session)
        await svc.subscribe(org_id, user_id, "https://push.example/x", p256dh, auth)

        await db_session.execute(
            text("DELETE FROM users WHERE id = :i"), {"i": user_id}
        )
        await db_session.commit()

        assert await _count(db_session, "user_id", user_id) == 0
