"""The foreign keys that block deleting a location are all listed in the service.

``LocationService`` decides between deleting a location and deactivating it by
counting the rows that point at it through ``_RESTRICTING_LOCATION_REFERENCES``.
That list is a hand-kept copy of a fact the schema already states, and a
reference missing from it fails in a way nobody sees until it happens: the
count says zero, the service takes the hard-delete path, the database refuses,
and the caller is told "try again to deactivate it instead" with a conflict
that retrying never resolves.

The list is currently exact. This derives the expected set from the model
metadata so a new blocking reference to ``locations`` cannot be added without
being listed, and a column that merely nulls out on delete cannot be listed by
mistake, which would deactivate a location that could have been deleted.
"""

import pytest

from app.core.database import Base
from app.models import Location
from app.services.location_service import _RESTRICTING_LOCATION_REFERENCES

pytestmark = pytest.mark.unit

# An omitted ON DELETE is NO ACTION, which refuses the delete as RESTRICT does.
_BLOCKING_RULES = {None, "NO ACTION", "RESTRICT"}


def _blocking_references_in_the_schema() -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    for table in Base.metadata.tables.values():
        for foreign_key in table.foreign_keys:
            if foreign_key.column.table.name != Location.__tablename__:
                continue
            rule = foreign_key.ondelete.upper() if foreign_key.ondelete else None
            if rule in _BLOCKING_RULES:
                found.add((table.name, foreign_key.parent.name))
    return found


def _references_the_service_counts() -> set[tuple[str, str]]:
    return {
        (column.class_.__tablename__, column.property.columns[0].name)
        for column in _RESTRICTING_LOCATION_REFERENCES
    }


# Owner decisions of 2026-11-01: deleting a location that training history,
# a meeting or an event request names deactivates it, as for an event. The
# records where a missing location is an ordinary state keep clearing.
_PROTECTED_BY_DECISION = {
    ("training_records", "location_id"),
    ("course_classes", "location_id"),
    ("course_cohorts", "location_id"),
    ("course_cohort_classes", "location_id"),
    ("meetings", "location_id"),
    ("event_requests", "event_location_id"),
}
_CLEARED_BY_DECISION = {
    ("inventory_items", "location_id"),
    ("storage_areas", "location_id"),
    ("nfc_card_taps", "location_id"),
}


class TestRestrictingLocationReferences:
    def test_the_scan_sees_the_known_references(self):
        # An empty scan would make both checks below pass for the wrong reason.
        schema = _blocking_references_in_the_schema()

        assert ("events", "location_id") in schema
        assert ("apparatus", "primary_station_id") in schema

    def test_training_meetings_and_requests_keep_their_location(self):
        schema = _blocking_references_in_the_schema()

        assert _PROTECTED_BY_DECISION <= schema
        assert _PROTECTED_BY_DECISION <= _references_the_service_counts()

    def test_items_storage_areas_and_tag_taps_still_clear(self):
        assert not _CLEARED_BY_DECISION & _blocking_references_in_the_schema()
        assert not _CLEARED_BY_DECISION & _references_the_service_counts()

    def test_every_blocking_reference_is_counted(self):
        missing = (
            _blocking_references_in_the_schema() - _references_the_service_counts()
        )

        assert not missing, (
            f"These columns block deleting a location but are not in "
            f"_RESTRICTING_LOCATION_REFERENCES: {sorted(missing)}. Add them, or "
            f"deleting a location they reference fails with a conflict that "
            f"retrying cannot resolve."
        )

    def test_nothing_is_counted_that_does_not_block(self):
        extra = _references_the_service_counts() - _blocking_references_in_the_schema()

        assert not extra, (
            f"These columns are in _RESTRICTING_LOCATION_REFERENCES but do not "
            f"block a delete: {sorted(extra)}. Listing a SET NULL or CASCADE "
            f"column deactivates locations that could have been deleted."
        )
