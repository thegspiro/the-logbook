"""The department's public website (``/public-site``).

Server-rendered HTML for the community a department serves: a home page, and
an About and a Contact page the department switches on separately. Anonymous
and read-only.

Reached on the installation's public website port, where the web server maps
the whole site onto this router (``/about`` there is ``/public-site/about``
here) and says so with ``X-Public-Site-Mapped``. The pages are not proxied on
the members' address at all, so the two never share an origin or a cookie.

Whether anything is served is decided on every request from the department's
current settings, so switching the website or a page off takes effect at once;
pages are ``no-store`` for the same reason. Until the website is switched on
every path answers a bare 404 that names nobody.

Multi-tenant note, as for the public minutes: an anonymous visitor carries no
organization, so the website answers only on a deployment with exactly one.

Everything a department types is rendered as text. Jinja's autoescaping is on
for every template and no value is marked safe.
"""

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security_middleware import get_client_ip, public_rate_limit
from app.models.public_site import PublicSiteSettings
from app.models.user import Organization
from app.services import branding_service
from app.services.organization_service import OrganizationService
from app.services.public_site_service import (
    PUBLIC_SITE_MODULE,
    PublicSiteService,
    paragraphs,
    public_contact,
    theme_of,
)

ROUTE_PREFIX = "/public-site"

#: Set by the public website port's proxy rule, which serves this router at
#: the root of its own address. It only decides which prefix the pages' links
#: carry, so a caller who forges it gets broken links and nothing else.
MAPPED_HEADER = "x-public-site-mapped"

router = APIRouter(prefix=ROUTE_PREFIX, tags=["public-site"])

_TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "templates" / "public_site"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    # Unconditional: every template here is HTML, whatever its file is called.
    autoescape=select_autoescape(default=True, default_for_string=True),
    trim_blocks=True,
    lstrip_blocks=True,
)

_STYLESHEET = (_TEMPLATE_DIR / "site.css").read_bytes()
_STYLESHEET_VERSION = hashlib.sha256(_STYLESHEET).hexdigest()[:12]

_NO_STORE = {"Cache-Control": "no-store"}
# The stylesheet and the logo are addressed by a digest of their content, so a
# changed one has a new address and an old copy can be kept for a long time.
_VERSIONED_ASSET = {"Cache-Control": "public, max-age=31536000, immutable"}

_BARE_NOT_FOUND = (
    "<!doctype html>\n"
    '<html lang="en"><head><meta charset="utf-8">'
    '<meta name="robots" content="noindex">'
    "<title>Not found</title></head>"
    "<body><h1>Not found</h1></body></html>\n"
)


@dataclass(frozen=True)
class _Site:
    org: Organization
    row: PublicSiteSettings


async def _rate_limit_site(request: Request) -> None:
    """Rate limit the public website: 240 requests a minute per address.

    A page is three requests (the page, its stylesheet, the logo), and a
    station's own visitors share one address.
    """
    client_ip = get_client_ip(request)
    is_limited, _ = await public_rate_limit(
        key=f"pub_site:{client_ip}", max_requests=240, window_seconds=60
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
        )


async def _site(db: AsyncSession) -> Optional[_Site]:
    """The website this deployment serves, or ``None`` while it serves none.

    ``limit(2)`` and an exact count of one is the whole safeguard: ``.first()``
    would publish an arbitrary department once a second exists.
    """
    orgs = (await db.execute(select(Organization).limit(2))).scalars().all()
    if len(orgs) != 1:
        return None
    org = orgs[0]
    enabled = (
        await OrganizationService(db).get_enabled_modules(org.id)
    ).enabled_modules
    if PUBLIC_SITE_MODULE not in enabled:
        return None
    row = await PublicSiteService(db).settings(str(org.id))
    if not row.enabled:
        return None
    return _Site(org=org, row=row)


def _base_path(request: Request) -> str:
    """The prefix this request's links need: none on the public website port,
    the router's own when the backend is reached directly."""
    return "" if request.headers.get(MAPPED_HEADER) == "1" else ROUTE_PREFIX


def _member_login_url() -> Optional[str]:
    url = (settings.FRONTEND_URL or "").strip().rstrip("/")
    if not url.startswith(("https://", "http://")):
        return None
    return f"{url}/login"


async def _logo_version(db: AsyncSession) -> Optional[str]:
    rendered = await branding_service.get_email_logo(db)
    return rendered[0] if rendered else None


