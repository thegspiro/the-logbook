"""
Scheduled Task API Endpoints

Endpoints for triggering and inspecting scheduled/cron tasks.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import get_client_ip
from app.models.user import User
from app.services.scheduled_tasks import SCHEDULE, TASK_RUNNERS

router = APIRouter()


@router.get("/tasks")
async def list_scheduled_tasks(
    current_user: User = Depends(require_permission("admin.access", "settings.manage")),
):
    """
    List all available scheduled tasks with their recommended cron schedule.

    **Requires admin.access or settings.manage permission**
    """
    return {"tasks": [{"id": task_id, **info} for task_id, info in SCHEDULE.items()]}


@router.post("/run-task")
async def run_scheduled_task(
    request: Request,
    task: str = Query(..., description="Task ID to run (e.g. cert_expiration_alerts)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("system.run_tasks")),
):
    """
    Manually trigger a scheduled task.

    Each task iterates **every** organization, so triggering one has
    platform-wide side effects. It is therefore restricted to the wildcard
    "System Owner" (``system.run_tasks``) rather than a single-org admin.

    For the list of available task ids and their recommended cron schedules,
    call `GET /scheduled/tasks` — it is generated from the same `SCHEDULE`
    registry this endpoint dispatches against, so it cannot drift. (This
    docstring previously listed five of the thirty-eight, and had.)

    **Requires system.run_tasks (platform System Owner).**
    """
    runner = TASK_RUNNERS.get(task)
    if not runner:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task '{task}'. Available: {list(TASK_RUNNERS.keys())}",
        )

    # Logged and committed before the run, not after: a task that iterates
    # every organization is exactly the kind of platform-wide, System-Owner-
    # only action `log_audit_event()` exists for (see CLAUDE.md's audit-
    # logging pattern). `log_audit_event` only opens a nested savepoint, and
    # `get_db`'s session-scoped commit runs once at the end of the request —
    # if the runner subsequently raises, that whole-session commit is skipped
    # in favor of a rollback (`database.py`'s `get_session`), which would
    # silently take this entry down with it. Committing immediately makes the
    # attempt durable regardless of what the runner does afterward.
    await log_audit_event(
        db=db,
        event_type="scheduled_task.manual_trigger",
        event_category="administration",
        severity="info",
        event_data={"task": task},
        user_id=str(current_user.id),
        username=current_user.username,
        ip_address=get_client_ip(request),
    )
    await db.commit()

    result = await runner(db)
    return result
