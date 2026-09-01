"""Tests for the email-first channel policy
(app/services/notification_channels.py).

The point of these is the *negative* space: what must NOT get a text. Twilio
and the DB are mocked; no network, no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.consent_service import ConsentService
from app.services.notification_channels import (
    SmsAlert,
    resolve_sms_deliveries,
    resolve_sms_recipients,
    wants_channel,
)

URGENT = SmsAlert.URGENT_DEPARTMENT_MESSAGE


def _user(uid, mobile=None, phone=None, prefs=None):
    return SimpleNamespace(
        id=uid, mobile=mobile, phone=phone, notification_preferences=prefs
    )


def _patch_sms_enabled(enabled=True):
    sms = MagicMock()
    sms.enabled = enabled
    return patch("app.services.sms_service.SMSService", return_value=sms)


def _patch_consent(*consented_ids):
    """Pretend the given member ids granted SMS consent (TCPA gate)."""
    return patch.object(
        ConsentService,
        "granted_user_ids",
        new=AsyncMock(return_value=set(consented_ids)),
    )


class TestAlertAllowlist:
    async def test_urgent_department_message_is_the_only_eligible_alert(self):
        # Guards the policy itself: a new member added here without a matching
        # decision to text people is what this assertion is meant to catch.
        assert [a.value for a in SmsAlert] == ["urgent_department_message"]

    async def test_an_unlisted_alert_is_rejected_rather_than_texted(self):
        # Low stock is the canonical example — it is email-only, so a call site
        # cannot smuggle it through by passing a string.
        with pytest.raises(ValueError, match="not an SMS-eligible alert"):
            await resolve_sms_recipients(
                MagicMock(), [_user("u1", mobile="+1")], "low_stock"
            )

    async def test_the_enum_value_as_a_bare_string_is_also_rejected(self):
        # The enum member is the credential, not the string that spells it.
        with pytest.raises(ValueError, match="not an SMS-eligible alert"):
            await resolve_sms_recipients(
                MagicMock(), [_user("u1", mobile="+1")], "urgent_department_message"
            )


class TestOptInGates:
    async def test_no_recipients_when_twilio_is_not_configured(self):
        with _patch_sms_enabled(False):
            assert (
                await resolve_sms_recipients(
                    MagicMock(), [_user("u1", mobile="+1")], URGENT
                )
                == []
            )

    async def test_never_asked_means_refused(self):
        # Fails closed: absence of a consent row is not a grant.
        with _patch_sms_enabled(), _patch_consent():
            assert (
                await resolve_sms_recipients(
                    MagicMock(), [_user("u1", mobile="+1")], URGENT
                )
                == []
            )

    async def test_consent_alone_is_not_enough_when_the_member_muted_texts(self):
        users = [_user("u1", mobile="+1", prefs={"sms_notifications": False})]
        with _patch_sms_enabled(), _patch_consent("u1"):
            assert await resolve_sms_recipients(MagicMock(), users, URGENT) == []

    async def test_mobile_is_preferred_over_phone_and_numberless_members_drop_out(self):
        users = [
            _user("u1", mobile="+1555mobile", phone="+1555landline"),
            _user("u2", phone="+1555phone"),
            _user("u3"),
        ]
        with _patch_sms_enabled(), _patch_consent("u1", "u2", "u3"):
            numbers = await resolve_sms_recipients(MagicMock(), users, URGENT)
        assert numbers == ["+1555mobile", "+1555phone"]

    async def test_unset_preference_is_treated_as_opted_in(self):
        # A preferences blob written before the key existed must not mute a
        # member who did grant consent.
        users = [_user("u1", mobile="+1555", prefs={"email_notifications": True})]
        with _patch_sms_enabled(), _patch_consent("u1"):
            assert await resolve_sms_recipients(MagicMock(), users, URGENT) == ["+1555"]


class TestSharedPhoneNumbers:
    """A number does not identify a member, so it must not be used to find one.

    Two members on one handset is ordinary in a volunteer department. The
    delivery path used to get back numbers only and recover the member by
    searching the roster for whoever carried each one — which finds the first
    such member. When only the second consented, the text and its TCPA audit
    row were filed against the member who had refused, and the member who
    agreed got no record at all.
    """

    async def test_the_consenting_member_is_the_one_paired_with_the_number(self):
        shared = "+15550001"
        users = [
            _user("refused", mobile=shared),
            _user("consented", mobile=shared),
        ]
        with _patch_sms_enabled(), _patch_consent("consented"):
            deliveries = await resolve_sms_deliveries(MagicMock(), users, URGENT)

        assert deliveries == [("consented", shared)]

    async def test_both_members_get_their_own_pair_when_both_consented(self):
        shared = "+15550001"
        users = [_user("a", mobile=shared), _user("b", mobile=shared)]
        with _patch_sms_enabled(), _patch_consent("a", "b"):
            deliveries = await resolve_sms_deliveries(MagicMock(), users, URGENT)

        assert deliveries == [("a", shared), ("b", shared)]

    async def test_resolve_sms_recipients_still_returns_bare_numbers(self):
        """The older helper keeps its contract for callers that only send."""
        users = [_user("u1", mobile="+1555"), _user("u2", phone="+1666")]
        with _patch_sms_enabled(), _patch_consent("u1", "u2"):
            assert await resolve_sms_recipients(MagicMock(), users, URGENT) == [
                "+1555",
                "+1666",
            ]


class TestWantsChannel:
    def test_missing_preferences_default_to_opted_in(self):
        assert wants_channel(None, "sms_notifications") is True
        assert wants_channel({}, "sms_notifications") is True

    def test_only_an_explicit_false_opts_out(self):
        assert wants_channel({"sms_notifications": False}, "sms_notifications") is False
        assert wants_channel({"sms_notifications": True}, "sms_notifications") is True


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
