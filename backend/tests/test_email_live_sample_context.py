"""Previews and test sends use this deployment's links and the real department.

"Send test email" used ``SAMPLE_CONTEXT`` as it stood, so every button in the
test pointed at example.com and the footer carried Sample Fire Department's
phone and address — the latter winning even over the organization's real ones,
because ``build_context`` only fills keys the caller left out. A test that
does not show what a member will receive does not test much.
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.models.email_template import EmailTemplateType
from app.services.email_template_service import (
    SAMPLE_CONTEXT,
    EmailTemplateService,
    live_sample_context,
)

pytestmark = pytest.mark.unit

LIVE = "https://logbook.station12.org"


def _org(**overrides):
    base = dict(
        name="Station 12 Volunteer Fire Co.",
        logo="",
        phone="(703) 555-0112",
        email="office@station12.org",
        website="https://station12.org",
        settings={},
        physical_address_same=True,
        mailing_address_line1="12 Firehouse Lane",
        mailing_address_line2=None,
        mailing_city="Vienna",
        mailing_state="VA",
        mailing_zip="22180",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.fixture
def _live_frontend():
    with patch(
        "app.services.email_template_service.app_settings.FRONTEND_URL", LIVE + "/"
    ):
        yield


@pytest.mark.usefixtures("_live_frontend")
class TestLinks:
    def test_every_sample_link_uses_the_live_address(self):
        for template_type in SAMPLE_CONTEXT:
            context = live_sample_context(template_type, _org())
            for key, value in context.items():
                assert "https://example." not in value, (template_type, key)

    def test_the_path_the_real_sender_builds_is_kept(self):
        context = live_sample_context("event_reminder", _org())
        assert context["event_url"] == f"{LIVE}/events/123"

    def test_query_and_fragment_survive(self):
        assert (
            live_sample_context("password_reset", _org())["reset_url"]
            == f"{LIVE}/reset-password?token=sample-token"
        )
        assert (
            live_sample_context("ballot_notification", _org())["ballot_url"]
            == f"{LIVE}/ballot#token=sample-token"
        )

    def test_sample_member_addresses_are_not_links_and_stay(self):
        """Only the link host is swapped; jdoe@example.com is sample data."""
        context = live_sample_context("election_report", _org())
        assert "jsmith@example.com" in context["ballot_recipients_html"]


class TestTheDepartmentIsReal:
    def test_the_organizations_details_replace_the_sample_ones(self):
        context = EmailTemplateService.build_context(
            live_sample_context("welcome", _org()), _org()
        )
        assert context["organization_phone"] == "(703) 555-0112"
        assert context["organization_name"] == "Station 12 Volunteer Fire Co."
        assert "12 Firehouse Lane" in context["organization_mailing_address"]
        assert "samplefd" not in context["footer_html"]
        assert "(703) 555-0112" in context["footer_html"]

    def test_a_detail_the_department_left_blank_stays_blank(self):
        """What members would see, rather than a sample number."""
        context = EmailTemplateService.build_context(
            live_sample_context("welcome", _org(phone=None)), _org(phone=None)
        )
        assert context["organization_phone"] == ""

    def test_without_an_organization_the_samples_remain(self):
        context = live_sample_context("welcome")
        assert context["organization_name"] == "Sample Fire Department"

    def test_non_organization_samples_are_untouched(self):
        context = live_sample_context("welcome", _org())
        assert context["first_name"] == "John"
        assert context["temp_password"] == "TempPass123!"


def test_a_blank_frontend_url_leaves_the_links_as_they_were():
    with patch("app.services.email_template_service.app_settings.FRONTEND_URL", ""):
        context = live_sample_context("event_reminder", _org())
    assert context["event_url"] == SAMPLE_CONTEXT["event_reminder"]["event_url"]


@pytest.mark.usefixtures("_live_frontend")
def test_a_rendered_test_email_links_to_this_deployment():
    org = _org()
    _, html, text = EmailTemplateService.render_default(
        EmailTemplateType.EVENT_REMINDER,
        live_sample_context("event_reminder", org),
        organization=org,
    )
    assert f"{LIVE}/events/123" in html
    assert "https://example." not in html
    assert "https://example." not in (text or "")
