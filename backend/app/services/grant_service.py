"""
Grant Service

Business logic for grant opportunity management, application tracking,
budget management, expenditure logging, compliance task tracking,
and grant reporting.
"""

from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit_event
from app.models.grant import (
    ApplicationStatus,
    ComplianceTaskStatus,
    FundraisingCampaign,
    GrantApplication,
    GrantBudgetItem,
    GrantComplianceTask,
    GrantExpenditure,
    GrantNote,
    GrantNoteType,
    GrantOpportunity,
)
from app.models.user import User
from app.utils.org_scoping import assert_in_org
from app.utils.sql_ordering import nulls_last_asc


def _status_value(value: Any) -> str:
    """Read an enum-backed column as its wire value.

    The application-status and reporting-frequency schema fields are
    ``Literal[...]`` unions of plain strings, so ``model_dump()`` hands the
    service a ``str``. Assigning that to the SQLAlchemy ``Enum`` column leaves
    the *attribute* a ``str`` until the row is refreshed from the database — the
    coercion happens on the way out, not on assignment. Reading ``.value`` off
    it therefore raises ``AttributeError`` and turns the whole request into a
    500, but only when the client actually sends the field (omitting it leaves
    the column default, a real enum member) — which is why it survived review.
    Handle both shapes rather than assuming which one is in hand.

    Duck-typed on ``.value`` rather than ``isinstance(value, Enum)`` so any
    enum-like stand-in (such as the lightweight fakes the service tests build)
    reads the same way a real member does.
    """
    return str(getattr(value, "value", value))


