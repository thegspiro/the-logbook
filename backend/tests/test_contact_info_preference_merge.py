"""Notification preferences merge rather than replace on save
(PATCH /users/{user_id}/contact-info).

Every field on NotificationPreferences defaults to True, so dumping the whole
model turned a partial payload into a re-subscribe — a caller naming one
preference silently switched the rest back on, behind a 200. DB and the audit
log are mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints.users import update_contact_info
from app.schemas.user import ContactInfoUpdate

ORG = str(uuid4())


def _member(user_id, preferences):
    return SimpleNamespace(
        id=str(user_id),
        username="jsmith",
        organization_id=ORG,
        email="member@fd.example",
        email_verified=True,
        phone=None,
        mobile=None,
        notification_preferences=preferences,
    )


def _db(member):
    """Both the initial lookup and the post-commit re-query return *member*."""
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=member))
    )
    db.commit = AsyncMock()
    return db


async def _save(stored, payload):
    """Save *payload* against a member whose stored preferences are *stored*."""
    uid = uuid4()
    member = _member(uid, stored)
    update = ContactInfoUpdate.model_validate({"notification_preferences": payload})
    with patch("app.api.v1.endpoints.users.log_audit_event", new=AsyncMock()):
        await update_contact_info(uid, update, _db(member), member)
    return member.notification_preferences


class TestPartialPayloads:
    async def test_an_unnamed_preference_is_left_alone(self):
        # The regression: this used to come back with every other preference
        # reset to True, re-subscribing a member who had opted out.
        stored = {
            "email_notifications": False,
            "sms_notifications": True,
            "event_reminders": False,
            "training_reminders": False,
        }
        result = await _save(stored, {"sms_notifications": False})
        assert result == {
            "email_notifications": False,
            "sms_notifications": False,
            "event_reminders": False,
            "training_reminders": False,
        }

    async def test_an_explicit_true_still_switches_a_preference_back_on(self):
        # Merging must not make the endpoint write-once: naming a key with
        # True is how a member re-enables a channel they had turned off.
        result = await _save(
            {"email_notifications": False}, {"email_notifications": True}
        )
        assert result["email_notifications"] is True

    async def test_a_member_with_no_preferences_yet_gets_only_what_was_named(self):
        # The absent keys are not written as True — readers already default to
        # opted-in, and inventing rows would misrepresent choices never made.
        result = await _save({}, {"sms_notifications": False})
        assert result == {"sms_notifications": False}

    @pytest.mark.parametrize("stored", [None, {}])
    async def test_an_empty_or_missing_blob_does_not_break_the_save(self, stored):
        result = await _save(stored, {"training_reminders": False})
        assert result == {"training_reminders": False}


class TestFullPayloads:
    async def test_every_named_preference_is_written(self):
        payload = {
            "email_notifications": True,
            "sms_notifications": False,
            "event_reminders": False,
            "training_reminders": True,
        }
        assert await _save({"email_notifications": False}, payload) == payload


class TestDeadKeys:
    async def test_a_key_no_sender_reads_is_dropped_on_save(self):
        # `email` was folded into email_notifications by migration
        # 20260816_0007. Merging would otherwise preserve it forever; instead
        # a stale blob heals the next time the member is saved.
        stored = {"email": False, "email_notifications": True}
        result = await _save(stored, {"sms_notifications": False})
        assert "email" not in result
        assert result == {"email_notifications": True, "sms_notifications": False}


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
