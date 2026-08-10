"""
The storefront's notices as editable templates.

Two things have to hold at once. A department that edits a notice in
Communications → Email Templates must see its own wording go out; a department
that never opens that screen must keep receiving exactly what this module sent
before templates existed. The second is the one that breaks silently, so it is
tested against the real composed output rather than a mock.
"""

import re
import uuid
from decimal import Decimal

import pytest

from app.models.email_template import EmailTemplate, EmailTemplateType
from app.models.user import Organization
from app.services import email_templates_storefront as storefront_templates
from app.services import storefront_notification_service as notify_module
from app.services import storefront_preview_service as preview_module
from app.services.email_template_service import (
    RENDERER_INJECTED_VARIABLES,
    SAMPLE_CONTEXT,
    EmailTemplateService,
    get_variables_for_type,
)
from app.services.storefront_preview_service import StorefrontPreviewService
from app.services.storefront_service import StorefrontService

pytestmark = pytest.mark.integration

_STOREFRONT_TYPES = [
    defn["type"] for defn in storefront_templates.DEFAULT_TEMPLATE_DEFS
]


class _NoDelivery:
    def __init__(self, *_args, **_kwargs):
        pass

    async def send_email(self, **_kwargs):
        raise AssertionError("these tests never deliver")


@pytest.fixture(autouse=True)
def _no_delivery(monkeypatch):
    monkeypatch.setattr(notify_module, "EmailService", _NoDelivery)
    monkeypatch.setattr(preview_module, "EmailService", _NoDelivery)


async def _store(db) -> Organization:
    org = Organization(name="Template FD", slug=f"tmpl-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    await StorefrontService(db).update_settings(
        org.id,
        {
            "is_enabled": True,
            "store_name": "Falls Church Store",
            "accepted_payment_methods": ["venmo"],
            "venmo_handle": "FallsChurchFire",
            "receipt_footer": "Questions? Find Quinn at the station.",
        },
    )
    return org


async def _render(db, notice: str, org) -> dict:
    return await StorefrontPreviewService(db).render(notice, org.id)


# ======================================================================
# Registration
# ======================================================================


class TestTheTemplatesAreRegistered:
    def test_every_notice_the_store_sends_has_a_type(self):
        """A notice with no type could never be edited."""
        sent_types = {
            "storefront_order_confirmation",
            "storefront_new_order_admin",
            "storefront_order_update",
            "storefront_order_cancelled",
            "storefront_payment_reminder",
            "storefront_payment_received",
            "storefront_window_open",
            "storefront_window_closing",
            "storefront_window_closed",
            "storefront_vendor_order_placed",
        }
        assert {t.value for t in _STOREFRONT_TYPES} == sent_types
        for value in sent_types:
            assert EmailTemplateType(value)

    async def test_the_defaults_are_created_for_a_new_organization(self, db_session):
        org = await _store(db_session)
        service = EmailTemplateService(db_session)
        await service.ensure_default_templates(organization_id=org.id)
        await db_session.flush()

        for template_type in _STOREFRONT_TYPES:
            template = await service.get_template(org.id, template_type)
            assert template is not None, template_type
            assert template.subject.strip()
            assert template.html_body.strip()
            assert template.text_body.strip()

    def test_every_variable_a_default_body_uses_has_sample_data(self):
        """Otherwise the Email Templates preview shows raw {{placeholders}}."""
        for defn in storefront_templates.DEFAULT_TEMPLATE_DEFS:
            key = defn["type"].value
            sample = SAMPLE_CONTEXT[key]
            used = set()
            for field in ("subject", "html", "text"):
                used |= set(re.findall(r"\{\{\s*(\w+)\s*\}\}", defn[field]))
            # The renderer injects these itself; no caller supplies them.
            missing = used - set(sample) - RENDERER_INJECTED_VARIABLES
            assert not missing, f"{key} has no sample for {sorted(missing)}"

    def test_every_variable_a_default_body_uses_is_documented(self):
        """The editor lists these; an undocumented one is invisible."""
        for defn in storefront_templates.DEFAULT_TEMPLATE_DEFS:
            key = defn["type"].value
            documented = {v["name"] for v in get_variables_for_type(key)}
            used = set()
            for field in ("subject", "html", "text"):
                used |= set(re.findall(r"\{\{\s*(\w+)\s*\}\}", defn[field]))
            missing = used - documented - RENDERER_INJECTED_VARIABLES
            assert not missing, f"{key} does not document {sorted(missing)}"

    def test_computed_chunks_are_registered_as_raw_html(self):
        """Escaped, the item table would arrive as visible angle brackets."""
        raw = EmailTemplateService._RAW_HTML_VARIABLES
        for name in storefront_templates.RAW_HTML_VARIABLES:
            assert name in raw


