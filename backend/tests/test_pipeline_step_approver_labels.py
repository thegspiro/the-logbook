"""PipelineStepResponse labels a multi-approval stage's approver roles.

The applicant drawer showed the stored keys ("chief", "president") because
the step response carried nothing else; the labels belong to
``OFFICE_CATALOG``, so the response supplies them rather than the frontend
keeping a second catalog.
"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.schemas.membership_pipeline import PipelineStepResponse

pytestmark = pytest.mark.unit


def _step(config):
    now = datetime.now(timezone.utc)
    return PipelineStepResponse(
        id=uuid4(),
        pipeline_id=uuid4(),
        name="Officer sign-off",
        step_type="action",
        action_type="multi_approval",
        config=config,
        created_at=now,
        updated_at=now,
    )


def test_catalog_offices_get_their_catalog_label():
    step = _step({"required_approvers": ["chief", "ems_supply_officer"]})
    assert step.model_dump()["approver_labels"] == {
        "chief": "Chief",
        "ems_supply_officer": "EMS Supply Officer",
    }


def test_unknown_and_padded_roles_are_humanized_and_keyed_as_stored():
    step = _step({"required_approvers": [" President ", "hose_master"]})
    assert step.approver_labels == {
        " President ": "President",
        "hose_master": "Hose Master",
    }


@pytest.mark.parametrize("config", [None, {}, {"items": []}])
def test_stage_without_approvers_has_no_labels(config):
    assert _step(config).approver_labels == {}
