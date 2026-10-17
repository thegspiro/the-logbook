"""
The one place a member's departure reaches their directory account.

A member leaves when they are dropped (and stay gone through archiving) or
deleted, and returns when a drop is undone, they rejoin, or an archived record
is reactivated. Those changes are made from many places -- the status
endpoint, undo-drop, reactivation, auto-archive, soft and hard delete,
anonymization -- and any future path that touches ``User.status`` or
``User.deleted_at`` would be another. So nothing here is called by those paths:
a session hook watches every flush for a member crossing that line and, in the
same transaction, records on their account record that it should be suspended
or no longer suspended. A path cannot forget to do it.

The directory itself is never called from inside a transaction. After the
commit, a
background task brings the accounts into line (the pattern the audit chain's
sealer uses); the ``google_workspace_suspension_sync`` scheduled task is the
backstop for anything that task did not finish and for retries. A rolled-back
departure leaves nothing behind.

Only the line crossing matters, never the route: retired, on leave, inactive
and suspended-in-The-Logbook members keep their account (owner decision,
2026-10-15).
"""

import asyncio
from datetime import datetime, timezone
from typing import Any, Optional

from loguru import logger
from sqlalchemy import and_, event, inspect, not_, select, update
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.models.directory_account import (
    DirectoryAccountProvision,
    DirectoryAccountStatus,
)
from app.models.user import User, UserStatus

# A member in one of these, or deleted, has left the department.
DEPARTED_STATUSES = frozenset(
    {UserStatus.DROPPED_VOLUNTARY, UserStatus.DROPPED_INVOLUNTARY, UserStatus.ARCHIVED}
)

# Accounts that exist in the directory, and so can be suspended.
SUSPENDABLE_STATUSES = (
    DirectoryAccountStatus.CREATED.value,
    DirectoryAccountStatus.LINKED_EXISTING.value,
)

# session.info keys: work this transaction has staged for after its commit.
_RECONCILE = "directory_account_reconcile"  # {(organization_id, user_id)}
# [(organization_id, provider, account_ref)]
_DETACHED = "directory_account_detached"

_tasks: set["asyncio.Task[None]"] = set()


def has_departed(status: Any, deleted_at: Optional[datetime]) -> bool:
    if deleted_at is not None:
        return True
    try:
        return UserStatus(status) in DEPARTED_STATUSES
    except ValueError:
        return False


def _previous(user: User, attribute: str) -> Any:
    history = inspect(user).attrs[attribute].history
    if history.deleted:
        return history.deleted[0]
    return getattr(user, attribute)


def _stage(session: Session, user: User, suspended: bool) -> None:
    organization_id = str(user.organization_id)
    user_id = str(user.id)
    requested_at = datetime.now(timezone.utc)
    still_to_do = not_(
        and_(
            DirectoryAccountProvision.suspension_wanted.is_(suspended),
            DirectoryAccountProvision.suspension_settled.is_(True),
        )
    )
    result = session.connection().execute(
        update(DirectoryAccountProvision)
        .where(
            DirectoryAccountProvision.user_id == user_id,
            DirectoryAccountProvision.organization_id == organization_id,
            DirectoryAccountProvision.status.in_(SUSPENDABLE_STATUSES),
            still_to_do,
        )
        .values(
            suspension_wanted=suspended,
            suspension_settled=False,
            suspension_error=None,
            suspension_requested_at=requested_at,
        )
    )
    if not result.rowcount:
        return
    # A copy already loaded in this session would otherwise keep the old
    # values, and anything reading it before a refresh would act on them.
    for loaded in list(session.identity_map.values()):
        if isinstance(loaded, DirectoryAccountProvision) and loaded.user_id == user_id:
            set_committed_value(loaded, "suspension_wanted", suspended)
            set_committed_value(loaded, "suspension_settled", False)
            set_committed_value(loaded, "suspension_error", None)
            set_committed_value(loaded, "suspension_requested_at", requested_at)
    session.info.setdefault(_RECONCILE, set()).add((organization_id, user_id))


