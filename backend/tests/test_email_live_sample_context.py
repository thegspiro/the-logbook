"""Previews and test sends use this deployment's links and the real department.

"Send test email" used ``SAMPLE_CONTEXT`` as it stood, so every button in the
test pointed at example.com and the footer carried Sample Fire Department's
phone and address — the latter winning even over the organization's real ones,
because ``build_context`` only fills keys the caller left out. A test that
does not show what a member will receive does not test much.
"""

import re
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.models.email_template import EmailTemplateType
from app.services.email_template_service import (
    SAMPLE_CONTEXT,
    TEST_RECIPIENT_FIELDS,
    TEST_SAMPLE_DATES,
    TEST_SAMPLE_PROSE_DATES,
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


# --- The recipient is the admin, the dates are today's --------------------

_ADMIN = SimpleNamespace(first_name="Jordan", last_name="Reyes", username="jreyes")
_PACIFIC = SimpleNamespace(timezone="America/Los_Angeles")
_GREETING = re.compile(r"(?:Hello|Hi|Dear)\s*,?\s*\{\{\s*(\w+)\s*\}\}")
# 03:00 UTC on the 29th is still the evening of the 28th in California.
_NOW = datetime(2026, 9, 29, 3, 0, tzinfo=timezone.utc)


class TestTheRecipientIsTheAdmin:
    def test_every_default_greeting_names_a_mapped_field(self):
        """A new template's greeting has to be decided on, not left as John."""
        for defn in EmailTemplateService._DEFAULT_TEMPLATE_DEFS:
            for variable in _GREETING.findall(defn["html"]):
                assert variable in TEST_RECIPIENT_FIELDS.get(defn["type"].value, {}), (
                    defn["type"].value,
                    variable,
                )

    def test_every_mapped_field_is_a_sample_field(self):
        for template_type, fields in TEST_RECIPIENT_FIELDS.items():
            for key in fields:
                assert key in SAMPLE_CONTEXT[template_type], (template_type, key)

    def test_the_greeting_uses_the_admins_name(self):
        context = live_sample_context("event_reminder", _org(), recipient=_ADMIN)
        assert context["recipient_name"] == "Jordan Reyes"

    def test_a_first_name_greeting_gets_the_first_name(self):
        context = live_sample_context("shift_reminder", _org(), recipient=_ADMIN)
        assert context["recipient_name"] == "Jordan"

    def test_the_welcome_describes_the_admins_own_account(self):
        context = live_sample_context("welcome", _org(), recipient=_ADMIN)
        assert (context["first_name"], context["full_name"], context["username"]) == (
            "Jordan",
            "Jordan Reyes",
            "jreyes",
        )

    def test_a_name_belonging_to_someone_else_stays_sample(self):
        """The officer told of a decline is not the member who declined."""
        context = live_sample_context("shift_decline", _org(), recipient=_ADMIN)
        assert context["member_name"] == SAMPLE_CONTEXT["shift_decline"]["member_name"]
        approval = live_sample_context("training_approval", _org(), recipient=_ADMIN)
        assert approval["submitter_name"] == "Jane Smith"

    def test_a_blank_name_keeps_the_sample_rather_than_greeting_nobody(self):
        nameless = SimpleNamespace(first_name=None, last_name="", username="x")
        context = live_sample_context("event_reminder", _org(), recipient=nameless)
        assert context["recipient_name"] == "John Doe"

    def test_without_a_recipient_the_sample_name_remains(self):
        assert live_sample_context("welcome", _org())["first_name"] == "John"


_DATE_LIKE = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October"
    r"|November|December)\s+\d{1,2},\s+\d{4}"
)
# Dates inside free prose that the map deliberately does not own.
_UNMAPPED_DATE_FIELDS = {
    ("event_request_status", "details_text"),  # rewritten via event_date
    ("event_request_status", "details_html"),  # rewritten via event_date
}


class TestTheDatesAreTodays:
    def test_every_sample_date_is_mapped(self):
        """A fixed sample date turns into last spring as soon as it is written."""
        for template_type, context in SAMPLE_CONTEXT.items():
            for key, value in context.items():
                if not isinstance(value, str) or not _DATE_LIKE.search(value):
                    continue
                if (template_type, key) in _UNMAPPED_DATE_FIELDS:
                    continue
                if key in TEST_SAMPLE_PROSE_DATES.get(template_type, {}):
                    continue
                assert key in TEST_SAMPLE_DATES.get(template_type, {}), (
                    template_type,
                    key,
                )

    def test_every_mapped_date_is_a_sample_field(self):
        for template_type, fields in TEST_SAMPLE_DATES.items():
            for key in fields:
                assert key in SAMPLE_CONTEXT[template_type], (template_type, key)

    def test_an_event_reminder_is_for_tomorrow_on_the_departments_calendar(self):
        context = live_sample_context("event_reminder", _PACIFIC, now=_NOW)
        assert context["event_start"] == "September 29, 2026 at 07:00 PM"
        assert context["event_end"] == "09:00 PM"
        assert (context["event_month"], context["event_day"]) == ("Sep", "29")

    def test_the_date_tile_drops_the_leading_zero(self):
        early = datetime(2026, 10, 3, 18, 0, tzinfo=timezone.utc)
        context = live_sample_context("event_reminder", _PACIFIC, now=early)
        assert context["event_day"] == "4"

    def test_a_completed_action_is_dated_now_in_local_time(self):
        context = live_sample_context("election_rollback", _PACIFIC, now=_NOW)
        assert context["action_time"] == "September 28, 2026 at 08:00 PM"

    def test_a_date_quoted_in_prose_moves_with_it(self):
        context = live_sample_context("event_request_status", _PACIFIC, now=_NOW)
        assert context["event_date"] == "October 19, 2026 at 06:00 PM"
        assert context["details_text"] == (
            "Scheduled Date: October 19, 2026 at 06:00 PM"
        )
        assert "October 19, 2026 at 06:00 PM" in context["details_html"]
        sample_date = SAMPLE_CONTEXT["event_request_status"]["event_date"]
        assert sample_date not in context["details_html"]

    def test_without_an_organization_the_default_zone_is_used(self):
        context = live_sample_context("event_cancellation", None, now=_NOW)
        # 23:00 on the 28th in New York, the scheduling default; +3 days.
        assert context["event_date"] == "October 01, 2026"

    def test_a_date_written_into_prose_is_moved(self):
        context = live_sample_context("storefront_window_open", _PACIFIC, now=_NOW)
        assert context["window_extra_html"] == "<p>Orders close October 12, 2026.</p>"
        vendor = live_sample_context(
            "storefront_vendor_order_placed", _PACIFIC, now=_NOW
        )
        assert "<strong>Acme Apparel</strong>" in vendor["window_extra_html"]
        assert "October 28, 2026" in vendor["window_extra_html"]
