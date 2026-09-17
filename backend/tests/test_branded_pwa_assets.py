"""The department's logo, rendered into the assets an installed app shows.

Three things are worth pinning here and none of them fail loudly in production:
a browser that cannot use an icon simply shows a generic one, an iOS launch
image for a geometry nobody declared is never requested, and a logo this server
declines to decode looks identical to a department that never uploaded one.
"""

import base64
import re
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from PIL import Image

import app.api.public.branding as branding_api
from app.models.user import Organization
from app.services import branding_service
from app.utils.app_icons import (
    ICON_VARIANTS,
    MASKABLE_SAFE_FRACTION,
    SPLASH_GEOMETRIES,
    decode_logo,
    parse_splash_geometry,
    render_icon,
    render_splash,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
INDEX_HTML = REPO_ROOT / "frontend" / "index.html"
NGINX_CONF = REPO_ROOT / "frontend" / "nginx.conf"


def _logo_data_uri(
    size: tuple[int, int] = (400, 300),
    colour: tuple[int, int, int, int] = (200, 30, 30, 255),
) -> str:
    """A real PNG, as the settings screen's FileReader would have stored it."""
    buffer = BytesIO()
    Image.new("RGBA", size, colour).save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


@pytest.fixture(autouse=True)
def _clear_branding_cache():
    """The logo and its renderings are cached per process, not per test."""
    branding_service.reset_branding_cache()
    yield
    branding_service.reset_branding_cache()


@pytest.mark.unit
class TestDecodeLogo:
    def test_reads_a_stored_data_uri(self):
        logo = decode_logo(_logo_data_uri())

        assert logo is not None
        assert logo.size == (400, 300)
        assert logo.mode == "RGBA"

    def test_refuses_an_external_url(self):
        # The column accepts an external URL, and fetching one here would turn
        # an unauthenticated icon request into a server-side request to a host
        # of the caller's choosing.
        assert decode_logo("https://example.com/logo.png") is None
        assert decode_logo("http://169.254.169.254/latest/meta-data/") is None

    @pytest.mark.parametrize(
        "stored",
        [
            None,
            "",
            "data:image/png;base64,not base64 at all",
            "data:image/png;base64," + base64.b64encode(b"nope").decode(),
            "data:image/svg+xml;base64,"
            + base64.b64encode(b"<svg xmlns='http://www.w3.org/2000/svg'/>").decode(),
        ],
    )
    def test_unusable_values_degrade_to_none(self, stored):
        # None means "serve the shipped icon", which is the right answer for
        # every one of these — never a 500 at a browser trying to install.
        assert decode_logo(stored) is None

    def test_refuses_an_oversized_payload(self):
        oversized = "data:image/png;base64," + ("A" * (8 * 1024 * 1024))

        assert decode_logo(oversized) is None


@pytest.mark.unit
class TestRenderIcon:
    @pytest.mark.parametrize("name", sorted(ICON_VARIANTS))
    def test_renders_the_declared_square(self, name):
        logo = decode_logo(_logo_data_uri())

        icon = Image.open(BytesIO(render_icon(logo, ICON_VARIANTS[name])))

        assert icon.size == (ICON_VARIANTS[name].size,) * 2
        assert icon.format == "PNG"

    def test_manifest_icons_keep_their_transparency(self):
        logo = decode_logo(_logo_data_uri(size=(100, 400)))

        icon = Image.open(BytesIO(render_icon(logo, ICON_VARIANTS["192"]))).convert(
            "RGBA"
        )

        # A tall logo leaves the corners of a square canvas empty; they stay
        # transparent so the mark sits on the launcher's own background.
        assert icon.getpixel((0, 0))[3] == 0

    @pytest.mark.parametrize("name", ["maskable-512", "apple-touch"])
    def test_masked_and_ios_icons_get_an_opaque_plate(self, name):
        # Android fills a masked icon's surround itself, and iOS composites
        # transparency onto black — a dark crest would vanish into it.
        logo = decode_logo(_logo_data_uri(size=(100, 400)))

        icon = Image.open(BytesIO(render_icon(logo, ICON_VARIANTS[name]))).convert(
            "RGBA"
        )

        assert icon.getpixel((0, 0)) == (255, 255, 255, 255)

    def test_maskable_content_stays_inside_the_safe_zone(self):
        # A square logo is the worst case: it fills the box it is given, so if
        # the box were too large the corners would be cropped by a round mask.
        logo = decode_logo(_logo_data_uri(size=(512, 512)))
        variant = ICON_VARIANTS["maskable-512"]

        icon = Image.open(BytesIO(render_icon(logo, variant))).convert("RGBA")
        red_columns = [
            x
            for x in range(icon.width)
            if icon.getpixel((x, icon.height // 2))[:3] != (255, 255, 255)
        ]

        painted = red_columns[-1] - red_columns[0] + 1
        assert painted <= round(variant.size * MASKABLE_SAFE_FRACTION) + 1
        # And not so conservative that the icon reads as a dot on a card.
        assert painted >= variant.size * 0.5

    def test_a_logo_smaller_than_the_icon_is_enlarged(self):
        logo = decode_logo(_logo_data_uri(size=(32, 32)))

        icon = Image.open(BytesIO(render_icon(logo, ICON_VARIANTS["512"]))).convert(
            "RGBA"
        )
        painted = [
            x for x in range(icon.width) if icon.getpixel((x, icon.height // 2))[3] > 0
        ]

        assert painted[-1] - painted[0] + 1 > 400


@pytest.mark.unit
class TestRenderSplash:
    def test_renders_the_requested_device_geometry(self):
        logo = decode_logo(_logo_data_uri())

        splash = Image.open(BytesIO(render_splash(logo, 1170, 2532))).convert("RGBA")

        assert splash.size == (1170, 2532)
        # Matches the manifest's background_color so the launch image blends
        # into first paint rather than flashing against it.
        assert splash.getpixel((0, 0)) == (15, 23, 42, 255)

    def test_only_declared_geometries_are_rendered(self):
        # iOS uses a launch image only for an exactly matching device, so an
        # arbitrary size is CPU spent on an image nothing will ever request.
        assert parse_splash_geometry("1170-2532") == (1170, 2532)
        assert parse_splash_geometry("9999-9999") is None
        assert parse_splash_geometry("1170x2532") is None
        assert parse_splash_geometry("../../etc/passwd") is None
        assert parse_splash_geometry("-1--1") is None


@pytest.mark.unit
class TestFrontendContract:
    """The geometries and URLs the browser actually asks for.

    Nothing in the backend fails when these drift: index.html simply asks for a
    launch image this server refuses to render, and the department gets the
    shipped one back without a word.
    """

    def test_splash_geometries_match_the_links_in_index_html(self):
        declared = {
            (int(width), int(height))
            for width, height in re.findall(
                r"apple-splash-(\d+)-(\d+)\.png", INDEX_HTML.read_text(encoding="utf-8")
            )
        }

        assert declared == set(SPLASH_GEOMETRIES)

    def test_every_icon_variant_is_reachable_through_the_nginx_map(self):
        # The map in frontend/nginx.conf is what turns a manifest icon URL into
        # a request this router answers; a variant missing from it is rendered
        # by nobody.
        conf = NGINX_CONF.read_text(encoding="utf-8")
        mapped = set(re.findall(r"/api/public/v1/branding/icon/([\w-]+)\.png", conf))

        assert set(ICON_VARIANTS) <= mapped

    def test_the_nginx_map_routes_launch_images_too(self):
        conf = NGINX_CONF.read_text(encoding="utf-8")

        assert "/api/public/v1/branding/splash/$1-$2.png" in conf


@pytest.mark.unit
class TestBrandedAssetEndpoints:
    """The routes themselves, with the organization lookup stubbed."""

    @staticmethod
    def _request(headers: dict[str, str] | None = None):
        return SimpleNamespace(headers=headers or {})

    @pytest.fixture
    def org_with_logo(self, monkeypatch):
        branding = SimpleNamespace(name="Test FD", logo=_logo_data_uri(), settings=None)
        monkeypatch.setattr(
            branding_service,
            "get_primary_branding",
            AsyncMock(return_value=branding),
        )
        return branding

    @pytest.fixture
    def _org_without_logo(self, monkeypatch):
        monkeypatch.setattr(
            branding_service,
            "get_primary_branding",
            AsyncMock(
                return_value=SimpleNamespace(name="Test FD", logo=None, settings=None)
            ),
        )

    async def test_serves_the_rendered_icon(self, org_with_logo):
        response = await branding_api.get_app_icon("192", self._request(), db=None)

        assert response.status_code == 200
        assert response.media_type == "image/png"
        assert Image.open(BytesIO(response.body)).size == (192, 192)
        assert response.headers["etag"]

    async def test_repeat_request_with_the_etag_is_a_304(self, org_with_logo):
        first = await branding_api.get_app_icon("192", self._request(), db=None)
        etag = first.headers["etag"]

        second = await branding_api.get_app_icon(
            "192", self._request({"if-none-match": etag}), db=None
        )

        assert second.status_code == 304
        assert not second.body

    async def test_a_weakened_etag_still_matches(self, org_with_logo):
        # Some proxies re-emit a strong tag as a weak one.
        first = await branding_api.get_app_icon("192", self._request(), db=None)

        second = await branding_api.get_app_icon(
            "192",
            self._request({"if-none-match": f'W/{first.headers["etag"]}'}),
            db=None,
        )

        assert second.status_code == 304

    async def test_changing_the_logo_changes_the_etag(self, monkeypatch, org_with_logo):
        first = await branding_api.get_app_icon("192", self._request(), db=None)

        branding_service.reset_branding_cache()
        monkeypatch.setattr(
            branding_service,
            "get_primary_branding",
            AsyncMock(
                return_value=SimpleNamespace(
                    name="Test FD",
                    logo=_logo_data_uri(colour=(10, 10, 200, 255)),
                    settings=None,
                )
            ),
        )
        second = await branding_api.get_app_icon("192", self._request(), db=None)

        assert first.headers["etag"] != second.headers["etag"]

    async def test_serves_a_launch_image(self, org_with_logo):
        response = await branding_api.get_app_splash(
            "1170-2532", self._request(), db=None
        )

        assert response.status_code == 200
        assert Image.open(BytesIO(response.body)).size == (1170, 2532)

    @pytest.mark.parametrize(
        "variant", ["unmapped", "1024", "../../secret", "apple-touch "]
    )
    async def test_an_unknown_variant_is_a_404(self, variant, org_with_logo):
        # The reverse proxy reads this 404 as "serve the shipped icon", which
        # is why an unmapped URL is safe rather than broken.
        with pytest.raises(HTTPException) as excinfo:
            await branding_api.get_app_icon(variant, self._request(), db=None)

        assert excinfo.value.status_code == 404

    @pytest.mark.usefixtures("_org_without_logo")
    async def test_a_department_with_no_logo_is_a_404(self):
        with pytest.raises(HTTPException) as excinfo:
            await branding_api.get_app_icon("192", self._request(), db=None)

        assert excinfo.value.status_code == 404

    async def test_an_unreachable_database_is_a_404_not_a_500(self, monkeypatch):
        # Pre-onboarding, or mid-start. A browser deciding whether the site is
        # installable should get the shipped icon, not an error page.
        monkeypatch.setattr(
            branding_service,
            "get_primary_branding",
            AsyncMock(side_effect=RuntimeError("database is starting")),
        )

        with pytest.raises(HTTPException) as excinfo:
            await branding_api.get_app_icon("192", self._request(), db=None)

        assert excinfo.value.status_code == 404


@pytest.mark.integration
class TestPrimaryOrganizationLookup:
    """The one rule this shares with the login page's branding endpoint."""

    @staticmethod
    async def _primary_org(db_session) -> Organization:
        """The row get_primary_branding will pick, creating one if need be.

        A test database may already hold an organization, and "oldest active"
        would then pick that one rather than anything this test added — so the
        logo goes on whichever row the rule actually selects.
        """
        from sqlalchemy import select

        result = await db_session.execute(
            select(Organization)
            .where(Organization.active.is_(True))
            .order_by(Organization.created_at.asc())
            .limit(1)
        )
        org = result.scalar_one_or_none()
        if org is None:
            org = Organization(name="Test FD", slug="branded-pwa-test-fd", active=True)
            db_session.add(org)
        return org

    async def test_the_login_page_and_the_app_icon_name_one_department(
        self, db_session
    ):
        from app.api.v1.endpoints.auth import get_login_branding

        org = await self._primary_org(db_session)
        org.logo = _logo_data_uri()
        await db_session.commit()

        branding = await branding_service.get_primary_branding(db_session)
        login_branding = await get_login_branding(db_session)

        assert branding is not None
        assert branding.logo == org.logo
        # Both resolve "which organization is this deployment" through the same
        # helper; if they ever diverge a member sees one department's crest
        # above another's name.
        assert login_branding["name"] == branding.name
        assert login_branding["logo"] == branding.logo

    async def test_renders_an_icon_from_the_stored_column(self, db_session):
        org = await self._primary_org(db_session)
        org.logo = _logo_data_uri()
        await db_session.commit()

        rendered = await branding_service.get_app_icon(db_session, "512")

        assert rendered is not None
        digest, png = rendered
        assert digest
        assert Image.open(BytesIO(png)).size == (512, 512)

    async def test_a_department_with_no_logo_renders_nothing(self, db_session):
        org = await self._primary_org(db_session)
        org.logo = None
        await db_session.commit()

        assert await branding_service.get_app_icon(db_session, "512") is None
