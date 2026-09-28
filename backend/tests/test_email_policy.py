"""The central list of member emails: required or optional, and who decides.

Before app/services/email_policy.py each sender read preferences its own way,
so the member's "Email notifications" switch stopped some emails and not
others. These tests pin the decision order and check that the list, the
senders and the admin page cannot drift apart.
"""

import pathlib
import re
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.email_policy import (
    EMAIL_POLICIES,
    OPTIONAL_KINDS,
    EmailKind,
    clean_email_kind_choices,
    member_receives_email,
    recipients_for,
)
from app.services.notification_channels import SMS_ALERT_DETAILS, SmsAlert

pytestmark = pytest.mark.unit

APP = pathlib.Path(__file__).resolve().parent.parent / "app"


class TestTheList:
    def test_every_kind_is_classified(self):
        assert set(EMAIL_POLICIES) == set(EmailKind)

    def test_the_kinds_the_department_named_are_required(self):
        for kind in (
            EmailKind.ELECTION_BALLOTS,
            EmailKind.ACCOUNT_SECURITY,
            EmailKind.DEPARTMENT_MESSAGES,
        ):
            assert EMAIL_POLICIES[kind].required, kind

    def test_nomination_notices_and_officer_duties_are_optional(self):
        for kind in (
            EmailKind.ELECTION_NOTICES,
            EmailKind.EVENT_DUTIES,
            EmailKind.SCHEDULING_DUTIES,
            EmailKind.TRAINING_DUTIES,
            EmailKind.ELECTION_ADMIN,
            EmailKind.INVENTORY_DUTIES,
            EmailKind.MEMBERSHIP_ADMIN,
        ):
            policy = EMAIL_POLICIES[kind]
            assert not policy.required, kind
            assert policy.default_on, kind

    def test_every_kind_says_what_it_covers(self):
        for kind, policy in EMAIL_POLICIES.items():
            assert policy.label, kind
            assert policy.includes, kind
            assert policy.rationale, kind

    def test_every_optional_kind_has_a_sender_that_reads_it(self):
        # CLAUDE.md pitfall #19: a switch with no reader tells a member an
        # email is off when nothing ever checked. Required kinds are exempt —
        # there is nothing for a sender to check.
        sources = "\n".join(
            path.read_text()
            for path in APP.rglob("*.py")
            if path.name != "email_policy.py"
        )
        unread = [
            kind.name
            for kind in OPTIONAL_KINDS
            if not re.search(rf"EmailKind\.{kind.name}\b", sources)
        ]
        assert unread == []

    def test_every_text_alert_is_described(self):
        assert set(SMS_ALERT_DETAILS) == set(SmsAlert)
        for info in SMS_ALERT_DETAILS.values():
            assert EmailKind(info.email_kind)


