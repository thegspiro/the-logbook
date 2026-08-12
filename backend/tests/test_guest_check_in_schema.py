"""GuestCheckInRequest's published schema must match what it actually enforces.

The contract suite fuzzes public endpoints with data its OpenAPI schema declares
valid and treats a 4xx as the API breaking its own contract. ``min_length=1``
alone declares "\\n" acceptable — it is one character — while ``_strip_name``
strips and refuses it, so schemathesis reported "API rejected schema-compliant
request" against a 422 the endpoint was right to return. The gap is in the
declaration, not the validation.

Pure schema tests: no database, so they run in the ordinary unit job rather
than only in the DB-backed contract suite that found it.
"""

import pytest
from pydantic import ValidationError

from app.schemas.event import NAME_HAS_CONTENT, GuestCheckInRequest


def _request(**overrides):
    payload = {"first_name": "Dana", "last_name": "Reed"}
    payload.update(overrides)
    return GuestCheckInRequest(**payload)


class TestNamesRejectWhitespaceOnly:
    """Values the schema must declare invalid, not merely reject at runtime."""

    # \v and \f are here because the fuzzer found them, not for symmetry: the
    # two CI failures this fixes were first_name="\n" and last_name="\v".
    BLANKS = ["\n", "   ", "\t", "\r\n", " \t ", "\v", "\f", ""]

    @pytest.mark.parametrize("blank", BLANKS)
    def test_first_name(self, blank):
        with pytest.raises(ValidationError):
            _request(first_name=blank)

    @pytest.mark.parametrize("blank", BLANKS)
    def test_last_name(self, blank):
        with pytest.raises(ValidationError):
            _request(last_name=blank)


class TestNamesAcceptRealInput:
    """The pattern is unanchored on purpose: surrounding space is stripped, not
    refused. A guest typing " Mary Anne " on a tablet is not an error."""

    @pytest.mark.parametrize(
        ("given", "stored"),
        [
            ("Dana", "Dana"),
            (" Dana", "Dana"),
            ("Dana ", "Dana"),
            ("  Mary Anne  ", "Mary Anne"),
            ("Ünïcodé", "Ünïcodé"),
            ("O'Brien-Smith", "O'Brien-Smith"),
        ],
    )
    def test_first_name_is_stripped_not_rejected(self, given, stored):
        assert _request(first_name=given).first_name == stored


class TestPublishedSchema:
    """What a generated client — and the contract fuzzer — is told."""

    def test_names_declare_the_non_whitespace_requirement(self):
        props = GuestCheckInRequest.model_json_schema()["properties"]

        for field in ("first_name", "last_name"):
            # Without this the declared contract is looser than the real one,
            # which is exactly what the contract suite flags. The spelling of
            # the rule is owned by NAME_HAS_CONTENT in the schema module —
            # this asserts the schema publishes it, not how it is written.
            assert props[field].get("pattern") == NAME_HAS_CONTENT, field
            assert props[field]["maxLength"] == 100, field
