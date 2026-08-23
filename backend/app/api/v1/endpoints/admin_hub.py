"""
Administration-page frame endpoints.

One shape serves every admin page: the four headline metrics and the "Needs
attention" queue for a module, plus the settings screen that chooses which
three metrics fill the open slots.

Access is the module's own manage permission, never a blanket admin gate — an
inventory officer who cannot manage members has no business reading the member
queue, and the queue rows name people.
"""

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_active_user, user_has_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.admin_hub import (
    AdminHubSummary,
    AdminMetricSettings,
    AdminMetricSettingsUpdate,
)
from app.services.admin_hub_service import MODULE_REGISTRY, AdminHubService

router = APIRouter()

_MODULE_PATH = Path(
    ...,
    description="Administration module key",
    pattern="^[a-z_]{1,50}$",
)


def _require_module_access(module_key: str, current_user: User) -> None:
    """Resolve the module, then check the caller holds its manage permission.

    An unknown module and a forbidden one both answer 404: a caller who may
    not administer Training should not learn from this endpoint whether the
    department runs it.
    """
    spec = MODULE_REGISTRY.get(module_key)
    if spec is None or not user_has_permission(current_user, spec.permission):
        raise HTTPException(status_code=404, detail="Administration module not found")


@router.get("/{module_key}/summary", response_model=AdminHubSummary)
async def get_admin_hub_summary(
    module_key: str = _MODULE_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> AdminHubSummary:
    """Metrics row and attention queue for one administration page."""
    _require_module_access(module_key, current_user)
    try:
        return await AdminHubService(db).get_summary(module_key, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=safe_error_detail(exc))


@router.get("/{module_key}/metrics", response_model=AdminMetricSettings)
async def get_admin_hub_metrics(
    module_key: str = _MODULE_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> AdminMetricSettings:
    """Every metric the module offers, and which three are in the slots."""
    _require_module_access(module_key, current_user)
    try:
        return await AdminHubService(db).get_settings(module_key, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=safe_error_detail(exc))


@router.put("/{module_key}/metrics", response_model=AdminMetricSettings)
async def update_admin_hub_metrics(
    payload: AdminMetricSettingsUpdate,
    module_key: str = _MODULE_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> AdminMetricSettings:
    """Save the three open slots, department-wide or for this admin alone."""
    _require_module_access(module_key, current_user)
    try:
        settings = await AdminHubService(db).save_settings(
            module_key, current_user, payload
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=safe_error_detail(exc))

    await log_audit_event(
        db=db,
        event_type="admin_hub.metrics_updated",
        event_category="administration",
        severity="info",
        event_data={
            "module": module_key,
            "metric_keys": list(payload.metric_keys),
            "applies_to_everyone": payload.applies_to_everyone,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return settings
