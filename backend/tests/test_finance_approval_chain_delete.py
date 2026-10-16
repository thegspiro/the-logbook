"""Deleting an approval chain (or step) never erases approval history.

A request's approval history -- who approved or denied each step, and their
notes -- lives in ``approval_step_records``, whose ``chain_id`` and
``step_id`` are ON DELETE CASCADE. So a chain or step that any request has
been routed through is refused with a 400 telling the admin to turn the chain
off instead; one nobody has used deletes as before. Every chain and step
change is audited.
"""

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import finance as finance_endpoints
from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.finance import (
    ApprovalChain,
    ApprovalChainStep,
    ApprovalEntityType,
    ApprovalStepRecord,
    ApprovalStepType,
    ApproverType,
)
from app.models.user import Position, User
from app.services.finance_service import FinanceService

pytestmark = [pytest.mark.integration]

_STEP = {
    "step_type": ApprovalStepType.APPROVAL,
    "approver_type": ApproverType.PERMISSION,
    "approver_value": "finance.approve",
}


def _client(db_session: AsyncSession, caller: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(finance_endpoints.router, prefix="/finance")
    app.dependency_overrides[get_current_user] = lambda: caller
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Chain Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"chn-{org_id[:8]}"},
    )
    tag = uuid.uuid4().hex[:8]
    admin = User(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        username=f"chain-admin-{tag}",
        email=f"chain-admin-{tag}@dept.test",
        first_name="Chain",
        last_name="Admin",
        password_hash="x",
    )
    admin.positions.append(
        Position(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            name=f"Approvals Admin {tag}",
            slug=f"approvals-admin-{tag}",
            permissions=[
                "finance.view",
                "finance.approve",
                "finance.configure_approvals",
            ],
        )
    )
    db_session.add(admin)
    await db_session.flush()

    service = FinanceService(db_session)
    chain = await service.create_approval_chain(
        org_id=org_id,
        created_by=admin.id,
        name="Large purchases",
        applies_to=ApprovalEntityType.PURCHASE_REQUEST,
        is_default=False,
        steps=[
            {"step_order": 1, "name": "Treasurer review", **_STEP},
            {"step_order": 2, "name": "Chief sign-off", **_STEP},
        ],
    )
    return {"org_id": org_id, "admin": admin, "chain": chain, "service": service}


async def _route_a_request(dept) -> None:
    await dept["service"].create_approval_records(
        dept["chain"],
        ApprovalEntityType.PURCHASE_REQUEST,
        str(uuid.uuid4()),
        500,
        dept["admin"].id,
    )


async def _count(db_session: AsyncSession, model, *where) -> int:
    return int(
        (
            await db_session.execute(
                select(func.count()).select_from(model).where(*where)
            )
        ).scalar_one()
    )


async def _audit(db_session: AsyncSession, event_type: str, org_id: str):
    return (
        (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == event_type,
                    AuditLog.organization_id == org_id,
                )
            )
        )
        .scalars()
        .all()
    )


