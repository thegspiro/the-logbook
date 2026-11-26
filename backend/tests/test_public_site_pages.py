"""The department's public website pages (``app/api/public/site.py``).

Pinned:

* nothing is served, and nobody is named, until the website is switched on,
  on a deployment with any number of departments but one, or with the Public
  Information module off;
* each page and each contact detail answers to its own switch;
* what a department types reaches the page as text, never as markup;
* links carry the router's prefix unless the public website port mapped the
  request to its own root.
"""

import pytest
from starlette.requests import Request

from app.api.public import site
from app.models.public_site import PublicSiteSettings
from app.models.user import Organization
from app.services import branding_service

pytestmark = pytest.mark.integration

_NAME = "Falls Church VFD"


@pytest.fixture(autouse=True)
def _no_cached_logo():
    branding_service.reset_branding_cache()
    yield
    branding_service.reset_branding_cache()


def _request(mapped: bool = False) -> Request:
    headers = [(b"x-public-site-mapped", b"1")] if mapped else []
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": headers,
            "query_string": b"",
        }
    )


async def _org(db, slug: str = "fcvfd", **fields) -> Organization:
    org = Organization(name=_NAME, slug=slug, **fields)
    db.add(org)
    await db.flush()
    return org


async def _settings(db, org: Organization, **fields) -> PublicSiteSettings:
    values = {"enabled": True, **fields}
    row = PublicSiteSettings(organization_id=str(org.id), **values)
    db.add(row)
    await db.flush()
    return row


def _text(response) -> str:
    return response.body.decode("utf-8")


class TestNothingIsServedUntilItIsSwitchedOn:
    async def test_no_department(self, db_session):
        response = await site.home(_request(), db_session)
        assert response.status_code == 404

    async def test_a_department_with_no_settings(self, db_session):
        await _org(db_session)
        response = await site.home(_request(), db_session)
        assert response.status_code == 404
        assert _NAME not in _text(response)

    async def test_switched_off(self, db_session):
        org = await _org(db_session)
        await _settings(db_session, org, enabled=False, show_about=True)
        for handler in (site.home, site.about, site.contact):
            response = await handler(_request(), db_session)
            assert response.status_code == 404
            assert _NAME not in _text(response)

    async def test_two_departments(self, db_session):
        first = await _org(db_session)
        await _settings(db_session, first)
        await _org(db_session, slug="other")
        response = await site.home(_request(), db_session)
        assert response.status_code == 404
        assert _NAME not in _text(response)

    async def test_the_module_switched_off(self, db_session):
        org = await _org(
            db_session,
            settings={"modules": {"public_info": False, "_user_configured": True}},
        )
        await _settings(db_session, org)
        response = await site.home(_request(), db_session)
        assert response.status_code == 404

    async def test_robots_keeps_crawlers_out_of_an_empty_address(self, db_session):
        response = await site.robots(db_session)
        assert _text(response) == "User-agent: *\nDisallow: /\n"

    async def test_the_logo_is_not_served(self, db_session):
        response = await site.logo(v="anything", db=db_session)
        assert response.status_code == 404


class TestTheHomePage:
    async def test_names_the_department(self, db_session):
        org = await _org(db_session)
        await _settings(
            db_session,
            org,
            tagline="Serving the city since 1925",
            welcome_text="First paragraph.\n\nSecond paragraph.",
        )
        response = await site.home(_request(), db_session)
        body = _text(response)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert f"<h1>{_NAME}</h1>" in body
        assert "Serving the city since 1925" in body
        assert "<p>First paragraph.</p>" in body
        assert "<p>Second paragraph.</p>" in body

    async def test_a_page_switched_off_is_not_linked(self, db_session):
        org = await _org(db_session)
        await _settings(db_session, org)
        body = _text(await site.home(_request(), db_session))
        assert "/about" not in body
        assert "/contact" not in body

    async def test_links_to_the_pages_switched_on(self, db_session):
        org = await _org(db_session)
        await _settings(db_session, org, show_about=True, show_contact=True)
        body = _text(await site.home(_request(), db_session))
        assert 'href="/public-site/about"' in body
        assert 'href="/public-site/contact"' in body
        assert 'href="/public-site/" aria-current="page"' in body

    async def test_links_sit_at_the_root_on_the_public_website_port(self, db_session):
        org = await _org(db_session)
        await _settings(db_session, org, show_about=True)
        body = _text(await site.home(_request(mapped=True), db_session))
        assert 'href="/about"' in body
        assert 'href="/assets/site.css?v=' in body
        assert "/public-site" not in body

    async def test_robots_invites_crawlers(self, db_session):
        org = await _org(db_session)
        await _settings(db_session, org)
        response = await site.robots(db_session)
        assert _text(response) == "User-agent: *\nAllow: /\n"

    @pytest.mark.parametrize("theme", ["classic", "modern", "heritage"])
    async def test_wears_the_chosen_theme(self, db_session, theme):
        org = await _org(db_session)
        await _settings(db_session, org, theme=theme)
        body = _text(await site.home(_request(), db_session))
        assert f'<body class="theme-{theme}">' in body

    async def test_an_unknown_stored_theme_falls_back(self, db_session):
        org = await _org(db_session)
        await _settings(db_session, org, theme="retired")
        body = _text(await site.home(_request(), db_session))
        assert '<body class="theme-classic">' in body


