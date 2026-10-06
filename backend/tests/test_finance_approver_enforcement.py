"""The named approver on a finance approval step is enforced.

An approval chain step names who approves it (``approver_type`` /
``approver_value``). Until 2026-10 nothing read that pair: any
``finance.approve`` holder could approve or deny any step, so a "Treasurer"
step could be signed by anybody holding the generic permission. These tests
pin the rule that replaced it, everywhere it is applied:

- the matcher itself (pure — no database)
- approve / deny, including the approvals-admin override and its audit trail
- the pending-approvals list and the request detail flags
- the email-token path, which must follow the step's CURRENT approver type
- step validation on create / update
- the approver-coverage report
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.finance import (
    ApprovalChainStep,
    ApprovalEntityType,
    ApprovalStepStatus,
    ApprovalStepType,
    ApproverType,
    PurchaseRequestStatus,
)
from app.models.user import Position, User, UserStatus
from app.services.finance_approver_matching import (
    ApproverMismatchError,
    authorize_step_actor,
    user_matches_step,
)
from app.services.finance_service import ApprovalTokenNotValidError, FinanceService
from app.services.separation_of_duties import SeparationOfDutiesError

ORG = "org-a"
OTHER_ORG = "org-b"


def _step(approver_type=None, approver_value=None, step_type=ApprovalStepType.APPROVAL):
    return SimpleNamespace(
        step_type=step_type,
        approver_type=approver_type,
        approver_value=approver_value,
    )


def _transient_user(
    *permissions,
    org=ORG,
    positions=(),
    status=UserStatus.ACTIVE,
    email="member@dept.org",
    user_id=None,
):
    """A User with its positions set in memory, so nothing lazy-loads."""
    user = User(
        id=user_id or str(uuid.uuid4()),
        organization_id=org,
        username="member",
        first_name="Pat",
        last_name="Member",
        email=email,
        password_hash="x",
        status=status,
    )
    held = [
        Position(organization_id=pos_org, slug=slug, name=slug, permissions=[])
        for pos_org, slug in positions
    ]
    if permissions:
        held.append(
            Position(
                organization_id=org,
                slug=f"grant-{uuid.uuid4().hex[:6]}",
                name="Grant",
                permissions=list(permissions),
            )
        )
    user.positions = held
    return user


class _FakeDirectory:
    """Stands in for ApproverDirectory's org-scoped lookups."""

    def __init__(self, positions=None, users=None):
        self.positions = positions or {}
        self.users = users or {}

    async def position(self, slug):
        return self.positions.get((slug or "").strip().lower())

    async def user(self, user_id):
        return self.users.get(user_id)


# ============================================
# The matcher (pure)
# ============================================


