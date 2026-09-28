"""The Settings profile save validates a new logo the way onboarding does.

``PATCH /organization/profile`` stored whatever string arrived as the logo.
Emails, the installed app's icons and the login page all render from that
column, so an image the server cannot decode — or a link it cannot serve
through the email logo route — broke every one of them at once.
"""

import base64
import io
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from PIL import Image

from app.api.v1.endpoints.organizations import update_organization_profile
from app.schemas.organization import OrganizationProfileUpdate

pytestmark = pytest.mark.unit


def _png_data_uri(size=64, color=(153, 27, 27)):
    buffer = io.BytesIO()
    Image.new("RGB", (size, size), color).save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def _org(**overrides):
    base = dict(
        id="org-1",
        name="Station 12",
        timezone="America/New_York",
        phone=None,
        email=None,
        website=None,
        county=None,
        founded_year=None,
        logo=None,
        mailing_address_line1=None,
        mailing_address_line2=None,
        mailing_city=None,
        mailing_state=None,
        mailing_zip=None,
        physical_address_same=True,
        physical_address_line1=None,
        physical_address_line2=None,
        physical_city=None,
        physical_state=None,
        physical_zip=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _db(org):
    result = MagicMock()
    result.scalar_one_or_none.return_value = org
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


async def _save(org, **fields):
    user = SimpleNamespace(organization_id="org-1", id="user-1", username="chief")
    with (
        patch("app.api.v1.endpoints.organizations.log_audit_event", new=AsyncMock()),
        patch("app.api.v1.endpoints.organizations.reset_branding_cache"),
    ):
        return await update_organization_profile(
            OrganizationProfileUpdate(**fields), db=_db(org), current_user=user
        )


async def test_a_new_png_is_stored_re_encoded():
    org = _org()
    response = await _save(org, logo=_png_data_uri())

    assert org.logo.startswith("data:image/png;base64,")
    decoded = Image.open(io.BytesIO(base64.b64decode(org.logo.split(",", 1)[1])))
    assert decoded.format == "PNG"
    assert response["logo"] == org.logo


async def test_an_image_that_is_not_one_is_refused_and_nothing_is_stored():
    org = _org(logo="data:image/png;base64,T0xE")
    with pytest.raises(HTTPException) as excinfo:
        await _save(org, logo="data:image/png;base64,bm90IGFuIGltYWdl")

    assert excinfo.value.status_code == 400
    assert str(excinfo.value.detail).startswith("Invalid image")
    assert org.logo == "data:image/png;base64,T0xE"


async def test_a_too_small_image_is_refused():
    with pytest.raises(HTTPException) as excinfo:
        await _save(_org(), logo=_png_data_uri(size=8))
    assert excinfo.value.status_code == 400


@pytest.mark.parametrize(
    "link", ["https://cdn.example.org/crest.png", "HTTP://example.org/c.png"]
)
async def test_a_link_is_refused_with_a_message_that_says_so(link):
    with pytest.raises(HTTPException) as excinfo:
        await _save(_org(), logo=link)
    assert excinfo.value.status_code == 400
    assert "rather than a link" in excinfo.value.detail


async def test_an_unchanged_logo_is_not_revalidated():
    """The Settings screen resends the whole profile on every save.

    A department whose stored logo predates the check (here, an external
    link) must still be able to save its name.
    """
    stored = "https://cdn.example.org/crest.png"
    org = _org(logo=stored)

    await _save(org, name="Station 12 VFC", logo=stored)

    assert org.name == "Station 12 VFC"
    assert org.logo == stored


async def test_clearing_the_logo_is_allowed():
    org = _org(logo=_png_data_uri())
    await _save(org, logo=None)
    assert org.logo is None


async def test_a_save_without_the_logo_leaves_it_alone():
    stored = _png_data_uri()
    org = _org(logo=stored)
    await _save(org, phone="(703) 555-0112")
    assert org.logo == stored
