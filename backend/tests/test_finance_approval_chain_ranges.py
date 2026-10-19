"""Approval chain ranges: what is accepted, and which chain an amount lands on.

A chain's minimum and maximum are both inclusive, so an amount exactly on the
edge between two chains ("up to $500" and "$500 and over") fits both. It goes
to the chain with the higher minimum. A chain that is the only one to fit an
amount keeps it, so a lone "up to $500" chain still covers exactly $500.00.
"""

from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.finance import (
    ApprovalChainCreate,
    ApprovalChainStepCreate,
    ApprovalChainUpdate,
)
from app.services.finance_service import pick_approval_chain

pytestmark = [pytest.mark.unit]


def _chain(
    chain_id,
    name,
    min_amount=None,
    max_amount=None,
    category=None,
    is_default=False,
):
    return SimpleNamespace(
        id=chain_id,
        name=name,
        min_amount=None if min_amount is None else Decimal(str(min_amount)),
        max_amount=None if max_amount is None else Decimal(str(max_amount)),
        budget_category_id=category,
        is_default=is_default,
    )


SMALL = _chain("a", "Small", 0, 500)
LARGE = _chain("b", "Large", 500)


def _pick(chains, amount, category=None):
    chain = pick_approval_chain(chains, Decimal(str(amount)), category)
    return chain.name if chain else None


class TestWhichChainTakesAnAmount:
    def test_an_amount_inside_one_range_takes_that_chain(self):
        assert _pick([SMALL, LARGE], "300") == "Small"
        assert _pick([SMALL, LARGE], "5000") == "Large"

    def test_an_amount_exactly_on_the_edge_goes_to_the_higher_chain(self):
        assert _pick([SMALL, LARGE], "500") == "Large"
        assert _pick([SMALL, LARGE], "500.00") == "Large"

    def test_the_cent_either_side_of_the_edge_keeps_its_own_chain(self):
        assert _pick([SMALL, LARGE], "499.99") == "Small"
        assert _pick([SMALL, LARGE], "500.01") == "Large"

    def test_the_answer_does_not_depend_on_the_order_chains_arrive_in(self):
        assert _pick([LARGE, SMALL], "500") == "Large"
        assert _pick([SMALL, LARGE], "500") == "Large"

    def test_a_lone_up_to_chain_still_covers_its_own_maximum(self):
        assert _pick([SMALL], "500") == "Small"

    def test_a_lone_open_ended_chain_covers_its_own_minimum(self):
        assert _pick([LARGE], "500") == "Large"

    def test_an_amount_no_chain_fits_resolves_to_none(self):
        assert _pick([_chain("a", "Mid", 100, 200)], "50") is None
        assert _pick([], "50") is None

    def test_a_category_chain_beats_a_higher_minimum(self):
        category_chain = _chain("c", "Fire prevention", 0, 1000, category="cat-1")

        assert _pick([category_chain, LARGE], "600", category="cat-1") == (
            "Fire prevention"
        )

    def test_a_chain_for_another_category_never_fits(self):
        category_chain = _chain("c", "Fire prevention", 0, 1000, category="cat-1")

        assert _pick([category_chain], "600", category="cat-2") is None

    def test_a_default_chain_is_the_fallback_for_what_no_range_fits(self):
        fallback = _chain("d", "Fallback", is_default=True)

        assert _pick([SMALL, fallback], "900") == "Fallback"
        assert _pick([SMALL, fallback], "300") == "Small"

    def test_chains_alike_in_every_way_are_told_apart_by_id(self):
        twin_one = _chain("1", "Twin one", 0, 500)
        twin_two = _chain("2", "Twin two", 0, 500)

        assert _pick([twin_two, twin_one], "100") == "Twin one"
        assert _pick([twin_one, twin_two], "100") == "Twin one"


def _create(**amounts):
    return ApprovalChainCreate(name="Chain", applies_to="purchase_request", **amounts)


class TestARangeIsAcceptedOnlyIfSomeAmountCanFitIt:
    def test_a_minimum_above_the_maximum_is_refused(self):
        with pytest.raises(ValidationError, match="minimum amount cannot be above"):
            _create(min_amount="600", max_amount="500")

    def test_a_minimum_equal_to_the_maximum_is_accepted(self):
        chain = _create(min_amount="500", max_amount="500")

        assert chain.min_amount == chain.max_amount == Decimal("500")

    def test_either_end_may_be_left_open(self):
        assert _create(min_amount="500").max_amount is None
        assert _create(max_amount="500").min_amount is None
        assert _create().min_amount is None

    @pytest.mark.parametrize("field", ["min_amount", "max_amount"])
    def test_a_negative_threshold_is_refused(self, field):
        with pytest.raises(ValidationError):
            _create(**{field: "-1"})

    def test_an_update_naming_both_ends_in_the_wrong_order_is_refused(self):
        with pytest.raises(ValidationError, match="minimum amount cannot be above"):
            ApprovalChainUpdate(min_amount="600", max_amount="500")

    def test_an_update_naming_one_end_is_left_to_the_service_to_check(self):
        assert ApprovalChainUpdate(max_amount="100").max_amount == Decimal("100")

    def test_an_update_may_clear_an_end(self):
        update = ApprovalChainUpdate(max_amount=None)

        assert update.model_dump(exclude_unset=True) == {"max_amount": None}

    def test_a_negative_auto_approve_threshold_is_refused(self):
        with pytest.raises(ValidationError):
            ApprovalChainStepCreate(
                step_order=1,
                name="Review",
                step_type="approval",
                approver_type="permission",
                approver_value="finance.approve",
                auto_approve_under="-5",
            )
