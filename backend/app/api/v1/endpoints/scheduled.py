"""
Scheduled Task API Endpoints

Endpoints for triggering and inspecting scheduled/cron tasks.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
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
    task: str = Query(..., description="Task ID to run (e.g. cert_expiration_alerts)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("system.run_tasks")),
):
    """
    Manually trigger a scheduled task.

    Each task iterates **every** organization, so triggering one has
    platform-wide side effects. It is therefore restricted to the wildcard
    "System Owner" (``system.run_tasks``) rather than a single-org admin.

    Available tasks:
    - `cert_expiration_alerts` — Send tiered cert expiration alerts (daily)
    - `struggling_member_check` — Detect members falling behind (weekly)
    - `enrollment_deadline_warnings` — Warn approaching deadlines (weekly)
    - `membership_tier_advance` — Auto-advance membership tiers (monthly)
    - `inventory_notifications` — Process delayed inventory change emails (every 15 min)

    **Requires system.run_tasks (platform System Owner).**
    """
    runner = TASK_RUNNERS.get(task)
    if not runner:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task '{task}'. Available: {list(TASK_RUNNERS.keys())}",
        )

    result = await runner(db)
    return result
