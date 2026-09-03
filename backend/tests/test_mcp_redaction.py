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
