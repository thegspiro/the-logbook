"""Variant sort_order is settled on the write, in size order.

``StorefrontService._ordered_variants`` is the write-side authority: it puts an
incoming variant list in smallest-to-largest order so ``sort_order`` in the
database is canonical and every reader — the member's size chips, the admin
form, the vendor purchase order — gets the same sequence without re-deriving
it.
"""

from types import SimpleNamespace

from app.services.storefront_service import StorefrontService


def _labels(payloads):
    return [v["label"] for v in StorefrontService._ordered_variants(payloads)]


def _variants(*labels):
    return [{"label": label} for label in labels]


class TestOrderedVariants:
    def test_sizes_are_reordered_smallest_to_largest(self):
        assert _labels(_variants("L", "XS", "XL", "S", "M")) == [
            "XS",
            "S",
            "M",
            "L",
            "XL",
        ]

    def test_a_size_added_later_lands_in_its_place_not_at_the_end(self):
        # The actual failure mode: a department stocks S/M/L, then adds XS and
        # 3XL a season later, and both were appended after XL.
        assert _labels(_variants("S", "M", "L", "XL", "XS", "3XL", "2XL")) == [
            "XS",
            "S",
            "M",
            "L",
            "XL",
            "2XL",
            "3XL",
        ]

    def test_the_clients_row_order_is_not_consulted(self):
        # Submitting the same set in any order yields the same sequence.
        assert _labels(_variants("XL", "S", "M")) == _labels(_variants("M", "XL", "S"))

    def test_non_size_labels_keep_their_entered_order(self):
        assert _labels(_variants("Navy", "Red", "Black")) == ["Navy", "Red", "Black"]

    def test_an_empty_list_is_handled(self):
        assert _labels([]) == []

    def test_a_payload_without_a_label_does_not_raise(self):
        assert len(StorefrontService._ordered_variants([{"sku": "X"}])) == 1

    def test_other_payload_keys_survive_the_reordering(self):
        payloads = [
            {"label": "L", "sku": "L-1", "stock_quantity": 4},
            {"label": "S", "sku": "S-1", "stock_quantity": 9},
        ]
        ordered = StorefrontService._ordered_variants(payloads)
        assert [v["sku"] for v in ordered] == ["S-1", "L-1"]
        assert ordered[0]["stock_quantity"] == 9


class TestBuiltVariantsGetCanonicalIndices:
    """The create path must assign the canonical index, not the client's.

    ``_ordered_variants`` reorders the payloads, but ``_build_variant`` used to
    prefer any truthy client ``sort_order`` over the enumerated one — and the
    admin form always submits its own row indices. Creating [S, M, L, XS]
    therefore stored XS at 3 and duplicated an index, so a newly created
    product came back in the order it was typed rather than in size order.
    """

    @staticmethod
    def _create(labels):
        """Mimic ``create_product``: order the payloads, then build each one."""
        product = SimpleNamespace(organization_id="o1", id="p1")
        payloads = [
            # The form sends its row index as sort_order, exactly like this.
            {"label": label, "sort_order": index}
            for index, label in enumerate(labels)
        ]
        built = [
            StorefrontService._build_variant(
                StorefrontService, product, payload, default_sort=index
            )
            for index, payload in enumerate(
                StorefrontService._ordered_variants(payloads)
            )
        ]
        return [(v.label, v.sort_order) for v in built]

    def test_a_size_added_last_still_sorts_first(self):
        assert self._create(["S", "M", "L", "XS"]) == [
            ("XS", 0),
            ("S", 1),
            ("M", 2),
            ("L", 3),
        ]

    def test_indices_are_unique_and_contiguous(self):
        built = self._create(["S", "M", "L", "XS", "2XL", "XL"])
        orders = [order for _, order in built]
        assert orders == list(range(len(orders)))

    def test_reading_back_by_sort_order_yields_size_order(self):
        built = self._create(["XL", "S", "2XL", "M", "XS", "L"])
        by_sort = [label for label, _ in sorted(built, key=lambda pair: pair[1])]
        assert by_sort == ["XS", "S", "M", "L", "XL", "2XL"]
