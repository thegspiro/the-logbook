"""Tenant-isolation tests for instructor qualification references."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.training_enhancement_service import InstructorQualificationService


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


@pytest.mark.asyncio
async def test_create_rejects_reference_outside_organization():
    db = MagicMock()
    db.execute = AsyncMock(return_value=_scalar_result(None))
    service = InstructorQualificationService(db)

    with pytest.raises(ValueError, match="Invalid user_id"):
        await service.create_qualification(
            "tenant-a",
            {"user_id": "tenant-b-user", "qualification_type": "instructor"},
            "creator",
        )

    db.add.assert_not_called()
    statement = db.execute.await_args.args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "users.organization_id = 'tenant-a'" in sql


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field", "table"),
    [
        ("course_id", "training_courses"),
        ("skill_evaluation_id", "skill_evaluations"),
        ("category_id", "training_categories"),
    ],
)
async def test_create_tenant_scopes_optional_references(field, table):
    db = MagicMock()
    db.execute = AsyncMock(return_value=_scalar_result(None))
    service = InstructorQualificationService(db)

    with pytest.raises(ValueError, match=f"Invalid {field}"):
        await service.create_qualification(
            "tenant-a",
            {
                "user_id": None,
                field: "tenant-b-reference",
                "qualification_type": "instructor",
            },
            "creator",
        )

    statement = db.execute.await_args.args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert f"{table}.organization_id = 'tenant-a'" in sql


@pytest.mark.asyncio
async def test_qualification_enrichment_joins_are_tenant_scoped():
    db = MagicMock()
    result = MagicMock()
    result.all.return_value = []
    db.execute = AsyncMock(return_value=result)
    service = InstructorQualificationService(db)

    assert await service.get_qualifications("tenant-a") == []

    statement = db.execute.await_args.args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "users.organization_id = 'tenant-a'" in sql
    assert "training_courses.organization_id = 'tenant-a'" in sql


@pytest.mark.asyncio
async def test_update_validates_changed_reference_before_assignment():
    qualification = MagicMock(course_id="original-course")
    db = MagicMock()
    db.flush = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[_scalar_result(qualification), _scalar_result(None)]
    )
    service = InstructorQualificationService(db)

    with pytest.raises(ValueError, match="Invalid course_id"):
        await service.update_qualification(
            "qualification-id", "tenant-a", {"course_id": "tenant-b-course"}
        )

    db.flush.assert_not_awaited()
    assert qualification.course_id != "tenant-b-course"