@pytest.mark.unit
class TestTheMatcher:
    async def _matches(self, user, step, org=ORG):
        return await user_matches_step(None, user, step, org)

    async def test_an_unassigned_step_takes_any_finance_approver(self):
        step = _step()
        assert await self._matches(_transient_user("finance.approve"), step)
        assert not await self._matches(_transient_user("finance.view"), step)

    async def test_a_position_step_takes_a_holder_of_that_slug(self):
        step = _step(ApproverType.POSITION, "treasurer")
        holder = _transient_user(positions=[(ORG, "treasurer")])
        assert await self._matches(holder, step)

    async def test_position_slugs_compare_case_insensitively_and_trimmed(self):
        step = _step(ApproverType.POSITION, " Treasurer ")
        holder = _transient_user(positions=[(ORG, "treasurer")])
        assert await self._matches(holder, step)

    async def test_the_same_slug_in_another_org_does_not_count(self):
        step = _step(ApproverType.POSITION, "treasurer")
        foreign = _transient_user(positions=[(OTHER_ORG, "treasurer")])
        assert not await self._matches(foreign, step)

    async def test_an_inactive_holder_does_not_count(self):
        step = _step(ApproverType.POSITION, "treasurer")
        inactive = _transient_user(
            positions=[(ORG, "treasurer")], status=UserStatus.INACTIVE
        )
        assert not await self._matches(inactive, step)

    async def test_a_member_of_another_org_never_matches(self):
        step = _step()
        foreign = _transient_user("finance.approve", org=OTHER_ORG)
        assert not await self._matches(foreign, step)

    async def test_a_permission_step_uses_the_permission_helper(self):
        step = _step(ApproverType.PERMISSION, "finance.manage")
        assert await self._matches(_transient_user("finance.manage"), step)
        assert not await self._matches(_transient_user("finance.approve"), step)

    async def test_a_global_wildcard_holder_satisfies_a_permission_step(self):
        step = _step(ApproverType.PERMISSION, "finance.manage")
        assert await self._matches(_transient_user("*"), step)

    async def test_a_module_wildcard_satisfies_a_permission_step(self):
        step = _step(ApproverType.PERMISSION, "finance.manage")
        assert await self._matches(_transient_user("finance.*"), step)

    async def test_a_specific_user_step_takes_only_that_member(self):
        user = _transient_user(user_id="u-1")
        assert await self._matches(user, _step(ApproverType.SPECIFIC_USER, "u-1"))
        assert not await self._matches(user, _step(ApproverType.SPECIFIC_USER, "u-2"))

    async def test_an_email_step_matches_the_account_email_case_insensitively(self):
        user = _transient_user(email="Treasurer@Dept.org")
        step = _step(ApproverType.EMAIL, " treasurer@dept.ORG ")
        assert await self._matches(user, step)
        assert not await self._matches(
            user, _step(ApproverType.EMAIL, "board@dept.org")
        )

    async def test_a_blank_value_matches_nobody(self):
        user = _transient_user("*", positions=[(ORG, "treasurer")])
        assert not await self._matches(user, _step(ApproverType.POSITION, "  "))


@pytest.mark.unit
class TestTheOverrideDecision:
    async def _decide(self, user, step, reason=None):
        directory = _FakeDirectory(
            positions={"treasurer": SimpleNamespace(name="Treasurer")}
        )
        return await authorize_step_actor(
            None, user, step, ORG, reason, lookup=directory
        )

    async def test_the_named_approver_is_allowed_without_a_reason(self):
        user = _transient_user(positions=[(ORG, "treasurer")])
        decision = await self._decide(user, _step(ApproverType.POSITION, "treasurer"))
        assert decision.matched
        assert not decision.override
        assert decision.assignee_label == "Treasurer position"

    async def test_a_non_matching_approver_is_told_who_the_step_waits_on(self):
        user = _transient_user("finance.approve")
        with pytest.raises(ApproverMismatchError) as exc:
            await self._decide(user, _step(ApproverType.POSITION, "treasurer"))
        assert str(exc.value) == "This step is waiting on Treasurer position."

    async def test_a_non_admin_cannot_override_even_with_a_reason(self):
        user = _transient_user("finance.approve")
        with pytest.raises(ApproverMismatchError):
            await self._decide(
                user, _step(ApproverType.POSITION, "treasurer"), reason="urgent"
            )

    async def test_an_admin_without_a_reason_is_told_one_is_needed(self):
        admin = _transient_user("finance.approve", "finance.configure_approvals")
        with pytest.raises(ApproverMismatchError) as exc:
            await self._decide(
                admin, _step(ApproverType.POSITION, "treasurer"), reason="   "
            )
        assert "assigned to Treasurer position" in str(exc.value)
        assert "approvals administrator" in str(exc.value)
        assert "override reason" in str(exc.value)

    async def test_an_admin_with_a_reason_overrides(self):
        admin = _transient_user("finance.approve", "finance.configure_approvals")
        decision = await self._decide(
            admin,
            _step(ApproverType.POSITION, "treasurer"),
            reason="  Treasurer on leave  ",
        )
        assert decision.override
        assert not decision.matched
        assert decision.override_reason == "Treasurer on leave"
        assert decision.approver_type == "position"
        assert decision.approver_value == "treasurer"

    async def test_an_overlong_reason_is_refused(self):
        admin = _transient_user("finance.approve", "finance.configure_approvals")
        with pytest.raises(ValueError, match="2000"):
            await self._decide(
                admin, _step(ApproverType.POSITION, "treasurer"), reason="x" * 2001
            )