async def _context(request: Request, db: AsyncSession, site: _Site) -> dict[str, Any]:
    row = site.row
    base = _base_path(request)
    logo_version = await _logo_version(db)
    nav = [{"key": "home", "label": "Home", "href": f"{base}/"}]
    if row.show_about:
        nav.append({"key": "about", "label": "About", "href": f"{base}/about"})
    if row.show_contact:
        nav.append({"key": "contact", "label": "Contact", "href": f"{base}/contact"})
    return {
        "name": site.org.name,
        "tagline": row.tagline,
        "emergency_notice": row.emergency_notice,
        "theme": theme_of(row),
        "nav": nav,
        "home_href": f"{base}/",
        "stylesheet_href": f"{base}/assets/site.css?v={_STYLESHEET_VERSION}",
        "logo_href": (f"{base}/assets/logo?v={logo_version}" if logo_version else None),
        "member_login_url": _member_login_url() if row.show_member_login else None,
        "show_about": row.show_about,
        "show_contact": row.show_contact,
    }


def _html(template: str, context: dict[str, Any], status_code: int = 200) -> Response:
    body = _env.get_template(template).render(**context)
    return HTMLResponse(body, status_code=status_code, headers=_NO_STORE)


def _bare_not_found() -> Response:
    return HTMLResponse(_BARE_NOT_FOUND, status_code=404, headers=_NO_STORE)


async def _not_found(request: Request, db: AsyncSession, site: _Site) -> Response:
    context = await _context(request, db, site)
    return _html("not_found.html", {**context, "page": None}, status_code=404)


def _page(path: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Register an HTML page: GET and HEAD, rate limited, out of the schema."""
    return router.api_route(
        path,
        methods=["GET", "HEAD"],
        response_class=HTMLResponse,
        include_in_schema=False,
        dependencies=[Depends(_rate_limit_site)],
    )


@_page("/")
async def home(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """The website's home page."""
    site = await _site(db)
    if site is None:
        return _bare_not_found()
    context = await _context(request, db, site)
    return _html(
        "home.html",
        {
            **context,
            "page": "home",
            "welcome": paragraphs(site.row.welcome_text),
            "contact": (
                public_contact(site.org, site.row) if site.row.show_contact else None
            ),
        },
    )


@_page("/about")
async def about(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """The About page, while the department has it switched on."""
    site = await _site(db)
    if site is None:
        return _bare_not_found()
    if not site.row.show_about:
        return await _not_found(request, db, site)
    context = await _context(request, db, site)
    return _html(
        "about.html",
        {
            **context,
            "page": "about",
            "about": paragraphs(site.row.about_text),
            "founded_year": site.org.founded_year,
            "county": site.org.county,
        },
    )


@_page("/contact")
async def contact(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """The Contact page, while the department has it switched on."""
    site = await _site(db)
    if site is None:
        return _bare_not_found()
    if not site.row.show_contact:
        return await _not_found(request, db, site)
    context = await _context(request, db, site)
    return _html(
        "contact.html",
        {
            **context,
            "page": "contact",
            "contact": public_contact(site.org, site.row),
        },
    )


@router.api_route(
    "/assets/site.css",
    methods=["GET", "HEAD"],
    response_class=Response,
    include_in_schema=False,
    dependencies=[Depends(_rate_limit_site)],
)
async def stylesheet() -> Response:
    """The website's one stylesheet. It holds no department's data, so it is
    served whether or not the website is on."""
    return Response(
        _STYLESHEET,
        media_type="text/css; charset=utf-8",
        headers=_VERSIONED_ASSET,
    )


@router.api_route(
    "/assets/logo",
    methods=["GET", "HEAD"],
    response_class=Response,
    include_in_schema=False,
    dependencies=[Depends(_rate_limit_site)],
)
async def logo(
    v: str = Query("", max_length=64), db: AsyncSession = Depends(get_db)
) -> Response:
    """The department's logo, at the address the pages give it.

    ``v`` must be the current logo's digest: a replaced logo's address stops
    answering, so no cache keeps showing a crest the department has changed.
    """
    if await _site(db) is None:
        return _bare_not_found()
    rendered = await branding_service.get_email_logo(db)
    if rendered is None or v != rendered[0]:
        return _bare_not_found()
    return Response(rendered[1], media_type="image/png", headers=_VERSIONED_ASSET)


@router.api_route(
    "/robots.txt",
    methods=["GET", "HEAD"],
    response_class=PlainTextResponse,
    include_in_schema=False,
    dependencies=[Depends(_rate_limit_site)],
)
async def robots(db: AsyncSession = Depends(get_db)) -> Response:
    """Invite search engines in while the website is on, and keep them out of
    an address that is serving nothing."""
    rule = "Allow: /" if await _site(db) is not None else "Disallow: /"
    return PlainTextResponse(f"User-agent: *\n{rule}\n", headers=_NO_STORE)


@_page("/{path:path}")
async def unknown(
    path: str, request: Request, db: AsyncSession = Depends(get_db)
) -> Response:
    """Any other address: the website's own Not Found page, as HTML, where the
    application's JSON error would be shown to a visitor as raw text."""
    site = await _site(db)
    if site is None:
        return _bare_not_found()
    return await _not_found(request, db, site)
