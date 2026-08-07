"""
Tests for email template variable substitution and item-list builders
(app/services/email_template_service.py).

_replace_variables is the email XSS-defense core: it HTML-escapes every
{{variable}} value except a whitelist of system-generated HTML fragments,
and drops unknown variables. build_items_list_html/text render the
outstanding-property tables (also escaping item text). No DB needed for the
logic under test.
"""

from unittest.mock import MagicMock

from app.services.email_template_service import (
    EmailTemplateService,
    build_items_list_html,
    build_items_list_text,
)


def _svc():
    return EmailTemplateService(MagicMock())


class TestReplaceVariables:
    def test_substitutes_value(self):
        out = _svc()._replace_variables("Hello {{name}}!", {"name": "Jane"})
        assert out == "Hello Jane!"

    def test_escapes_html_in_value(self):
        out = _svc()._replace_variables(
            "Hi {{name}}", {"name": "<script>alert(1)</script>"}
        )
        assert "<script>" not in out
        assert "&lt;script&gt;" in out

    def test_escapes_ampersand(self):
        out = _svc()._replace_variables("{{org}}", {"org": "Smith & Sons"})
        assert out == "Smith &amp; Sons"

    def test_unknown_variable_becomes_empty(self):
        out = _svc()._replace_variables("A{{missing}}B", {})
        assert out == "AB"

    def test_whitespace_inside_braces_tolerated(self):
        out = _svc()._replace_variables("{{ name }}", {"name": "X"})
        assert out == "X"

    def test_raw_html_variable_not_escaped(self):
        # Whitelisted system-generated HTML is inserted verbatim.
        out = _svc()._replace_variables(
            "{{items_list_html}}", {"items_list_html": "<table><tr></tr></table>"}
        )
        assert out == "<table><tr></tr></table>"


class TestNonMarkupDestinations:
    """The Subject: header and the text/plain alternative are not markup.

    Escaping them does not add safety — nothing parses them as HTML — and it
    actively corrupts ordinary content: apostrophes and ampersands are common
    in member names and department names.
    """

    def test_plain_text_keeps_apostrophes_and_ampersands(self):
        out = _svc()._replace_variables(
            "Hi {{name}} at {{org}}",
            {"name": "Sean O'Brien", "org": "Falls Church Fire & Rescue"},
            escape_html=False,
        )
        assert out == "Hi Sean O'Brien at Falls Church Fire & Rescue"
        assert "&" in out and "&amp;" not in out
        assert "&#x27;" not in out

    def test_html_still_escapes_when_flag_defaults(self):
        # The flag must not weaken the HTML path, which is the XSS boundary.
        out = _svc()._replace_variables("{{v}}", {"v": "<script>alert(1)</script>"})
        assert "<script>" not in out


class TestRenderEscapesOnlyTheHtmlBody:
    """render() has three outputs with different escaping rules."""

    @staticmethod
    def _template():
        tpl = MagicMock()
        tpl.subject = "Results for {{title}}"
        tpl.html_body = "<p>Hi {{name}} — {{title}}</p>"
        tpl.text_body = "Hi {{name}} — {{title}}"
        tpl.css_styles = None
        return tpl

    def _render(self):
        svc = EmailTemplateService.__new__(EmailTemplateService)
        return svc.render(
            self._template(),
            {"name": "Sean O'Brien", "title": 'Chief & "Deputy"'},
        )

    def test_subject_is_not_html_escaped(self):
        subject, _, _ = self._render()
        assert subject == 'Results for Chief & "Deputy"'

    def test_text_body_is_not_html_escaped(self):
        _, _, text_body = self._render()
        assert text_body == 'Hi Sean O\'Brien — Chief & "Deputy"'

    def test_html_body_is_still_escaped(self):
        _, html, _ = self._render()
        assert "O&#x27;Brien" in html
        assert "Chief &amp;" in html

    def test_html_body_still_blocks_injection(self):
        tpl = self._template()
        svc = EmailTemplateService.__new__(EmailTemplateService)
        _, html, _ = svc.render(
            tpl, {"name": "x", "title": "<img src=x onerror=alert(1)>"}
        )
        assert "onerror=alert(1)>" not in html
        assert "&lt;img" in html

    def test_title_tag_is_escaped_exactly_once(self):
        # The subject reaching render() is now raw, so the <title>/aria-label
        # escape is the only one applied. Previously it was the second, and
        # an ampersand arrived as &amp;amp;.
        import re

        _, html, _ = self._render()
        title = re.search(r"<title>(.*?)</title>", html, re.S).group(1)
        assert "&amp;quot;" not in title
        assert "&amp;amp;" not in title
        assert "&amp;" in title


class TestBuildItemsListHtml:
    def _items(self):
        return [
            {
                "name": "Helmet",
                "serial_number": "SN1",
                "asset_tag": "AT1",
                "value": 100.0,
            },
            {
                "name": "Radio",
                "serial_number": "SN2",
                "asset_tag": "AT2",
                "value": 250.5,
            },
        ]

    def test_renders_items_and_total(self):
        html = build_items_list_html(self._items(), 350.5)
        assert "Helmet" in html
        assert "Radio" in html
        assert "$100.00" in html
        assert "$250.50" in html
        assert "$350.50" in html  # total

    def test_escapes_item_name(self):
        items = [
            {"name": "<b>x</b>", "serial_number": "-", "asset_tag": "-", "value": 0}
        ]
        html = build_items_list_html(items, 0)
        assert "<b>x</b>" not in html
        assert "&lt;b&gt;x&lt;/b&gt;" in html

    def test_condition_column_optional(self):
        without = build_items_list_html(self._items(), 350.5)
        assert "Condition" not in without
        with_cond = build_items_list_html(
            [{"name": "A", "value": 1, "condition": "good"}], 1, include_condition=True
        )
        assert "Condition" in with_cond
        assert "Good" in with_cond  # titled


class TestBuildItemsListText:
    def test_text_includes_names_and_total(self):
        text = build_items_list_text([{"name": "Helmet", "value": 100.0}], 100.0)
        assert "Helmet" in text
        assert "100.00" in text


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
