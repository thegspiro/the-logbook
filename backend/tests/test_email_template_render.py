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
