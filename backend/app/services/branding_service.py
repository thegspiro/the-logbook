"""The department this deployment belongs to, and the assets branded with it.

One rule lives here rather than at each call site: *which* organization a
request with no session belongs to. A deployment serves one department, so it
is the oldest active organization — but that is a rule, not an obvious fact,
and the login page, the onboarding splash and the installable app's icons all
have to agree on it or a member sees one department's name above another's
crest.
"""

import asyncio
import hashlib
from collections import OrderedDict
from time import monotonic
from typing import Any, NamedTuple, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import _is_loopback_url, settings
from app.models.user import Organization
from app.utils.app_icons import (
    EMAIL_LOGO_VARIANT,
    ICON_VARIANTS,
    decode_logo,
    render_icon,
    render_splash,
)


class OrganizationBranding(NamedTuple):
    """How the department presents itself, before anyone has signed in."""

    name: Optional[str]
    logo: Optional[str]
    settings: Optional[dict[str, Any]]


# How long a logo read is reused. The logo is a base64 data URI in a LONGTEXT
# column — up to a couple of megabytes — and an iPhone adding the app to its
# home screen asks for an icon and a launch image within the same second. A
# short window keeps that burst off the database while still picking up a logo
# change without a restart.
LOGO_CACHE_TTL_SECONDS = 60.0

# A deployment has one logo and renders at most 18 assets from it (4 icons and
# 14 launch images), so this holds a full set with room for one logo change
# before the oldest entries are dropped.
ASSET_CACHE_MAX_ENTRIES = 40

_logo_cache: dict[str, Any] = {}
_asset_cache: "OrderedDict[tuple[str, str], bytes]" = OrderedDict()

# Rendering a 2048x2732 launch image allocates ~22 MB and blocks for a moment.
# Serialising renders bounds that to one at a time, and means the 14 launch
# images a cold device could ask for at once are produced in turn rather than
# all at once.
_render_lock = asyncio.Lock()


async def get_primary_branding(db: AsyncSession) -> Optional[OrganizationBranding]:
    """The branding of the organization this deployment serves.

    Returns ``None`` before onboarding has created one. Raises whatever the
    database raises — callers on a request path that must survive an unready
    database (the login page) catch it themselves.
    """
    result = await db.execute(
        select(Organization.name, Organization.logo, Organization.settings)
        .where(Organization.active.is_(True))
        .order_by(Organization.created_at.asc())
        .limit(1)
    )
    row = result.first()
    if not row:
        return None
    # Attribute access, not indexing: a SQLAlchemy Row supports both, and the
    # columns are named here so a reordered select cannot silently swap them.
    return OrganizationBranding(name=row.name, logo=row.logo, settings=row.settings)


async def get_app_icon(
    db: AsyncSession, variant_name: str
) -> Optional[tuple[str, bytes]]:
    """The department's logo as the named icon variant, or ``None``.

    ``None`` means "serve the shipped icon instead" — no organization yet, no
    logo configured, or a logo this server cannot render.
    """
    variant = ICON_VARIANTS.get(variant_name)
    if variant is None:
        return None
    return await _get_asset(
        db, f"icon:{variant_name}", lambda logo: render_icon(logo, variant)
    )


async def get_email_logo(db: AsyncSession) -> Optional[tuple[str, bytes]]:
    """The department's logo sized for an email masthead, or ``None``."""
    return await _get_asset(
        db, "email", lambda logo: render_icon(logo, EMAIL_LOGO_VARIANT)
    )


# Path of the email logo route, relative to the site. Extensionless on
# purpose: frontend/nginx.conf serves every URL ending in .png from disk, ahead
# of its /api proxy, so "/email-logo.png" would never reach the backend.
EMAIL_LOGO_PATH = "/api/public/v1/branding/email-logo"


def email_logo_src(logo: Optional[str]) -> str:
    """The address an email should load the department's logo from.

    An uploaded logo is stored as a base64 data URI, and embedding that in a
    message pushes it past Gmail's 102 KB clipping limit, so an email instead
    links to the rendering this deployment serves. The ``v`` parameter is the
    logo's digest, which does two jobs: a new upload gets a new URL, so a mail
    client's cached copy never shows a crest the department has replaced, and
    the route answers 404 for any digest but the current one, so an email from
    an organization other than the one this deployment serves shows its alt
    text rather than somebody else's crest.

    A logo stored as an ``https://`` address is returned as it is, as before.
    Nothing is returned when ``FRONTEND_URL`` is loopback: a recipient could
    not load an image from it, and a broken image is worse than no logo.
    """
    value = str(logo or "")
    if not value:
        return ""
    if not value.startswith("data:"):
        return value
    base = (settings.FRONTEND_URL or "").strip().rstrip("/")
    if not base or _is_loopback_url(base):
        return ""
    return f"{base}{EMAIL_LOGO_PATH}?v={logo_digest(value)}"


def logo_digest(logo: str) -> str:
    """The short hash that identifies one version of a stored logo."""
    return hashlib.sha256(logo.encode("utf-8", "replace")).hexdigest()[:16]


async def get_app_splash(
    db: AsyncSession, width: int, height: int
) -> Optional[tuple[str, bytes]]:
    """The department's logo as an iOS launch image, or ``None``."""
    return await _get_asset(
        db,
        f"splash:{width}-{height}",
        lambda logo: render_splash(logo, width, height),
    )


async def _get_asset(
    db: AsyncSession, asset_key: str, render
) -> Optional[tuple[str, bytes]]:
    """Render *asset_key* from the current logo, returning ``(digest, png)``.

    The digest identifies the logo the asset was rendered from, and becomes the
    ETag — so a department that changes its logo invalidates every asset at
    once, and one that has not changed it answers a revalidation with a 304.
    """
    digest, logo_value = await _current_logo(db)
    if digest is None:
        return None

    cached = _asset_cache.get((digest, asset_key))
    if cached is not None:
        _asset_cache.move_to_end((digest, asset_key))
        return digest, cached

    async with _render_lock:
        # Another request may have rendered this while we waited for the lock.
        cached = _asset_cache.get((digest, asset_key))
        if cached is not None:
            _asset_cache.move_to_end((digest, asset_key))
            return digest, cached

        logo = await asyncio.to_thread(decode_logo, logo_value)
        if logo is None:
            return None
        png = await asyncio.to_thread(render, logo)

        _asset_cache[(digest, asset_key)] = png
        _asset_cache.move_to_end((digest, asset_key))
        while len(_asset_cache) > ASSET_CACHE_MAX_ENTRIES:
            _asset_cache.popitem(last=False)

    return digest, png


async def _current_logo(db: AsyncSession) -> tuple[Optional[str], Optional[str]]:
    """``(digest, logo)`` for the deployment's organization, cached briefly."""
    now = monotonic()
    if _logo_cache.get("expires_at", 0.0) > now:
        return _logo_cache["digest"], _logo_cache["logo"]

    try:
        branding = await get_primary_branding(db)
    except Exception:
        # Pre-onboarding, or a database that is not up yet. An icon request is
        # not worth a 500 — the shipped icon is a correct answer here.
        return None, None

    logo = branding.logo if branding else None
    digest = logo_digest(logo) if logo else None
    _logo_cache.update(
        {"expires_at": now + LOGO_CACHE_TTL_SECONDS, "digest": digest, "logo": logo}
    )
    return digest, logo


def reset_branding_cache() -> None:
    """Drop every cached logo and rendered asset.

    Used by tests, and by the organization profile endpoint so a logo a chief
    has just uploaded is served immediately rather than after the TTL.
    """
    _logo_cache.clear()
    _asset_cache.clear()
