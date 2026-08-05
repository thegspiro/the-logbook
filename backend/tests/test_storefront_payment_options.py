"""
Tests for the per-order payment option list.

The contract these protect: a member sees a button for every method the
department accepts *and has configured*, and never for one it has not. A dead
button on a payment screen is worse than no button — it tells a member the
money went somewhere when it did not.
"""

from decimal import Decimal

import pytest

from app.models.storefront import StorePaymentMethod, StoreSettings
from app.utils.storefront_payments import build_payment_options

pytestmark = pytest.mark.unit


def _settings(**overrides) -> StoreSettings:
    fields = {
        "accepted_payment_methods": ["venmo", "paypal", "cash_app", "zelle"],
        "venmo_handle": "FallsChurchFire",
        "paypal_me_url": "https://paypal.me/fcfd",
        "cash_app_cashtag": "FallsChurchFire",
        "zelle_handle": "treasurer@example.org",
    }
    fields.update(overrides)
    return StoreSettings(**fields)


def _by_method(options):
    return {o["method"]: o for o in options}


class TestOptionList:
    def test_offers_every_configured_method(self):
        options = build_payment_options(_settings(), Decimal("45.00"), "ORD-2026-0001")
        assert [o["method"] for o in options] == [
            "venmo",
            "paypal",
            "cash_app",
            "zelle",
        ]

    def test_preserves_the_order_the_department_listed(self):
        settings = _settings(accepted_payment_methods=["zelle", "venmo"])
        options = build_payment_options(settings, Decimal("45.00"), "ORD-2026-0001")
        assert [o["method"] for o in options] == ["zelle", "venmo"]

    def test_drops_a_method_with_no_handle_configured(self):
        # Accepting Venmo but never entering a handle must not put a dead
        # button in front of a member.
        settings = _settings(venmo_handle=None)
        assert "venmo" not in _by_method(
            build_payment_options(settings, Decimal("45.00"), "ORD-2026-0001")
        )

    def test_drops_a_method_with_a_malformed_handle(self):
        settings = _settings(cash_app_cashtag="$1invalid")
        assert "cash_app" not in _by_method(
            build_payment_options(settings, Decimal("45.00"), "ORD-2026-0001")
        )

    def test_ignores_an_unrecognized_stored_method(self):
        # A method retired from the enum should not take the store down.
        settings = _settings(accepted_payment_methods=["venmo", "bitcoin"])
        options = build_payment_options(settings, Decimal("45.00"), "ORD-2026-0001")
        assert [o["method"] for o in options] == ["venmo"]

    def test_deduplicates_a_repeated_method(self):
        settings = _settings(accepted_payment_methods=["venmo", "venmo"])
        options = build_payment_options(settings, Decimal("45.00"), "ORD-2026-0001")
        assert len(options) == 1

    def test_no_accepted_methods_yields_nothing(self):
        settings = _settings(accepted_payment_methods=None)
        assert build_payment_options(settings, Decimal("45.00"), "ORD-1") == []


class TestOptionContent:
    def test_venmo_carries_the_order_number_in_the_link(self):
        options = _by_method(
            build_payment_options(_settings(), Decimal("45.00"), "ORD-2026-0001")
        )
        venmo = options["venmo"]
        assert venmo["handle"] == "@FallsChurchFire"
        assert "ORD-2026-0001" in venmo["payment_url"]
        assert "amount=45.00" in venmo["payment_url"]
        # Venmo passes our note through, so the member is not asked to type it.
        assert venmo["prefills_reference"] is True

    def test_cash_app_has_no_note_field_so_the_member_must_type_it(self):
        options = _by_method(
            build_payment_options(_settings(), Decimal("45.00"), "ORD-2026-0001")
        )
        cash_app = options["cash_app"]
        assert cash_app["payment_url"] == "https://cash.app/$FallsChurchFire/45.00"
        assert cash_app["prefills_reference"] is False

    def test_paypal_link_carries_the_amount(self):
        options = _by_method(
            build_payment_options(_settings(), Decimal("45.00"), "ORD-2026-0001")
        )
        assert options["paypal"]["payment_url"] == "https://paypal.me/fcfd/45.00"

    def test_paypal_falls_back_to_the_email_with_no_link(self):
        settings = _settings(
            paypal_me_url=None,
            paypal_email="store@example.org",
            accepted_payment_methods=["paypal"],
        )
        paypal = _by_method(build_payment_options(settings, Decimal("45.00"), "ORD-1"))[
            "paypal"
        ]
        assert paypal["payment_url"] is None
        assert paypal["handle"] == "store@example.org"

    def test_zelle_offers_a_handle_but_never_a_link(self):
        # Zelle lives inside each bank's own app; there is nothing to open.
        zelle = _by_method(
            build_payment_options(_settings(), Decimal("45.00"), "ORD-1")
        )["zelle"]
        assert zelle["payment_url"] is None
        assert zelle["handle"] == "treasurer@example.org"

    def test_zelle_passes_through_its_instructions(self):
        settings = _settings(
            accepted_payment_methods=["zelle"],
            zelle_instructions="Confirm the recipient reads Falls Church FD.",
        )
        zelle = _by_method(build_payment_options(settings, Decimal("45"), "ORD-1"))[
            "zelle"
        ]
        assert zelle["instructions"] == "Confirm the recipient reads Falls Church FD."

    def test_offline_methods_carry_their_instructions(self):
        settings = _settings(
            accepted_payment_methods=["check", "cash", "payroll_deduction", "other"],
            check_payable_to="Falls Church VFD",
            check_mailing_address="100 Main St",
            cash_instructions="Pay the quartermaster at drill.",
            payroll_deduction_instructions="Submit form 27B.",
            other_payment_instructions="Ask the treasurer.",
        )
        options = _by_method(build_payment_options(settings, Decimal("45"), "ORD-1"))
        assert options["check"]["handle"] == "Falls Church VFD"
        assert options["check"]["instructions"] == "100 Main St"
        assert options["cash"]["instructions"] == "Pay the quartermaster at drill."
        assert options["payroll_deduction"]["instructions"] == "Submit form 27B."
        assert options["other"]["instructions"] == "Ask the treasurer."

    def test_every_option_carries_a_label(self):
        settings = _settings(
            accepted_payment_methods=[m.value for m in StorePaymentMethod],
            check_payable_to="Falls Church VFD",
        )
        options = build_payment_options(settings, Decimal("45"), "ORD-1")
        assert all(o["label"] for o in options)


