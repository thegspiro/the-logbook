"""
Grant lifecycle and overspend warnings (GF-7).

Owner decision: a grant state machine, and overspend that warns rather than
blocks. ``update_application`` used to apply any status change -- a closed
grant could drop back to researching -- and nothing compared spending with
what was awarded or budgeted.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.grant import (
    APPLICATION_STATUS_TRANSITIONS,
    ApplicationStatus,
    allowed_next_statuses,
    assert_status_transition,
)
from app.schemas.grant import GrantApplicationResponse, GrantBudgetItemResponse
from app.services.grant_service import GrantService
from app.utils.grant_spending import (
    application_overspend,
    budget_item_overspend,
    spending_warnings,
)

NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)


@pytest.mark.unit
class TestLifecycle:
    def test_every_status_has_an_entry(self):
        assert set(APPLICATION_STATUS_TRANSITIONS) == set(ApplicationStatus)

    @pytest.mark.parametrize(
        ("old", "new"),
        [
            ("researching", "preparing"),
            ("researching", "submitted"),
            ("preparing", "researching"),
            ("submitted", "awarded"),
            ("under_review", "denied"),
            ("awarded", "active"),
            ("active", "reporting"),
            ("reporting", "active"),
            ("reporting", "closed"),
            ("closed", "reporting"),
            ("denied", "researching"),
            ("closed", "closed"),
        ],
    )
    def test_lifecycle_steps_are_allowed(self, old, new):
        assert_status_transition(old, new)

    @pytest.mark.parametrize(
        ("old", "new"),
        [
            ("closed", "researching"),
            ("awarded", "researching"),
            ("active", "awarded"),
            ("submitted", "preparing"),
            ("denied", "awarded"),
            ("researching", "active"),
        ],
    )
    def test_other_moves_are_refused(self, old, new):
        with pytest.raises(ValueError, match=f"cannot move from {old} to {new}"):
            assert_status_transition(old, new)

    def test_allowed_next_is_in_pipeline_order(self):
        assert allowed_next_statuses("submitted") == [
            "under_review",
            "awarded",
            "denied",
        ]

    async def test_update_application_refuses_before_writing(self):
        application = SimpleNamespace(
            id="app-1",
            application_status=ApplicationStatus.CLOSED,
            opportunity_id=None,
        )
        db = MagicMock()
        db.flush = AsyncMock()
        service = GrantService(db)
        service.get_application = AsyncMock(return_value=application)
        service._validate_application_fks = AsyncMock()

        with pytest.raises(ValueError, match="cannot move from closed to researching"):
            await service.update_application(
                "app-1",
                "org-1",
                {"application_status": "researching", "notes": "reopen"},
                "user-1",
            )

        assert application.application_status == ApplicationStatus.CLOSED
        assert not hasattr(application, "notes")
        db.flush.assert_not_awaited()


def _expenditure(amount):
    return SimpleNamespace(amount=Decimal(amount))


def _item(budgeted, spent, description="Turnout gear"):
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        description=description,
        amount_budgeted=Decimal(budgeted),
        amount_spent=Decimal(spent),
    )


@pytest.mark.unit
class TestOverspend:
    def test_grant_overspend_is_measured_against_the_award(self):
        spent = [_expenditure("600"), _expenditure("500")]
        assert application_overspend(Decimal("1000"), spent) == Decimal("100")
        assert application_overspend(Decimal("1100"), spent) is None
        # Nothing awarded yet: nothing to be over.
        assert application_overspend(None, spent) is None

    def test_budget_line_overspend(self):
        assert budget_item_overspend(Decimal("500"), Decimal("650")) == Decimal("150")
        assert budget_item_overspend(Decimal("500"), Decimal("500")) is None

    def test_warnings_name_the_grant_and_the_line_written(self):
        over_line = _item("500", "650")
        other_line = _item("100", "300", description="Radios")
        application = SimpleNamespace(
            amount_awarded=Decimal("900"),
            expenditures=[_expenditure("950")],
            budget_items=[over_line, other_line],
        )

        warnings = spending_warnings(application, over_line.id)

        assert warnings == [
            "Spending on this grant is now $50.00 over the $900.00 awarded.",
            "Budget line “Turnout gear” is $150.00 over its $500.00 budget.",
        ]

    def test_response_reports_overspend_and_next_statuses(self):
        application = SimpleNamespace(
            id=uuid.uuid4(),
            organization_id=uuid.uuid4(),
            opportunity_id=None,
            assigned_to=None,
            linked_campaign_id=None,
            created_by=None,
            created_at=NOW,
            updated_at=NOW,
            grant_program_name="AFG",
            grant_agency="FEMA",
            application_status="active",
            amount_requested=None,
            amount_awarded=Decimal("1000"),
            budget_items=[],
            expenditures=[
                SimpleNamespace(
                    id=uuid.uuid4(),
                    application_id=uuid.uuid4(),
                    budget_item_id=None,
                    description="Hose",
                    amount=Decimal("1200"),
                    expenditure_date=date(2026, 9, 1),
                    vendor=None,
                    invoice_number=None,
                    receipt_url=None,
                    approved_by=None,
                    approval_date=None,
                    created_by=None,
                    created_at=NOW,
                    updated_at=NOW,
                )
            ],
            compliance_tasks=[],
            grant_notes=[],
        )

        body = GrantApplicationResponse.model_validate(application).model_dump(
            by_alias=True, mode="json"
        )

        assert body["allowedNextStatuses"] == ["reporting", "closed"]
        assert body["totalExpended"] == "1200"
        assert body["overspentBy"] == "200"

    def test_budget_item_response_reports_overspend(self):
        item = GrantBudgetItemResponse.model_validate(
            SimpleNamespace(
                id=uuid.uuid4(),
                application_id=uuid.uuid4(),
                category="equipment",
                description="Radios",
                amount_budgeted=Decimal("100"),
                amount_spent=Decimal("130"),
                amount_remaining=Decimal("-30"),
                federal_share=None,
                local_match=None,
                notes=None,
                sort_order=0,
                created_at=NOW,
                updated_at=NOW,
            )
        )
        assert item.model_dump(by_alias=True)["overspentBy"] == Decimal("30")


@pytest.mark.unit
class TestExpenditureEndpointWarns:
    async def test_the_write_succeeds_and_carries_the_warning(self, monkeypatch):
        from app.api.v1.endpoints import grants as endpoint
        from app.schemas.grant import GrantExpenditureCreate

        expenditure = SimpleNamespace(
            id=uuid.uuid4(),
            application_id=uuid.uuid4(),
            budget_item_id=None,
            description="Hose",
            amount=Decimal("1200"),
            expenditure_date=date(2026, 9, 1),
            vendor=None,
            invoice_number=None,
            receipt_url=None,
            approved_by=None,
            approval_date=None,
            created_by=None,
            created_at=NOW,
            updated_at=NOW,
        )
        service = MagicMock()
        service.create_expenditure = AsyncMock(return_value=expenditure)
        service.spending_warnings = AsyncMock(return_value=["over"])
        monkeypatch.setattr(endpoint, "GrantService", lambda _db: service)

        out = await endpoint.create_expenditure(
            app_id=uuid.uuid4(),
            data=GrantExpenditureCreate(
                application_id=uuid.uuid4(),
                description="Hose",
                amount=Decimal("1200"),
                expenditure_date=date.today(),
            ),
            db=MagicMock(),
            current_user=SimpleNamespace(id=uuid.uuid4(), organization_id=uuid.uuid4()),
        )

        assert out.warnings == ["over"]
        assert out.amount == Decimal("1200")


@pytest.mark.integration
class TestAgainstTheDatabase:
    async def test_overspend_is_recorded_warned_and_audited(self, db_session):
        from sqlalchemy import select

        from app.models.audit import AuditLog
        from app.models.grant import GrantApplication
        from app.models.user import Organization

        org = Organization(
            id=str(uuid.uuid4()),
            name="Lifecycle Department",
            slug=f"lifecycle-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
        )
        db_session.add(org)
        await db_session.flush()
        application = GrantApplication(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            grant_program_name="AFG",
            application_status=ApplicationStatus.ACTIVE,
            amount_awarded=Decimal("1000"),
        )
        db_session.add(application)
        await db_session.flush()
        service = GrantService(db_session)
        item = await service.create_budget_item(
            application.id,
            org.id,
            {
                "category": "equipment",
                "description": "Radios",
                "amount_budgeted": Decimal("500"),
            },
        )

        expenditure = await service.create_expenditure(
            application.id,
            org.id,
            {
                "description": "Radios",
                "amount": Decimal("1100"),
                "expenditure_date": date(2026, 9, 1),
                "budget_item_id": item.id,
            },
            user_id=None,
        )
        warnings = await service.spending_warnings(
            application.id, org.id, budget_item_id=item.id
        )

        assert expenditure.id
        assert warnings == [
            "Spending on this grant is now $100.00 over the $1,000.00 awarded.",
            "Budget line “Radios” is $600.00 over its $500.00 budget.",
        ]
        logged = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "grant_overspend_recorded"
                )
            )
        ).scalars()
        assert any(
            (row.event_data or {}).get("application_id") == application.id
            for row in logged
        )

        with pytest.raises(ValueError, match="cannot move from active to awarded"):
            await service.update_application(
                application.id, org.id, {"application_status": "awarded"}, "user-1"
            )