# ======================================================================
# With no template row — the behaviour that must not change
# ======================================================================


class TestTheCodedFallbackIsUnchanged:
    async def test_a_store_that_never_opened_the_editor_gets_the_same_email(
        self, db_session
    ):
        org = await _store(db_session)
        preview = await _render(db_session, "order_confirmation", org)

        assert preview["subject"] == "Order ORD-2026-0042 received"
        body = preview["html_body"]
        assert "Falls Church Store" in body
        assert "Department Job Shirt" in body
        assert "Pay with Venmo" in body
        assert "Questions? Find Quinn at the station." in body

    async def test_an_inactive_template_falls_back(self, db_session):
        """Deactivating a template restores the built-in wording."""
        org = await _store(db_session)
        db_session.add(
            EmailTemplate(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                template_type=EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION,
                name="Store — Order Confirmation",
                subject="Edited subject {{order_number}}",
                html_body="<p>Edited body</p>",
                is_active=False,
            )
        )
        await db_session.flush()

        preview = await _render(db_session, "order_confirmation", org)
        assert preview["subject"] == "Order ORD-2026-0042 received"
        assert "Edited body" not in preview["html_body"]


# ======================================================================
# With a template row
# ======================================================================


async def _install(db, org, template_type, *, subject, html, text=None):
    template = EmailTemplate(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        template_type=template_type,
        name=f"Edited {template_type.value}",
        subject=subject,
        html_body=html,
        text_body=text,
        is_active=True,
    )
    db.add(template)
    await db.flush()
    return template


class TestAnEditedTemplateIsUsed:
    async def test_the_departments_own_wording_goes_out(self, db_session):
        org = await _store(db_session)
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION,
            subject="We got your order, {{first_name}}",
            html="<p>Thanks {{first_name}} — order {{order_number}}.</p>",
        )

        preview = await _render(db_session, "order_confirmation", org)
        assert preview["subject"] == "We got your order, Sam"
        assert "Thanks Sam — order ORD-2026-0042." in preview["html_body"]
        # The built-in prose is gone; this is the admin's email now.
        assert "Thanks for your order from the" not in preview["html_body"]

    async def test_the_item_table_arrives_as_a_table_not_as_text(self, db_session):
        """The point of the raw-HTML variables."""
        org = await _store(db_session)
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION,
            subject="Order {{order_number}}",
            html="<p>Here it is:</p>{{items_table_html}}{{payment_block_html}}",
        )

        body = (await _render(db_session, "order_confirmation", org))["html_body"]
        assert "<table" in body
        assert "&lt;table" not in body
        assert "Department Job Shirt" in body
        assert "Pay with Venmo" in body

    async def test_a_member_still_cannot_inject_markup_through_the_template(
        self, db_session
    ):
        """Personalization is escaped when the table is built, not after."""
        org = await _store(db_session)
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION,
            subject="Order {{order_number}}",
            html="{{items_table_html}}",
        )
        service = StorefrontPreviewService(db_session)
        composed = await service._compose_message("order_confirmation", org.id)
        # The sample order carries a plain name; assert the escaping path is
        # the table builder by feeding it markup directly.
        notifier = notify_module.StorefrontNotificationService(db_session)
        order = preview_module._sample_order(composed["settings"])
        order.items[0].personalization_text = '<script>alert("x")</script>'
        table = notifier._items_table(order, "USD")
        assert "<script>" not in table
        assert "&lt;script&gt;" in table

    async def test_dropping_a_variable_drops_that_part_of_the_email(self, db_session):
        """An admin removing {{payment_block_html}} means what it looks like."""
        org = await _store(db_session)
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_PAYMENT_REMINDER,
            subject="You owe {{balance_due}}",
            html="<p>Order {{order_number}} — {{balance_due}} outstanding.</p>",
        )

        preview = await _render(db_session, "payment_reminder", org)
        assert preview["subject"] == "You owe $53.00"
        assert "Pay with Venmo" not in preview["html_body"]

    async def test_a_window_notice_uses_its_template(self, db_session):
        org = await _store(db_session)
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_VENDOR_ORDER_PLACED,
            subject="{{window_name}} is with the vendor",
            html="<p>{{window_name}}</p>{{window_extra_html}}",
        )

        preview = await _render(db_session, "vendor_order_placed", org)
        assert preview["subject"] == "Fall job shirts is with the vendor"
        assert "Acme Apparel" in preview["html_body"]

    async def test_the_cancellation_notice_has_its_own_template(self, db_session):
        """It used to share the order-update type.

        Sharing would mean rewording the status-change email and silently
        changing what a cancelled member reads.
        """
        org = await _store(db_session)
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_ORDER_UPDATE,
            subject="Update: {{order_number}}",
            html="<p>Status update only.</p>",
        )
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_ORDER_CANCELLED,
            subject="Sorry — {{order_number}} cancelled",
            html="<p>Cancelled: {{order_number}}.</p>{{refund_notice_html}}",
        )

        notifier = notify_module.StorefrontNotificationService(db_session, capture=[])
        settings = await StorefrontService(db_session).get_settings(org.id)
        order = preview_module._sample_order(settings)
        await notifier.send_order_cancelled(order, "Vendor discontinued", settings, org)

        message = notifier._capture[0]
        assert message["subject"] == "Sorry — ORD-2026-0042 cancelled"
        assert message["template_type"] == "storefront_order_cancelled"
        assert "Status update only" not in message["html_body"]


