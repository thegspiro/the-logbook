"""
Previewing what the store's emails look like.

The settings screen lists nine notices a quartermaster can switch on and off.
These tests cover the thing that makes that list usable: being able to see one
before deciding. The preview renders through the real ``send_*`` method, so the
tests that matter most are the ones proving it is the *same* email — same
subject, same payment buttons, same wording pulled from the department's own
settings — and that previewing never sends anything or writes anything.
"""

import uuid
from decimal import Decimal

import pytest

from app.models.storefront import StoreProduct, StoreProductStatus
from app.models.user import Organization, User
from app.services import storefront_notification_service as notify_module
from app.services import storefront_preview_service as preview_module
from app.services.storefront_preview_service import (
    PreviewNotAvailable,
    StorefrontPreviewService,
)
from app.services.storefront_service import StorefrontService

pytestmark = pytest.mark.integration


class _ExplodingEmailService:
    """Any attempt to actually deliver a preview is a bug."""

    def __init__(self, *_args, **_kwargs):
        pass

    async def send_email(self, **_kwargs):
        raise AssertionError("a preview must never send email")


@pytest.fixture(autouse=True)
def _no_delivery(monkeypatch):
    monkeypatch.setattr(notify_module, "EmailService", _ExplodingEmailService)
    monkeypatch.setattr(preview_module, "EmailService", _ExplodingEmailService)