# ============================================
# Database-backed: approve / deny, listings, validation, coverage
# ============================================


async def _make_org(db: AsyncSession) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Approver Dept", "slug": f"apr-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _make_member(
    db: AsyncSession,
    org_id: str,
    *permissions: str,
    slug: str | None = None,
    position_name: str | None = None,
    status: UserStatus = UserStatus.ACTIVE,
    first_name: str = "Pat",
) -> User:
    tag = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        username=f"m-{tag}",
        email=f"m-{tag}@dept.test",
        first_name=first_name,
        last_name="Member",
        password_hash="x",
        status=status,
    )
    if permissions:
        user.positions.append(
            Position(
                id=str(uuid.uuid4()),
                organization_id=org_id,
                name=f"Grant {tag}",
                slug=f"grant-{tag}",
                permissions=list(permissions),
            )
        )
    if slug:
        existing = (
            await db.execute(
                select(Position).where(
                    Position.organization_id == org_id, Position.slug == slug
                )
            )
        ).scalar_one_or_none()
        user.positions.append(
            existing
            or Position(
                id=str(uuid.uuid4()),
                organization_id=org_id,
                name=position_name or slug.title(),
                slug=slug,
                permissions=[],
            )
        )
    db.add(user)
    await db.flush()
    return user


async def _make_position(db, org_id, slug, name):
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        slug=slug,
        permissions=[],
    )
    db.add(position)
    await db.flush()
    return position


async def _pending_pr(service, org_id, requester_id, steps, title="Radios"):
    fy = await service.create_fiscal_year(
        org_id=org_id,
        created_by=requester_id,
        name=f"FY-{uuid.uuid4().hex[:6]}",
        start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
    )
    pr = await service.create_purchase_request(
        org_id=org_id,
        requested_by=requester_id,
        fiscal_year_id=fy.id,
        title=title,
        estimated_amount=1000.00,
    )
    pr.status = PurchaseRequestStatus.PENDING_APPROVAL
    chain = await service.create_approval_chain(
        org_id=org_id,
        created_by=requester_id,
        name=f"Chain {uuid.uuid4().hex[:6]}",
        applies_to=ApprovalEntityType.PURCHASE_REQUEST,
        is_default=False,
        steps=steps,
    )
    records = await service.create_approval_records(
        chain, ApprovalEntityType.PURCHASE_REQUEST, pr.id, 1000.00, requester_id
    )
    return pr, chain, records


def _approval(order=1, approver_type=None, value=None, name="Approve"):
    return {
        "step_order": order,
        "name": name,
        "step_type": ApprovalStepType.APPROVAL,
        "approver_type": approver_type,
        "approver_value": value,
    }


def _client(db_session, caller):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.api.v1.endpoints import finance as finance_endpoints
    from app.core.database import get_db

    app = FastAPI()
    app.include_router(finance_endpoints.router, prefix="/finance")
    app.dependency_overrides[get_current_user] = lambda: caller
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def treasurer_setup(db_session: AsyncSession):
    """A request waiting on a Treasurer step, and the people around it."""
    org_id = await _make_org(db_session)
    requester = await _make_member(db_session, org_id, "finance.manage")
    treasurer = await _make_member(
        db_session,
        org_id,
        "finance.view",
        "finance.approve",
        slug="treasurer",
        first_name="Tess",
    )
    officer = await _make_member(db_session, org_id, "finance.view", "finance.approve")
    admin = await _make_member(
        db_session,
        org_id,
        "finance.view",
        "finance.approve",
        "finance.configure_approvals",
    )
    service = FinanceService(db_session)
    pr, chain, records = await _pending_pr(
        service,
        org_id,
        requester.id,
        [_approval(approver_type="position", value="treasurer", name="Treasurer")],
    )
    return SimpleNamespace(
        org_id=org_id,
        requester=requester,
        treasurer=treasurer,
        officer=officer,
        admin=admin,
        service=service,
        pr=pr,
        chain=chain,
        record=records[0],
    )