class TestDefaultTemplatesMatchTheCodedEmail:
    """A department accepting the defaults must not notice the change."""

    @pytest.mark.parametrize(
        "notice",
        [
            "order_confirmation",
            "payment_reminder",
            "window_opened",
            "vendor_order_placed",
        ],
    )
    async def test_the_default_template_carries_the_same_content(
        self, db_session, notice
    ):
        org = await _store(db_session)
        service = StorefrontPreviewService(db_session)
        coded = await _render(db_session, notice, org)
        # Guard against this passing because templates were never consulted.
        before = await service._compose_message(notice, org.id)
        assert before["message"]["templated"] is False

        await EmailTemplateService(db_session).ensure_default_templates(
            organization_id=org.id
        )
        await db_session.flush()
        after = await StorefrontPreviewService(db_session)._compose_message(
            notice, org.id
        )
        assert after["message"]["templated"] is True
        templated = await StorefrontPreviewService(db_session).render(notice, org.id)

        assert templated["subject"] == coded["subject"]
        for phrase in ("Falls Church Store", "Fall job shirts", "Pay with Venmo"):
            if phrase in coded["html_body"]:
                assert phrase in templated["html_body"], phrase

    async def test_no_placeholder_survives_into_a_defaulted_email(self, db_session):
        """A stray {{variable}} in a member's inbox is the visible failure."""
        org = await _store(db_session)
        await EmailTemplateService(db_session).ensure_default_templates(
            organization_id=org.id
        )
        await db_session.flush()

        service = StorefrontPreviewService(db_session)
        for notice in StorefrontPreviewService.CATALOG:
            preview = await service.render(notice, org.id)
            leftovers = re.findall(r"\{\{\s*\w+\s*\}\}", preview["html_body"])
            assert not leftovers, f"{notice} left {leftovers}"
            assert not re.findall(r"\{\{\s*\w+\s*\}\}", preview["subject"])


class TestPerformance:
    async def test_the_template_is_read_once_per_run_not_once_per_order(
        self, db_session
    ):
        """A reminder run walks up to 200 orders."""
        org = await _store(db_session)
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_PAYMENT_REMINDER,
            subject="Order {{order_number}}",
            html="<p>{{balance_due}}</p>",
        )

        notifier = notify_module.StorefrontNotificationService(db_session, capture=[])
        settings = await StorefrontService(db_session).get_settings(org.id)
        reads = 0
        original = EmailTemplateService.get_template

        async def counting(self, organization_id, template_type, active_only=True):
            nonlocal reads
            reads += 1
            return await original(self, organization_id, template_type, active_only)

        EmailTemplateService.get_template = counting
        try:
            for _ in range(5):
                order = preview_module._sample_order(settings)
                order.amount_paid = Decimal("0.00")
                await notifier.send_payment_reminder(order, settings, org)
        finally:
            EmailTemplateService.get_template = original

        assert len(notifier._capture) == 5
        assert reads == 1


