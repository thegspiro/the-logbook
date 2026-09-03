"""The personal-information boundary of the MCP server.

Two halves. The runtime half: ``redact`` strips every denied field at every
depth, and the registry wrapper applies it to whatever a tool returns. The
static half: no tool module projects a denied field by name, so the
boundary is not relying on the second net alone.
"""

import re
from pathlib import Path

import pytest

from app.mcp.redaction import (
    DENIED_FIELDS,
    denied_fields_in,
    is_denied_field,
    redact,
)

TOOLS_DIR = Path(__file__).resolve().parents[1] / "app" / "mcp" / "tools"

# The fields the department named as never-shared, spelled as the models
# spell them. If a model renames one of these, this test is what notices.
NEVER_SHARED = (
    "phone",
    "mobile",
    "email",
    "personal_email",
    "address_street",
    "date_of_birth",
    "emergency_contacts",
    "photo_url",
    "membership_number",
    "certification_number",
    "provider_name",
    "result_summary",
    "result_data",
    "password_hash",
    "mfa_secret",
    "calendar_feed_token",
)


class TestRedact:
    @pytest.mark.parametrize("field", NEVER_SHARED)
    def test_every_named_field_is_denied(self, field):
        assert is_denied_field(field)
        assert field in DENIED_FIELDS or is_denied_field(field)

    def test_strips_at_top_level(self):
        assert redact({"name": "A", "phone": "555"}) == {"name": "A"}

    def test_strips_nested_dicts_and_lists(self):
        value = {
            "items": [
                {"name": "A", "emergency_contacts": [{"phone": "1"}]},
                {"name": "B", "profile": {"address_city": "X", "rank": "FF"}},
            ],
            "meta": {"count": 2, "user_email": "a@b"},
        }
        assert redact(value) == {
            "items": [{"name": "A"}, {"name": "B", "profile": {"rank": "FF"}}],
            "meta": {"count": 2},
        }

    def test_suffix_and_prefix_rules(self):
        assert is_denied_field("api_secret")
        assert is_denied_field("Reset_Token")
        assert is_denied_field("emergency_phone")
        assert is_denied_field("address_line3")
        assert not is_denied_field("station")
        assert not is_denied_field("full_name")
        assert not is_denied_field("city")

    def test_case_insensitive(self):
        assert redact({"Phone": "1", "EMAIL": "x", "ok": 1}) == {"ok": 1}

    def test_non_string_keys_and_scalars_pass_through(self):
        assert redact({1: "a", "b": (1, 2)}) == {1: "a", "b": [1, 2]}
        assert redact("phone") == "phone"
        assert redact(None) is None

    def test_denied_fields_in_reports_offenders(self):
        assert denied_fields_in(["name", "phone", "dob"]) == ["dob", "phone"]


class TestToolModulesNeverProjectDeniedFields:
    """A tool that wrote ``"phone": user.phone`` would be stripped at runtime,
    but the intent is that no tool tries. This walks the source for a denied
    name used as a dict key or attribute on the projection side."""

    KEY_PATTERN = re.compile(r'"([a-z_]+)"\s*:')
    ATTR_PATTERN = re.compile(r"\.([a-z_]+)\b")

    @pytest.mark.parametrize(
        "path", sorted(p for p in TOOLS_DIR.glob("*.py") if p.name != "__init__.py")
    )
    def test_module_is_clean(self, path):
        source = path.read_text()
        keys = set(self.KEY_PATTERN.findall(source))
        attrs = set(self.ATTR_PATTERN.findall(source))
        offenders = denied_fields_in(keys | attrs)
        assert not offenders, f"{path.name} touches denied fields: {offenders}"


class TestScrubText:
    """Field names cannot catch a phone number typed into a note; values are
    scrubbed for the two shapes recognisable on their own."""

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("mail sam@example.org today", "mail [email removed] today"),
            (
                "Call (555) 123-4567 or 555.123.4567",
                "Call [phone removed] or [phone removed]",
            ),
            ("555-123-4567", "[phone removed]"),
            ("+1 555 123 4567", "[phone removed]"),
            ("call 5551234567 now", "call [phone removed] now"),
            ("5551234567", "[phone removed]"),  # a note that is only the number
            ("Call 5551234", "Call [phone removed]"),  # a compact local number
            ("<p>5551234567</p>", "<p>[phone removed]</p>"),
            ("Reach me: 5551234567.", "Reach me: [phone removed]."),
            ("5551234567,15551234567", "[phone removed],[phone removed]"),
            ("Call 555-0100", "Call [phone removed]"),
            ("Dial +44 20 7946 0958", "Dial [phone removed]"),
            ("+49 30 1234567", "[phone removed]"),
            # National formats without a country code.
            ("Ring 020 7946 0958", "Ring [phone removed]"),
            ("Ring (020) 7946 0958", "Ring [phone removed]"),
            ("Ring 020 79460958", "Ring [phone removed]"),
            ("Ring 912 34 567", "Ring [phone removed]"),
            ("Ring 91234567", "Ring [phone removed]"),
            ("Ring 912345678", "Ring [phone removed]"),
            ("01 23 45 67 89", "[phone removed]"),
            ("030-1234-5678", "[phone removed]"),
            ("Ring 612 345 678", "Ring [phone removed]"),
            ("0412 345 678", "[phone removed]"),
            ("612.345.678", "[phone removed]"),
        ],
    )
    def test_contact_shapes_are_replaced(self, text, expected):
        assert redact({"notes": text}) == {"notes": expected}

    @pytest.mark.parametrize(
        "text",
        [
            "SN-1234567890",
            "0012345678901",  # a 13-digit barcode is longer than any phone number
            "PO 202609031234 shipped",
            "Engine 1 pumps 1500 gpm; unit 2024",
            "ext 4567",
            "range 2024-2025",
            "ISO 9001-2015",
            "due 03.09.2026",
            "on 2026-09-03 at 19:30",
            "budget 10 000 000",
            "1 500 000 gallons",
        ],
    )
    def test_quantities_and_codes_survive_in_prose(self, text):
        assert redact({"description": text}) == {"description": text}

    @pytest.mark.parametrize(
        "field",
        ["asset_tag", "serial_number", "barcode", "unit_number", "apparatus_id"],
    )
    def test_identifier_fields_keep_a_bare_digit_run(self, field):
        """The field decides, not the shape: the same ten digits are an
        asset tag here and a phone number in a description."""
        assert redact({field: "5551234567"}) == {field: "5551234567"}
        assert redact({field: "5551234"}) == {field: "5551234"}
        assert redact({field: "LOT/2026/1234567890"}) == {field: "LOT/2026/1234567890"}

    def test_a_string_without_a_field_is_prose(self):
        assert redact(["5551234567"]) == ["[phone removed]"]
        assert redact({"tags": ["5551234567"]}) == {"tags": ["[phone removed]"]}
        assert redact("5551234567") == "[phone removed]"

    def test_strings_are_scrubbed_at_every_depth(self):
        value = {"items": [{"body": "x@y.io", "nested": {"t": "555-123-4567"}}]}
        assert redact(value) == {
            "items": [{"body": "[email removed]", "nested": {"t": "[phone removed]"}}]
        }
