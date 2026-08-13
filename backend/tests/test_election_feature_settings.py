"""Regression tests for election feature-toggle settings."""

from unittest.mock import AsyncMock, Mock

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints.elections import ElectionSettingsUpdate, _feature_flag
from app.services.election_service import ElectionService


@pytest.mark.parametrize(
    "name",
    [
        "nominations_enabled",
        "paper_ballots_enabled",
        "reminders_enabled",
        "auto_open_enabled",
    ],
)
def test_feature_toggle_rejects_explicit_null(name):
    with pytest.raises(ValidationError, match="feature flags must be true or false"):
        ElectionSettingsUpdate.model_validate({name: None})


def test_feature_toggle_may_be_omitted():
    assert ElectionSettingsUpdate().model_dump(exclude_unset=True) == {}


def test_api_normalizes_legacy_null_feature_flag():
    assert _feature_flag({"nominations_enabled": None}, "nominations_enabled") is True


@pytest.mark.asyncio
async def test_service_normalizes_legacy_null_feature_flag():
    organization = Mock(settings={"election_features": {"nominations_enabled": None}})
    result = Mock()
    result.scalar_one_or_none.return_value = organization
    db = Mock()
    db.execute = AsyncMock(return_value=result)

    flags = await ElectionService(db).get_feature_flags(Mock())

    assert flags["nominations_enabled"] is True