async def _store(db, **overrides):
    org = Organization(name="Preview FD", slug=f"preview-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    service = StorefrontService(db)
    payload = {
        "is_enabled": True,
        "store_name": "Falls Church Store",
        "allow_pickup": True,
        "accepted_payment_methods": ["venmo", "cash"],
        "venmo_handle": "FallsChurchFire",
        "cash_instructions": "Hand it to the quartermaster at drill.",
        "receipt_footer": "Questions? Find Quinn at the station.",
    }
    payload.update(overrides)
    await service.update_settings(org.id, payload)
    return org


class TestEveryNoticeRenders:
    @pytest.mark.parametrize("notice", sorted(StorefrontPreviewService.CATALOG.keys()))
    async def test_a_notice_renders_a_subject_and_a_body(self, db_session, notice):
        org = await _store(db_session)
        preview = await StorefrontPreviewService(db_session).render(notice, org.id)

        assert preview["notice"] == notice
        assert preview["subject"].strip()
        assert preview["html_body"].strip().startswith("<")
        assert preview["text_body"].strip()
        assert preview["label"].strip()
        assert preview["audience"].strip()

    async def test_the_catalog_covers_every_switch_and_nothing_else(self):
        """A notice with no switch could be previewed but never controlled."""
        settings_fields = {
            entry["setting"] for entry in StorefrontPreviewService.CATALOG.values()
        }
        assert settings_fields == {
            "send_order_confirmation",
            "send_status_updates",
            "send_payment_receipts",
            "send_payment_reminders",
            "notify_admins_on_order",
            "send_window_opened",
            "send_window_closing_reminder",
            "send_window_closed",
            "send_vendor_order_updates",
        }

    async def test_an_unknown_notice_is_rejected(self, db_session):
        org = await _store(db_session)
        with pytest.raises(PreviewNotAvailable):
            await StorefrontPreviewService(db_session).render("nonsense", org.id)


class TestThePreviewShowsTheRealSettings:
    async def test_it_uses_the_departments_own_payment_configuration(self, db_session):
        org = await _store(db_session)
        preview = await StorefrontPreviewService(db_session).render(
            "order_confirmation", org.id
        )

        body = preview["html_body"]
        assert "Falls Church Store" in body
        assert "Pay with Venmo" in body
        assert "FallsChurchFire" in body
        assert "Hand it to the quartermaster at drill." in body
        assert "Questions? Find Quinn at the station." in body

    async def test_a_method_the_store_does_not_accept_is_absent(self, db_session):
        """The preview is how a quartermaster checks exactly this."""
        org = await _store(
            db_session,
            accepted_payment_methods=["cash"],
            cash_app_cashtag="$FallsChurch",
        )
        preview = await StorefrontPreviewService(db_session).render(
            "order_confirmation", org.id
        )

        assert "Cash App" not in preview["html_body"]
        assert "Pay with Venmo" not in preview["html_body"]

    async def test_reworded_instructions_show_up_immediately(self, db_session):
        org = await _store(db_session)
        await StorefrontService(db_session).update_settings(
            org.id, {"payment_instructions": "Reference your bay number."}
        )
        preview = await StorefrontPreviewService(db_session).render(
            "payment_reminder", org.id
        )

        assert "Reference your bay number." in preview["html_body"]

    async def test_it_reports_whether_the_notice_is_currently_on(self, db_session):
        org = await _store(db_session, send_window_opened=False)
        service = StorefrontPreviewService(db_session)

        assert (await service.render("window_opened", org.id))["enabled"] is False
        assert (await service.render("window_closed", org.id))["enabled"] is True

    async def test_it_names_the_other_emails_the_same_switch_governs(self, db_session):
        org = await _store(db_session)
        service = StorefrontPreviewService(db_session)

        status = await service.render("status_change", org.id)
        assert status["also_governs"] == ["The cancellation notice"]

        receipt = await service.render("payment_receipt", org.id)
        assert "Refunds" in receipt["also_governs"]


class TestPreviewingIsInert:
    async def test_a_switched_off_notice_still_previews(self, db_session):
        """Otherwise you could not look before deciding to turn it on."""
        org = await _store(db_session, send_vendor_order_updates=False)
        preview = await StorefrontPreviewService(db_session).render(
            "vendor_order_placed", org.id
        )

        assert preview["enabled"] is False
        assert "Acme Apparel" in preview["html_body"]

    async def test_it_writes_no_orders_or_windows(self, db_session):
        org = await _store(db_session)
        db_session.add(
            StoreProduct(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name="Job Shirt",
                price=Decimal("45.00"),
                status=StoreProductStatus.ACTIVE,
            )
        )
        await db_session.flush()

        service = StorefrontPreviewService(db_session)
        for notice in StorefrontPreviewService.CATALOG:
            await service.render(notice, org.id)

        orders, total = await StorefrontService(db_session).list_orders(org.id)
        assert total == 0
        assert orders == []
        windows = await StorefrontService(db_session).list_windows(org.id)
        assert windows == []

    async def test_it_does_not_resolve_real_members(self, db_session):
        """A store with no members yet must still render every notice."""
        org = await _store(db_session)
        db_session.add(
            User(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                username=f"member-{uuid.uuid4().hex[:8]}",
                email="real.member@example.org",
                first_name="Real",
                last_name="Member",
            )
        )
        await db_session.flush()

        preview = await StorefrontPreviewService(db_session).render(
            "window_opened", org.id
        )
        assert "real.member@example.org" not in preview["html_body"]


class TestSendingYourselfATest:
    """A real inbox, because an iframe is not one.

    Gmail and Outlook rewrite email HTML, and the thing worth checking — does
    the Venmo button actually tap through on a phone — can only be checked from
    a delivered message.
    """

    async def test_it_mails_the_previewed_notice_to_the_requester(
        self, db_session, monkeypatch
    ):
        sent = []

        class _Capturing(_ExplodingEmailService):
            async def send_email(self, **kwargs):
                sent.append(kwargs)
                return 1, 0

        monkeypatch.setattr(notify_module, "EmailService", _Capturing)
        monkeypatch.setattr(preview_module, "EmailService", _Capturing)

        org = await _store(db_session)
        result = await StorefrontPreviewService(db_session).send_test(
            "order_confirmation", org.id, "quinn@example.org"
        )

        assert result["delivered"] is True
        assert result["sent_to"] == "quinn@example.org"
        assert len(sent) == 1
        assert sent[0]["to_emails"] == ["quinn@example.org"]
        # Same email as the preview: the department's own payment details.
        assert "Pay with Venmo" in sent[0]["html_body"]
        assert "FallsChurchFire" in sent[0]["html_body"]

    async def test_it_is_marked_as_a_test_in_both_bodies(self, db_session, monkeypatch):
        """The sample announces an order number that does not exist.

        An unmarked copy sitting in an inbox is a message someone acts on
        later.
        """
        sent = []

        class _Capturing(_ExplodingEmailService):
            async def send_email(self, **kwargs):
                sent.append(kwargs)
                return 1, 0

        monkeypatch.setattr(notify_module, "EmailService", _Capturing)
        monkeypatch.setattr(preview_module, "EmailService", _Capturing)

        org = await _store(db_session)
        await StorefrontPreviewService(db_session).send_test(
            "order_confirmation", org.id, "quinn@example.org"
        )

        assert sent[0]["subject"].startswith("[TEST] ")
        assert "Test message." in sent[0]["html_body"]
        assert "no order exists" in sent[0]["html_body"]
        assert sent[0]["text_body"].startswith("[TEST")

    async def test_it_never_addresses_anybody_but_the_requester(
        self, db_session, monkeypatch
    ):
        """Not a way to mail the department from the settings screen."""
        sent = []

        class _Capturing(_ExplodingEmailService):
            async def send_email(self, **kwargs):
                sent.append(kwargs)
                return 1, 0

        monkeypatch.setattr(notify_module, "EmailService", _Capturing)
        monkeypatch.setattr(preview_module, "EmailService", _Capturing)

        org = await _store(db_session)
        db_session.add(
            User(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                username=f"member-{uuid.uuid4().hex[:8]}",
                email="real.member@example.org",
                first_name="Real",
                last_name="Member",
            )
        )
        await db_session.flush()

        # window_opened would otherwise resolve the whole active roster.
        await StorefrontPreviewService(db_session).send_test(
            "window_opened", org.id, "quinn@example.org"
        )

        assert sent[0]["to_emails"] == ["quinn@example.org"]
        assert not sent[0].get("bcc_emails")

    async def test_an_account_with_no_address_is_refused(self, db_session):
        org = await _store(db_session)
        with pytest.raises(PreviewNotAvailable):
            await StorefrontPreviewService(db_session).send_test(
                "order_confirmation", org.id, None
            )

    async def test_an_unknown_notice_is_refused_before_anything_is_sent(
        self, db_session
    ):
        org = await _store(db_session)
        with pytest.raises(PreviewNotAvailable):
            await StorefrontPreviewService(db_session).send_test(
                "nonsense", org.id, "quinn@example.org"
            )

    async def test_email_being_switched_off_is_reported_not_raised(
        self, db_session, monkeypatch
    ):
        """A setup gap, not a failure of the notice under test."""

        class _Disabled(_ExplodingEmailService):
            async def send_email(self, **_kwargs):
                return 0, 1

        monkeypatch.setattr(notify_module, "EmailService", _Disabled)
        monkeypatch.setattr(preview_module, "EmailService", _Disabled)

        org = await _store(db_session)
        result = await StorefrontPreviewService(db_session).send_test(
            "order_confirmation", org.id, "quinn@example.org"
        )

        assert result["delivered"] is False
        assert "not configured" in result["detail"]
