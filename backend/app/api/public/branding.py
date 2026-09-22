"""Branded installable-app assets — the department's logo as the app icon.

Unauthenticated by necessity: a browser fetches a manifest icon and an iOS
launch image while deciding whether the site can be installed, long before
anyone signs in, and it sends no credentials when it does. Nothing here is
newly exposed — ``GET /api/v1/auth/branding`` already serves the same
department name and logo to the login page for the same reason.

A request for a logo that does not exist, or cannot be rendered, answers 404
rather than substituting anything. The reverse proxy turns that 404 into the
shipped Logbook icon (see the ``app-icon`` locations in
``frontend/nginx.conf``), which keeps the default assets in the image that
already owns them instead of copying them into this one.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.core.security_middleware import get_client_ip, public_rate_limit
from app.services import branding_service
from app.utils.app_icons import ICON_VARIANTS, parse_splash_geometry

router = APIRouter(prefix="/public/v1/branding", tags=["public-branding"])

# Browsers revalidate these on launch, and one device adding the app to its
# home screen asks for several at once. Short enough that a re-uploaded logo
# reaches a new install quickly; the ETag below makes each revalidation a 304.
CACHE_CONTROL = "public, max-age=300, must-revalidate"


async def _rate_limit_branding(request: Request) -> None:
    """Rate limit branded asset requests: 120/minute per IP (DoS guard).

    Sized for a device that installs the app — up to four icons and a launch
    image in one burst — plus the revalidations a few launches produce, while
    still refusing a script that cycles asset URLs to force renders.
    """
    client_ip = get_client_ip(request)
    is_limited, _ = await public_rate_limit(
        key=f"pub_branding:{client_ip}", max_requests=120, window_seconds=60
    )
    if is_limited:
        raise CodedHTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
            error_code=ErrorCode.SYS_RATE_LIMITED,
        )


def _png_response(request: Request, digest: str, png: bytes) -> Response:
    """A PNG body, or 304 when the caller already holds this rendering."""
    etag = f'"{digest}"'
    headers = {
        "ETag": etag,
        "Cache-Control": CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
    }

    # If-None-Match is a list, and a proxy may weaken the tag it echoes back.
    supplied = request.headers.get("if-none-match", "")
    if any(
        candidate.strip().removeprefix("W/") == etag
        for candidate in supplied.split(",")
        if candidate.strip()
    ):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)

    return Response(content=png, media_type="image/png", headers=headers)


def _not_configured() -> HTTPException:
    """The 404 that tells the reverse proxy to serve the shipped icon.

    A plain HTTPException rather than a coded one: nothing human reads this
    body. It is a routing signal consumed by nginx, and an error code would
    promise a troubleshooting narrative for what is simply a department that
    has not uploaded a logo.
    """
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="No department logo is configured.",
    )


# HEAD as well as GET: these URLs answer for files that used to be served
# straight off disk, where a HEAD was a 200, and a monitor or a proxy that
# probes them should not start seeing 405 because the bytes moved. Registered
# as a second route rather than a second method on the first: one route
# answering both emits two OpenAPI operations under one id, which FastAPI
# warns about. The HEAD route is kept out of the schema because it documents
# nothing the GET does not.
@router.head(
    "/icon/{variant}.png",
    response_class=Response,
    include_in_schema=False,
    dependencies=[Depends(_rate_limit_branding)],
)
@router.get(
    "/icon/{variant}.png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
    dependencies=[Depends(_rate_limit_branding)],
)
async def get_app_icon(
    variant: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The department's logo as one of the manifest / iOS home-screen icons."""
    if variant not in ICON_VARIANTS:
        raise _not_configured()

    rendered = await branding_service.get_app_icon(db, variant)
    if rendered is None:
        raise _not_configured()

    digest, png = rendered
    return _png_response(request, digest, png)


@router.head(
    "/splash/{geometry}.png",
    response_class=Response,
    include_in_schema=False,
    dependencies=[Depends(_rate_limit_branding)],
)
@router.get(
    "/splash/{geometry}.png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
    dependencies=[Depends(_rate_limit_branding)],
)
async def get_app_splash(
    geometry: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The department's logo as an iOS launch image for one device geometry."""
    size = parse_splash_geometry(geometry)
    if size is None:
        raise _not_configured()

    rendered = await branding_service.get_app_splash(db, size[0], size[1])
    if rendered is None:
        raise _not_configured()

    digest, png = rendered
    return _png_response(request, digest, png)
