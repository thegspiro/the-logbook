"""Removing audit rows a test committed for real, without breaking the chain.

Most tests never commit: ``db_session`` rolls everything back. A test that
drives its own sessions does commit, and every commit carrying an audit row
starts the background sealer, which links the row onto the chain and advances
the single ``audit_chain_head`` row in a transaction of its own. Deleting the
test's audit rows afterwards leaves that head pointing at a row that is gone,
so the next row sealed links to nothing and every later full-chain
``verify_integrity`` reports the chain head missing. Whether the sealer ran
before the delete depends on timing, so the failure lands on whichever audit
test runs next, in CI but rarely on a laptop.

The head is dropped rather than rewound: ``AuditLogger._create_chain_head``
rebuilds it from the rows that remain the next time anything seals, which is
the same seeding a ``create_all`` installation gets.
"""

from typing import Any, Mapping

from sqlalchemy import text

from app.core import audit as audit_module
from app.core.database import database_manager


async def settle_background_sealer() -> None:
    """Wait for an after-commit sealer this test started, so it cannot seal a
    row after the cleanup below has decided what the head should be."""
    task = audit_module._seal_task
    if task is not None and not task.done():
        await task


async def discard_committed_audit_rows(where: str, params: Mapping[str, Any]) -> None:
    """Delete the committed ``audit_logs`` rows matching ``where`` and drop
    the chain head so it is rebuilt from what is left.

    ``where`` is a fixed SQL condition written by the calling test, with its
    values bound through ``params``.
    """
    await settle_background_sealer()
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(text(f"DELETE FROM audit_logs WHERE {where}"), params)
            await conn.execute(text("DELETE FROM audit_chain_head"))
