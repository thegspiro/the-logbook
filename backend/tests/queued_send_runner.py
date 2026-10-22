"""Run background ballot sends inside a test's own database session.

Sends are queued as jobs and started with ``asyncio.create_task`` in a fresh
session, which cannot see rows a test wrote inside its rolled-back
transaction. ``QueuedSends`` captures what was queued instead, and ``drain``
runs it in the test's session, so a test can still assert on the whole path
from the lifecycle task to the mail it sent.
"""

from contextlib import asynccontextmanager
from typing import Any, List, Tuple
from unittest.mock import patch

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ballot_send_jobs import run_ballot_send_job

START_JOB = "app.services.ballot_send_jobs.start_ballot_send_job"


class QueuedSends:
    def __init__(self, db_session: AsyncSession) -> None:
        self._db = db_session
        self.queued: List[Tuple[Any, ...]] = []

    def _capture(self, *args: Any) -> None:
        self.queued.append(args)

    def _session_factory(self):
        @asynccontextmanager
        async def factory():
            yield self._db

        return factory

    async def drain(self) -> int:
        """Run every queued send, in order; returns how many ran."""
        ran = 0
        while self.queued:
            job_id, organization_id, send = self.queued.pop(0)
            await run_ballot_send_job(
                job_id, organization_id, send, session_factory=self._session_factory()
            )
            ran += 1
        return ran


@asynccontextmanager
async def capture_queued_sends(db_session: AsyncSession):
    sends = QueuedSends(db_session)
    with patch(START_JOB, side_effect=sends._capture):
        yield sends
