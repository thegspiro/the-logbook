"""The quartermaster's thread colour must survive a round-trip.

``_product_payload`` builds the admin response from an explicit field
allowlist rather than from the ORM object, so a new column is invisible to
every create/get/list/update response until it is named there. A response that
always reports gold is worse than no setting: reopening the product in the
form selects gold, and the next save writes gold over the colour the
department actually chose.
"""

from decimal import Decimal

from app.api.v1.endpoints.storefront import _product_payload
from app.schemas.storefront import StoreOrderItemResponse, StoreProductResponse
from app.utils.embroidery import EmbroideryThreadColor


class _Product:
    """Stand-in for the ORM row, with only what ``_product_payload`` reads."""

    id = "p1"
    organization_id = "o1"
    name = "Job Shirt"
    sku = None
    description = None
    image_url = None
    category = None
    inventory_item_id = None
    price = Decimal("65")
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
    personalization_thread_color = None
    personalization_method = None
    sort_order = 0
    internal_notes = None
    created_at = None
    updated_at = None
    variants: list = []


def _response(stored_color):
    product = _Product()
    product.personalization_thread_color = stored_color
    return StoreProductResponse.model_validate(_product_payload(product))


class TestProductPayloadCarriesThreadColor:
    def test_a_configured_colour_survives_the_payload(self):
        response = _response("white")
        assert response.personalization_thread_color is EmbroideryThreadColor.WHITE
        assert response.personalization_thread_color_hex == "#f5f5f4"

    def test_every_palette_colour_round_trips(self):
        for color in EmbroideryThreadColor:
            assert _response(color.value).personalization_thread_color is color

    def test_a_product_predating_the_setting_reads_as_gold(self):
        response = _response(None)
        assert response.personalization_thread_color is EmbroideryThreadColor.GOLD

    def test_the_payload_names_the_column(self):
        # The allowlist is the thing that goes stale; assert it directly so a
        # future column cannot be added to the model and silently dropped here.
        assert "personalization_thread_color" in _product_payload(_Product())


class TestOrderLineThreadColor:
    """A line placed before the column existed stores NULL, meaning gold."""

    @staticmethod
    def _line(**overrides):
        payload = {
            "id": "i1",
            "product_id": "p1",
            "variant_id": None,
            "product_name": "Job Shirt",
            "variant_label": "L",
            "sku": None,
            "personalization_text": "J. SMITH",
            "personalization_thread_color": None,
            "unit_price": Decimal("65"),
            "quantity": 1,
            "line_total": Decimal("65"),
            "fulfilled_quantity": 0,
        }
        payload.update(overrides)
        return StoreOrderItemResponse.model_validate(payload)

    def test_a_legacy_personalized_line_resolves_to_gold(self):
        # The CSV export and window tally already report Gold for these rows;
        # leaving the response unset made the order-detail swatch vanish.
        line = self._line()
        assert line.personalization_thread_color is EmbroideryThreadColor.GOLD
        assert line.personalization_thread_color_hex == "#c8a02c"

    def test_a_snapshot_colour_is_preserved(self):
        line = self._line(personalization_thread_color="navy")
        assert line.personalization_thread_color is EmbroideryThreadColor.NAVY
        assert line.personalization_thread_color_hex == "#1e3a5f"

    def test_a_line_with_nothing_stitched_carries_no_thread(self):
        # "Stitched in gold" and "nothing stitched" must stay distinguishable.
        line = self._line(personalization_text=None)
        assert line.personalization_thread_color is None
        assert line.personalization_thread_color_hex is None

    def test_a_snapshot_colour_is_ignored_without_personalization(self):
        line = self._line(
            personalization_text=None, personalization_thread_color="navy"
        )
        assert line.personalization_thread_color is None