class TestDeleteApprovalChain:
    async def test_a_chain_no_request_used_deletes_and_is_audited(
        self, db_session: AsyncSession, dept
    ):
        chain_id = dept["chain"].id
        async with _client(db_session, dept["admin"]) as client:
            resp = await client.delete(f"/finance/approval-chains/{chain_id}")

        assert resp.status_code == 204
        assert (
            await _count(db_session, ApprovalChain, ApprovalChain.id == chain_id) == 0
        )
        rows = await _audit(
            db_session, "finance.approval_chain_deleted", dept["org_id"]
        )
        assert len(rows) == 1
        assert rows[0].event_data == {"chain_id": chain_id, "name": "Large purchases"}
        assert rows[0].user_id == dept["admin"].id

    async def test_a_used_chain_is_refused_and_its_history_kept(
        self, db_session: AsyncSession, dept
    ):
        chain_id = dept["chain"].id
        await _route_a_request(dept)
        await _route_a_request(dept)

        async with _client(db_session, dept["admin"]) as client:
            resp = await client.delete(f"/finance/approval-chains/{chain_id}")

        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert "2 requests have been routed through it" in detail
        assert "Turn the chain off instead" in detail
        assert (
            await _count(db_session, ApprovalChain, ApprovalChain.id == chain_id) == 1
        )
        assert (
            await _count(
                db_session,
                ApprovalStepRecord,
                ApprovalStepRecord.chain_id == chain_id,
            )
            == 4
        )
        assert (
            await _audit(db_session, "finance.approval_chain_deleted", dept["org_id"])
            == []
        )

    async def test_another_departments_chain_is_not_found(
        self, db_session: AsyncSession, dept
    ):
        with pytest.raises(ValueError, match="not found"):
            await dept["service"].delete_approval_chain(
                dept["chain"].id, str(uuid.uuid4())
            )

    async def test_turning_a_used_chain_off_is_allowed_and_audited(
        self, db_session: AsyncSession, dept
    ):
        chain_id = dept["chain"].id
        await _route_a_request(dept)

        async with _client(db_session, dept["admin"]) as client:
            resp = await client.put(
                f"/finance/approval-chains/{chain_id}", json={"is_active": False}
            )

        assert resp.status_code == 200
        assert resp.json()["isActive"] is False
        rows = await _audit(
            db_session, "finance.approval_chain_updated", dept["org_id"]
        )
        assert len(rows) == 1
        assert rows[0].event_data == {
            "chain_id": chain_id,
            "name": "Large purchases",
            "fields": ["is_active"],
        }


class TestDeleteChainStep:
    async def test_a_used_step_is_refused_and_its_records_kept(
        self, db_session: AsyncSession, dept
    ):
        chain = dept["chain"]
        step_id = chain.steps[0].id
        await _route_a_request(dept)

        async with _client(db_session, dept["admin"]) as client:
            resp = await client.delete(
                f"/finance/approval-chains/{chain.id}/steps/{step_id}"
            )

        assert resp.status_code == 400
        assert "1 request has been routed through it" in resp.json()["detail"]
        assert (
            await _count(db_session, ApprovalChainStep, ApprovalChainStep.id == step_id)
            == 1
        )
        assert (
            await _count(
                db_session, ApprovalStepRecord, ApprovalStepRecord.step_id == step_id
            )
            == 1
        )

    async def test_step_add_update_and_unused_delete_are_audited(
        self, db_session: AsyncSession, dept
    ):
        chain_id = dept["chain"].id
        org_id = dept["org_id"]
        async with _client(db_session, dept["admin"]) as client:
            added = await client.post(
                f"/finance/approval-chains/{chain_id}/steps",
                json={
                    "step_order": 3,
                    "name": "Board vote",
                    "step_type": "approval",
                    "approver_type": "permission",
                    "approver_value": "finance.approve",
                },
            )
            assert added.status_code == 201
            step_id = added.json()["id"]
            updated = await client.put(
                f"/finance/approval-chains/{chain_id}/steps/{step_id}",
                json={"name": "Board of trustees vote"},
            )
            assert updated.status_code == 200
            deleted = await client.delete(
                f"/finance/approval-chains/{chain_id}/steps/{step_id}"
            )
            assert deleted.status_code == 204

        (add_row,) = await _audit(
            db_session, "finance.approval_chain_step_added", org_id
        )
        assert add_row.event_data == {
            "chain_id": chain_id,
            "step_id": step_id,
            "name": "Board vote",
        }
        (upd_row,) = await _audit(
            db_session, "finance.approval_chain_step_updated", org_id
        )
        assert upd_row.event_data == {
            "chain_id": chain_id,
            "step_id": step_id,
            "name": "Board of trustees vote",
            "fields": ["name"],
        }
        (del_row,) = await _audit(
            db_session, "finance.approval_chain_step_deleted", org_id
        )
        assert del_row.event_data == {
            "chain_id": chain_id,
            "step_id": step_id,
            "name": "Board of trustees vote",
        }
