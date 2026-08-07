"""
Retention of practice skills-test attempts.

Practice attempts are drill runs, not records: never scored against the member,
never counted, never fed to the training pipeline — so they expire on a timer.
Official results live in the same table and must never be swept, which is what
the record class's row_filter exists to guarantee. These tests pin that
guarantee down without a database.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models.skills_testing import SkillTest
from app.services.retention_service import RECORD_CLASSES


def _practice_class():
    return next(rc for rc in RECORD_CLASSES if rc.key == "practice_skill_tests")


def test_practice_class_is_registered_with_a_one_year_default():
    rc = _practice_class()
    assert rc.model is SkillTest
    assert rc.timestamp_attr == "created_at"
    assert rc.default_days == 365


def test_practice_class_has_a_row_filter():
    """Without this the sweep would delete official results too — the whole
    table shares one model."""
    assert _practice_class().row_filter is not None


def test_row_filter_restricts_the_sweep_to_practice_rows():
    rc = _practice_class()
    assert rc.row_filter is not None

    # Mirrors the query _delete_expired builds.
    cutoff = datetime.now(UTC) - timedelta(days=rc.default_days or 365)
    query = (
        select(SkillTest.id)
        .where(getattr(SkillTest, rc.timestamp_attr) < cutoff)
        .where(SkillTest.organization_id == "org-1")
        .where(rc.row_filter(SkillTest))
    )

    rendered = str(query.compile(compile_kwargs={"render_postcompile": True}))
    assert "skill_tests.is_practice IS true" in rendered.replace("\n", " ")


def test_official_results_are_not_matched_by_the_filter():
    """Belt and braces: the criterion must be an is_practice test, not a
    tautology that would let every row through."""
    rc = _practice_class()
    assert rc.row_filter is not None

    criterion = rc.row_filter(SkillTest)
    assert "is_practice" in str(criterion)
