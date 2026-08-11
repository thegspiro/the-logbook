"""
`ShiftResponse` must project `apparatus_type`.

`_enrich_shift_dict` has always computed it — resolved across both apparatus
tables and lowercased, so `Apparatus` (which normalizes its type into
`apparatus_types`) and `BasicApparatus` (which stores it inline) produce the
same string. The schema did not declare the field, so Pydantic dropped it and
every shift reached the client with no type at all.

Nothing failed. The report form reads `shift.apparatus_type` to choose the
per-apparatus skill list and the task defaults that pre-fill the "+ Add" row
under Tasks Performed; with the value always undefined, both silently fell back
to the department-wide lists. A department could configure
`apparatus_type_tasks` for every rig class it owns and never see one of them —
"+ Add" appended a blank row on an engine and a ladder alike.

Source and schema assertions — the enrichment is a plain dict transform, and
the defect was the schema's failure to carry its output.
"""

import inspect

from app.schemas.scheduling import ShiftDetailResponse, ShiftResponse
from app.services.scheduling_service import SchedulingService


def test_the_response_projects_the_type():
    assert "apparatus_type" in ShiftResponse.model_fields


def test_the_detail_response_inherits_it():
    """The detail endpoint is what the report form's prefill path reads."""
    assert "apparatus_type" in ShiftDetailResponse.model_fields


def test_the_field_is_optional():
    """A shift with no apparatus, or one whose id resolves to neither table."""
    assert ShiftResponse.model_fields["apparatus_type"].default is None


def test_the_enrichment_still_sets_it():
    """If the enrichment stops computing it, projecting it is pointless."""
    source = inspect.getsource(SchedulingService._enrich_shift_dict)
    assert (
        'shift_dict["apparatus_type"]' in source
    ), "_enrich_shift_dict no longer sets apparatus_type"


def test_every_display_field_the_enrichment_sets_is_projected():
    """The gap was one field of four. Guard the whole set rather than the one."""
    source = inspect.getsource(SchedulingService._enrich_shift_dict)
    for field in (
        "apparatus_name",
        "apparatus_unit_number",
        "apparatus_type",
        "apparatus_positions",
    ):
        assert f'shift_dict["{field}"]' in source, f"enrichment dropped {field}"
        assert field in ShiftResponse.model_fields, f"schema does not carry {field}"
