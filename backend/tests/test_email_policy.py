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
    department_required_kinds,
    member_choice,
    member_receives_email,
    recipients_for,
)
from app.services.notification_channels import SMS_ALERT_DETAILS, SmsAlert

pytestmark = pytest.mark.unit

APP = pathlib.Path(__file__).resolve().parent.parent / "app"
NONE = frozenset()


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
        assert member_receives_email(prefs, EmailKind.ELECTION_BALLOTS, NONE)

    @pytest.mark.parametrize("prefs", [None, {}, {"email_notifications": True}])
    def test_an_optional_kind_is_on_by_default(self, prefs):
        assert member_receives_email(prefs, EmailKind.SHIFT_NOTICES, NONE)

    def test_the_email_switch_turns_off_every_optional_kind(self):
        prefs = {"email_notifications": False}
        for kind in OPTIONAL_KINDS:
            assert not member_receives_email(prefs, kind, NONE), kind

    def test_the_email_switch_wins_over_a_per_kind_choice(self):
        prefs = {
            "email_notifications": False,
            "email_kinds": {"shift_notices": True},
        }
        assert not member_receives_email(prefs, EmailKind.SHIFT_NOTICES, NONE)

    def test_a_per_kind_choice_is_honoured(self):
        prefs = {"email_kinds": {"shift_notices": False}}
        assert not member_receives_email(prefs, EmailKind.SHIFT_NOTICES, NONE)
        assert member_receives_email(prefs, EmailKind.INVENTORY_UPDATES, NONE)

    @pytest.mark.parametrize(
        ("kind", "legacy"),
        [
            (EmailKind.EVENT_REMINDERS, "event_reminders"),
            (EmailKind.TRAINING_REMINDERS, "training_reminders"),
        ],
    )
    def test_the_older_topic_switch_still_applies(self, kind, legacy):
        assert not member_receives_email({legacy: False}, kind, NONE)

    def test_an_explicit_choice_overrides_the_older_topic_switch(self):
        prefs = {
            "event_reminders": False,
            "email_kinds": {"event_reminders": True},
        }
        assert member_receives_email(prefs, EmailKind.EVENT_REMINDERS, NONE)

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
        assert member_receives_email(prefs, EmailKind.SHIFT_NOTICES, NONE)

    def test_recipients_for_keeps_order_and_drops_opted_out(self):
        on = SimpleNamespace(notification_preferences=None)
        off = SimpleNamespace(notification_preferences={"email_notifications": False})
        also_on = SimpleNamespace(notification_preferences={})
        assert recipients_for([on, off, also_on], EmailKind.SHIFT_NOTICES, NONE) == [
            on,
            also_on,
        ]


class TestTheDepartmentOverride:
    """Leadership can make an optional email required for its own members."""

    REQUIRED = frozenset({EmailKind.SHIFT_NOTICES})

    def test_a_department_required_kind_ignores_every_preference(self):
        prefs = {
            "email_notifications": False,
            "email_kinds": {"shift_notices": False},
        }
        assert member_receives_email(prefs, EmailKind.SHIFT_NOTICES, self.REQUIRED)
        # Every other optional kind is still the member's to turn off.
        assert not member_receives_email(
            prefs, EmailKind.INVENTORY_UPDATES, self.REQUIRED
        )

    def test_recipients_for_keeps_everyone_for_a_department_required_kind(self):
        off = SimpleNamespace(notification_preferences={"email_notifications": False})
        assert recipients_for([off], EmailKind.SHIFT_NOTICES, self.REQUIRED) == [off]

    def test_the_members_own_choice_is_kept_underneath(self):
        # If the department later relaxes the rule, the member's earlier
        # choice applies again rather than being lost.
        prefs = {"email_kinds": {"shift_notices": False}}
        assert member_choice(prefs, EmailKind.SHIFT_NOTICES) is False

    def test_only_optional_kinds_are_read_from_settings(self):
        org = SimpleNamespace(
            settings={
                "email_policy": {
                    "required_kinds": [
                        "shift_notices",
                        "election_ballots",
                        "nope",
                        7,
                    ]
                }
            }
        )
        assert department_required_kinds(org) == {EmailKind.SHIFT_NOTICES}

    @pytest.mark.parametrize(
        "org",
        [
            None,
            SimpleNamespace(),
            SimpleNamespace(settings=None),
            SimpleNamespace(settings={"email_policy": "all"}),
            SimpleNamespace(settings={"email_policy": {"required_kinds": "all"}}),
        ],
    )
    def test_a_missing_or_malformed_setting_requires_nothing(self, org):
        assert department_required_kinds(org) == frozenset()


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


def _db_with_org(org):
    db = MagicMock()
    db.get = AsyncMock(return_value=org)
    db.commit = AsyncMock()
    return db


def _user(permissions=()):
    return SimpleNamespace(
        id="user-1",
        username="officer",
        organization_id="org-1",
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
        notification_preferences={},
    )


