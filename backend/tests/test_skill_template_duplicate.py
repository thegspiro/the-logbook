"""Regression tests for duplicating skill-template configuration."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.api.v1.endpoints import skills_testing as endpoint
from app.models.skills_testing import SkillTemplate


async def test_duplicate_template_preserves_result_privacy_policy(monkeypatch):
    source = SkillTemplate(
        id=str(uuid4()),
        organization_id=str(uuid4()),
        created_by=str(uuid4()),
        name="Promotional evaluation",
        sections=[{"name": "Command", "criteria": []}],
        result_disclosure="scores",
        result_release="on_release",
        result_viewer_positions=["training-chief"],
    )
    user = SimpleNamespace(
        id=uuid4(),
        organization_id=source.organization_id,
        username="chief",
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = source
    db = SimpleNamespace(
        execute=AsyncMock(return_value=result),
        add=MagicMock(),
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )
    monkeypatch.setattr(endpoint, "log_audit_event", AsyncMock())

    duplicate = await endpoint.duplicate_template(uuid4(), db=db, current_user=user)

    assert duplicate.result_disclosure == "scores"
    assert duplicate.result_release == "on_release"
    assert duplicate.result_viewer_positions == ["training-chief"]
