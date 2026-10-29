"""ELEC2-9: the department's election defaults are validated and read safely.

The create-election form now starts from these values, so a stored value it
cannot submit must neither be accepted nor handed back to it.
"""

from unittest.mock import AsyncMock, Mock

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints.elections import (
    ElectionSettingsUpdate,
    _election_defaults_view,
    get_election_settings,
    update_election_settings,
)

pytestmark = pytest.mark.unit

BUILT_INS = {
    "default_voting_method": "simple_majority",
    "default_victory_condition": "most_votes",
    "default_victory_percentage": None,
    "default_anonymous_voting": True,
    "default_allow_write_ins": False,
    "default_quorum_type": "none",
    "default_quorum_value": None,
}


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


@pytest.mark.parametrize(
    "field",
    ["default_voting_method", "default_victory_condition", "default_quorum_type"],
)
def test_an_unknown_choice_is_refused(field):
    with pytest.raises(ValidationError, match="must be one of"):
        ElectionSettingsUpdate.model_validate({field: "plurality"})


def test_known_choices_are_accepted():
    update = ElectionSettingsUpdate.model_validate(
        {
            "default_voting_method": "ranked_choice",
            "default_victory_condition": "majority",
            "default_quorum_type": "percentage",
        }
    )
    assert update.default_voting_method == "ranked_choice"


def test_nothing_saved_reads_as_the_forms_own_starting_values():
    assert _election_defaults_view({}) == BUILT_INS
    assert _election_defaults_view(None) == BUILT_INS


def test_a_value_saved_before_validation_reads_as_the_built_in():
    view = _election_defaults_view(
        {
            "voting_method": "plurality",
            "victory_condition": None,
            "victory_percentage": 0,
            "anonymous_voting": None,
            "allow_write_ins": "yes",
            "quorum_type": "quorum",
            "quorum_value": True,
        }
    )
    assert view == BUILT_INS


@pytest.mark.asyncio
async def test_saved_defaults_come_back_on_the_next_read():
    db, organization = _settings_db({})
    user = Mock(organization_id="org-1")

    await update_election_settings(
        ElectionSettingsUpdate.model_validate(
            {
                "default_voting_method": "simple_majority",
                "default_victory_condition": "supermajority",
                "default_victory_percentage": 75,
                "default_anonymous_voting": False,
                "default_allow_write_ins": True,
                "default_quorum_type": "percentage",
                "default_quorum_value": 51,
            }
        ),
        db=db,
        current_user=user,
    )
    read = await get_election_settings(db=db, current_user=user)

    assert {key: read[key] for key in BUILT_INS} == {
        "default_voting_method": "simple_majority",
        "default_victory_condition": "supermajority",
        "default_victory_percentage": 75,
        "default_anonymous_voting": False,
        "default_allow_write_ins": True,
        "default_quorum_type": "percentage",
        "default_quorum_value": 51,
    }