@pytest.mark.integration
class TestApproveAndDenyEnforceTheNamedApprover:
    async def test_the_named_approver_approves(self, treasurer_setup):
        s = treasurer_setup
        record = await s.service.approve_step(s.record.id, s.treasurer, org_id=s.org_id)
        assert record.status == ApprovalStepStatus.APPROVED
        assert record.acted_by == s.treasurer.id
        assert not s.service.last_approver_decision.override

    async def test_another_finance_approver_is_refused_and_nothing_changes(
        self, treasurer_setup
    ):
        s = treasurer_setup
        with pytest.raises(ApproverMismatchError, match="Treasurer position"):
            await s.service.approve_step(s.record.id, s.officer, org_id=s.org_id)
        with pytest.raises(ApproverMismatchError):
            await s.service.deny_step(s.record.id, s.officer, "no", org_id=s.org_id)

        assert s.record.status == ApprovalStepStatus.PENDING
        assert s.record.acted_by is None
        assert s.record.notes is None
        assert s.pr.status == PurchaseRequestStatus.PENDING_APPROVAL

    async def test_an_admin_without_a_reason_is_refused(self, treasurer_setup):
        s = treasurer_setup
        with pytest.raises(ApproverMismatchError, match="override reason"):
            await s.service.approve_step(s.record.id, s.admin, org_id=s.org_id)
        assert s.record.status == ApprovalStepStatus.PENDING

    async def test_an_admin_with_a_reason_overrides(self, treasurer_setup):
        s = treasurer_setup
        record = await s.service.deny_step(
            s.record.id,
            s.admin,
            "duplicate",
            org_id=s.org_id,
            override_reason="Treasurer is the payee",
        )
        assert record.status == ApprovalStepStatus.DENIED
        decision = s.service.last_approver_decision
        assert decision.override
        assert decision.override_reason == "Treasurer is the payee"

    async def test_separation_of_duties_survives_the_override(self, db_session):
        org_id = await _make_org(db_session)
        admin = await _make_member(
            db_session, org_id, "finance.approve", "finance.configure_approvals"
        )
        await _make_member(db_session, org_id, "finance.approve", slug="treasurer")
        service = FinanceService(db_session)
        _pr, _chain, records = await _pending_pr(
            service,
            org_id,
            admin.id,
            [_approval(approver_type="position", value="treasurer")],
        )

        with pytest.raises(SeparationOfDutiesError):
            await service.approve_step(
                records[0].id, admin, org_id=org_id, override_reason="I'm the admin"
            )
        assert records[0].status == ApprovalStepStatus.PENDING

    async def test_the_requester_may_still_deny_their_own_request(self, db_session):
        org_id = await _make_org(db_session)
        treasurer = await _make_member(
            db_session, org_id, "finance.approve", slug="treasurer"
        )
        service = FinanceService(db_session)
        _pr, _chain, records = await _pending_pr(
            service,
            org_id,
            treasurer.id,
            [_approval(approver_type="position", value="treasurer")],
        )

        denied = await service.deny_step(
            records[0].id, treasurer, "withdrawn", org_id=org_id
        )
        assert denied.status == ApprovalStepStatus.DENIED