class GrantService:
    """Service for grant management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Audit helper
    # ------------------------------------------------------------------

    async def _audit(
        self,
        event_type: str,
        event_data: Dict,
        severity: str = "info",
        user_id: Optional[str] = None,
    ) -> None:
        await log_audit_event(
            db=self.db,
            event_type=event_type,
            event_category="grants",
            severity=severity,
            event_data=event_data,
            user_id=user_id,
        )

    # ------------------------------------------------------------------
    # Grant Opportunities
    # ------------------------------------------------------------------

    async def list_opportunities(
        self,
        organization_id: str,
        category: Optional[str] = None,
        active_only: bool = True,
        search: Optional[str] = None,
    ) -> List[GrantOpportunity]:
        query = select(GrantOpportunity).where(
            GrantOpportunity.organization_id == organization_id
        )
        if active_only:
            query = query.where(GrantOpportunity.is_active.is_(True))
        if category:
            query = query.where(GrantOpportunity.category == category)
        if search:
            safe = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{safe}%"
            query = query.where(
                (GrantOpportunity.name.ilike(pattern, escape="\\"))
                | (GrantOpportunity.agency.ilike(pattern, escape="\\"))
                | (GrantOpportunity.description.ilike(pattern, escape="\\"))
            )
        query = query.order_by(*nulls_last_asc(GrantOpportunity.deadline_date))
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_opportunity(
        self, opportunity_id: str, organization_id: str
    ) -> Optional[GrantOpportunity]:
        result = await self.db.execute(
            select(GrantOpportunity).where(
                GrantOpportunity.id == opportunity_id,
                GrantOpportunity.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_opportunity(
        self, organization_id: str, data: Dict[str, Any], user_id: str
    ) -> GrantOpportunity:
        opportunity = GrantOpportunity(
            organization_id=organization_id,
            created_by=user_id,
            **data,
        )
        self.db.add(opportunity)
        await self.db.flush()
        await self._audit(
            "grant_opportunity_created",
            {"opportunity_id": opportunity.id, "name": opportunity.name},
            user_id=user_id,
        )
        # Server-side `created_at` / `updated_at` stay expired after the flush,
        # and the response_model requires both. Pydantic reads attributes
        # synchronously, so the lazy reload raises MissingGreenlet and the POST
        # 500s on a row it did create.
        await self.db.refresh(opportunity)
        return opportunity

    async def update_opportunity(
        self,
        opportunity_id: str,
        organization_id: str,
        data: Dict[str, Any],
    ) -> Optional[GrantOpportunity]:
        opportunity = await self.get_opportunity(opportunity_id, organization_id)
        if not opportunity:
            return None
        for key, value in data.items():
            setattr(opportunity, key, value)
        await self.db.flush()
        return opportunity

    async def delete_opportunity(
        self, opportunity_id: str, organization_id: str
    ) -> bool:
        opportunity = await self.get_opportunity(opportunity_id, organization_id)
        if not opportunity:
            return False
        await self.db.delete(opportunity)
        await self.db.flush()
        return True

    # ------------------------------------------------------------------
    # Grant Applications
    # ------------------------------------------------------------------

    async def list_applications(
        self,
        organization_id: str,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        assigned_to: Optional[str] = None,
    ) -> List[GrantApplication]:
        query = (
            select(GrantApplication)
            .where(GrantApplication.organization_id == organization_id)
            .options(
                selectinload(GrantApplication.budget_items),
                selectinload(GrantApplication.compliance_tasks),
            )
        )
        if status:
            query = query.where(GrantApplication.application_status == status)
        if priority:
            query = query.where(GrantApplication.priority == priority)
        if assigned_to:
            query = query.where(GrantApplication.assigned_to == assigned_to)
        query = query.order_by(GrantApplication.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().unique().all())

    async def get_application(
        self, application_id: str, organization_id: str
    ) -> Optional[GrantApplication]:
        result = await self.db.execute(
            select(GrantApplication)
            .where(
                GrantApplication.id == application_id,
                GrantApplication.organization_id == organization_id,
            )
            .options(
                selectinload(GrantApplication.budget_items),
                selectinload(GrantApplication.expenditures),
                selectinload(GrantApplication.compliance_tasks),
                selectinload(GrantApplication.grant_notes),
                selectinload(GrantApplication.opportunity),
            )
        )
        return result.scalar_one_or_none()

    async def _opportunity_in_org(
        self, opportunity_id: Any, organization_id: str
    ) -> bool:
        """Whether a grant opportunity is in the org.

        `opportunity_id` is client-supplied and is eager-loaded into the
        application response and read by `_generate_compliance_tasks`
        (`opportunity.category`) — a foreign id would leak another org's
        opportunity fields and drive task generation, so validate it in-org.
        """
        if not opportunity_id:
            return False
        result = await self.db.execute(
            select(GrantOpportunity.id).where(
                GrantOpportunity.id == str(opportunity_id),
                GrantOpportunity.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none() is not None

    async def _validate_application_fks(
        self, data: Dict[str, Any], organization_id: str
    ) -> None:
        """GF-6: client-supplied FK ids on an application must be in the org.

        ``opportunity_id`` was already validated (GF-4, read-leak); these three
        are stored-only FKs — a foreign ``linked_campaign_id`` /
        ``assigned_to`` / ``approved_by`` would persist a dangling/mis-attributed
        reference. ``allow_none`` so clearing or omitting a field is fine.
        """
        await assert_in_org(
            self.db,
            FundraisingCampaign,
            data.get("linked_campaign_id"),
            organization_id,
            allow_none=True,
            label="Linked campaign",
        )
        await assert_in_org(
            self.db,
            User,
            data.get("assigned_to"),
            organization_id,
            allow_none=True,
            label="Assigned user",
        )
        await assert_in_org(
            self.db,
            User,
            data.get("approved_by"),
            organization_id,
            allow_none=True,
            label="Approver",
        )

    async def create_application(
        self, organization_id: str, data: Dict[str, Any], user_id: str
    ) -> GrantApplication:
        if data.get("opportunity_id") and not await self._opportunity_in_org(
            data["opportunity_id"], organization_id
        ):
            raise ValueError("Grant opportunity not found")
        await self._validate_application_fks(data, organization_id)
        application = GrantApplication(
            organization_id=organization_id,
            created_by=user_id,
            **data,
        )
        self.db.add(application)
        await self.db.flush()

        # Create initial status note
        note = GrantNote(
            application_id=application.id,
            note_type=GrantNoteType.STATUS_CHANGE,
            content=(
                "Application created with status: "
                f"{_status_value(application.application_status)}"
            ),
            note_metadata={"new_status": _status_value(application.application_status)},
            created_by=user_id,
        )
        self.db.add(note)

        await self._audit(
            "grant_application_created",
            {
                "application_id": application.id,
                "program": application.grant_program_name,
            },
            user_id=user_id,
        )
        await self.db.flush()
        return application

    async def update_application(
        self,
        application_id: str,
        organization_id: str,
        data: Dict[str, Any],
        user_id: str,
    ) -> Optional[GrantApplication]:
        application = await self.get_application(application_id, organization_id)
        if not application:
            return None

        if data.get("opportunity_id") and not await self._opportunity_in_org(
            data["opportunity_id"], organization_id
        ):
            raise ValueError("Grant opportunity not found")
        await self._validate_application_fks(data, organization_id)

        old_status = application.application_status

        for key, value in data.items():
            setattr(application, key, value)

        # Log status change
        new_status = application.application_status
        if old_status != new_status:
            note = GrantNote(
                application_id=application.id,
                note_type=GrantNoteType.STATUS_CHANGE,
                content=(
                    f"Status changed from {_status_value(old_status)} "
                    f"to {_status_value(new_status)}"
                ),
                note_metadata={
                    "old_status": _status_value(old_status),
                    "new_status": _status_value(new_status),
                },
                created_by=user_id,
            )
            self.db.add(note)

            # Auto-generate compliance tasks when status changes to "awarded"
            if new_status == ApplicationStatus.AWARDED:
                await self._generate_compliance_tasks(application, user_id)

            await self._audit(
                "grant_application_status_changed",
                {
                    "application_id": application.id,
                    "old_status": _status_value(old_status),
                    "new_status": _status_value(new_status),
                },
                user_id=user_id,
            )

        await self.db.flush()
        return application

    async def _generate_compliance_tasks(
        self, application: GrantApplication, user_id: str
    ) -> None:
        """Auto-generate standard compliance tasks when a grant is awarded."""
        tasks_to_create = []

        # Generate periodic performance reports based on reporting frequency
        if application.reporting_frequency and application.grant_start_date:
            from dateutil.relativedelta import relativedelta

            freq_map = {
                "monthly": relativedelta(months=1),
                "quarterly": relativedelta(months=3),
                "semi_annual": relativedelta(months=6),
                "annual": relativedelta(years=1),
            }
            delta = freq_map.get(_status_value(application.reporting_frequency))
            if delta and application.grant_end_date:
                report_date = application.grant_start_date + delta
                report_num = 1
                while report_date <= application.grant_end_date:
                    tasks_to_create.append(
                        GrantComplianceTask(
                            application_id=application.id,
                            task_type="performance_report",
                            title=f"Performance Report #{report_num}",
                            description=(
                                f"Submit {_status_value(application.reporting_frequency)} "
                                f"performance report to grantor."
                            ),
                            due_date=report_date,
                            status=ComplianceTaskStatus.PENDING,
                            priority="medium",
                            reminder_days_before=14,
                            report_template=(
                                "Include: progress toward objectives, "
                                "expenditure summary, challenges encountered, "
                                "equipment/services acquired, community impact."
                            ),
                            created_by=user_id,
                        )
                    )
                    report_date += delta
                    report_num += 1

        # Final closeout report
        if application.grant_end_date:
            from dateutil.relativedelta import relativedelta

            tasks_to_create.append(
                GrantComplianceTask(
                    application_id=application.id,
                    task_type="closeout_report",
                    title="Grant Closeout Report",
                    description=(
                        "Submit final closeout report with complete financial "
                        "accounting and project outcomes."
                    ),
                    due_date=application.grant_end_date + relativedelta(days=90),
                    status=ComplianceTaskStatus.PENDING,
                    priority="high",
                    reminder_days_before=30,
                    report_template=(
                        "Include: final financial report, equipment inventory, "
                        "project outcomes, lessons learned, remaining funds "
                        "disposition."
                    ),
                    created_by=user_id,
                )
            )

        # Equipment inventory if it's an equipment grant
        if application.opportunity and application.opportunity.category in (
            "equipment",
            "vehicles",
        ):
            tasks_to_create.append(
                GrantComplianceTask(
                    application_id=application.id,
                    task_type="equipment_inventory",
                    title="Grant-Funded Equipment Inventory",
                    description=(
                        "Complete inventory of all equipment purchased with "
                        "grant funds. Include serial numbers, location, and "
                        "condition."
                    ),
                    due_date=(
                        application.grant_end_date
                        if application.grant_end_date
                        else date.today()
                    ),
                    status=ComplianceTaskStatus.PENDING,
                    priority="medium",
                    reminder_days_before=30,
                    created_by=user_id,
                )
            )

        for task in tasks_to_create:
            self.db.add(task)

        if tasks_to_create:
            note = GrantNote(
                application_id=application.id,
                note_type=GrantNoteType.COMPLIANCE,
                content=(
                    f"Auto-generated {len(tasks_to_create)} compliance "
                    f"tasks based on grant award."
                ),
                created_by=user_id,
            )
            self.db.add(note)

    async def delete_application(
        self, application_id: str, organization_id: str, user_id: str
    ) -> bool:
        application = await self.get_application(application_id, organization_id)
        if not application:
            return False

        await self._audit(
            "grant_application_deleted",
            {
                "application_id": application.id,
                "program": application.grant_program_name,
            },
            severity="warning",
            user_id=user_id,
        )
        await self.db.delete(application)
        await self.db.flush()
        return True

    # ------------------------------------------------------------------
    # Budget Items
    # ------------------------------------------------------------------

    async def list_budget_items(
        self, application_id: str, organization_id: str
    ) -> List[GrantBudgetItem]:
        # Verify application belongs to org
        app = await self.get_application(application_id, organization_id)
        if not app:
            raise ValueError("Application not found")
        result = await self.db.execute(
            select(GrantBudgetItem)
            .where(GrantBudgetItem.application_id == application_id)
            .order_by(GrantBudgetItem.sort_order.asc())
        )
        return list(result.scalars().all())

    async def create_budget_item(
        self, application_id: str, organization_id: str, data: Dict[str, Any]
    ) -> GrantBudgetItem:
        app = await self.get_application(application_id, organization_id)
        if not app:
            raise ValueError("Application not found")
        item = GrantBudgetItem(application_id=application_id, **data)
        self.db.add(item)
        await self.db.flush()
        return item

    async def update_budget_item(
        self, item_id: str, data: Dict[str, Any], organization_id: str
    ) -> Optional[GrantBudgetItem]:
        # Scope by org via the parent application: a budget item is only
        # reachable if its application belongs to the caller's organization,
        # otherwise this is a cross-org IDOR (fundraising.manage is not
        # org-specific).
        result = await self.db.execute(
            select(GrantBudgetItem)
            .join(
                GrantApplication,
                GrantBudgetItem.application_id == GrantApplication.id,
            )
            .where(
                GrantBudgetItem.id == item_id,
                GrantApplication.organization_id == organization_id,
            )
        )
        item = result.scalar_one_or_none()
        if not item:
            return None
        for key, value in data.items():
            setattr(item, key, value)
        await self.db.flush()
        return item

    async def delete_budget_item(self, item_id: str, organization_id: str) -> bool:
        result = await self.db.execute(
            select(GrantBudgetItem)
            .join(
                GrantApplication,
                GrantBudgetItem.application_id == GrantApplication.id,
            )
            .where(
                GrantBudgetItem.id == item_id,
                GrantApplication.organization_id == organization_id,
            )
        )
        item = result.scalar_one_or_none()
        if not item:
            return False
        await self.db.delete(item)
        await self.db.flush()
        return True

    # ------------------------------------------------------------------
    # Expenditures
    # ------------------------------------------------------------------

    async def list_expenditures(
        self,
        application_id: str,
        organization_id: str,
        budget_item_id: Optional[str] = None,
    ) -> List[GrantExpenditure]:
        app = await self.get_application(application_id, organization_id)
        if not app:
            raise ValueError("Application not found")
        query = select(GrantExpenditure).where(
            GrantExpenditure.application_id == application_id
        )
        if budget_item_id:
            query = query.where(GrantExpenditure.budget_item_id == budget_item_id)
        query = query.order_by(GrantExpenditure.expenditure_date.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _budget_item_in_application(
        self, budget_item_id: Any, application_id: str
    ) -> bool:
        """Whether a budget item belongs to the given (org-verified) application.

        `budget_item_id` is client-supplied and feeds `_update_budget_item_spent`
        (which fetches and writes the budget item by id) — tying it to the
        already-org-scoped application prevents an expenditure from corrupting
        another org's budget line.
        """
        if not budget_item_id:
            return False
        result = await self.db.execute(
            select(GrantBudgetItem.id).where(
                GrantBudgetItem.id == str(budget_item_id),
                GrantBudgetItem.application_id == str(application_id),
            )
        )
        return result.scalar_one_or_none() is not None

    async def create_expenditure(
        self,
        application_id: str,
        organization_id: str,
        data: Dict[str, Any],
        user_id: str,
    ) -> GrantExpenditure:
        app = await self.get_application(application_id, organization_id)
        if not app:
            raise ValueError("Application not found")
        if data.get("budget_item_id") and not await self._budget_item_in_application(
            data["budget_item_id"], application_id
        ):
            raise ValueError("Budget item not found")
        expenditure = GrantExpenditure(
            application_id=application_id,
            created_by=user_id,
            **data,
        )
        self.db.add(expenditure)
        await self.db.flush()

        # Update budget item amount_spent if linked
        if expenditure.budget_item_id:
            await self._update_budget_item_spent(expenditure.budget_item_id)

        return expenditure

    async def update_expenditure(
        self, expenditure_id: str, data: Dict[str, Any], organization_id: str
    ) -> Optional[GrantExpenditure]:
        result = await self.db.execute(
            select(GrantExpenditure)
            .join(
                GrantApplication,
                GrantExpenditure.application_id == GrantApplication.id,
            )
            .where(
                GrantExpenditure.id == expenditure_id,
                GrantApplication.organization_id == organization_id,
            )
        )
        expenditure = result.scalar_one_or_none()
        if not expenditure:
            return None
        # A reassigned budget_item_id must belong to this expenditure's
        # (org-scoped) application before it feeds the recompute-write.
        if data.get("budget_item_id") and not await self._budget_item_in_application(
            data["budget_item_id"], expenditure.application_id
        ):
            raise ValueError("Budget item not found")
        old_budget_item_id = expenditure.budget_item_id
        for key, value in data.items():
            setattr(expenditure, key, value)
        await self.db.flush()

        # Recalculate budget item totals
        if old_budget_item_id:
            await self._update_budget_item_spent(old_budget_item_id)
        if (
            expenditure.budget_item_id
            and expenditure.budget_item_id != old_budget_item_id
        ):
            await self._update_budget_item_spent(expenditure.budget_item_id)

        return expenditure

    async def delete_expenditure(
        self, expenditure_id: str, organization_id: str
    ) -> bool:
        result = await self.db.execute(
            select(GrantExpenditure)
            .join(
                GrantApplication,
                GrantExpenditure.application_id == GrantApplication.id,
            )
            .where(
                GrantExpenditure.id == expenditure_id,
                GrantApplication.organization_id == organization_id,
            )
        )
        expenditure = result.scalar_one_or_none()
        if not expenditure:
            return False
        budget_item_id = expenditure.budget_item_id
        await self.db.delete(expenditure)
        await self.db.flush()
        if budget_item_id:
            await self._update_budget_item_spent(budget_item_id)
        return True

    async def _update_budget_item_spent(self, budget_item_id: str) -> None:
        """Recalculate total spent for a budget item from its expenditures."""
        result = await self.db.execute(
            select(func.coalesce(func.sum(GrantExpenditure.amount), 0)).where(
                GrantExpenditure.budget_item_id == budget_item_id
            )
        )
        total_spent = result.scalar()
        item_result = await self.db.execute(
            select(GrantBudgetItem).where(GrantBudgetItem.id == budget_item_id)
        )
        item = item_result.scalar_one_or_none()
        if item:
            item.amount_spent = total_spent
            item.amount_remaining = item.amount_budgeted - total_spent

    # ------------------------------------------------------------------
    # Compliance Tasks
    # ------------------------------------------------------------------

    async def list_compliance_tasks(
        self,
        organization_id: str,
        application_id: Optional[str] = None,
        status: Optional[str] = None,
        due_before: Optional[date] = None,
    ) -> List[GrantComplianceTask]:
        query = select(GrantComplianceTask).join(GrantApplication)
        query = query.where(GrantApplication.organization_id == organization_id)
        if application_id:
            query = query.where(GrantComplianceTask.application_id == application_id)
        if status:
            query = query.where(GrantComplianceTask.status == status)
        if due_before:
            query = query.where(GrantComplianceTask.due_date <= due_before)
        query = query.order_by(GrantComplianceTask.due_date.asc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create_compliance_task(
        self,
        application_id: str,
        organization_id: str,
        data: Dict[str, Any],
        user_id: str,
    ) -> GrantComplianceTask:
        app = await self.get_application(application_id, organization_id)
        if not app:
            raise ValueError("Application not found")
        task = GrantComplianceTask(
            application_id=application_id,
            created_by=user_id,
            **data,
        )
        self.db.add(task)
        await self.db.flush()
        return task

    async def update_compliance_task(
        self,
        task_id: str,
        data: Dict[str, Any],
        user_id: str,
        organization_id: str,
    ) -> Optional[GrantComplianceTask]:
        result = await self.db.execute(
            select(GrantComplianceTask)
            .join(
                GrantApplication,
                GrantComplianceTask.application_id == GrantApplication.id,
            )
            .where(
                GrantComplianceTask.id == task_id,
                GrantApplication.organization_id == organization_id,
            )
        )
        task = result.scalar_one_or_none()
        if not task:
            return None

        # XC-1: a client-supplied assignee must belong to the caller's org
        # before it is persisted (the create schema can't set it, but the
        # update schema can — validate the update path too).
        await assert_in_org(
            self.db,
            User,
            data.get("assigned_to"),
            organization_id,
            allow_none=True,
            label="Assigned user",
        )

        old_status = task.status
        for key, value in data.items():
            setattr(task, key, value)

        # Auto-set completed_date when marking as completed
        if (
            task.status == ComplianceTaskStatus.COMPLETED
            and old_status != ComplianceTaskStatus.COMPLETED
            and not task.completed_date
        ):
            task.completed_date = date.today()

        # Log completion as a grant note
        if (
            task.status == ComplianceTaskStatus.COMPLETED
            and old_status != ComplianceTaskStatus.COMPLETED
        ):
            note = GrantNote(
                application_id=task.application_id,
                note_type=GrantNoteType.COMPLIANCE,
                content=f"Compliance task completed: {task.title}",
                note_metadata={
                    "task_id": task.id,
                    "task_type": _status_value(task.task_type),
                },
                created_by=user_id,
            )
            self.db.add(note)

        await self.db.flush()
        return task

    async def delete_compliance_task(self, task_id: str, organization_id: str) -> bool:
        result = await self.db.execute(
            select(GrantComplianceTask)
            .join(
                GrantApplication,
                GrantComplianceTask.application_id == GrantApplication.id,
            )
            .where(
                GrantComplianceTask.id == task_id,
                GrantApplication.organization_id == organization_id,
            )
        )
        task = result.scalar_one_or_none()
        if not task:
            return False
        await self.db.delete(task)
        await self.db.flush()
        return True

    # ------------------------------------------------------------------
    # Grant Notes
    # ------------------------------------------------------------------

    async def list_notes(
        self, application_id: str, organization_id: str
    ) -> List[GrantNote]:
        # Scope through the parent application so notes from another org's
        # application can't be read by guessing its id.
        app = await self.get_application(application_id, organization_id)
        if not app:
            raise ValueError("Application not found")
        result = await self.db.execute(
            select(GrantNote)
            .where(GrantNote.application_id == application_id)
            .order_by(GrantNote.created_at.desc())
        )
        return list(result.scalars().all())

    async def create_note(
        self,
        application_id: str,
        data: Dict[str, Any],
        user_id: str,
        organization_id: str,
    ) -> GrantNote:
        # Verify the application belongs to the caller's org before attaching
        # a note, otherwise a note can be written onto another org's grant.
        app = await self.get_application(application_id, organization_id)
        if not app:
            raise ValueError("Application not found")
        note = GrantNote(
            application_id=application_id,
            created_by=user_id,
            **data,
        )
        self.db.add(note)
        await self.db.flush()
        return note

    # ------------------------------------------------------------------
    # Dashboard & Reporting
    # ------------------------------------------------------------------

    async def get_dashboard_data(self, organization_id: str) -> Dict[str, Any]:
        """Aggregate data for the grants dashboard."""
        today = date.today()

        # Active grants (status = active or reporting)
        active_statuses = [ApplicationStatus.ACTIVE, ApplicationStatus.REPORTING]
        active_grants_result = await self.db.execute(
            select(func.count(GrantApplication.id)).where(
                GrantApplication.organization_id == organization_id,
                GrantApplication.application_status.in_(
                    [s.value for s in active_statuses]
                ),
            )
        )
        active_grants = active_grants_result.scalar() or 0

        # Pending applications
        pending_statuses = [
            ApplicationStatus.RESEARCHING,
            ApplicationStatus.PREPARING,
            ApplicationStatus.INTERNAL_REVIEW,
            ApplicationStatus.SUBMITTED,
            ApplicationStatus.UNDER_REVIEW,
        ]
        pending_result = await self.db.execute(
            select(func.count(GrantApplication.id)).where(
                GrantApplication.organization_id == organization_id,
                GrantApplication.application_status.in_(
                    [s.value for s in pending_statuses]
                ),
            )
        )
        pending_applications = pending_result.scalar() or 0

        # Total grant funding (awarded)
        funding_result = await self.db.execute(
            select(func.coalesce(func.sum(GrantApplication.amount_awarded), 0)).where(
                GrantApplication.organization_id == organization_id,
                GrantApplication.application_status.in_(
                    [
                        s.value
                        for s in [
                            ApplicationStatus.AWARDED,
                            ApplicationStatus.ACTIVE,
                            ApplicationStatus.REPORTING,
                            ApplicationStatus.CLOSED,
                        ]
                    ]
                ),
            )
        )
        total_grant_funding = funding_result.scalar() or Decimal("0")

        # Upcoming deadlines (opportunities within 90 days)
        from datetime import timedelta

        deadline_cutoff = today + timedelta(days=90)
        upcoming_result = await self.db.execute(
            select(GrantOpportunity)
            .where(
                GrantOpportunity.organization_id == organization_id,
                GrantOpportunity.is_active.is_(True),
                GrantOpportunity.deadline_date.isnot(None),
                GrantOpportunity.deadline_date >= today,
                GrantOpportunity.deadline_date <= deadline_cutoff,
            )
            .order_by(GrantOpportunity.deadline_date.asc())
            .limit(10)
        )
        upcoming_deadlines = list(upcoming_result.scalars().all())

        # Compliance tasks due in next 30 days
        compliance_cutoff = today + timedelta(days=30)
        compliance_result = await self.db.execute(
            select(GrantComplianceTask)
            .join(GrantApplication)
            .where(
                GrantApplication.organization_id == organization_id,
                GrantComplianceTask.status.in_(
                    [
                        ComplianceTaskStatus.PENDING.value,
                        ComplianceTaskStatus.IN_PROGRESS.value,
                    ]
                ),
                GrantComplianceTask.due_date <= compliance_cutoff,
            )
            .order_by(GrantComplianceTask.due_date.asc())
            .limit(10)
        )
        compliance_tasks_due = list(compliance_result.scalars().all())

        # Grant pipeline summary by status
        pipeline_result = await self.db.execute(
            select(
                GrantApplication.application_status,
                func.count(GrantApplication.id),
                func.coalesce(func.sum(GrantApplication.amount_requested), 0),
            )
            .where(GrantApplication.organization_id == organization_id)
            .group_by(GrantApplication.application_status)
        )
        pipeline_summary = [
            {
                "status": row[0].value if hasattr(row[0], "value") else row[0],
                "count": row[1],
                "total_requested": float(row[2]),
            }
            for row in pipeline_result.all()
        ]

        return {
            "active_grants": active_grants,
            "pending_applications": pending_applications,
            "total_grant_funding": float(total_grant_funding),
            "upcoming_deadlines": upcoming_deadlines,
            "compliance_tasks_due": compliance_tasks_due,
            "pipeline_summary": pipeline_summary,
        }

    async def get_grant_report(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        """Generate a comprehensive grant report."""
        query = select(GrantApplication).where(
            GrantApplication.organization_id == organization_id
        )
        if start_date:
            query = query.where(GrantApplication.created_at >= start_date)
        if end_date:
            query = query.where(GrantApplication.created_at <= end_date)

        result = await self.db.execute(
            query.options(
                selectinload(GrantApplication.budget_items),
                selectinload(GrantApplication.expenditures),
                selectinload(GrantApplication.compliance_tasks),
            )
        )
        applications = list(result.scalars().unique().all())

        total_requested = sum(float(a.amount_requested or 0) for a in applications)
        total_awarded = sum(
            float(a.amount_awarded or 0)
            for a in applications
            if a.application_status
            in (
                ApplicationStatus.AWARDED,
                ApplicationStatus.ACTIVE,
                ApplicationStatus.REPORTING,
                ApplicationStatus.CLOSED,
            )
        )
        total_spent = sum(
            sum(float(e.amount) for e in a.expenditures) for a in applications
        )

        awarded_count = sum(
            1
            for a in applications
            if a.application_status
            in (
                ApplicationStatus.AWARDED,
                ApplicationStatus.ACTIVE,
                ApplicationStatus.REPORTING,
                ApplicationStatus.CLOSED,
            )
        )
        denied_count = sum(
            1 for a in applications if a.application_status == ApplicationStatus.DENIED
        )
        total_decided = awarded_count + denied_count
        success_rate = (awarded_count / total_decided * 100) if total_decided > 0 else 0

        # Compliance task summary
        all_tasks = []
        for a in applications:
            all_tasks.extend(a.compliance_tasks)
        tasks_completed = sum(
            1 for t in all_tasks if t.status == ComplianceTaskStatus.COMPLETED
        )
        tasks_overdue = sum(
            1 for t in all_tasks if t.status == ComplianceTaskStatus.OVERDUE
        )
        tasks_pending = sum(
            1
            for t in all_tasks
            if t.status
            in (ComplianceTaskStatus.PENDING, ComplianceTaskStatus.IN_PROGRESS)
        )

        # Spending by budget category
        spending_by_category: Dict[str, float] = {}
        for a in applications:
            for item in a.budget_items:
                cat = (
                    item.category.value
                    if hasattr(item.category, "value")
                    else item.category
                )
                spending_by_category[cat] = spending_by_category.get(cat, 0) + float(
                    item.amount_spent or 0
                )

        return {
            "total_applications": len(applications),
            "total_requested": total_requested,
            "total_awarded": total_awarded,
            "total_spent": total_spent,
            "success_rate": round(success_rate, 1),
            "awarded_count": awarded_count,
            "denied_count": denied_count,
            "compliance_summary": {
                "total_tasks": len(all_tasks),
                "completed": tasks_completed,
                "overdue": tasks_overdue,
                "pending": tasks_pending,
            },
            "spending_by_category": spending_by_category,
        }
