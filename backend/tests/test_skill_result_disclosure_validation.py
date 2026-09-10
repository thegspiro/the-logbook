"""SKT4-5 — ``result_disclosure``/``result_release`` are a closed set.

``redact_test_for_view`` only special-cases "pending" and "scores"; any other
string — including a typo — falls through and returns the payload unredacted,
and ``resolve_result_view`` only holds a result back when ``result_release``
equals ``ResultRelease.ON_RELEASE.value`` exactly, so an unrecognised release
value behaves as immediate release. Both fields were a bare ``Optional[str]``
until this check existed: a typo in either one would save cleanly and quietly
fail open to full disclosure, the same shape of failure
``test_skill_criterion_type_validation.py`` documents for an unknown
criterion type.

These tests hold the whitelist closed on every schema that accepts either
field as input (the two template schemas and the two test schemas) — the
response schemas are deliberately not validated, since they report values
already accepted at write time via ``from_attributes``.
"""

import pytest
from pydantic import ValidationError

from app.models.skills_testing import ResultDisclosure, ResultRelease
from app.schemas.skills_testing import (
    SkillTemplateCreate,
    SkillTemplateUpdate,
    SkillTestCreate,
    SkillTestUpdate,
)


def _template_kwargs(**overrides):
    base = {
        "name": "SCBA Donning",
        "sections": [{"name": "Donning", "criteria": [{"label": "Step 1"}]}],
    }
    base.update(overrides)
    return base


def _test_create_kwargs(**overrides):
    import uuid

    base = {"template_id": uuid.uuid4(), "candidate_id": uuid.uuid4()}
    base.update(overrides)
    return base


@pytest.mark.parametrize("value", [e.value for e in ResultDisclosure])
def test_every_disclosure_value_is_accepted(value):
    SkillTemplateCreate(**_template_kwargs(result_disclosure=value))
    SkillTemplateUpdate(result_disclosure=value)
    SkillTestCreate(**_test_create_kwargs(result_disclosure=value))
    SkillTestUpdate(result_disclosure=value)


@pytest.mark.parametrize("value", [e.value for e in ResultRelease])
def test_every_release_value_is_accepted(value):
    SkillTemplateCreate(**_template_kwargs(result_release=value))
    SkillTemplateUpdate(result_release=value)
    SkillTestCreate(**_test_create_kwargs(result_release=value))
    SkillTestUpdate(result_release=value)


def test_omitting_either_field_is_accepted():
    """Omitting means "inherit the default" — this is not the same as an
    invalid value, and must not be rejected."""
    SkillTemplateCreate(**_template_kwargs())
    SkillTemplateUpdate()
    SkillTestCreate(**_test_create_kwargs())
    SkillTestUpdate()


@pytest.mark.parametrize("bad_value", ["fulll", "None", "on-release", "", "Full"])
def test_unknown_disclosure_value_is_rejected_on_every_write_schema(bad_value):
    for factory in (
        lambda: SkillTemplateCreate(**_template_kwargs(result_disclosure=bad_value)),
        lambda: SkillTemplateUpdate(result_disclosure=bad_value),
        lambda: SkillTestCreate(**_test_create_kwargs(result_disclosure=bad_value)),
        lambda: SkillTestUpdate(result_disclosure=bad_value),
    ):
        with pytest.raises(ValidationError) as exc:
            factory()
        assert "Unknown result disclosure" in str(exc.value)


@pytest.mark.parametrize("bad_value", ["onrelease", "on_releasee", "COMPLETION", ""])
def test_unknown_release_value_is_rejected_on_every_write_schema(bad_value):
    for factory in (
        lambda: SkillTemplateCreate(**_template_kwargs(result_release=bad_value)),
        lambda: SkillTemplateUpdate(result_release=bad_value),
        lambda: SkillTestCreate(**_test_create_kwargs(result_release=bad_value)),
        lambda: SkillTestUpdate(result_release=bad_value),
    ):
        with pytest.raises(ValidationError) as exc:
            factory()
        assert "Unknown result release mode" in str(exc.value)


def test_an_overlong_value_is_rejected_before_reaching_the_custom_validator():
    """SKT4-5 round-6 follow-up: the validators above embed the rejected
    value verbatim in their error message (matching this file's existing
    `type`/`score_mode` pattern), and the global 422 handler runs that
    message through a regex-based sanitizer before it enforces its own
    300-character cap. An unbounded `result_disclosure`/`result_release`
    let an attacker submit a long adversarial string (e.g. repeated
    "SELECT " with no "FROM") that made one of the sanitizer's own
    SQL-detection patterns backtrack superlinearly. `max_length=50` caps
    the field before the custom validator ever runs, so no value long
    enough to matter for that regex ever reaches it: this asserts the
    failure is Pydantic's own `string_too_long` (a fixed, constant-message
    error type in the global handler), not the custom validator's
    value-embedding `value_error`."""
    long_value = "SELECT " * 20  # well past max_length=50, short of a real attack size
    for factory in (
        lambda: SkillTemplateCreate(**_template_kwargs(result_disclosure=long_value)),
        lambda: SkillTemplateUpdate(result_disclosure=long_value),
        lambda: SkillTestCreate(**_test_create_kwargs(result_disclosure=long_value)),
        lambda: SkillTestUpdate(result_disclosure=long_value),
    ):
        with pytest.raises(ValidationError) as exc:
            factory()
        errors = exc.value.errors()
        assert any(e["type"] == "string_too_long" for e in errors)
        assert not any(e["type"] == "value_error" for e in errors)


def test_whitelists_match_the_enums_the_resolver_reads():
    """The two lists drifting is how this class of bug survives: the schema
    would accept a value the resolver does not recognise, and nothing would
    tie the stored value to the set the disclosure logic actually branches
    on."""
    from app.schemas.skills_testing import (
        _RESULT_DISCLOSURE_VALUES,
        _RESULT_RELEASE_VALUES,
    )

    assert _RESULT_DISCLOSURE_VALUES == {e.value for e in ResultDisclosure}
    assert _RESULT_RELEASE_VALUES == {e.value for e in ResultRelease}
