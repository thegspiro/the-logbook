"""
Contract tests for the shared prospect field mappings
(app/utils/prospect_fields.py).

These maps are the single source of truth that the pipeline service and the
forms service use to map submitted form fields onto `ProspectiveMember`
columns. A silent drift — a renamed model column, a mapping target with no
display label, or a label key that isn't normalized — breaks form→prospect
mapping at submission time with no error. These tests guard those invariants;
they are pure (no DB) and read the live ORM model.
"""

from app.models.membership_pipeline import ProspectiveMember
from app.utils.prospect_fields import (
    FIELD_DISPLAY_LABELS,
    FIELD_TYPE_MAP,
    LABEL_MAP,
    REQUIRED_PROSPECT_FIELDS,
)

_MODEL_COLUMNS = {c.name for c in ProspectiveMember.__table__.columns}

# Every prospect-column target referenced anywhere in the mappings.
_ALL_TARGETS = (
    set(LABEL_MAP.values())
    | set(FIELD_TYPE_MAP.values())
    | set(REQUIRED_PROSPECT_FIELDS)
    | set(FIELD_DISPLAY_LABELS.keys())
)


class TestTargetsAreRealColumns:
    def test_every_label_map_target_is_a_model_column(self):
        invalid = sorted(t for t in LABEL_MAP.values() if t not in _MODEL_COLUMNS)
        assert invalid == [], f"LABEL_MAP targets not on ProspectiveMember: {invalid}"

    def test_every_field_type_map_target_is_a_model_column(self):
        invalid = sorted(t for t in FIELD_TYPE_MAP.values() if t not in _MODEL_COLUMNS)
        assert invalid == [], f"FIELD_TYPE_MAP targets not on model: {invalid}"

    def test_every_required_field_is_a_model_column(self):
        invalid = sorted(t for t in REQUIRED_PROSPECT_FIELDS if t not in _MODEL_COLUMNS)
        assert invalid == [], f"Required fields not on model: {invalid}"

    def test_every_display_label_key_is_a_model_column(self):
        invalid = sorted(t for t in FIELD_DISPLAY_LABELS if t not in _MODEL_COLUMNS)
        assert invalid == [], f"FIELD_DISPLAY_LABELS keys not on model: {invalid}"


class TestDisplayLabelCoverage:
    def test_every_mapped_target_has_a_display_label(self):
        mapped = (
            set(LABEL_MAP.values())
            | set(FIELD_TYPE_MAP.values())
            | set(REQUIRED_PROSPECT_FIELDS)
        )
        missing = sorted(t for t in mapped if t not in FIELD_DISPLAY_LABELS)
        assert missing == [], f"Mapped targets without a display label: {missing}"

    def test_display_labels_are_non_empty(self):
        blank = sorted(k for k, v in FIELD_DISPLAY_LABELS.items() if not v.strip())
        assert blank == [], f"Empty display labels: {blank}"


class TestLabelKeyNormalization:
    def test_label_map_keys_are_stripped_and_lowercased(self):
        # The lookup is `field.label.strip().lower()`; a key that isn't already
        # normalized can never match an incoming form field.
        bad = sorted(k for k in LABEL_MAP if k != k.strip().lower())
        assert bad == [], f"LABEL_MAP keys not normalized (strip/lower): {bad}"

    def test_field_type_map_keys_are_lowercase(self):
        # Matched against an enum `.value`, which is lowercase by convention.
        bad = sorted(k for k in FIELD_TYPE_MAP if k != k.lower())
        assert bad == [], f"FIELD_TYPE_MAP keys not lowercase: {bad}"

    def test_no_blank_label_keys(self):
        assert all(k.strip() for k in LABEL_MAP), "LABEL_MAP has a blank key"


class TestRequiredFieldsReachable:
    def test_every_required_field_has_a_label(self):
        # A pipeline form must be able to supply each required field, so each
        # one needs at least one label that maps to it.
        reachable = set(LABEL_MAP.values())
        unreachable = sorted(f for f in REQUIRED_PROSPECT_FIELDS if f not in reachable)
        assert unreachable == [], f"Required fields with no label: {unreachable}"

    def test_required_fields_are_the_expected_core_set(self):
        # Guards against accidental widening/narrowing of the required set.
        assert REQUIRED_PROSPECT_FIELDS == {"first_name", "last_name", "email"}
