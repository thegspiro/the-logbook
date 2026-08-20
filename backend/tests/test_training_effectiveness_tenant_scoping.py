from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.api.v1.endpoints.training_enhancements import create_effectiveness_evaluation
from app.schemas.training_enhancements import TrainingEffectivenessCreate
from app.services.training_enhancement_service import TrainingEffectivenessService


@pytest.mark.asyncio
async def test_create_endpoint_forces_evaluation_to_current_user():
    actor_id = uuid4()
    data = TrainingEffectivenessCreate(
        user_id=uuid4(), evaluation_level="reaction", overall_rating=4
    )
    db = AsyncMock()
    evaluation = SimpleNamespace()
    service = MagicMock()
    service.create_evaluation = AsyncMock(return_value=evaluation)

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "app.api.v1.endpoints.training_enhancements.TrainingEffectivenessService",
            MagicMock(return_value=service),
        )
        result = await create_effectiveness_evaluation(
            data, db, SimpleNamespace(id=actor_id, organization_id=str(uuid4()))
        )

    assert result is evaluation
    submitted = service.create_evaluation.await_args.args[1]
    assert submitted["user_id"] == str(actor_id)
    assert submitted["evaluated_by"] == str(actor_id)


@pytest.mark.asyncio
async def test_create_rejects_cross_tenant_training_reference():
    db = AsyncMock()
    missing = MagicMock()
    missing.scalar_one_or_none.return_value = None
    db.execute.return_value = missing
    service = TrainingEffectivenessService(db)

    with pytest.raises(ValueError, match="Invalid course_id"):
        await service.create_evaluation(
            str(uuid4()),
            {
                "user_id": str(uuid4()),
                "evaluated_by": str(uuid4()),
                "evaluation_level": "reaction",
                "course_id": str(uuid4()),
            },
        )

    db.add.assert_not_called()