@pytest.mark.integration
class TestTheEndpoints:
    async def test_a_non_matching_approver_gets_403_with_the_assignee(
        self, db_session, treasurer_setup
    ):
        s = treasurer_setup
        async with _client(db_session, s.officer) as client:
            response = await client.post(
                f"/finance/approvals/{s.record.id}/approve", json={}
            )
        assert response.status_code == 403
        assert response.json()["detail"] == (
            "This step is waiting on Treasurer position."
        )
        assert s.record.status == ApprovalStepStatus.PENDING

    async def test_an_admin_override_is_audited(self, db_session, treasurer_setup):
        s = treasurer_setup
        async with _client(db_session, s.admin) as client:
            refused = await client.post(
                f"/finance/approvals/{s.record.id}/approve", json={}
            )
            response = await client.post(
                f"/finance/approvals/{s.record.id}/approve",
                json={"notes": "ok", "overrideReason": "Treasurer on leave"},
            )
        assert refused.status_code == 403
        assert "override reason" in refused.json()["detail"]
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "approved"

        log = (
            (
                await db_session.execute(
                    select(AuditLog)
                    .where(
                        AuditLog.event_type == "finance.approval_step_approved",
                        AuditLog.user_id == s.admin.id,
                    )
                    .order_by(AuditLog.id.desc())
                )
            )
            .scalars()
            .first()
        )
        assert log is not None
        assert log.event_data["override"] is True
        assert log.event_data["override_reason"] == "Treasurer on leave"
        assert log.event_data["approver_type"] == "position"
        assert log.event_data["approver_value"] == "treasurer"
        severity = getattr(log.severity, "value", log.severity)
        assert str(severity).lower() == "warning"

    async def test_a_matched_approval_is_audited_without_override(
        self, db_session, treasurer_setup
    ):
        s = treasurer_setup
        async with _client(db_session, s.treasurer) as client:
            response = await client.post(
                f"/finance/approvals/{s.record.id}/approve", json={}
            )
        assert response.status_code == 200, response.text
        log = (
            (
                await db_session.execute(
                    select(AuditLog)
                    .where(
                        AuditLog.event_type == "finance.approval_step_approved",
                        AuditLog.user_id == s.treasurer.id,
                    )
                    .order_by(AuditLog.id.desc())
                )
            )
            .scalars()
            .first()
        )
        assert log.event_data["override"] is False
        assert "override_reason" not in log.event_data

    async def test_the_detail_page_reports_who_can_act(
        self, db_session, treasurer_setup
    ):
        s = treasurer_setup

        async def steps_for(user):
            async with _client(db_session, user) as client:
                response = await client.get(f"/finance/purchase-requests/{s.pr.id}")
            assert response.status_code == 200, response.text
            return response.json()["approvalSteps"]

        (mine,) = await steps_for(s.treasurer)
        assert mine["assigneeLabel"] == "Treasurer position"
        assert mine["canAct"] is True
        assert mine["requiresOverride"] is False

        (theirs,) = await steps_for(s.officer)
        assert theirs["canAct"] is False
        assert theirs["requiresOverride"] is False

        (admins,) = await steps_for(s.admin)
        assert admins["canAct"] is False
        assert admins["requiresOverride"] is True


@pytest.mark.integration
class TestThePendingList:
    async def test_each_caller_sees_what_they_can_act_on(
        self, db_session, treasurer_setup
    ):
        s = treasurer_setup
        open_pr, _chain, _records = await _pending_pr(
            s.service, s.org_id, s.requester.id, [_approval()], title="Hose"
        )
        other_org = await _make_org(db_session)
        other_requester = await _make_member(db_session, other_org, "finance.manage")
        foreign_pr, _c, _r = await _pending_pr(
            s.service, other_org, other_requester.id, [_approval()], title="Foreign"
        )

        async def listed(user):
            rows = await s.service.get_pending_approvals(user, s.org_id)
            return {row["entity_id"]: row for row in rows}

        officer_rows = await listed(s.officer)
        assert set(officer_rows) == {open_pr.id}
        assert officer_rows[open_pr.id]["can_act"] is True
        assert officer_rows[open_pr.id]["assignee_label"] == "any finance approver"

        treasurer_rows = await listed(s.treasurer)
        assert set(treasurer_rows) == {open_pr.id, s.pr.id}
        assert treasurer_rows[s.pr.id]["approver_type"] == "position"
        assert treasurer_rows[s.pr.id]["approver_value"] == "treasurer"
        assert treasurer_rows[s.pr.id]["assignee_label"] == "Treasurer position"

        admin_rows = await listed(s.admin)
        assert set(admin_rows) == {open_pr.id, s.pr.id}
        assert admin_rows[s.pr.id]["can_act"] is False
        assert admin_rows[s.pr.id]["requires_override"] is True
        assert admin_rows[open_pr.id]["can_act"] is True
        assert admin_rows[open_pr.id]["requires_override"] is False
        assert foreign_pr.id not in admin_rows

    async def test_the_endpoint_serializes_the_new_fields(
        self, db_session, treasurer_setup
    ):
        s = treasurer_setup
        async with _client(db_session, s.admin) as client:
            response = await client.get("/finance/approvals/pending")
        assert response.status_code == 200, response.text
        (row,) = response.json()
        assert row["assigneeLabel"] == "Treasurer position"
        assert row["approverType"] == "position"
        assert row["approverValue"] == "treasurer"
        assert row["canAct"] is False
        assert row["requiresOverride"] is True


