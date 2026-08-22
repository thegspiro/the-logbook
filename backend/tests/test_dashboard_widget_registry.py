"""Authorization invariants for the shared dashboard widget registry."""

from types import SimpleNamespace
from unittest.mock import patch

from app.api.v1.endpoints.dashboard import _authorized_widgets, _default_widgets


def user():
    return SimpleNamespace(id="user-1", organization_id="tenant-a")


def test_preferences_can_never_add_unauthorized_widgets():
    with patch(
        "app.api.v1.endpoints.dashboard.user_has_permission", return_value=False
    ):
        assert (
            _authorized_widgets(
                user(),
                {
                    "members",
                    "training",
                    "scheduling",
                    "inventory",
                    "apparatus",
                    "settings",
                },
            )
            == []
        )


def test_training_manager_gets_conservative_training_defaults_only():
    with patch(
        "app.api.v1.endpoints.dashboard.user_has_permission",
        side_effect=lambda _u, p: p == "training.manage",
    ):
        authorized = _authorized_widgets(
            user(), {"members", "training", "events", "settings"}
        )
        assert authorized == ["training-compliance", "credential-expirations"]
        assert _default_widgets(user(), authorized) == [
            "training-compliance",
            "credential-expirations",
        ]


def test_disabled_modules_remove_widgets_even_when_permission_is_held():
    with patch("app.api.v1.endpoints.dashboard.user_has_permission", return_value=True):
        authorized = _authorized_widgets(user(), {"members", "events", "settings"})
        assert "coverage-gaps" not in authorized
        assert "asset-readiness" not in authorized
        assert "credential-expirations" not in authorized
