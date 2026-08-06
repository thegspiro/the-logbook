"""
Endpoint-level tests for external-training org scoping (TR-6).

Client-supplied training-category FKs must be validated in-org, so a provider's
default_category_id or a category mapping's internal_category_id can't reference
(or leak the name of) another org's training category. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.external_training import (
    create_provider,
    update_category_mapping,
)
from app.schemas.training import (
    ExternalCategoryMappingUpdate,
    ExternalProviderType,
    ExternalTrainingProviderCreate,
)


def _user():
    return SimpleNamespace(id="u1", organization_id="org-1", username="officer")


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class TestExternalTrainingCategoryScoping:
    async def test_create_provider_rejects_foreign_default_category(self):
        db = MagicMock()
        # is_in_org(TrainingCategory, ...) resolves nothing -> foreign/absent.
        db.execute = AsyncMock(side_effect=[_one(None)])
        provider = ExternalTrainingProviderCreate(
            name="Vector",
            provider_type=ExternalProviderType.VECTOR_SOLUTIONS,
            default_category_id=uuid4(),
        )
        with pytest.raises(HTTPException) as exc:
            await create_provider(provider, db, _user())
        assert exc.value.status_code == 400
        assert "Default category" in exc.value.detail
        db.add.assert_not_called()

    async def test_update_mapping_rejects_foreign_internal_category(self):
        mapping = SimpleNamespace(
            id="m1",
            provider_id="p1",
            organization_id="org-1",
            internal_category_id=None,
            is_mapped=False,
            auto_mapped=True,
            mapped_by=None,
        )
        db = MagicMock()
        # 1) fetch mapping (in-org), 2) is_in_org(category) -> not found.
        db.execute = AsyncMock(side_effect=[_one(mapping), _one(None)])
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        upd = ExternalCategoryMappingUpdate(internal_category_id=uuid4())
        with pytest.raises(HTTPException) as exc:
            await update_category_mapping(uuid4(), uuid4(), upd, db, _user())
        assert exc.value.status_code == 400
        assert "Internal category" in exc.value.detail
        # The foreign id must not have been persisted.
        assert mapping.internal_category_id is None
        db.commit.assert_not_awaited()
