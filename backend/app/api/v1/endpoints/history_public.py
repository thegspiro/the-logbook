"""
What the department's website may show from History
(``/api/v1/history/public-settings``, gated on the module).

The switches for each part of History the public portal serves, all off until
somebody turns one on, and the "Today in history" widget: its style, and its
secret link, which is made and shown once, then kept only as a hash. Making a
new link stops the old one at once.

Edited by holders of ``history.manage`` (the archive's keepers) or
``settings.manage`` (who also run the Public Portal). Audit entries name what
changed, never the link's secret.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.api.v1.endpoints.history_events import _audit
from app.core.database import get_db
from app.models.history import HistoryPublicSettings
from app.models.public_portal import PublicPortalAPIKey, PublicPortalConfig
from app.models.user import Organization, User
from app.schemas.history import (
    HistoryPublicSettingsUpdate,
    HistoryPublicSettingsView,
    HistoryWidgetLink,
)
from app.services.history_public_service import SWITCHES, HistoryPublicService
from app.utils.embed_origins import department_embed_origins

router = APIRouter()


async def _view(
    db: AsyncSession, organization_id: str, row: HistoryPublicSettings
) -> HistoryPublicSettingsView:
    config = await db.scalar(
        select(PublicPortalConfig).where(
            PublicPortalConfig.organization_id == organization_id
        )
    )
    now = datetime.now(timezone.utc)
    key_id: Optional[str] = await db.scalar(
        select(PublicPortalAPIKey.id)
        .where(
            PublicPortalAPIKey.organization_id == organization_id,
            PublicPortalAPIKey.is_active.is_(True),
            or_(
                PublicPortalAPIKey.expires_at.is_(None),
                PublicPortalAPIKey.expires_at > now,
            ),
        )
        .limit(1)
    )
    return HistoryPublicSettingsView(
        **{name: bool(getattr(row, field)) for name, field in SWITCHES.items()},
        widget_theme=row.widget_theme.value,
        widget_show_branding=bool(row.widget_show_branding),
        widget_link_exists=row.widget_token_hash is not None,
        widget_token_created_at=row.widget_token_created_at,
        portal_enabled=bool(config and config.enabled),
        portal_has_key=key_id is not None,
        widget_websites=department_embed_origins(
            await db.scalar(
                select(Organization.settings).where(Organization.id == organization_id)
            )
        ),
    )


@router.get("/public-settings", response_model=HistoryPublicSettingsView)
async def get_public_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("history.manage", "settings.manage")
    ),
):
    """
    What the department's website may show from History, and whether the
    Public Portal it reaches it through is on and has a key.

    **Requires permission: history.manage or settings.manage**
    """
    organization_id = str(current_user.organization_id)
    row = await HistoryPublicService(db).settings(organization_id)
    return await _view(db, organization_id, row)


@router.put("/public-settings", response_model=HistoryPublicSettingsView)
async def update_public_settings(
    payload: HistoryPublicSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("history.manage", "settings.manage")
    ),
):
    """
    Switch parts of History on or off for the website, and set the widget's
    style. Only the fields sent change.

    **Requires permission: history.manage or settings.manage**
    """
    organization_id = str(current_user.organization_id)
    values = payload.model_dump(exclude_unset=True)
    row = await HistoryPublicService(db).update_settings(
        organization_id, values, str(current_user.id)
    )
    await _audit(
        db,
        current_user,
        "history_public_settings_updated",
        {"changed": sorted(k for k, v in values.items() if v is not None)},
    )
    await db.commit()
    return await _view(db, organization_id, row)


@router.post(
    "/public-settings/widget-link",
    response_model=HistoryWidgetLink,
    status_code=status.HTTP_201_CREATED,
)
async def make_widget_link(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("history.manage", "settings.manage")
    ),
):
    """
    A new secret link for the "Today in history" widget. Any earlier link
    stops working at once. The secret is returned this once and only its hash
    is kept, so it cannot be shown again.

    **Requires permission: history.manage or settings.manage**
    """
    token = await HistoryPublicService(db).make_widget_token(
        str(current_user.organization_id), str(current_user.id)
    )
    await _audit(db, current_user, "history_widget_link_made", {})
    await db.commit()
    return HistoryWidgetLink(token=token)


@router.delete("/public-settings/widget-link", status_code=status.HTTP_204_NO_CONTENT)
async def remove_widget_link(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("history.manage", "settings.manage")
    ),
):
    """
    Remove the widget's link. A website still showing it shows nothing.

    **Requires permission: history.manage or settings.manage**
    """
    await HistoryPublicService(db).remove_widget_token(
        str(current_user.organization_id), str(current_user.id)
    )
    await _audit(db, current_user, "history_widget_link_removed", {})
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