class TestTheAdminEndpoint:
    async def test_it_lists_every_email_and_text(self):
        from app.api.v1.endpoints.email_templates import get_member_email_policy

        org = SimpleNamespace(
            settings={"email_policy": {"required_kinds": ["shift_notices"]}}
        )
        response = await get_member_email_policy(
            db=_db_with_org(org), current_user=_user()
        )
        assert {e.key for e in response.emails} == {k.value for k in EmailKind}
        assert {t.key for t in response.texts} == {a.value for a in SmsAlert}
        assert response.text_conditions
        ballots = next(e for e in response.emails if e.key == "election_ballots")
        assert ballots.required is True
        assert ballots.department_required is False
        shifts = next(e for e in response.emails if e.key == "shift_notices")
        assert shifts.department_required is True

    async def test_the_update_writes_the_list_and_keeps_other_settings(
        self, monkeypatch
    ):
        from app.api.v1.endpoints import email_templates
        from app.schemas.email_template import MemberEmailPolicyUpdate

        monkeypatch.setattr(email_templates, "log_audit_event", AsyncMock())
        nested = {"visible": True}
        org = SimpleNamespace(
            settings={"events": nested, "email_policy": {"required_kinds": []}}
        )
        db = _db_with_org(org)
        response = await email_templates.update_member_email_policy(
            payload=MemberEmailPolicyUpdate(
                required_kinds=["shift_notices", "election_notices"]
            ),
            db=db,
            current_user=_user(["settings.manage"]),
        )
        assert org.settings["email_policy"]["required_kinds"] == [
            "election_notices",
            "shift_notices",
        ]
        assert org.settings["events"] == {"visible": True}
        db.commit.assert_awaited_once()
        email_templates.log_audit_event.assert_awaited_once()
        assert {e.key for e in response.emails if e.department_required} == {
            "shift_notices",
            "election_notices",
        }

    @pytest.mark.parametrize("kind", ["election_ballots", "made_up"])
    async def test_the_update_refuses_anything_but_an_optional_kind(self, kind):
        from fastapi import HTTPException

        from app.api.v1.endpoints.email_templates import update_member_email_policy
        from app.schemas.email_template import MemberEmailPolicyUpdate

        org = SimpleNamespace(settings={})
        db = _db_with_org(org)
        with pytest.raises(HTTPException, match="Not an optional email") as caught:
            await update_member_email_policy(
                payload=MemberEmailPolicyUpdate(required_kinds=[kind]),
                db=db,
                current_user=_user(["settings.manage"]),
            )
        assert caught.value.status_code == 400
        assert org.settings == {}
        db.commit.assert_not_awaited()


class TestTheMemberChoices:
    async def _choices(self, org, prefs=None, permissions=()):
        from app.api.v1.endpoints.users import get_my_email_choices

        user = _user(permissions)
        user.notification_preferences = prefs or {}
        return await get_my_email_choices(db=_db_with_org(org), current_user=user)

    async def test_a_member_sees_their_optional_emails_but_no_officer_ones(self):
        response = await self._choices(
            SimpleNamespace(settings={}),
            prefs={"email_kinds": {"shift_notices": False}},
        )
        keys = {c.key for c in response.choices}
        assert "shift_notices" in keys
        assert "election_ballots" not in keys
        assert not keys & {k.value for k in EmailKind if k.name.endswith("_DUTIES")}
        shifts = next(c for c in response.choices if c.key == "shift_notices")
        assert shifts.enabled is False
        assert "Election ballots" in response.always_sent

    async def test_an_officer_also_sees_the_officer_duty_emails(self):
        response = await self._choices(
            SimpleNamespace(settings={}), permissions=["inventory.manage"]
        )
        assert "inventory_duties" in {c.key for c in response.choices}

    async def test_a_department_required_email_is_not_offered_as_a_choice(self):
        org = SimpleNamespace(
            settings={"email_policy": {"required_kinds": ["shift_notices"]}}
        )
        response = await self._choices(org)
        assert "shift_notices" not in {c.key for c in response.choices}
        label = EMAIL_POLICIES[EmailKind.SHIFT_NOTICES].label
        assert label in response.always_sent

    async def test_a_department_required_officer_email_stays_hidden_from_members(
        self,
    ):
        org = SimpleNamespace(
            settings={"email_policy": {"required_kinds": ["inventory_duties"]}}
        )
        response = await self._choices(org)
        label = EMAIL_POLICIES[EmailKind.INVENTORY_DUTIES].label
        assert label not in response.always_sent


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

    async def test_a_department_required_notice_is_never_filtered(self):
        service = self._service([("off@fd.example", {"email_notifications": False})])
        kept = await service._drop_opted_out(
            SimpleNamespace(
                id="org-1",
                settings={"email_policy": {"required_kinds": ["store_announcements"]}},
            ),
            ["off@fd.example"],
            "storefront_window_open",
        )
        assert kept == ["off@fd.example"]

    async def test_a_receipt_is_never_filtered(self):
        service = self._service([("off@fd.example", {"email_notifications": False})])
        kept = await service._drop_opted_out(
            SimpleNamespace(id="org-1"),
            ["off@fd.example"],
            "storefront_order_confirmation",
        )
        assert kept == ["off@fd.example"]
        service.db.execute.assert_not_called()
