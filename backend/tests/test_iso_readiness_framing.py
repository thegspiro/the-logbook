"""Guards against re-introducing an unsound ISO PPC class estimate.

A previous version mapped a training-hours readiness percentage straight onto
a Public Protection Classification (>=95% => "Class 1"). Training is FSRS
Section 580 — 9 of ~105.5 points — while Water Supply (40) and Emergency
Communications (10) dominate the schedule and are not tracked here at all.
PPC drives fire-insurance rates for every property in the district, so an
optimistic estimate is a correctness problem, not a rounding error.
"""

import inspect

from app.api.v1.endpoints import integrations as integrations_endpoint
from app.services import compliance_officer_service as cos
from app.services.compliance_officer_service import ISOReadinessService


class TestNoPPCClassEstimate:
    def test_service_exposes_no_class_estimator(self):
        assert not hasattr(ISOReadinessService, "_estimate_iso_class")
        source = inspect.getsource(cos)
        assert "iso_class_estimate" not in source

    def test_training_points_are_capped_at_the_fsrs_section_580_share(self):
        assert cos._FSRS_TRAINING_POINTS == 9.0
        # Perfect training compliance earns the training points and nothing
        # more — it must never imply a whole-schedule rating.
        assert ISOReadinessService._estimate_training_points(100.0) == 9.0
        assert ISOReadinessService._estimate_training_points(0.0) == 0.0
        assert ISOReadinessService._estimate_training_points(50.0) == 4.5

    def test_scope_note_states_what_is_not_measured(self):
        note = cos._FSRS_SCOPE_NOTE.lower()
        assert "not a public protection classification" in note
        assert "water supply" in note


class TestIntegrationCatalogHonesty:
    """Integrations without a reachable route must not advertise as available."""

    def test_file_based_integrations_are_not_advertised_available(self):
        catalog = {
            entry["integration_type"]: entry
            for entry in integrations_endpoint.INTEGRATION_CATALOG
        }
        # None of these has an import/export route on the integrations
        # router — it exposes only list/get/connect/disconnect/patch/test.
        for itype in ("nfirs-export", "nemsis-export", "epcr-import", "csv-import"):
            assert catalog[itype]["status"] == "coming_soon", (
                f"{itype} is advertised as available but has no route to "
                "actually move data"
            )