@pytest.mark.integration
class TestTheTokenFollowsTheStepsCurrentApprover:
    async def test_a_token_dies_when_its_step_stops_being_an_email_step(
        self, db_session
    ):
        org_id = await _make_org(db_session)
        requester = await _make_member(db_session, org_id, "finance.manage")
        await _make_position(db_session, org_id, "treasurer", "Treasurer")
        service = FinanceService(db_session)
        _pr, chain, records = await _pending_pr(
            service,
            org_id,
            requester.id,
            [_approval(approver_type="email", value="cpa@example.com")],
        )
        token = records[0].approval_token
        assert token

        await service.update_chain_step(
            records[0].step_id,
            chain.id,
            org_id,
            approver_type="position",
            approver_value="treasurer",
        )

        with pytest.raises(ApprovalTokenNotValidError):
            await service.approve_by_token(token)
        with pytest.raises(ApprovalTokenNotValidError):
            await service.deny_by_token(token)
        assert records[0].status == ApprovalStepStatus.PENDING


@pytest.mark.integration
class TestStepValidation:
    async def _chain(self, service, org_id, created_by):
        return await service.create_approval_chain(
            org_id=org_id,
            created_by=created_by,
            name="Validated",
            applies_to=ApprovalEntityType.PURCHASE_REQUEST,
        )

    @pytest.mark.parametrize(
        ("approver_type", "value", "message"),
        [
            ("position", "no-such-position", "no position"),
            ("position", "   ", "required"),
            ("specific_user", str(uuid.uuid4()), "not an active member"),
            ("permission", "finance.bogus", "not a known permission"),
            ("permission", "finance.*", "not a known permission"),
            ("email", "a@x.org, b@x.org", "single valid email"),
            ("email", "not-an-address", "single valid email"),
        ],
    )
    async def test_a_bad_approver_is_refused(
        self, db_session, approver_type, value, message
    ):
        org_id = await _make_org(db_session)
        admin = await _make_member(db_session, org_id, "finance.configure_approvals")
        service = FinanceService(db_session)
        chain = await self._chain(service, org_id, admin.id)
        with pytest.raises(ValueError, match=message):
            await service.add_chain_step(
                chain.id,
                org_id,
                **_approval(approver_type=approver_type, value=value),
            )

    async def test_an_inactive_or_foreign_member_is_refused(self, db_session):
        org_id = await _make_org(db_session)
        other_org = await _make_org(db_session)
        admin = await _make_member(db_session, org_id, "finance.configure_approvals")
        inactive = await _make_member(db_session, org_id, status=UserStatus.INACTIVE)
        foreign = await _make_member(db_session, other_org)
        service = FinanceService(db_session)
        chain = await self._chain(service, org_id, admin.id)
        for user in (inactive, foreign):
            with pytest.raises(ValueError, match="not an active member"):
                await service.add_chain_step(
                    chain.id,
                    org_id,
                    **_approval(approver_type="specific_user", value=user.id),
                )

    async def test_a_position_in_another_org_is_refused(self, db_session):
        org_id = await _make_org(db_session)
        other_org = await _make_org(db_session)
        await _make_position(db_session, other_org, "treasurer", "Treasurer")
        admin = await _make_member(db_session, org_id, "finance.configure_approvals")
        service = FinanceService(db_session)
        chain = await self._chain(service, org_id, admin.id)
        with pytest.raises(ValueError, match="no position"):
            await service.add_chain_step(
                chain.id,
                org_id,
                **_approval(approver_type="position", value="treasurer"),
            )

    async def test_valid_approvers_are_accepted(self, db_session):
        org_id = await _make_org(db_session)
        admin = await _make_member(db_session, org_id, "finance.configure_approvals")
        await _make_position(db_session, org_id, "treasurer", "Treasurer")
        service = FinanceService(db_session)
        chain = await self._chain(service, org_id, admin.id)
        for order, (approver_type, value) in enumerate(
            [
                ("position", "Treasurer"),
                ("specific_user", admin.id),
                ("permission", "finance.approve"),
                ("permission", "*"),
                ("email", "  cpa@example.com "),
                (None, None),
            ],
            start=1,
        ):
            step = await service.add_chain_step(
                chain.id,
                org_id,
                **_approval(order=order, approver_type=approver_type, value=value),
            )
            assert step.id
        assert step.approver_type is None

    async def test_notification_steps_are_not_validated(self, db_session):
        org_id = await _make_org(db_session)
        admin = await _make_member(db_session, org_id, "finance.configure_approvals")
        service = FinanceService(db_session)
        chain = await self._chain(service, org_id, admin.id)
        step = await service.add_chain_step(
            chain.id,
            org_id,
            step_order=1,
            name="FYI",
            step_type=ApprovalStepType.NOTIFICATION,
            approver_type="position",
            approver_value="nobody",
        )
        assert step.id

    async def test_nested_steps_are_validated_on_chain_create(self, db_session):
        org_id = await _make_org(db_session)
        admin = await _make_member(db_session, org_id, "finance.configure_approvals")
        service = FinanceService(db_session)
        with pytest.raises(ValueError, match="Step 2: .*no position"):
            await service.create_approval_chain(
                org_id=org_id,
                created_by=admin.id,
                name="Nested",
                applies_to=ApprovalEntityType.PURCHASE_REQUEST,
                steps=[
                    _approval(order=1),
                    _approval(order=2, approver_type="position", value="ghost"),
                ],
            )

    async def test_an_already_broken_step_can_still_be_renamed(self, db_session):
        org_id = await _make_org(db_session)
        admin = await _make_member(db_session, org_id, "finance.configure_approvals")
        service = FinanceService(db_session)
        chain = await self._chain(service, org_id, admin.id)
        # Written straight to the table, as a step saved before validation
        # existed would have been.
        broken = ApprovalChainStep(
            id=str(uuid.uuid4()),
            chain_id=chain.id,
            step_order=1,
            name="Old",
            step_type=ApprovalStepType.APPROVAL,
            approver_type=ApproverType.POSITION,
            approver_value="ghost",
        )
        db_session.add(broken)
        await db_session.flush()

        renamed = await service.update_chain_step(
            broken.id, chain.id, org_id, name="Renamed"
        )
        assert renamed.name == "Renamed"

        with pytest.raises(ValueError, match="no position"):
            await service.update_chain_step(
                broken.id, chain.id, org_id, approver_value="still-ghost"
            )
        with pytest.raises(ValueError, match="no position"):
            await service.update_chain_step(
                broken.id, chain.id, org_id, approver_type="position"
            )


