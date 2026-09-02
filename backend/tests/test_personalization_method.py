"""Embroidery stitches cloth; engraving cuts metal. Only one has thread.

The storefront modelled personalization as one process, so every personalized
line carried a thread colour — and an engraved challenge coin reached the
vendor purchase order and the CSV export reading "Gold", an instruction the
engraver cannot follow.
"""

from decimal import Decimal

import pytest

from app.api.v1.endpoints.storefront import _product_payload
from app.schemas.storefront import StoreOrderItemResponse, StoreProductResponse
from app.utils.embroidery import (
    DEFAULT_PERSONALIZATION_METHOD,
    EmbroideryThreadColor,
    PersonalizationMethod,
    normalize_personalization_method,
    personalization_methods,
    personalization_prompt,
    personalization_verb,
    uses_thread_color,
)


class TestMethodResolution:
    def test_missing_means_embroidery(self):
        # Every product predating the setting was previewed in gold thread.
        assert (
            normalize_personalization_method(None) is PersonalizationMethod.EMBROIDERY
        )
        assert DEFAULT_PERSONALIZATION_METHOD is PersonalizationMethod.EMBROIDERY

    def test_an_enum_member_round_trips(self):
        # Same (str, Enum) trap as the thread colour: str() yields
        # "PersonalizationMethod.ENGRAVING", not "engraving".
        for method in PersonalizationMethod:
            assert normalize_personalization_method(method) is method

    def test_casing_and_padding_tolerated(self):
        assert (
            normalize_personalization_method("  ENGRAVING ")
            is PersonalizationMethod.ENGRAVING
        )

    def test_unknown_degrades_rather_than_raising(self):
        assert (
            normalize_personalization_method("etching")
            is DEFAULT_PERSONALIZATION_METHOD
        )


class TestThreadAppliesToEmbroideryOnly:
    def test_only_embroidery_uses_thread(self):
        assert uses_thread_color(PersonalizationMethod.EMBROIDERY) is True
        assert uses_thread_color(PersonalizationMethod.ENGRAVING) is False

    def test_a_missing_method_still_uses_thread(self):
        # Legacy rows are embroidery, so their swatch must not disappear.
        assert uses_thread_color(None) is True

    @pytest.mark.parametrize("method", list(PersonalizationMethod))
    def test_every_method_names_itself(self, method):
        assert personalization_verb(method).strip()
        assert personalization_prompt(method).strip()

    def test_the_prompts_differ_by_method(self):
        # A coin must not ask to be embroidered.
        assert personalization_prompt(PersonalizationMethod.EMBROIDERY) != (
            personalization_prompt(PersonalizationMethod.ENGRAVING)
        )
        assert (
            "engrav" in personalization_prompt(PersonalizationMethod.ENGRAVING).lower()
        )

    def test_catalogue_covers_the_whole_enum(self):
        assert [m["value"] for m in personalization_methods()] == [
            m.value for m in PersonalizationMethod
        ]


class _Product:
    id = "p1"
    organization_id = "o1"
    name = "Challenge Coin"
    sku = None
    description = None
    image_url = None
    category = None
    inventory_item_id = None
    price = Decimal("12")
    cost = None
    is_taxable = False
    status = "active"
    max_per_member = None
    track_stock = False
    stock_quantity = None
    requires_variant = False
    personalization_enabled = True
    personalization_required = False
    personalization_label = None
    personalization_max_length = 30
    personalization_price = Decimal("0")
    personalization_thread_color = "gold"
    personalization_method = None
    sort_order = 0
    internal_notes = None
    created_at = None
    updated_at = None
    variants: list = []


def _product_response(method):
    product = _Product()
    product.personalization_method = method
    return StoreProductResponse.model_validate(_product_payload(product))


class TestProductPayloadCarriesTheMethod:
    def test_a_configured_method_survives_the_payload(self):
        # _product_payload builds from an explicit allowlist, so a new column
        # is invisible until it is named there — the same trap the thread
        # colour fell into, which made that setting inert.
        assert (
            _product_response("engraving").personalization_method
            is PersonalizationMethod.ENGRAVING
        )

    def test_a_product_predating_the_setting_reads_as_embroidery(self):
        assert (
            _product_response(None).personalization_method
            is PersonalizationMethod.EMBROIDERY
        )

    def test_the_payload_names_the_column(self):
        assert "personalization_method" in _product_payload(_Product())


class TestOrderLineSnapshot:
    @staticmethod
    def _line(**overrides):
        payload = {
            "id": "i1",
            "product_id": "p1",
            "variant_id": None,
            "product_name": "Challenge Coin",
            "variant_label": None,
            "sku": None,
            "personalization_text": "J. SMITH",
            "personalization_thread_color": "gold",
            "personalization_method": "engraving",
            "unit_price": Decimal("12"),
            "quantity": 1,
            "line_total": Decimal("12"),
            "fulfilled_quantity": 0,
        }
        payload.update(overrides)
        return StoreOrderItemResponse.model_validate(payload)

    def test_an_engraved_line_carries_no_thread(self):
        line = self._line()
        assert line.personalization_method is PersonalizationMethod.ENGRAVING
        assert line.personalization_thread_color is None
        assert line.personalization_thread_color_hex is None

    def test_an_embroidered_line_keeps_its_thread(self):
        line = self._line(personalization_method="embroidery")
        assert line.personalization_thread_color is EmbroideryThreadColor.GOLD
        assert line.personalization_thread_color_hex == "#c8a02c"

    def test_a_legacy_line_is_embroidery_in_gold(self):
        line = self._line(
            personalization_method=None, personalization_thread_color=None
        )
        assert line.personalization_method is PersonalizationMethod.EMBROIDERY
        assert line.personalization_thread_color is EmbroideryThreadColor.GOLD

    def test_a_line_with_nothing_inscribed_carries_neither(self):
        line = self._line(personalization_text=None)
        assert line.personalization_method is None
        assert line.personalization_thread_color is None