class TestTheDecision:
    def test_a_required_kind_ignores_every_preference(self):
        prefs = {
            "email_notifications": False,
            "email_kinds": {"election_ballots": False},
        }
        assert member_receives_email(prefs, EmailKind.ELECTION_BALLOTS)

    @pytest.mark.parametrize("prefs", [None, {}, {"email_notifications": True}])
    def test_an_optional_kind_is_on_by_default(self, prefs):
        assert member_receives_email(prefs, EmailKind.SHIFT_NOTICES)

    def test_the_email_switch_turns_off_every_optional_kind(self):
        prefs = {"email_notifications": False}
        for kind in OPTIONAL_KINDS:
            assert not member_receives_email(prefs, kind), kind

    def test_the_email_switch_wins_over_a_per_kind_choice(self):
        prefs = {
            "email_notifications": False,
            "email_kinds": {"shift_notices": True},
        }
        assert not member_receives_email(prefs, EmailKind.SHIFT_NOTICES)

    def test_a_per_kind_choice_is_honoured(self):
        prefs = {"email_kinds": {"shift_notices": False}}
        assert not member_receives_email(prefs, EmailKind.SHIFT_NOTICES)
        assert member_receives_email(prefs, EmailKind.INVENTORY_UPDATES)

    @pytest.mark.parametrize(
        ("kind", "legacy"),
        [
            (EmailKind.EVENT_REMINDERS, "event_reminders"),
            (EmailKind.TRAINING_REMINDERS, "training_reminders"),
        ],
    )
    def test_the_older_topic_switch_still_applies(self, kind, legacy):
        assert not member_receives_email({legacy: False}, kind)

    def test_an_explicit_choice_overrides_the_older_topic_switch(self):
        prefs = {
            "event_reminders": False,
            "email_kinds": {"event_reminders": True},
        }
        assert member_receives_email(prefs, EmailKind.EVENT_REMINDERS)

    @pytest.mark.parametrize(
        "prefs",
        [
            "not a dict",
            {"email_kinds": "off"},
            {"email_kinds": {"shift_notices": "no"}},
            {"email_kinds": {"shift_notices": None}},
            {"email_notifications": "false"},
        ],
    )
    def test_a_malformed_preference_is_no_choice(self, prefs):
        assert member_receives_email(prefs, EmailKind.SHIFT_NOTICES)

    def test_recipients_for_keeps_order_and_drops_opted_out(self):
        on = SimpleNamespace(notification_preferences=None)
        off = SimpleNamespace(notification_preferences={"email_notifications": False})
        also_on = SimpleNamespace(notification_preferences={})
        assert recipients_for([on, off, also_on], EmailKind.SHIFT_NOTICES) == [
            on,
            also_on,
        ]


class TestCleaningStoredChoices:
    def test_only_optional_kinds_and_booleans_are_kept(self):
        assert clean_email_kind_choices(
            {
                "shift_notices": False,
                "election_ballots": False,
                "nope": False,
                "store_announcements": "no",
            }
        ) == {"shift_notices": False}

    @pytest.mark.parametrize("value", [None, "x", ["shift_notices"]])
    def test_anything_else_is_empty(self, value):
        assert clean_email_kind_choices(value) == {}


class TestTheAdminEndpoint:
    async def test_it_lists_every_email_and_text(self):
        from app.api.v1.endpoints.email_templates import get_member_email_policy

        response = await get_member_email_policy(current_user=SimpleNamespace())
        assert {e.key for e in response.emails} == {k.value for k in EmailKind}
        assert {t.key for t in response.texts} == {a.value for a in SmsAlert}
        assert response.text_conditions
        ballots = next(e for e in response.emails if e.key == "election_ballots")
        assert ballots.required is True


class TestStorefrontAddressFilter:
    """The store sends to addresses, so they are matched back to members."""

    def _service(self, rows):
        from app.services.storefront_notification_service import (
            StorefrontNotificationService,
        )

        db = MagicMock()
        db.execute = AsyncMock(return_value=MagicMock(all=MagicMock(return_value=rows)))
        return StorefrontNotificationService(db)

    async def test_an_opted_out_member_is_dropped_from_an_announcement(self):
        service = self._service(
            [
                ("off@fd.example", {"email_kinds": {"store_announcements": False}}),
                ("on@fd.example", {}),
            ]
        )
        kept = await service._drop_opted_out(
            SimpleNamespace(id="org-1"),
            ["OFF@fd.example", "on@fd.example", "extra@vendor.example"],
            "storefront_window_open",
        )
        # Case-insensitive, and an address that is no member's is kept.
        assert kept == ["on@fd.example", "extra@vendor.example"]

    async def test_a_receipt_is_never_filtered(self):
        service = self._service([("off@fd.example", {"email_notifications": False})])
        kept = await service._drop_opted_out(
            SimpleNamespace(id="org-1"),
            ["off@fd.example"],
            "storefront_order_confirmation",
        )
        assert kept == ["off@fd.example"]
        service.db.execute.assert_not_called()
