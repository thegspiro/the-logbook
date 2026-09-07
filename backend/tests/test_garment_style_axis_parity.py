"""Contract test: the garment style axes, on both sides of the wire.

The style vocabulary is hand-duplicated in three places already — the
``GarmentStyle`` model enum, ``GarmentStyleLiteral`` in the schemas, and
``GARMENT_STYLES`` on the frontend — and the axes add a fourth. Nothing at
build time makes them agree.

Drift here is quiet and expensive. A value the backend files under "neckline"
and the frontend files under "fit" makes the Add Item preview promise a
different number of items than the API creates, and a value missing from the
frontend axes simply vanishes from the picker: the chip is gone, no error is
raised, and the department loses a style they used to be able to stock.

Like test_onboarding_module_parity.py, this reads the .ts file as text — it
only needs to compare identifiers, and a node round-trip from pytest would buy
accuracy this does not need.

If this fails, fix whichever side is wrong. Do not loosen the comparison.
"""

import re
from pathlib import Path

import pytest

from app.models.inventory import GarmentStyle
from app.schemas.inventory import GarmentStyleLiteral
from app.utils.garment_styles import (
    GARMENT_STYLE_AXES,
    GARMENT_STYLE_LABELS,
    assert_axes_cover_enum,
)

pytestmark = pytest.mark.unit

_TYPES_FILE = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "modules"
    / "inventory"
    / "types"
    / "index.ts"
)

# Each axis block: `key: 'sleeve', label: 'Sleeve', options: [ ... ]`, plus the
# single-line form the one-option closure axis is written in.
_AXIS_BLOCK = re.compile(
    r"key:\s*'(?P<key>[a-z_]+)',\s*label:\s*'(?P<label>[^']+)',\s*"
    r"options:\s*\[(?P<options>.*?)\],?\s*\}",
    re.S,
)
_OPTION = re.compile(r"value:\s*'(?P<value>[a-z_]+)'")


def _frontend_axes() -> list[tuple[str, str, tuple[str, ...]]]:
    source = _TYPES_FILE.read_text(encoding="utf-8")
    start = source.index("export const GARMENT_STYLE_AXES")
    end = source.index("export const GARMENT_STYLES", start)
    block = source[start:end]
    return [
        (
            match.group("key"),
            match.group("label"),
            tuple(_OPTION.findall(match.group("options"))),
        )
        for match in _AXIS_BLOCK.finditer(block)
    ]


class TestTheParser:
    """A regex that silently matched nothing would make every test below pass."""

    def test_it_finds_every_axis(self):
        assert len(_frontend_axes()) == len(GARMENT_STYLE_AXES)

    def test_it_finds_options_in_each_axis(self):
        assert all(values for _key, _label, values in _frontend_axes())


class TestParity:
    def test_the_axes_match_key_label_and_order(self):
        assert _frontend_axes() == [
            (key, label, tuple(values)) for key, label, values in GARMENT_STYLE_AXES
        ]

    def test_the_axes_partition_the_model_enum(self):
        assert_axes_cover_enum()

    def test_the_schema_literal_matches_the_model_enum(self):
        literal_values = set(GarmentStyleLiteral.__args__)  # type: ignore[attr-defined]
        assert literal_values == {member.value for member in GarmentStyle}

    def test_every_value_has_a_label_on_both_sides(self):
        backend_values = {v for _k, _l, values in GARMENT_STYLE_AXES for v in values}
        assert set(GARMENT_STYLE_LABELS) == backend_values

        source = _TYPES_FILE.read_text(encoding="utf-8")
        for value in backend_values:
            assert f"value: '{value}'" in source, f"{value} has no frontend chip"
