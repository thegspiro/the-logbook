"""
NOTIF2-4 (app-review B11 pass 3): trigger / category / channel on the
notification-rule request schemas map to strict MySQL ENUM columns but were
typed as free str and stored raw (create_rule's **rule_data, update_rule's
setattr loop) — an out-of-set value 500'd at MySQL. The request schemas now
validate them (the B1 latent-500 class). DB-free.
"""

import pytest
from pydantic import ValidationError

from app.schemas.notifications import NotificationRuleCreate, NotificationRuleUpdate


class TestRuleEnumValidation:
    def test_defaults_are_valid(self):
        r = NotificationRuleCreate(name="R", trigger="training_expiry")
        assert (r.category, r.channel) == ("general", "in_app")

    def test_normalizes_case(self):
        r = NotificationRuleCreate(name="R", trigger="NEW_MEMBER", channel="EMAIL")
        assert r.trigger == "new_member"
        assert r.channel == "email"

    def test_rejects_bad_trigger(self):
        with pytest.raises(ValidationError):
            NotificationRuleCreate(name="R", trigger="bogus_trigger")

    def test_rejects_bad_category(self):
        with pytest.raises(ValidationError):
            NotificationRuleCreate(name="R", trigger="new_member", category="nope")

    def test_rejects_bad_channel(self):
        with pytest.raises(ValidationError):
            NotificationRuleCreate(name="R", trigger="new_member", channel="sms")

    def test_update_rejects_bad_channel(self):
        with pytest.raises(ValidationError):
            NotificationRuleUpdate(channel="carrier_pigeon")

    def test_update_allows_omitted(self):
        u = NotificationRuleUpdate(name="Renamed")
        assert u.trigger is None
        assert u.category is None
        assert u.channel is None


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
