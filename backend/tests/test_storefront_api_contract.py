"""
Contract test: storefront response schemas vs the frontend's TypeScript types.

These two definitions have to agree and nothing enforces it at build time —
Pydantic serializes whatever it has, and TypeScript silently ignores response
fields it does not know about. So a field added on one side and forgotten on
the other produces no error anywhere: the UI just renders `undefined` and the
bug surfaces as a blank cell in production.

This test reads the .ts file as text rather than compiling it. That is
deliberately crude, but it only needs to compare field *names*, and the
alternative (a node round-trip from pytest) buys accuracy this does not need.

If this fails, the fix is to add the field to whichever side is missing it —
not to loosen the comparison.
"""

import re
from pathlib import Path

import pytest

from app.schemas.storefront import (
    StoreOrderResponse,
    StoreOrderWindowResponse,
    StorePaymentEventListResponse,
    StorePaymentEventResponse,
    StorePaymentInstructions,
    StorePaymentOption,
    StoreProductResponse,
    StoreSettingsResponse,
)

pytestmark = pytest.mark.unit

_TYPES_FILE = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "modules"
    / "storefront"
    / "types"
    / "index.ts"
)

# (Pydantic response model, TypeScript interface name)
_CONTRACT = [
    (StoreSettingsResponse, "StoreSettings"),
    (StoreOrderResponse, "StoreOrder"),
    (StoreProductResponse, "StoreProduct"),
    (StoreOrderWindowResponse, "StoreOrderWindow"),
    (StorePaymentInstructions, "StorePaymentInstructions"),
    (StorePaymentOption, "StorePaymentOption"),
    (StorePaymentEventResponse, "StorePaymentEvent"),
    (StorePaymentEventListResponse, "StorePaymentEventList"),
]


def _ts_interface_fields(source: str, name: str) -> set:
    match = re.search(
        r"export interface " + re.escape(name) + r"\s*\{(.*?)\n\}", source, re.S
    )
    assert match, f"No `export interface {name}` in {_TYPES_FILE.name}"
    body = match.group(1)
    # Strip block and line comments so a field name mentioned in prose does not
    # register as a declaration.
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    body = re.sub(r"//.*", "", body)
    return set(re.findall(r"^\s*(\w+)\??:", body, re.M))


def _schema_field_names(model) -> set:
    """The keys this model actually serializes (camelCase via alias_generator)."""
    return {field.alias or name for name, field in model.model_fields.items()}


@pytest.mark.skipif(
    not _TYPES_FILE.exists(),
    reason="frontend/ not present (backend-only checkout)",
)
@pytest.mark.parametrize(
    ("model", "interface"),
    _CONTRACT,
    ids=[name for _, name in _CONTRACT],
)
def test_response_schema_matches_the_typescript_interface(model, interface):
    source = _TYPES_FILE.read_text()
    sent = _schema_field_names(model)
    declared = _ts_interface_fields(source, interface)

    missing_in_ts = sorted(sent - declared)
    missing_in_py = sorted(declared - sent)

    assert not missing_in_ts, (
        f"{model.__name__} serializes {missing_in_ts}, which `{interface}` does "
        f"not declare. TypeScript will not error on this — the field is simply "
        f"invisible to the UI. Add it to {_TYPES_FILE.name}."
    )
    assert not missing_in_py, (
        f"`{interface}` declares {missing_in_py}, which {model.__name__} never "
        f"sends. Components reading those get undefined at runtime with no "
        f"type error. Add the field to the schema or drop it from the interface."
    )
