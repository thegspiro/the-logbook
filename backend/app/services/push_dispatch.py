"""Web push sent after the request that caused it, not during it.

``NotificationsService.log_notification`` used to push in-line, so a request
that notified many members — an event announcement to the whole department —
waited on every push to every device in turn, each allowed ten seconds by
``PushService._send_one``. A large roster, or a push-service outage, ran past
the frontend's 30-second timeout and nginx's 60: the officer saw an error for
an announcement that had in fact gone out, and a retry sent it twice.

Pushes are queued here instead and drained by a few workers in this process,
each opening its own session — the request's session is closed by the time
they run. They are workers draining a queue rather than one task per push
because a task per push would open one session per notification at once, and
an announcement to 150 members would take the connection pool away from the
requests it exists to serve.

Delivery stays best-effort, as it always was: a restart drops whatever is still
queued, and the in-app notification and email it accompanies are already
recorded by then.
"""

import asyncio
import logging
import weakref
from collections import deque
from dataclasses import dataclass
from typing import Deque, Optional, Set

from app.core.database import async_session_factory
from app.services.push_service import PushService

logger = logging.getLogger(__name__)

# A ceiling on pushes waiting to go (CLAUDE.md pitfall #9). Far above any one
# announcement; reached only when the push service has been failing slowly
# for long enough that a queue this long would deliver stale news anyway.
_MAX_QUEUED_PUSHES = 5_000

# Sessions drawn from the pool at once by push delivery.
_WORKERS = 4


@dataclass(frozen=True)
class _QueuedPush:
    organization_id: str
    user_id: str
    title: str
    body: str
    url: Optional[str]
    tag: Optional[str]


class _Dispatcher:
    """The queue and its workers for one event loop."""

    def __init__(self) -> None:
        self.queue: Deque[_QueuedPush] = deque()
        self.workers: Set["asyncio.Task[None]"] = set()

    async def run_worker(self) -> None:
        while self.queue:
            push = self.queue.popleft()
            try:
                async with async_session_factory() as session:
                    await PushService(session).send_to_user(
                        organization_id=push.organization_id,
                        user_id=push.user_id,
                        title=push.title,
                        body=push.body,
                        url=push.url,
                        tag=push.tag,
                    )
            except Exception:
                logger.exception("Queued web push to user %s failed", push.user_id)


# Keyed by loop: each test and each worker process has its own, and a task or
# queue belongs to the loop that created it.
_dispatchers: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, _Dispatcher]" = (
    weakref.WeakKeyDictionary()
)


def _dispatcher() -> _Dispatcher:
    loop = asyncio.get_running_loop()
    dispatcher = _dispatchers.get(loop)
    if dispatcher is None:
        dispatcher = _Dispatcher()
        _dispatchers[loop] = dispatcher
    return dispatcher


def schedule_push(
    organization_id: str,
    user_id: str,
    title: str,
    body: str,
    url: Optional[str] = None,
    tag: Optional[str] = None,
) -> bool:
    """Queue a push to every device ``user_id`` registered, and return at once.

    Returns False when the queue is full and the push was dropped. Callers
    need not act on that: the notification it accompanies is already stored.
    """
    dispatcher = _dispatcher()
    if len(dispatcher.queue) >= _MAX_QUEUED_PUSHES:
        logger.warning(
            "Web push queue full (%s); dropping a push to user %s",
            _MAX_QUEUED_PUSHES,
            user_id,
        )
        return False

    dispatcher.queue.append(
        _QueuedPush(str(organization_id), str(user_id), title, body, url, tag)
    )
    # Counted by done(), not by membership: a worker that has just found the
    # queue empty is finished but stays in the set until its done-callback
    # runs on a later tick, and a push queued in between would otherwise find
    # the set full and wait for a worker that is never coming.
    if sum(1 for worker in dispatcher.workers if not worker.done()) < _WORKERS:
        task = asyncio.get_running_loop().create_task(dispatcher.run_worker())
        dispatcher.workers.add(task)
        task.add_done_callback(dispatcher.workers.discard)
    return True


async def wait_for_queued_pushes(timeout: Optional[float] = None) -> None:
    """Wait until every queued push has been attempted, or ``timeout`` passes.

    Used at shutdown, so a deploy does not cut off an announcement that was
    still going out, and by tests that assert on what was sent.
    """
    dispatcher = _dispatchers.get(asyncio.get_running_loop())
    if dispatcher is None:
        return

    async def drained() -> None:
        # Only unfinished workers. Finished ones stay in the set until their
        # done-callbacks run, and gathering nothing but finished tasks returns
        # without yielding to the loop (Python 3.12+), so those callbacks never
        # got to run and this spun forever, freezing the process.
        while running := [worker for worker in dispatcher.workers if not worker.done()]:
            await asyncio.gather(*running, return_exceptions=True)

    try:
        await asyncio.wait_for(drained(), timeout)
    except asyncio.TimeoutError:
        logger.warning(
            "%s web pushes still queued at shutdown were not sent",
            len(dispatcher.queue),
        )
