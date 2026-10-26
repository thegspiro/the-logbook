"""Regression tests for election feature-toggle settings."""

from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints.elections import (
    ElectionSettingsUpdate,
    _feature_flag,
    update_election_settings,
)
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


@pytest.mark.parametrize("value", [0, -1, 2**31])
def test_default_quorum_value_refuses_a_value_outside_one_to_the_column_ceiling(value):
    with pytest.raises(ValidationError):
        ElectionSettingsUpdate.model_validate({"default_quorum_value": value})


@pytest.mark.parametrize("value", [1, 2**31 - 1, None])
def test_default_quorum_value_accepts_its_range_and_a_clear(value):
    update = ElectionSettingsUpdate.model_validate({"default_quorum_value": value})
    assert update.default_quorum_value == value


@pytest.fixture(autouse=True)
def _no_audit_write(monkeypatch):
    monkeypatch.setattr("app.api.v1.endpoints.elections.log_audit_event", AsyncMock())


def _settings_db(election_defaults):
    organization = Mock(settings={"election_defaults": election_defaults})
    result = Mock()
    result.scalar_one_or_none.return_value = organization
    db = Mock()
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    return db, organization


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("stored", "update"),
    [
        ({}, {"default_quorum_type": "percentage", "default_quorum_value": 150}),
        (
            {"quorum_type": "percentage", "quorum_value": 50},
            {"default_quorum_value": 101},
        ),
        (
            {"quorum_type": "count", "quorum_value": 150},
            {"default_quorum_type": "percentage"},
        ),
    ],
)
async def test_a_percentage_quorum_over_100_is_refused_from_the_merged_defaults(
    stored, update
):
    db, organization = _settings_db(dict(stored))

    with pytest.raises(HTTPException) as refused:
        await update_election_settings(
            ElectionSettingsUpdate.model_validate(update),
            db=db,
            current_user=Mock(organization_id="org-1"),
        )

    assert refused.value.status_code == 400
    assert refused.value.detail == "Percentage quorum cannot exceed 100"
    db.commit.assert_not_called()
    assert organization.settings == {"election_defaults": dict(stored)}


@pytest.mark.asyncio
async def test_a_count_quorum_may_exceed_100():
    db, organization = _settings_db({})

    await update_election_settings(
        ElectionSettingsUpdate.model_validate(
            {"default_quorum_type": "count", "default_quorum_value": 150}
        ),
        db=db,
        current_user=Mock(organization_id="org-1"),
    )

    stored = organization.settings["election_defaults"]
    assert (stored["quorum_type"], stored["quorum_value"]) == ("count", 150)


@pytest.mark.asyncio
async def test_an_unrelated_update_is_not_blocked_by_an_old_invalid_pair():
    db, organization = _settings_db({"quorum_type": "percentage", "quorum_value": 150})

    await update_election_settings(
        ElectionSettingsUpdate.model_validate({"reminders_enabled": False}),
        db=db,
        current_user=Mock(organization_id="org-1"),
    )

    db.commit.assert_called_once()
