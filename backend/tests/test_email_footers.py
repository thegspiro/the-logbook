"""
Named footers, and the templates that choose between them.

The footer used to be copy-pasted into all 35 default bodies. It is now a
small library on the organization, with each template naming the one it
closes with. The things that can quietly break: a footer whose text stops
being substituted (it is resolved a step earlier than the template body, so
it does not ride the same pass), a footer key that no longer resolves to
anything, and admin-entered text reaching the recipient as markup.

DB-free: every function under test takes the organization as a plain object.
"""

from types import SimpleNamespace

import pytest

from app.services import email_footers
from app.services.email_template_service import EmailTemplateService

pytestmark = pytest.mark.unit


def _org(**overrides):
    base = dict(
        name="Falls Church Fire & Rescue",
        logo="",
        phone="(555) 111-2222",
        email="info@example.org",
        website="https://example.org",
        settings={},
        physical_address_same=True,
        mailing_address_line1="100 Main Street",
        mailing_address_line2=None,
        mailing_city="Falls Church",
        mailing_state="VA",
        mailing_zip="22046",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _with_library(library):
    return _org(settings={email_footers.ORG_SETTINGS_FOOTER_KEY: library})


class TestTheLibrarySeedsItself:
    def test_an_organization_with_no_settings_still_has_footers(self):
        library = email_footers.read_library(_org())
        assert library["footers"]
        assert library["default_key"] in {f["key"] for f in library["footers"]}

    def test_no_organization_at_all_still_has_footers(self):
        assert email_footers.read_library(None)["footers"]

    def test_the_seeded_keys_are_the_ones_templates_reference(self):
        """A default template naming a footer nobody seeded gets no footer."""
        seeded = {f["key"] for f in email_footers.DEFAULT_FOOTERS}
        referenced = {
            defn["footer"]
            for defn in EmailTemplateService._DEFAULT_TEMPLATE_DEFS
            if defn.get("footer")
        }
        assert referenced <= seeded, sorted(referenced - seeded)


class TestAMalformedBlobStillSends:
    """Settings can be hand-edited. Mail must not stop."""

    @pytest.mark.parametrize(
        "blob",
        [
            "not a dict",
            {"footers": "not a list"},
            {"footers": []},
            {"footers": [{"key": "x"}]},
            {"footers": [{"key": "UPPER", "name": "n", "lines": []}]},
        ],
    )
    def test_unusable_settings_fall_back_to_the_seeded_library(self, blob):
        library = email_footers.read_library(_with_library(blob))
        assert library["footers"] == email_footers.DEFAULT_FOOTERS

    def test_a_default_key_naming_nothing_falls_back_to_a_real_footer(self):
        library = email_footers.read_library(
            _with_library(
                {
                    "default_key": "deleted",
                    "footers": [{"key": "only", "name": "Only", "lines": ["a"]}],
                }
            )
        )
        assert library["default_key"] == "only"


class TestResolvingWhichFooterToUse:
    def test_a_template_gets_the_footer_it_names(self):
        assert email_footers.resolve(_org(), "public")["key"] == "public"

    def test_naming_nothing_gets_the_default(self):
        assert email_footers.resolve(_org(), None)["key"] == "internal"

    def test_naming_a_deleted_footer_gets_the_default(self):
        """Deleting a footer should cost a template its choice, not its footer."""
        assert email_footers.resolve(_org(), "removed")["key"] == "internal"


class TestRenderingAFooter:
    def test_organization_variables_are_substituted(self):
        """The footer is resolved before the body, so it cannot ride that pass.

        A ``{{organization_name}}`` left unsubstituted here reaches the
        recipient as those literal braces.
        """
        context = EmailTemplateService.build_context({}, _org())
        assert "{{" not in context["footer_html"]
        assert "{{" not in context["footer_text"]
        assert "Falls Church Fire &amp; Rescue" in context["footer_html"]
        assert "Falls Church Fire & Rescue" in context["footer_text"]

    def test_admin_text_cannot_become_markup(self):
        footer = {
            "key": "x",
            "name": "X",
            "lines": ["<script>alert(1)</script> from {{organization_name}}"],
            "show_contact": False,
        }
        html = email_footers.render_html(footer, {"organization_name": "A & B"})
        assert "<script>" not in html
        assert "&lt;script&gt;" in html
        assert "A &amp; B" in html

    def test_a_variable_a_footer_may_not_use_is_left_alone(self):
        """Blanking it would silently delete the line's subject."""
        footer = {"key": "x", "name": "X", "lines": ["Hi {{first_name}}"]}
        assert "{{first_name}}" in email_footers.render_text(
            footer, {"first_name": "Jo"}
        )

    def test_the_contact_line_is_omitted_when_switched_off(self):
        footer = {"key": "x", "name": "X", "lines": ["One"], "show_contact": False}
        context = {"organization_phone": "(555) 111-2222"}
        assert "555" not in email_footers.render_html(footer, context)

    def test_the_mailing_address_is_included_when_switched_on(self):
        footer = {
            "key": "x",
            "name": "X",
            "lines": [],
            "show_contact": False,
            "show_mailing_address": True,
        }
        context = {"organization_mailing_address": "100 Main Street\nFalls Church, VA"}
        html = email_footers.render_html(footer, context)
        assert "100 Main Street" in html
        assert "<br />" in html
        assert "100 Main Street" in email_footers.render_text(footer, context)

    def test_a_footer_with_nothing_in_it_renders_nothing(self):
        """Not an empty div that shows as a gap under every email."""
        footer = {"key": "x", "name": "X", "lines": [], "show_contact": False}
        assert email_footers.render_html(footer, {}) == ""
        assert email_footers.render_text(footer, {}) == ""


class TestTemplatesCloseWithTheirOwnFooter:
    @staticmethod
    def _template(defn):
        return SimpleNamespace(
            subject=defn["subject"],
            html_body=defn["html"],
            text_body=defn["text"],
            css_styles=None,
            footer_key=defn.get("footer"),
        )

    def _render(self, type_value, organization):
        defn = next(
            d
            for d in EmailTemplateService._DEFAULT_TEMPLATE_DEFS
            if d["type"].value == type_value
        )
        service = EmailTemplateService.__new__(EmailTemplateService)
        return service.render(self._template(defn), {}, organization=organization)

    def test_a_public_notice_does_not_tell_the_recipient_not_to_reply(self):
        """It is the one notice whose recipient may well need to reply."""
        _, html, _ = self._render("event_request_status", _org())
        assert "do not reply" not in html.lower()

    def test_a_public_notice_carries_the_mailing_address(self):
        _, html, text = self._render("event_request_status", _org())
        assert "100 Main Street" in html
        assert "100 Main Street" in text

    def test_an_internal_notice_does_tell_the_recipient_not_to_reply(self):
        _, html, _ = self._render("welcome", _org())
        assert "do not reply" in html.lower()

    def test_an_official_notice_says_so(self):
        _, html, _ = self._render("member_dropped", _org())
        assert "official department notice" in html.lower()

    def test_editing_a_footer_reaches_every_template_using_it(self):
        """The whole point: one edit, not thirty-five."""
        organization = _with_library(
            {
                "default_key": "internal",
                "footers": [
                    {
                        "key": "internal",
                        "name": "Internal",
                        "lines": ["Reworded by the department."],
                        "show_contact": False,
                    }
                ],
            }
        )
        for type_value in ("welcome", "password_reset", "event_reminder"):
            _, html, _ = self._render(type_value, organization)
            assert "Reworded by the department." in html


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