class TestRetiredMethodStillPayable:
    """A member owing on a method the department has since stopped accepting."""

    def _order(self, method):
        from app.models.storefront import StoreOrder

        return StoreOrder(
            id="o1",
            organization_id="org1",
            order_number="ORD-2026-0001",
            customer_name="A. Member",
            total=Decimal("45.00"),
            amount_paid=Decimal("0.00"),
            payment_method=method,
        )

    def test_the_orders_own_method_survives_being_dropped(self):
        from app.services.storefront_service import StorefrontService

        # Venmo is gone from the accepted list, but this order was placed on it
        # and the member still owes the money.
        settings = _settings(accepted_payment_methods=["paypal"])
        payload = StorefrontService(None).build_payment_instructions(
            self._order(StorePaymentMethod.VENMO), settings
        )
        assert payload is not None
        assert payload["method"] == "venmo"
        assert "ORD-2026-0001" in payload["payment_url"]
        # And the still-accepted methods remain on offer.
        assert [o["method"] for o in payload["options"]] == ["venmo", "paypal"]

    def test_the_chosen_method_leads_the_list(self):
        from app.services.storefront_service import StorefrontService

        payload = StorefrontService(None).build_payment_instructions(
            self._order(StorePaymentMethod.ZELLE), _settings()
        )
        assert payload is not None
        assert payload["options"][0]["method"] == "zelle"
        assert {o["method"] for o in payload["options"]} == {
            "venmo",
            "paypal",
            "cash_app",
            "zelle",
        }


class TestOnlyAcceptedMethodsAreOffered:
    """A department must never be shown paying by a method it does not take."""

    def test_a_configured_method_that_is_not_accepted_stays_hidden(self):
        # The handle is still on file — the department used to take Cash App,
        # or filled it in speculatively — but they have not ticked it, so it
        # is not on offer.
        settings = _settings(accepted_payment_methods=["venmo"])
        assert settings.cash_app_cashtag  # configured...
        labels = [
            o["label"]
            for o in build_payment_options(settings, Decimal("45.00"), "ORD-1")
        ]
        assert labels == ["Venmo"]  # ...but not offered

    def test_ticking_it_is_what_puts_it_on_offer(self):
        settings = _settings(accepted_payment_methods=["venmo", "cash_app"])
        labels = [
            o["label"]
            for o in build_payment_options(settings, Decimal("45.00"), "ORD-1")
        ]
        assert labels == ["Venmo", "Cash App"]

    def test_both_conditions_are_required(self):
        # Ticked without a handle is just as hidden as configured without a
        # tick. The member sees a method only when both are true.
        for accepted, cashtag in (
            (["venmo", "cash_app"], None),
            (["venmo"], "FallsChurchFire"),
            (["venmo"], None),
        ):
            settings = _settings(
                accepted_payment_methods=accepted, cash_app_cashtag=cashtag
            )
            labels = [
                o["label"]
                for o in build_payment_options(settings, Decimal("45.00"), "ORD-1")
            ]
            assert "Cash App" not in labels