class TestWhatADepartmentTypesIsText:
    async def test_markup_is_escaped_everywhere_it_is_shown(self, db_session):
        attack = '<script>alert(1)</script>"><img src=x onerror=alert(2)>'
        # The phone column holds 20 characters, so it gets a shorter tag.
        org = await _org(db_session, phone="<b>1</b>", email=attack, county=attack)
        org.name = f"{_NAME} {attack}"
        await _settings(
            db_session,
            org,
            tagline=attack,
            welcome_text=attack,
            about_text=attack,
            emergency_notice=attack,
            show_about=True,
            show_contact=True,
            show_phone=True,
            show_email=True,
        )
        for handler in (site.home, site.about, site.contact):
            body = _text(await handler(_request(), db_session))
            assert "&lt;script&gt;alert(1)&lt;/script&gt;" in body
            assert "<script" not in body
            assert "<img src=x" not in body
            assert "<b>" not in body

    async def test_a_phone_note_with_no_digits_is_not_a_link(self, db_session):
        org = await _org(db_session, phone="javascript:alert(1)"[:20])
        await _settings(db_session, org, show_contact=True, show_phone=True)
        body = _text(await site.contact(_request(), db_session))
        assert 'href="javascript:' not in body
        assert 'href="tel:1"' in body


class TestTheAboutPage:
    async def test_switched_off_is_the_sites_own_not_found(self, db_session):
        org = await _org(db_session)
        await _settings(db_session, org, about_text="Our story.")
        response = await site.about(_request(), db_session)
        body = _text(response)
        assert response.status_code == 404
        assert "Page not found" in body
        assert "Our story." not in body
        assert 'content="noindex"' in body

    async def test_shows_the_text_and_the_record(self, db_session):
        org = await _org(db_session, founded_year=1925, county="Fairfax")
        await _settings(db_session, org, show_about=True, about_text="Our story.")
        body = _text(await site.about(_request(), db_session))
        assert "<p>Our story.</p>" in body
        assert "<dd>1925</dd>" in body
        assert "<dd>Fairfax</dd>" in body
        assert "<title>About | Falls Church VFD</title>" in body


class TestTheContactPage:
    async def _org_with_everything(self, db):
        return await _org(
            db,
            phone="(703) 555-0100",
            email="info@fcvfd.example",
            mailing_address_line1="PO Box 1",
            mailing_city="Falls Church",
            mailing_state="VA",
            mailing_zip="22046",
            physical_address_same=False,
            physical_address_line1="6950 Little Falls Rd",
            physical_city="Arlington",
            physical_state="VA",
            physical_zip="22213",
        )

    async def test_a_detail_is_shown_only_while_its_switch_is_on(self, db_session):
        org = await self._org_with_everything(db_session)
        await _settings(db_session, org, show_contact=True)
        body = _text(await site.contact(_request(), db_session))
        assert "555-0100" not in body
        assert "info@fcvfd.example" not in body
        assert "Little Falls" not in body
        assert "Contact details will be posted here soon." in body

    async def test_every_detail_switched_on(self, db_session):
        org = await self._org_with_everything(db_session)
        await _settings(
            db_session,
            org,
            show_contact=True,
            show_phone=True,
            show_email=True,
            show_address=True,
        )
        body = _text(await site.contact(_request(), db_session))
        assert '<a href="tel:7035550100">(703) 555-0100</a>' in body
        assert '<a href="mailto:info@fcvfd.example">info@fcvfd.example</a>' in body
        assert "6950 Little Falls Rd" in body
        assert "Arlington, VA 22213" in body
        assert "PO Box 1" not in body

    async def test_the_mailing_address_stands_in_for_the_station(self, db_session):
        org = await _org(
            db_session,
            mailing_address_line1="6950 Little Falls Rd",
            mailing_city="Arlington",
            mailing_state="VA",
            mailing_zip="22213",
        )
        await _settings(db_session, org, show_contact=True, show_address=True)
        body = _text(await site.contact(_request(), db_session))
        assert "6950 Little Falls Rd" in body

    async def test_the_page_switched_off_hides_the_home_page_card(self, db_session):
        org = await self._org_with_everything(db_session)
        await _settings(db_session, org, show_phone=True)
        assert (await site.contact(_request(), db_session)).status_code == 404
        assert "555-0100" not in _text(await site.home(_request(), db_session))


class TestAnyOtherAddress:
    async def test_is_the_sites_own_not_found_page(self, db_session):
        org = await _org(db_session)
        await _settings(db_session, org)
        response = await site.unknown("wp-login.php", _request(), db_session)
        assert response.status_code == 404
        assert response.headers["content-type"].startswith("text/html")
        assert "Page not found" in _text(response)

    async def test_names_nobody_while_the_website_is_off(self, db_session):
        await _org(db_session)
        response = await site.unknown("about-us", _request(), db_session)
        assert response.status_code == 404
        assert _NAME not in _text(response)


class TestTheMemberSignInLink:
    async def test_is_absent_unless_switched_on(self, db_session):
        org = await _org(db_session)
        await _settings(db_session, org)
        assert "Member sign-in" not in _text(await site.home(_request(), db_session))

    async def test_points_at_the_members_address(self, db_session, monkeypatch):
        monkeypatch.setattr(
            site.settings, "FRONTEND_URL", "https://logbook.fcvfd.example/"
        )
        org = await _org(db_session)
        await _settings(db_session, org, show_member_login=True)
        body = _text(await site.home(_request(), db_session))
        assert 'href="https://logbook.fcvfd.example/login"' in body


class TestTheStylesheet:
    async def test_is_served_as_css_and_cached_by_its_digest(self):
        response = await site.stylesheet()
        assert response.headers["content-type"] == "text/css; charset=utf-8"
        assert "immutable" in response.headers["cache-control"]
        assert b".theme-classic" in response.body