def _capture_before_hard_delete(session: Session, user: User) -> None:
    """The account record goes with the member (ON DELETE CASCADE), so the
    account is captured now and suspended once the delete has committed."""
    row = (
        session.connection()
        .execute(
            select(
                DirectoryAccountProvision.provider,
                DirectoryAccountProvision.external_user_id,
                DirectoryAccountProvision.primary_email,
            ).where(
                DirectoryAccountProvision.user_id == str(user.id),
                DirectoryAccountProvision.organization_id == str(user.organization_id),
                DirectoryAccountProvision.status.in_(SUSPENDABLE_STATUSES),
            )
        )
        .first()
    )
    if row is None:
        return
    account_ref = row.external_user_id or row.primary_email
    session.info.setdefault(_DETACHED, []).append(
        (str(user.organization_id), row.provider, account_ref)
    )


@event.listens_for(Session, "before_flush")
def _detect_departures(session: Session, flush_context: Any, instances: Any) -> None:
    for obj in list(session.dirty):
        if not isinstance(obj, User):
            continue
        state = inspect(obj)
        if not (
            state.attrs.status.history.has_changes()
            or state.attrs.deleted_at.history.has_changes()
        ):
            continue
        was_gone = has_departed(_previous(obj, "status"), _previous(obj, "deleted_at"))
        is_gone = has_departed(obj.status, obj.deleted_at)
        if was_gone != is_gone:
            _stage(session, obj, suspended=is_gone)
    for obj in list(session.deleted):
        if isinstance(obj, User):
            _capture_before_hard_delete(session, obj)


@event.listens_for(Session, "after_commit")
def _sync_after_commit(session: Session) -> None:
    reconcile = session.info.pop(_RECONCILE, None)
    detached = session.info.pop(_DETACHED, None)
    if not reconcile and not detached:
        return
    # A session bound to a Connection someone else began a transaction on
    # (the test fixture's outer transaction, a migration) has only released a
    # savepoint: nothing is committed, and another session would not see it.
    if isinstance(session.bind, Connection):
        session.info[_RECONCILE] = reconcile or set()
        session.info[_DETACHED] = detached or []
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # no event loop (a sync script): the scheduled task catches up
    task = loop.create_task(
        _run_after_commit(sorted(reconcile or ()), list(detached or ()))
    )
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


@event.listens_for(Session, "after_soft_rollback")
def _forget_on_rollback(session: Session, previous_transaction: Any) -> None:
    if previous_transaction.parent is None and not previous_transaction.nested:
        session.info.pop(_RECONCILE, None)
        session.info.pop(_DETACHED, None)


async def _run_after_commit(
    reconcile: list[tuple[str, str]], detached: list[tuple[str, str, str]]
) -> None:
    from app.core.database import async_session_factory
    from app.services.directory_account_service import DirectoryAccountService

    try:
        async with async_session_factory() as db:
            service = DirectoryAccountService(db)
            for organization_id, user_id in reconcile:
                await service.reconcile_suspension(user_id, organization_id)
            for organization_id, provider, account_ref in detached:
                await service.suspend_detached(
                    organization_id, provider, account_ref, actor_id=None
                )
    except Exception:
        # The scheduled google_workspace_suspension_sync task is the backstop
        # for every staged row; a detached account it cannot see is in the
        # audit log's absence and the server log.
        logger.exception("After-commit directory account suspension sync failed")


async def run_staged_now(session: Any) -> None:
    """Run, on *session*, what its committed transactions staged.

    For a session whose commits only release savepoints (tests), where the
    after-commit task deliberately does not run.
    """
    from app.services.directory_account_service import DirectoryAccountService

    info = (
        session.sync_session.info if hasattr(session, "sync_session") else session.info
    )
    reconcile = sorted(info.pop(_RECONCILE, None) or ())
    detached = list(info.pop(_DETACHED, None) or ())
    service = DirectoryAccountService(session)
    for organization_id, user_id in reconcile:
        await service.reconcile_suspension(user_id, organization_id)
    for organization_id, provider, account_ref in detached:
        await service.suspend_detached(
            organization_id, provider, account_ref, actor_id=None
        )
