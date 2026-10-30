"""The queue that sends web push after the request that caused it."""

import asyncio
from contextlib import asynccontextmanager
from typing import Any, Dict, List

import pytest

from app.services import push_dispatch
from app.services.push_dispatch import schedule_push, wait_for_queued_pushes

pytestmark = pytest.mark.unit


class _FakeDelivery:
    """Stands in for the session factory and PushService, recording sends."""

    def __init__(self) -> None:
        self.sent: List[Dict[str, Any]] = []
        self.open_sessions = 0
        self.most_open_sessions = 0
        self.gate = asyncio.Event()
        self.gate.set()
        self.fail_for: set = set()

    @asynccontextmanager
    async def session_factory(self):
        self.open_sessions += 1
        self.most_open_sessions = max(self.most_open_sessions, self.open_sessions)
        try:
            yield object()
        finally:
            self.open_sessions -= 1

    def push_service(self, _session):
        fake = self

        class _Service:
            async def send_to_user(self, **kwargs):
                await fake.gate.wait()
                if kwargs["user_id"] in fake.fail_for:
                    raise RuntimeError("push service down")
                fake.sent.append(kwargs)
                return 1

        return _Service()


@pytest.fixture
def delivery(monkeypatch):
    fake = _FakeDelivery()
    monkeypatch.setattr(push_dispatch, "async_session_factory", fake.session_factory)
    monkeypatch.setattr(push_dispatch, "PushService", fake.push_service)
    return fake


def _queue(count: int, start: int = 0) -> None:
    for n in range(start, start + count):
        assert schedule_push("org", f"user-{n}", "Title", "Body", url=f"/e/{n}")


async def test_queues_and_returns_without_sending(delivery):
    delivery.gate.clear()

    _queue(3)

    assert delivery.sent == []
    delivery.gate.set()
    await wait_for_queued_pushes(timeout=5)
    assert [push["user_id"] for push in delivery.sent] == ["user-0", "user-1", "user-2"]
    assert delivery.sent[0]["url"] == "/e/0"


async def test_draws_only_a_few_sessions_however_many_are_queued(delivery):
    # One session per queued push would take the pool from live requests
    # during a department-wide announcement.
    delivery.gate.clear()
    _queue(50)
    await asyncio.sleep(0)

    delivery.gate.set()
    await wait_for_queued_pushes(timeout=5)

    assert len(delivery.sent) == 50
    assert delivery.most_open_sessions == push_dispatch._WORKERS


async def test_one_failed_push_does_not_stop_the_rest(delivery):
    delivery.fail_for = {"user-1"}

    _queue(3)
    await wait_for_queued_pushes(timeout=5)

    assert [push["user_id"] for push in delivery.sent] == ["user-0", "user-2"]


async def test_a_push_queued_as_the_workers_finish_is_still_sent(delivery):
    # A finished worker stays in the set until its done-callback runs on a
    # later tick; counting membership instead of done() stranded this push.
    _queue(push_dispatch._WORKERS)
    while len(delivery.sent) < push_dispatch._WORKERS:
        await asyncio.sleep(0)

    _queue(1, start=100)
    await wait_for_queued_pushes(timeout=5)

    assert delivery.sent[-1]["user_id"] == "user-100"


async def test_waiting_returns_when_the_workers_have_just_finished(delivery):
    # Finished workers sit in the set until their done-callbacks run, and
    # gathering only finished tasks never yields to the loop (Python 3.12+),
    # so a wait at that moment spun forever and froze the process — the
    # shutdown wait included. pytest-timeout is what fails this if it regresses.
    _queue(push_dispatch._WORKERS)
    while len(delivery.sent) < push_dispatch._WORKERS:
        await asyncio.sleep(0)

    await wait_for_queued_pushes(timeout=1)

    assert len(delivery.sent) == push_dispatch._WORKERS


async def test_a_full_queue_drops_the_push_rather_than_growing(delivery, monkeypatch):
    monkeypatch.setattr(push_dispatch, "_MAX_QUEUED_PUSHES", 2)
    delivery.gate.clear()

    assert schedule_push("org", "user-a", "T", "B")
    assert schedule_push("org", "user-b", "T", "B")
    # Workers have not run yet, so both are still queued.
    assert schedule_push("org", "user-c", "T", "B") is False

    delivery.gate.set()
    await wait_for_queued_pushes(timeout=5)
    assert [push["user_id"] for push in delivery.sent] == ["user-a", "user-b"]


async def test_waiting_gives_up_after_the_timeout(delivery):
    delivery.gate.clear()
    _queue(1)

    await wait_for_queued_pushes(timeout=0.05)

    assert delivery.sent == []
    delivery.gate.set()
    await wait_for_queued_pushes(timeout=5)
