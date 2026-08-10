"""
MP2-3 (app-review B9 pass 3): step_type / action_type / prospect status map to
strict MySQL ENUM columns but were typed as free str and inserted raw
(create_step/update_step, update_prospect's setattr loop) — an out-of-set value
500'd at MySQL. Request schemas now validate them (the B1 latent-500 class).
DB-free.
"""

import pytest
from pydantic import ValidationError

from app.schemas.membership_pipeline import (
    PipelineStepCreate,
    PipelineStepUpdate,
    ProspectUpdate,
)


class TestStepEnumValidation:
    def test_create_accepts_valid_step_type(self):
        s = PipelineStepCreate(name="Interview", step_type="interview_requirement")
        assert s.step_type == "interview_requirement"

    def test_create_normalizes_case(self):
        s = PipelineStepCreate(name="X", step_type="CHECKBOX", action_type="SEND_EMAIL")
        assert s.step_type == "checkbox"
        assert s.action_type == "send_email"

    def test_create_rejects_bad_step_type(self):
        with pytest.raises(ValidationError):
            PipelineStepCreate(name="X", step_type="not_a_step")

    def test_create_rejects_bad_action_type(self):
        with pytest.raises(ValidationError):
            PipelineStepCreate(name="X", action_type="bogus")

    def test_create_allows_null_action_type(self):
        assert PipelineStepCreate(name="X").action_type is None

    def test_update_rejects_bad_step_type(self):
        with pytest.raises(ValidationError):
            PipelineStepUpdate(step_type="nope")

    def test_update_allows_omitted(self):
        u = PipelineStepUpdate(name="Renamed")
        assert u.step_type is None
        assert u.action_type is None


class TestProspectStatusValidation:
    def test_accepts_valid_status_incl_transferred(self):
        assert ProspectUpdate(status="transferred").status == "transferred"

    def test_rejects_unknown_status(self):
        with pytest.raises(ValidationError):
            ProspectUpdate(status="pending_maybe")

    def test_allows_omitted_status(self):
        assert ProspectUpdate(first_name="Alex").status is None


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