class TestPartialAndAwkwardEdits:
    """The states an admin lands in halfway through editing."""

    async def test_an_edited_html_body_with_no_text_body_keeps_the_coded_text(
        self, db_session
    ):
        """Mismatched, but a member with a text-only client still gets prose.

        The alternative — an empty plain-text part — reads as a blank email in
        the clients that refuse HTML.
        """
        org = await _store(db_session)
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION,
            subject="Custom {{order_number}}",
            html="<p>Custom body</p>",
            text=None,
        )

        preview = await _render(db_session, "order_confirmation", org)
        assert preview["subject"] == "Custom ORD-2026-0042"
        assert "Custom body" in preview["html_body"]
        assert preview["text_body"].startswith("Order ORD-2026-0042 received")

    async def test_a_blank_subject_falls_back_rather_than_sending_blank(
        self, db_session
    ):
        """An email with no subject line looks like spam."""
        org = await _store(db_session)
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION,
            subject="",
            html="<p>Custom body</p>",
        )

        preview = await _render(db_session, "order_confirmation", org)
        assert preview["subject"] == "Order ORD-2026-0042 received"

    async def test_an_unknown_variable_renders_as_nothing_not_as_braces(
        self, db_session
    ):
        """A typo'd variable must not reach a member as {{ordr_number}}."""
        org = await _store(db_session)
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION,
            subject="Order {{order_number}}",
            html="<p>Ref {{ordr_number}} — typo above.</p>",
        )

        body = (await _render(db_session, "order_confirmation", org))["html_body"]
        assert "{{" not in body
        assert "Ref  — typo above." in body

    async def test_the_test_send_banner_survives_an_edited_template(self, db_session):
        """The banner is injected into markup the admin arranged, not ours."""
        sent = []

        class _Capturing:
            def __init__(self, *_args, **_kwargs):
                pass

            async def send_email(self, **kwargs):
                sent.append(kwargs)
                return 1, 0

        org = await _store(db_session)
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION,
            subject="Custom {{order_number}}",
            html="<p>Custom body</p>",
        )

        preview_module.EmailService = _Capturing
        try:
            await StorefrontPreviewService(db_session).send_test(
                "order_confirmation", org.id, "quinn@example.org"
            )
        finally:
            preview_module.EmailService = _NoDelivery

        body = sent[0]["html_body"]
        assert sent[0]["subject"] == "[TEST] Custom ORD-2026-0042"
        assert body.index("Test message.") < body.index("Custom body")

    async def test_a_message_a_quartermaster_typed_uses_the_update_template(
        self, db_session
    ):
        """It has no status, so the status phrases render empty rather than odd."""
        org = await _store(db_session)
        await _install(
            db_session,
            org,
            EmailTemplateType.STOREFRONT_ORDER_UPDATE,
            subject="Order {{order_number}}{{status_subject_suffix}}",
            html="<p>{{order_number}}{{status_label_suffix}}: {{update_message}}</p>",
        )

        notifier = notify_module.StorefrontNotificationService(db_session, capture=[])
        settings = await StorefrontService(db_session).get_settings(org.id)
        order = preview_module._sample_order(settings)
        await notifier.send_order_update(
            order, "Your shirt is on the truck.", settings, org
        )

        message = notifier._capture[0]
        assert message["subject"] == "Order ORD-2026-0042 update"
        assert "ORD-2026-0042: Your shirt is on the truck." in message["html_body"]


class TestOrgIsolation:
    async def test_one_orgs_wording_never_reaches_anothers_members(self, db_session):
        """The template cache is keyed by org as well as notice.

        Every caller builds one service per organization today, so the notice
        key alone would be enough — which is exactly why this is pinned. A
        cache that is only correct because of how it happens to be called is
        one refactor away from mailing org A's wording to org B.
        """
        org_a = await _store(db_session)
        org_b = await _store(db_session)
        await _install(
            db_session,
            org_a,
            EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION,
            subject="A's subject {{order_number}}",
            html="<p>A's wording</p>",
        )

        notifier = notify_module.StorefrontNotificationService(db_session, capture=[])
        for org in (org_a, org_b):
            settings = await StorefrontService(db_session).get_settings(org.id)
            order = preview_module._sample_order(settings)
            organization = await notifier._get_organization(org.id)
            await notifier.send_order_confirmation(order, settings, organization)

        first, second = notifier._capture
        assert first["subject"] == "A's subject ORD-2026-0042"
        assert "A's wording" in first["html_body"]
        # B has no template of its own and must fall back, not inherit A's.
        assert second["subject"] == "Order ORD-2026-0042 received"
        assert "A's wording" not in second["html_body"]

    async def test_a_template_is_only_found_in_its_own_org(self, db_session):
        org_a = await _store(db_session)
        org_b = await _store(db_session)
        await _install(
            db_session,
            org_a,
            EmailTemplateType.STOREFRONT_WINDOW_OPEN,
            subject="A only",
            html="<p>A only</p>",
        )

        assert (await _render(db_session, "window_opened", org_a))[
            "subject"
        ] == "A only"
        assert (await _render(db_session, "window_opened", org_b))[
            "subject"
        ] == "Store orders are open — Fall job shirts"