@pytest.mark.integration
class TestApproverCoverage:
    async def test_problems_are_reported(self, db_session):
        org_id = await _make_org(db_session)
        admin = await _make_member(
            db_session, org_id, "finance.approve", "finance.configure_approvals"
        )
        holder = await _make_member(db_session, org_id, slug="treasurer")
        await _make_member(
            db_session, org_id, slug="trustee", status=UserStatus.INACTIVE
        )
        await _make_position(db_session, org_id, "chief", "Chief")
        service = FinanceService(db_session)
        chain = await service.create_approval_chain(
            org_id=org_id,
            created_by=admin.id,
            name="Coverage",
            applies_to=ApprovalEntityType.PURCHASE_REQUEST,
        )
        shapes = {
            "unassigned": (None, None),
            "treasurer": (ApproverType.POSITION, "treasurer"),
            "trustee": (ApproverType.POSITION, "trustee"),
            "chief": (ApproverType.POSITION, "chief"),
            "ghost": (ApproverType.POSITION, "ghost"),
            "blank": (ApproverType.POSITION, "  "),
            "perm": (ApproverType.PERMISSION, "finance.bogus"),
            "member": (ApproverType.SPECIFIC_USER, holder.id),
            "gone": (ApproverType.SPECIFIC_USER, str(uuid.uuid4())),
            "external": (ApproverType.EMAIL, "cpa@example.com"),
            "bad-email": (ApproverType.EMAIL, "a@x.org,b@x.org"),
        }
        for order, (name, (approver_type, value)) in enumerate(shapes.items(), 1):
            # Inserted directly: validation would refuse the broken ones,
            # which is exactly what a pre-validation installation still holds.
            db_session.add(
                ApprovalChainStep(
                    id=str(uuid.uuid4()),
                    chain_id=chain.id,
                    step_order=order,
                    name=name,
                    step_type=ApprovalStepType.APPROVAL,
                    approver_type=approver_type,
                    approver_value=value,
                )
            )
        db_session.add(
            ApprovalChainStep(
                id=str(uuid.uuid4()),
                chain_id=chain.id,
                step_order=99,
                name="fyi",
                step_type=ApprovalStepType.NOTIFICATION,
            )
        )
        await db_session.flush()

        rows = {r["step_name"]: r for r in await service.get_approver_coverage(org_id)}

        assert "fyi" not in rows
        assert rows["unassigned"]["problem"] is None
        assert rows["unassigned"]["eligible_active_count"] == 1  # the admin
        assert rows["unassigned"]["assignee_label"] == "any finance approver"
        assert rows["treasurer"]["problem"] is None
        assert rows["treasurer"]["eligible_active_count"] == 1
        assert rows["treasurer"]["assignee_label"] == "Treasurer position"
        assert rows["trustee"]["problem"] == "no_active_members"
        assert rows["chief"]["problem"] == "no_active_members"
        assert rows["ghost"]["problem"] == "not_found"
        assert rows["blank"]["problem"] == "no_value"
        assert rows["perm"]["problem"] == "not_found"
        assert rows["member"]["problem"] is None
        assert rows["member"]["eligible_active_count"] == 1
        assert rows["gone"]["problem"] == "not_found"
        assert rows["external"]["problem"] is None
        assert rows["bad-email"]["problem"] == "invalid_email"
        assert all(r["chain_name"] == "Coverage" for r in rows.values())

    async def test_requests_waiting_on_a_step_are_counted(self, treasurer_setup):
        s = treasurer_setup
        rows = await s.service.get_approver_coverage(s.org_id)
        (row,) = [r for r in rows if r["chain_id"] == s.chain.id]
        assert row["pending_request_count"] == 1
        assert row["step_id"] == s.record.step_id

        await s.service.approve_step(s.record.id, s.treasurer, org_id=s.org_id)
        rows = await s.service.get_approver_coverage(s.org_id)
        (row,) = [r for r in rows if r["chain_id"] == s.chain.id]
        assert row["pending_request_count"] == 0

    async def test_the_report_needs_configure_approvals(
        self, db_session, treasurer_setup
    ):
        s = treasurer_setup
        async with _client(db_session, s.officer) as client:
            refused = await client.get("/finance/approval-chains/approver-coverage")
        async with _client(db_session, s.admin) as client:
            allowed = await client.get("/finance/approval-chains/approver-coverage")
        assert refused.status_code == 403
        assert allowed.status_code == 200, allowed.text
        (row,) = allowed.json()
        assert row["assigneeLabel"] == "Treasurer position"
        assert row["eligibleActiveCount"] == 1
        assert row["pendingRequestCount"] == 1
        assert row["problem"] is None
