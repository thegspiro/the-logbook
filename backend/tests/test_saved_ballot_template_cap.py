"""ELEC-12: saved ballot templates are capped per organization.

The owner chose a creation cap over pagination (2026-10-05) so the Ballot
Builder's list response keeps its shape. The cap is enforced under a lock on
the organization row (pitfall #27) and refuses with a 409 that says what to do.
"""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import elections as elections_endpoints
from app.models.election import SavedBallotTemplate
from app.schemas.election import SavedBallotTemplateCreate

ITEM = {
    "id": "budget-2026",
    "type": "general_vote",
    "title": "Approve the 2026 budget",
    "vote_type": "approval",
}


def _payload(name: str) -> SavedBallotTemplateCreate:
    return SavedBallotTemplateCreate(name=name, ballot_items=[ITEM])


async def _seed_templates(db: AsyncSession, org_id: str, count: int) -> None:
    for n in range(count):
        await db.execute(
            text(
                "INSERT INTO saved_ballot_templates "
                "(id, organization_id, name, name_key, ballot_items, "
                "voting_method, allow_write_ins) "
                "VALUES (:id, :org, :name, :key, '[]', 'simple_majority', 0)"
            ),
            {
                "id": str(uuid.uuid4()),
                "org": org_id,
                "name": f"Seeded {n}",
                "key": uuid.uuid4().hex,
            },
        )
    await db.flush()


async def _template_count(db: AsyncSession, org_id: str) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(SavedBallotTemplate)
        .where(SavedBallotTemplate.organization_id == org_id)
    )
    return result.scalar_one()


@pytest.mark.integration
class TestSavedBallotTemplateCap:
    async def test_save_below_cap_succeeds(
        self, db_session: AsyncSession, setup_org_and_admin, monkeypatch
    ):
        org_id, admin_id = setup_org_and_admin
        monkeypatch.setattr(
            elections_endpoints, "MAX_SAVED_BALLOT_TEMPLATES_PER_ORG", 3
        )
        await _seed_templates(db_session, org_id, 2)
        user = SimpleNamespace(id=admin_id, organization_id=org_id)

        saved = await elections_endpoints.save_ballot_template(
            _payload("Annual meeting"), db=db_session, current_user=user
        )

        assert saved.name == "Annual meeting"
        assert await _template_count(db_session, org_id) == 3

    async def test_save_at_cap_is_refused_with_409(
        self, db_session: AsyncSession, setup_org_and_admin, monkeypatch
    ):
        org_id, admin_id = setup_org_and_admin
        monkeypatch.setattr(
            elections_endpoints, "MAX_SAVED_BALLOT_TEMPLATES_PER_ORG", 3
        )
        await _seed_templates(db_session, org_id, 3)
        user = SimpleNamespace(id=admin_id, organization_id=org_id)

        with pytest.raises(HTTPException) as refused:
            await elections_endpoints.save_ballot_template(
                _payload("One too many"), db=db_session, current_user=user
            )

        assert refused.value.status_code == 409
        assert "maximum of 3 saved ballot templates" in refused.value.detail
        assert await _template_count(db_session, org_id) == 3

    async def test_cap_counts_only_the_callers_organization(
        self, db_session: AsyncSession, setup_org_and_admin, monkeypatch
    ):
        org_id, admin_id = setup_org_and_admin
        other_org = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone) "
                "VALUES (:id, 'Other FD', 'fire_department', :slug, 'UTC')"
            ),
            {"id": other_org, "slug": f"other-{other_org[:8]}"},
        )
        monkeypatch.setattr(
            elections_endpoints, "MAX_SAVED_BALLOT_TEMPLATES_PER_ORG", 2
        )
        await _seed_templates(db_session, other_org, 2)
        user = SimpleNamespace(id=admin_id, organization_id=org_id)

        saved = await elections_endpoints.save_ballot_template(
            _payload("Ours"), db=db_session, current_user=user
        )

        assert saved.organization_id == org_id


@pytest.mark.unit
def test_default_cap_is_200():
    assert elections_endpoints.MAX_SAVED_BALLOT_TEMPLATES_PER_ORG == 200
