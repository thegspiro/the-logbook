"""
The department's public website: its settings
(``/api/v1/public-site/settings``, gated on the Public Information module).

Whether the website is on, which look it uses, its text, and a switch for each
page and each contact detail. The pages themselves are served anonymously by
``app/api/public/site.py``, on the installation's public website port.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import get_client_ip
from app.core.utils import safe_error_detail
from app.models.public_site import PublicSiteSettings
from app.models.user import Organization, User
from app.schemas.public_site import (
    PublicSiteContactOnRecord,
    PublicSiteSettingsUpdate,
    PublicSiteSettingsView,
    PublicSiteThemeOption,
)
from app.services.public_site_service import (
    SWITCHES,
    TEXT_FIELDS,
    THEMES,
    PublicSiteService,
    contact_on_record,
    theme_of,
)

router = APIRouter()


async def _view(
    db: AsyncSession, organization_id: str, row: PublicSiteSettings
) -> PublicSiteSettingsView:
    org = await db.scalar(
        select(Organization).where(Organization.id == organization_id)
    )
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    record = contact_on_record(org)
    return PublicSiteSettingsView(
        **{name: bool(getattr(row, name)) for name in SWITCHES},
        **{name: getattr(row, name) for name in TEXT_FIELDS},
        theme=theme_of(row),
        themes=[PublicSiteThemeOption(**theme) for theme in THEMES],
        contact_on_record=PublicSiteContactOnRecord(
            phone=record.phone,
            email=record.email,
            address_lines=record.address_lines,
        ),
        servable=await PublicSiteService(db).is_servable(),
    )


@router.get("/settings", response_model=PublicSiteSettingsView)
async def get_public_site_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
):
    """
    The department's public website settings, with everything off when none
    have been saved, the looks on offer, and the contact details the
    department's record holds.

    **Requires permission: settings.manage**
    """
    organization_id = str(current_user.organization_id)
    row = await PublicSiteService(db).settings(organization_id)
    return await _view(db, organization_id, row)


@router.put("/settings", response_model=PublicSiteSettingsView)
async def update_public_site_settings(
    payload: PublicSiteSettingsUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
):
    """
    Change the public website's settings. Only the fields sent change; a text
    field sent as null is cleared.

    **Requires permission: settings.manage**
    """
    organization_id = str(current_user.organization_id)
    values = payload.model_dump(exclude_unset=True)
    try:
        row = await PublicSiteService(db).update_settings(
            organization_id, values, str(current_user.id)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    # Which fields changed and where the switches now stand; never the text
    # itself, which is the department's to publish and not the audit log's
    # to keep a second copy of.
    await log_audit_event(
        db,
        "public_site.settings_updated",
        "administration",
        "warning" if "enabled" in values else "info",
        {
            "changed": sorted(values),
            "switches": {name: bool(getattr(row, name)) for name in SWITCHES},
        },
        user_id=str(current_user.id),
        organization_id=organization_id,
        ip_address=get_client_ip(request),
    )
    await db.commit()
    row = await PublicSiteService(db).settings(organization_id)
    return await _view(db, organization_id, row)
