"""
Finance Service

Business logic for fiscal years, budgets, purchase requests,
expense reports, check requests, dues, approval chains,
and QuickBooks export.
"""

import csv
import io
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from loguru import logger
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.finance import (
    ApprovalChain,
    ApprovalChainStep,
    ApprovalEntityType,
    ApprovalStepRecord,
    ApprovalStepStatus,
    ApprovalStepType,
    Budget,
    BudgetCategory,
    CheckRequest,
    CheckRequestStatus,
    DuesSchedule,
    DuesStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    ExportLog,
    ExportMapping,
    FiscalYear,
    FiscalYearStatus,
    MemberDues,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.models.user import User


class FinanceService:
    """Core finance business logic"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ========================================
    # Fiscal Years
    # ========================================

    async def list_fiscal_years(self, org_id: str) -> list[FiscalYear]:
        result = await self.db.execute(
            select(FiscalYear)
            .where(FiscalYear.organization_id == org_id)
            .order_by(FiscalYear.start_date.desc())
        )
        return list(result.scalars().all())

    async def get_fiscal_year(
        self, fy_id: str, org_id: str
    ) -> Optional[FiscalYear]:
        result = await self.db.execute(
            select(FiscalYear).where(
                FiscalYear.id == fy_id,
                FiscalYear.organization_id == org_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_fiscal_year(
        self, org_id: str, created_by: str, **kwargs
    ) -> FiscalYear:
        fy = FiscalYear(
            organization_id=org_id, created_by=created_by, **kwargs
        )
        self.db.add(fy)
        await self.db.flush()
        await self.db.refresh(fy, ["created_at", "updated_at"])
        logger.info("Created fiscal year %s for org %s", fy.id, org_id)
        return fy

    async def update_fiscal_year(
        self, fy_id: str, org_id: str, **kwargs
    ) -> FiscalYear:
        fy = await self.get_fiscal_year(fy_id, org_id)
        if not fy:
            raise ValueError("Fiscal year not found")
        if fy.is_locked:
            raise ValueError("Fiscal year is locked and cannot be modified")
        for key, value in kwargs.items():
            if value is not None:
                setattr(fy, key, value)
        await self.db.flush()
        await self.db.refresh(fy, ["updated_at"])
        return fy

    async def activate_fiscal_year(
        self, fy_id: str, org_id: str
    ) -> FiscalYear:
        fy = await self.get_fiscal_year(fy_id, org_id)
        if not fy:
            raise ValueError("Fiscal year not found")

        # Deactivate any currently active fiscal year
        result = await self.db.execute(
            select(FiscalYear).where(
                FiscalYear.organization_id == org_id,
                FiscalYear.status == FiscalYearStatus.ACTIVE,
                FiscalYear.id != fy_id,
            )
        )
        for active_fy in result.scalars().all():
            active_fy.status = FiscalYearStatus.CLOSED

        fy.status = FiscalYearStatus.ACTIVE
        await self.db.flush()
        await self.db.refresh(fy, ["updated_at"])
        logger.info("Activated fiscal year %s for org %s", fy_id, org_id)
        return fy

    async def lock_fiscal_year(
        self, fy_id: str, org_id: str
    ) -> FiscalYear:
        fy = await self.get_fiscal_year(fy_id, org_id)
        if not fy:
            raise ValueError("Fiscal year not found")
        fy.is_locked = True
        fy.status = FiscalYearStatus.CLOSED
        await self.db.flush()
        await self.db.refresh(fy, ["updated_at"])
        logger.info("Locked fiscal year %s", fy_id)
        return fy

    async def get_active_fiscal_year(self, org_id: str) -> Optional[FiscalYear]:
        result = await self.db.execute(
            select(FiscalYear).where(
                FiscalYear.organization_id == org_id,
                FiscalYear.status == FiscalYearStatus.ACTIVE,
            )
        )
        return result.scalar_one_or_none()

    # ========================================
    # Budget Categories
    # ========================================

    async def list_budget_categories(
        self, org_id: str
    ) -> list[BudgetCategory]:
        result = await self.db.execute(
            select(BudgetCategory)
            .where(BudgetCategory.organization_id == org_id)
            .order_by(BudgetCategory.sort_order)
        )
        return list(result.scalars().all())

    async def get_budget_category(
        self, cat_id: str, org_id: str
    ) -> Optional[BudgetCategory]:
        result = await self.db.execute(
            select(BudgetCategory).where(
                BudgetCategory.id == cat_id,
                BudgetCategory.organization_id == org_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_budget_category(
        self, org_id: str, **kwargs
    ) -> BudgetCategory:
        cat = BudgetCategory(organization_id=org_id, **kwargs)
        self.db.add(cat)
        await self.db.flush()
        await self.db.refresh(cat, ["created_at", "updated_at"])
        return cat

    async def update_budget_category(
        self, cat_id: str, org_id: str, **kwargs
    ) -> BudgetCategory:
        cat = await self.get_budget_category(cat_id, org_id)
        if not cat:
            raise ValueError("Budget category not found")
        for key, value in kwargs.items():
            if value is not None:
                setattr(cat, key, value)
        await self.db.flush()
        await self.db.refresh(cat, ["updated_at"])
        return cat

    async def delete_budget_category(
        self, cat_id: str, org_id: str
    ) -> None:
        cat = await self.get_budget_category(cat_id, org_id)
        if not cat:
            raise ValueError("Budget category not found")
        await self.db.delete(cat)
        await self.db.flush()

    # ========================================
    # Budgets
    # ========================================

    async def list_budgets(
        self,
        org_id: str,
        fiscal_year_id: Optional[str] = None,
        category_id: Optional[str] = None,
    ) -> list[Budget]:
        query = select(Budget).where(Budget.organization_id == org_id)
        if fiscal_year_id:
            query = query.where(Budget.fiscal_year_id == fiscal_year_id)
        if category_id:
            query = query.where(Budget.category_id == category_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_budget(
        self, budget_id: str, org_id: str
    ) -> Optional[Budget]:
        result = await self.db.execute(
            select(Budget).where(
                Budget.id == budget_id,
                Budget.organization_id == org_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_budget(
        self, org_id: str, created_by: str, **kwargs
    ) -> Budget:
        budget = Budget(
            organization_id=org_id, created_by=created_by, **kwargs
        )
        self.db.add(budget)
        await self.db.flush()
        await self.db.refresh(budget, ["created_at", "updated_at"])
        return budget

    async def update_budget(
        self, budget_id: str, org_id: str, **kwargs
    ) -> Budget:
        budget = await self.get_budget(budget_id, org_id)
        if not budget:
            raise ValueError("Budget not found")
        for key, value in kwargs.items():
            if value is not None:
                setattr(budget, key, value)
        await self.db.flush()
        await self.db.refresh(budget, ["updated_at"])
        return budget

    async def get_budget_summary(
        self, org_id: str, fiscal_year_id: str
    ) -> dict:
        result = await self.db.execute(
            select(
                func.coalesce(func.sum(Budget.amount_budgeted), 0).label(
                    "total_budgeted"
                ),
                func.coalesce(func.sum(Budget.amount_spent), 0).label(
                    "total_spent"
                ),
                func.coalesce(func.sum(Budget.amount_encumbered), 0).label(
                    "total_encumbered"
                ),
            ).where(
                Budget.organization_id == org_id,
                Budget.fiscal_year_id == fiscal_year_id,
            )
        )
        row = result.one()
        total_budgeted = float(row.total_budgeted)
        total_spent = float(row.total_spent)
        total_encumbered = float(row.total_encumbered)
        total_remaining = total_budgeted - total_spent - total_encumbered
        percent_used = (
            (total_spent / total_budgeted * 100) if total_budgeted > 0 else 0
        )
        return {
            "total_budgeted": total_budgeted,
            "total_spent": total_spent,
            "total_encumbered": total_encumbered,
            "total_remaining": total_remaining,
            "percent_used": round(percent_used, 2),
            "category_breakdown": [],
        }

    # ========================================
    # Approval Chains
    # ========================================

    async def list_approval_chains(
        self, org_id: str
    ) -> list[ApprovalChain]:
        result = await self.db.execute(
            select(ApprovalChain)
            .options(selectinload(ApprovalChain.steps))
            .where(ApprovalChain.organization_id == org_id)
            .order_by(ApprovalChain.name)
        )
        return list(result.scalars().unique().all())

    async def get_approval_chain(
        self, chain_id: str, org_id: str
    ) -> Optional[ApprovalChain]:
        result = await self.db.execute(
            select(ApprovalChain)
            .options(selectinload(ApprovalChain.steps))
            .where(
                ApprovalChain.id == chain_id,
                ApprovalChain.organization_id == org_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_approval_chain(
        self, org_id: str, created_by: str, steps: Optional[list] = None, **kwargs
    ) -> ApprovalChain:
        chain = ApprovalChain(
            organization_id=org_id, created_by=created_by, **kwargs
        )
        self.db.add(chain)
        await self.db.flush()

        if steps:
            for step_data in steps:
                step = ApprovalChainStep(chain_id=chain.id, **step_data)
                self.db.add(step)
            await self.db.flush()

        await self.db.refresh(chain, ["created_at", "updated_at"])
        # Reload with steps
        return await self.get_approval_chain(chain.id, org_id)

    async def update_approval_chain(
        self, chain_id: str, org_id: str, **kwargs
    ) -> ApprovalChain:
        chain = await self.get_approval_chain(chain_id, org_id)
        if not chain:
            raise ValueError("Approval chain not found")
        for key, value in kwargs.items():
            if value is not None:
                setattr(chain, key, value)
        await self.db.flush()
        await self.db.refresh(chain, ["updated_at"])
        return chain

    async def delete_approval_chain(
        self, chain_id: str, org_id: str
    ) -> None:
        chain = await self.get_approval_chain(chain_id, org_id)
        if not chain:
            raise ValueError("Approval chain not found")
        await self.db.delete(chain)
        await self.db.flush()

    async def add_chain_step(
        self, chain_id: str, org_id: str, **kwargs
    ) -> ApprovalChainStep:
        chain = await self.get_approval_chain(chain_id, org_id)
        if not chain:
            raise ValueError("Approval chain not found")
        step = ApprovalChainStep(chain_id=chain_id, **kwargs)
        self.db.add(step)
        await self.db.flush()
        await self.db.refresh(step, ["created_at"])
        return step

    async def update_chain_step(
        self, step_id: str, chain_id: str, org_id: str, **kwargs
    ) -> ApprovalChainStep:
        chain = await self.get_approval_chain(chain_id, org_id)
        if not chain:
            raise ValueError("Approval chain not found")
        result = await self.db.execute(
            select(ApprovalChainStep).where(
                ApprovalChainStep.id == step_id,
                ApprovalChainStep.chain_id == chain_id,
            )
        )
        step = result.scalar_one_or_none()
        if not step:
            raise ValueError("Approval chain step not found")
        for key, value in kwargs.items():
            if value is not None:
                setattr(step, key, value)
        await self.db.flush()
        return step

    async def delete_chain_step(
        self, step_id: str, chain_id: str, org_id: str
    ) -> None:
        chain = await self.get_approval_chain(chain_id, org_id)
        if not chain:
            raise ValueError("Approval chain not found")
        result = await self.db.execute(
            select(ApprovalChainStep).where(
                ApprovalChainStep.id == step_id,
                ApprovalChainStep.chain_id == chain_id,
            )
        )
        step = result.scalar_one_or_none()
        if not step:
            raise ValueError("Approval chain step not found")
        await self.db.delete(step)
        await self.db.flush()

    async def resolve_approval_chain(
        self,
        org_id: str,
        entity_type: ApprovalEntityType,
        amount: float,
        budget_category_id: Optional[str] = None,
    ) -> Optional[ApprovalChain]:
        """Find the most specific matching approval chain"""
        query = (
            select(ApprovalChain)
            .options(selectinload(ApprovalChain.steps))
            .where(
                ApprovalChain.organization_id == org_id,
                ApprovalChain.is_active == True,  # noqa: E712
                or_(
                    ApprovalChain.applies_to == entity_type,
                    ApprovalChain.applies_to == ApprovalEntityType.PURCHASE_REQUEST,
                ),
            )
        )
        result = await self.db.execute(query)
        chains = list(result.scalars().unique().all())

        if not chains:
            return None

        # Score chains by specificity
        best_chain = None
        best_score = -1

        for chain in chains:
            score = 0
            # Must match entity type
            if (
                chain.applies_to != entity_type
                and chain.applies_to != ApprovalEntityType.PURCHASE_REQUEST
            ):
                continue

            # Check amount range
            if chain.min_amount is not None and amount < float(chain.min_amount):
                continue
            if chain.max_amount is not None and amount > float(chain.max_amount):
                continue

            # Score by specificity
            if chain.budget_category_id and chain.budget_category_id == budget_category_id:
                score += 4
            elif chain.budget_category_id and chain.budget_category_id != budget_category_id:
                continue  # Category mismatch

            if chain.min_amount is not None or chain.max_amount is not None:
                score += 2

            if chain.is_default:
                score += 1

            if score > best_score:
                best_score = score
                best_chain = chain

        return best_chain

    async def create_approval_records(
        self,
        chain: ApprovalChain,
        entity_type: ApprovalEntityType,
        entity_id: str,
        amount: float,
        requester_id: str,
    ) -> list[ApprovalStepRecord]:
        """Create step records for an entity going through an approval chain"""
        records = []
        for step in chain.steps:
            status = ApprovalStepStatus.PENDING

            # Auto-approve if amount is under threshold
            if (
                step.step_type == ApprovalStepType.APPROVAL
                and step.auto_approve_under is not None
                and amount < float(step.auto_approve_under)
            ):
                status = ApprovalStepStatus.AUTO_APPROVED

            # Notification steps are auto-sent (will be processed later)
            if step.step_type == ApprovalStepType.NOTIFICATION:
                status = ApprovalStepStatus.PENDING  # Will be sent when reached

            record = ApprovalStepRecord(
                chain_id=chain.id,
                step_id=step.id,
                entity_type=entity_type,
                entity_id=entity_id,
                status=status,
            )

            # Generate token for EMAIL approver type
            if (
                step.step_type == ApprovalStepType.APPROVAL
                and step.approver_type
                and step.approver_type.value == "email"
            ):
                record.approval_token = secrets.token_urlsafe(32)
                record.token_expires_at = datetime.now(timezone.utc) + timedelta(
                    days=7
                )

            self.db.add(record)
            records.append(record)

        await self.db.flush()
        return records

    async def get_approval_records(
        self, entity_type: ApprovalEntityType, entity_id: str
    ) -> list[ApprovalStepRecord]:
        result = await self.db.execute(
            select(ApprovalStepRecord)
            .options(selectinload(ApprovalStepRecord.step))
            .where(
                ApprovalStepRecord.entity_type == entity_type,
                ApprovalStepRecord.entity_id == entity_id,
            )
            .order_by(ApprovalStepRecord.created_at)
        )
        return list(result.scalars().all())

    async def get_current_pending_step(
        self, entity_type: ApprovalEntityType, entity_id: str
    ) -> Optional[ApprovalStepRecord]:
        """Get the first non-completed step for an entity"""
        records = await self.get_approval_records(entity_type, entity_id)
        for record in records:
            if record.status == ApprovalStepStatus.PENDING:
                return record
        return None

    async def approve_step(
        self, step_record_id: str, approver_id: str, notes: Optional[str] = None
    ) -> ApprovalStepRecord:
        result = await self.db.execute(
            select(ApprovalStepRecord)
            .options(selectinload(ApprovalStepRecord.step))
            .where(ApprovalStepRecord.id == step_record_id)
        )
        record = result.scalar_one_or_none()
        if not record:
            raise ValueError("Approval step record not found")
        if record.status != ApprovalStepStatus.PENDING:
            raise ValueError("This step is not pending approval")

        now = datetime.now(timezone.utc)
        record.status = ApprovalStepStatus.APPROVED
        record.acted_by = approver_id
        record.acted_at = now
        record.notes = notes

        await self.db.flush()

        # Process next steps (advance notification steps automatically)
        await self._advance_notification_steps(
            record.entity_type, record.entity_id
        )

        # Check if all steps are complete
        all_complete = await self._check_all_steps_complete(
            record.entity_type, record.entity_id
        )
        if all_complete:
            await self._finalize_approval(
                record.entity_type, record.entity_id, approver_id
            )

        logger.info(
            "Approval step %s approved by %s", step_record_id, approver_id
        )
        return record

    async def deny_step(
        self, step_record_id: str, denier_id: str, notes: Optional[str] = None
    ) -> ApprovalStepRecord:
        result = await self.db.execute(
            select(ApprovalStepRecord)
            .options(selectinload(ApprovalStepRecord.step))
            .where(ApprovalStepRecord.id == step_record_id)
        )
        record = result.scalar_one_or_none()
        if not record:
            raise ValueError("Approval step record not found")
        if record.status != ApprovalStepStatus.PENDING:
            raise ValueError("This step is not pending approval")

        now = datetime.now(timezone.utc)
        record.status = ApprovalStepStatus.DENIED
        record.acted_by = denier_id
        record.acted_at = now
        record.notes = notes

        # Deny the entire entity
        await self._finalize_denial(
            record.entity_type, record.entity_id, denier_id, notes
        )

        await self.db.flush()
        logger.info(
            "Approval step %s denied by %s", step_record_id, denier_id
        )
        return record

    async def approve_by_token(
        self, token: str, notes: Optional[str] = None
    ) -> ApprovalStepRecord:
        """Approve a step via email token (for external approvers)"""
        result = await self.db.execute(
            select(ApprovalStepRecord).where(
                ApprovalStepRecord.approval_token == token
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            raise ValueError("Invalid approval token")
        if record.status != ApprovalStepStatus.PENDING:
            raise ValueError("This step has already been acted on")
        if (
            record.token_expires_at
            and record.token_expires_at < datetime.now(timezone.utc)
        ):
            raise ValueError("Approval token has expired")

        now = datetime.now(timezone.utc)
        record.status = ApprovalStepStatus.APPROVED
        record.acted_at = now
        record.notes = notes

        await self.db.flush()
        await self._advance_notification_steps(
            record.entity_type, record.entity_id
        )
        all_complete = await self._check_all_steps_complete(
            record.entity_type, record.entity_id
        )
        if all_complete:
            await self._finalize_approval(
                record.entity_type, record.entity_id, None
            )

        return record

    async def deny_by_token(
        self, token: str, notes: Optional[str] = None
    ) -> ApprovalStepRecord:
        """Deny a step via email token (for external approvers)"""
        result = await self.db.execute(
            select(ApprovalStepRecord).where(
                ApprovalStepRecord.approval_token == token
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            raise ValueError("Invalid approval token")
        if record.status != ApprovalStepStatus.PENDING:
            raise ValueError("This step has already been acted on")
        if (
            record.token_expires_at
            and record.token_expires_at < datetime.now(timezone.utc)
        ):
            raise ValueError("Approval token has expired")

        record.status = ApprovalStepStatus.DENIED
        record.acted_at = datetime.now(timezone.utc)
        record.notes = notes

        await self._finalize_denial(
            record.entity_type, record.entity_id, None, notes
        )
        await self.db.flush()
        return record

    async def get_pending_approvals(
        self, user_id: str, org_id: str
    ) -> list[dict]:
        """Get all pending approval steps for the current user"""
        result = await self.db.execute(
            select(ApprovalStepRecord)
            .options(selectinload(ApprovalStepRecord.step))
            .where(ApprovalStepRecord.status == ApprovalStepStatus.PENDING)
        )
        pending_records = list(result.scalars().all())

        approvals = []
        for record in pending_records:
            # Determine entity details
            entity_info = await self._get_entity_info(
                record.entity_type, record.entity_id, org_id
            )
            if not entity_info:
                continue

            # Check if this step is the current active step
            current_step = await self.get_current_pending_step(
                record.entity_type, record.entity_id
            )
            if not current_step or current_step.id != record.id:
                continue

            step_name = record.step.name if record.step else "Unknown"
            step_order = record.step.step_order if record.step else 0

            approvals.append({
                "step_record_id": record.id,
                "entity_type": record.entity_type.value,
                "entity_id": record.entity_id,
                "entity_title": entity_info.get("title", ""),
                "entity_amount": entity_info.get("amount", 0),
                "requester_name": entity_info.get("requester_name", ""),
                "step_name": step_name,
                "step_order": step_order,
                "submitted_at": entity_info.get("submitted_at", record.created_at),
            })

        return approvals

    async def preview_approval_chain(
        self,
        org_id: str,
        entity_type: str,
        amount: float,
        category_id: Optional[str] = None,
    ) -> Optional[ApprovalChain]:
        """Preview which chain would be selected for given parameters"""
        try:
            et = ApprovalEntityType(entity_type)
        except ValueError:
            raise ValueError(f"Invalid entity type: {entity_type}")
        return await self.resolve_approval_chain(
            org_id, et, amount, category_id
        )

    async def _advance_notification_steps(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
    ) -> None:
        """Auto-advance any notification steps that are now reachable"""
        records = await self.get_approval_records(entity_type, entity_id)
        for record in records:
            if record.status != ApprovalStepStatus.PENDING:
                continue
            if not record.step:
                continue
            if record.step.step_type == ApprovalStepType.NOTIFICATION:
                # All prior steps must be complete
                prior_complete = True
                for prior in records:
                    if prior.step and prior.step.step_order < record.step.step_order:
                        if prior.status in (
                            ApprovalStepStatus.PENDING,
                        ):
                            prior_complete = False
                            break
                if prior_complete:
                    record.status = ApprovalStepStatus.SENT
                    record.acted_at = datetime.now(timezone.utc)
                    # In production, trigger email sending here
                    logger.info(
                        "Notification step %s auto-sent for %s %s",
                        record.id,
                        entity_type.value,
                        entity_id,
                    )

    async def _check_all_steps_complete(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
    ) -> bool:
        records = await self.get_approval_records(entity_type, entity_id)
        for record in records:
            if record.status == ApprovalStepStatus.PENDING:
                return False
        return True

    async def _finalize_approval(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        approver_id: Optional[str],
    ) -> None:
        """Set the entity status to APPROVED and update denormalized fields"""
        now = datetime.now(timezone.utc)
        if entity_type == ApprovalEntityType.PURCHASE_REQUEST:
            result = await self.db.execute(
                select(PurchaseRequest).where(PurchaseRequest.id == entity_id)
            )
            entity = result.scalar_one_or_none()
            if entity:
                entity.status = PurchaseRequestStatus.APPROVED
                entity.approved_by = approver_id
                entity.approved_at = now
                # Encumber budget
                if entity.budget_id:
                    await self._encumber_budget(
                        entity.budget_id, float(entity.estimated_amount)
                    )
        elif entity_type == ApprovalEntityType.EXPENSE_REPORT:
            result = await self.db.execute(
                select(ExpenseReport).where(ExpenseReport.id == entity_id)
            )
            entity = result.scalar_one_or_none()
            if entity:
                entity.status = ExpenseReportStatus.APPROVED
                entity.approved_by = approver_id
                entity.approved_at = now
        elif entity_type == ApprovalEntityType.CHECK_REQUEST:
            result = await self.db.execute(
                select(CheckRequest).where(CheckRequest.id == entity_id)
            )
            entity = result.scalar_one_or_none()
            if entity:
                entity.status = CheckRequestStatus.APPROVED
                entity.approved_by = approver_id
                entity.approved_at = now

        await self.db.flush()

    async def _finalize_denial(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        denier_id: Optional[str],
        reason: Optional[str],
    ) -> None:
        """Set the entity status to DENIED"""
        if entity_type == ApprovalEntityType.PURCHASE_REQUEST:
            result = await self.db.execute(
                select(PurchaseRequest).where(PurchaseRequest.id == entity_id)
            )
            entity = result.scalar_one_or_none()
            if entity:
                entity.status = PurchaseRequestStatus.DENIED
                entity.approved_by = denier_id
                entity.denial_reason = reason
                # Release any encumbrance
                if entity.budget_id:
                    await self._release_encumbrance(
                        entity.budget_id, float(entity.estimated_amount)
                    )
        elif entity_type == ApprovalEntityType.EXPENSE_REPORT:
            result = await self.db.execute(
                select(ExpenseReport).where(ExpenseReport.id == entity_id)
            )
            entity = result.scalar_one_or_none()
            if entity:
                entity.status = ExpenseReportStatus.DENIED
                entity.approved_by = denier_id
                entity.denial_reason = reason
        elif entity_type == ApprovalEntityType.CHECK_REQUEST:
            result = await self.db.execute(
                select(CheckRequest).where(CheckRequest.id == entity_id)
            )
            entity = result.scalar_one_or_none()
            if entity:
                entity.status = CheckRequestStatus.DENIED
                entity.approved_by = denier_id
                entity.denial_reason = reason

        await self.db.flush()

    async def _get_entity_info(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        org_id: str,
    ) -> Optional[dict]:
        """Get basic info about an approval entity for display"""
        if entity_type == ApprovalEntityType.PURCHASE_REQUEST:
            result = await self.db.execute(
                select(PurchaseRequest).where(
                    PurchaseRequest.id == entity_id,
                    PurchaseRequest.organization_id == org_id,
                )
            )
            entity = result.scalar_one_or_none()
            if entity:
                return {
                    "title": entity.title,
                    "amount": float(entity.estimated_amount),
                    "requester_name": "",
                    "submitted_at": entity.created_at,
                }
        elif entity_type == ApprovalEntityType.EXPENSE_REPORT:
            result = await self.db.execute(
                select(ExpenseReport).where(
                    ExpenseReport.id == entity_id,
                    ExpenseReport.organization_id == org_id,
                )
            )
            entity = result.scalar_one_or_none()
            if entity:
                return {
                    "title": entity.title,
                    "amount": float(entity.total_amount),
                    "requester_name": "",
                    "submitted_at": entity.created_at,
                }
        elif entity_type == ApprovalEntityType.CHECK_REQUEST:
            result = await self.db.execute(
                select(CheckRequest).where(
                    CheckRequest.id == entity_id,
                    CheckRequest.organization_id == org_id,
                )
            )
            entity = result.scalar_one_or_none()
            if entity:
                return {
                    "title": f"Check to {entity.payee_name}",
                    "amount": float(entity.amount),
                    "requester_name": "",
                    "submitted_at": entity.created_at,
                }
        return None

    # ========================================
    # Purchase Requests
    # ========================================

    async def _generate_request_number(
        self, org_id: str, prefix: str, fiscal_year_id: str
    ) -> str:
        """Generate auto-incrementing request number like PR-2026-0001"""
        fy = await self.get_fiscal_year(fiscal_year_id, org_id)
        year = ""
        if fy and fy.start_date:
            year = str(fy.start_date.year)
        else:
            year = str(datetime.now(timezone.utc).year)

        table_map = {
            "PR": PurchaseRequest,
            "ER": ExpenseReport,
            "CK": CheckRequest,
        }
        model = table_map.get(prefix)
        if not model:
            raise ValueError(f"Unknown prefix: {prefix}")

        like_pattern = f"{prefix}-{year}-%"
        result = await self.db.execute(
            select(func.count())
            .select_from(model)
            .where(
                model.organization_id == org_id,
                model.request_number.like(like_pattern)
                if hasattr(model, "request_number")
                else model.report_number.like(like_pattern),
            )
        )
        count = result.scalar() or 0
        return f"{prefix}-{year}-{(count + 1):04d}"

    async def list_purchase_requests(
        self,
        org_id: str,
        status: Optional[str] = None,
        fiscal_year_id: Optional[str] = None,
    ) -> list[PurchaseRequest]:
        query = select(PurchaseRequest).where(
            PurchaseRequest.organization_id == org_id
        )
        if status:
            query = query.where(PurchaseRequest.status == status)
        if fiscal_year_id:
            query = query.where(
                PurchaseRequest.fiscal_year_id == fiscal_year_id
            )
        query = query.order_by(PurchaseRequest.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_purchase_request(
        self, pr_id: str, org_id: str
    ) -> Optional[PurchaseRequest]:
        result = await self.db.execute(
            select(PurchaseRequest).where(
                PurchaseRequest.id == pr_id,
                PurchaseRequest.organization_id == org_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_purchase_request(
        self, org_id: str, requested_by: str, **kwargs
    ) -> PurchaseRequest:
        fiscal_year_id = kwargs.get("fiscal_year_id", "")
        request_number = await self._generate_request_number(
            org_id, "PR", fiscal_year_id
        )
        pr = PurchaseRequest(
            organization_id=org_id,
            requested_by=requested_by,
            request_number=request_number,
            **kwargs,
        )
        self.db.add(pr)
        await self.db.flush()
        await self.db.refresh(pr, ["created_at", "updated_at"])
        logger.info("Created purchase request %s", request_number)
        return pr

    async def update_purchase_request(
        self, pr_id: str, org_id: str, **kwargs
    ) -> PurchaseRequest:
        pr = await self.get_purchase_request(pr_id, org_id)
        if not pr:
            raise ValueError("Purchase request not found")
        if pr.status not in (
            PurchaseRequestStatus.DRAFT,
            PurchaseRequestStatus.SUBMITTED,
        ):
            raise ValueError("Cannot edit a purchase request in this status")
        for key, value in kwargs.items():
            if value is not None:
                setattr(pr, key, value)
        await self.db.flush()
        await self.db.refresh(pr, ["updated_at"])
        return pr

    async def submit_purchase_request(
        self, pr_id: str, org_id: str
    ) -> PurchaseRequest:
        pr = await self.get_purchase_request(pr_id, org_id)
        if not pr:
            raise ValueError("Purchase request not found")
        if pr.status != PurchaseRequestStatus.DRAFT:
            raise ValueError("Only draft requests can be submitted")

        pr.status = PurchaseRequestStatus.SUBMITTED

        # Resolve and create approval chain
        budget_category_id = None
        if pr.budget_id:
            budget = await self.get_budget(pr.budget_id, org_id)
            if budget:
                budget_category_id = budget.category_id

        chain = await self.resolve_approval_chain(
            org_id,
            ApprovalEntityType.PURCHASE_REQUEST,
            float(pr.estimated_amount),
            budget_category_id,
        )

        if chain and chain.steps:
            pr.status = PurchaseRequestStatus.PENDING_APPROVAL
            await self.create_approval_records(
                chain,
                ApprovalEntityType.PURCHASE_REQUEST,
                pr.id,
                float(pr.estimated_amount),
                pr.requested_by,
            )
            # Check if all steps were auto-approved
            all_complete = await self._check_all_steps_complete(
                ApprovalEntityType.PURCHASE_REQUEST, pr.id
            )
            if all_complete:
                await self._finalize_approval(
                    ApprovalEntityType.PURCHASE_REQUEST, pr.id, None
                )
        else:
            # No chain — needs manual approval
            pr.status = PurchaseRequestStatus.PENDING_APPROVAL

        await self.db.flush()
        await self.db.refresh(pr, ["updated_at"])
        logger.info("Submitted purchase request %s", pr.request_number)
        return pr

    async def mark_pr_ordered(
        self, pr_id: str, org_id: str
    ) -> PurchaseRequest:
        pr = await self.get_purchase_request(pr_id, org_id)
        if not pr:
            raise ValueError("Purchase request not found")
        if pr.status != PurchaseRequestStatus.APPROVED:
            raise ValueError("Only approved requests can be marked as ordered")
        pr.status = PurchaseRequestStatus.ORDERED
        pr.ordered_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.refresh(pr, ["updated_at"])
        return pr

    async def mark_pr_received(
        self, pr_id: str, org_id: str
    ) -> PurchaseRequest:
        pr = await self.get_purchase_request(pr_id, org_id)
        if not pr:
            raise ValueError("Purchase request not found")
        if pr.status != PurchaseRequestStatus.ORDERED:
            raise ValueError("Only ordered requests can be marked as received")
        pr.status = PurchaseRequestStatus.RECEIVED
        pr.received_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.refresh(pr, ["updated_at"])
        return pr

    async def mark_pr_paid(
        self, pr_id: str, org_id: str, actual_amount: Optional[float] = None
    ) -> PurchaseRequest:
        pr = await self.get_purchase_request(pr_id, org_id)
        if not pr:
            raise ValueError("Purchase request not found")
        if pr.status not in (
            PurchaseRequestStatus.APPROVED,
            PurchaseRequestStatus.ORDERED,
            PurchaseRequestStatus.RECEIVED,
        ):
            raise ValueError("Request cannot be marked as paid in this status")

        pr.status = PurchaseRequestStatus.PAID
        pr.paid_at = datetime.now(timezone.utc)
        if actual_amount is not None:
            pr.actual_amount = Decimal(str(actual_amount))

        # Move from encumbered to spent
        if pr.budget_id:
            amount = float(pr.actual_amount or pr.estimated_amount)
            await self._release_encumbrance(
                pr.budget_id, float(pr.estimated_amount)
            )
            await self._add_to_spent(pr.budget_id, amount)

        await self.db.flush()
        await self.db.refresh(pr, ["updated_at"])
        return pr

    async def cancel_purchase_request(
        self, pr_id: str, org_id: str
    ) -> PurchaseRequest:
        pr = await self.get_purchase_request(pr_id, org_id)
        if not pr:
            raise ValueError("Purchase request not found")
        if pr.status in (PurchaseRequestStatus.PAID,):
            raise ValueError("Paid requests cannot be cancelled")

        # Release encumbrance if approved
        if pr.budget_id and pr.status in (
            PurchaseRequestStatus.APPROVED,
            PurchaseRequestStatus.ORDERED,
            PurchaseRequestStatus.RECEIVED,
        ):
            await self._release_encumbrance(
                pr.budget_id, float(pr.estimated_amount)
            )

        pr.status = PurchaseRequestStatus.CANCELLED
        await self.db.flush()
        await self.db.refresh(pr, ["updated_at"])
        return pr

    # ========================================
    # Expense Reports
    # ========================================

    async def list_expense_reports(
        self,
        org_id: str,
        status: Optional[str] = None,
    ) -> list[ExpenseReport]:
        query = (
            select(ExpenseReport)
            .options(selectinload(ExpenseReport.line_items))
            .where(ExpenseReport.organization_id == org_id)
        )
        if status:
            query = query.where(ExpenseReport.status == status)
        query = query.order_by(ExpenseReport.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().unique().all())

    async def get_expense_report(
        self, er_id: str, org_id: str
    ) -> Optional[ExpenseReport]:
        result = await self.db.execute(
            select(ExpenseReport)
            .options(selectinload(ExpenseReport.line_items))
            .where(
                ExpenseReport.id == er_id,
                ExpenseReport.organization_id == org_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_expense_report(
        self,
        org_id: str,
        submitted_by: str,
        line_items: Optional[list] = None,
        **kwargs,
    ) -> ExpenseReport:
        fiscal_year_id = kwargs.get("fiscal_year_id", "")
        report_number = await self._generate_request_number(
            org_id, "ER", fiscal_year_id
        )
        er = ExpenseReport(
            organization_id=org_id,
            submitted_by=submitted_by,
            report_number=report_number,
            **kwargs,
        )
        self.db.add(er)
        await self.db.flush()

        total = Decimal("0")
        if line_items:
            for item_data in line_items:
                item = ExpenseLineItem(
                    expense_report_id=er.id, **item_data
                )
                self.db.add(item)
                total += Decimal(str(item_data.get("amount", 0)))
            await self.db.flush()

        er.total_amount = total
        await self.db.flush()
        await self.db.refresh(er, ["created_at", "updated_at"])
        return er

    async def update_expense_report(
        self, er_id: str, org_id: str, **kwargs
    ) -> ExpenseReport:
        er = await self.get_expense_report(er_id, org_id)
        if not er:
            raise ValueError("Expense report not found")
        if er.status not in (
            ExpenseReportStatus.DRAFT,
            ExpenseReportStatus.SUBMITTED,
        ):
            raise ValueError("Cannot edit an expense report in this status")
        for key, value in kwargs.items():
            if value is not None:
                setattr(er, key, value)
        await self.db.flush()
        await self.db.refresh(er, ["updated_at"])
        return er

    async def add_expense_line_item(
        self, er_id: str, org_id: str, **kwargs
    ) -> ExpenseLineItem:
        er = await self.get_expense_report(er_id, org_id)
        if not er:
            raise ValueError("Expense report not found")
        if er.status not in (ExpenseReportStatus.DRAFT,):
            raise ValueError("Can only add items to draft reports")
        item = ExpenseLineItem(expense_report_id=er_id, **kwargs)
        self.db.add(item)
        await self.db.flush()

        # Recalculate total
        er.total_amount = sum(
            li.amount for li in er.line_items
        ) + item.amount
        await self.db.flush()
        await self.db.refresh(item, ["created_at"])
        return item

    async def submit_expense_report(
        self, er_id: str, org_id: str
    ) -> ExpenseReport:
        er = await self.get_expense_report(er_id, org_id)
        if not er:
            raise ValueError("Expense report not found")
        if er.status != ExpenseReportStatus.DRAFT:
            raise ValueError("Only draft reports can be submitted")
        if float(er.total_amount) <= 0:
            raise ValueError("Expense report must have line items")

        er.status = ExpenseReportStatus.SUBMITTED

        chain = await self.resolve_approval_chain(
            org_id,
            ApprovalEntityType.EXPENSE_REPORT,
            float(er.total_amount),
        )

        if chain and chain.steps:
            er.status = ExpenseReportStatus.PENDING_APPROVAL
            await self.create_approval_records(
                chain,
                ApprovalEntityType.EXPENSE_REPORT,
                er.id,
                float(er.total_amount),
                er.submitted_by,
            )
            all_complete = await self._check_all_steps_complete(
                ApprovalEntityType.EXPENSE_REPORT, er.id
            )
            if all_complete:
                await self._finalize_approval(
                    ApprovalEntityType.EXPENSE_REPORT, er.id, None
                )
        else:
            er.status = ExpenseReportStatus.PENDING_APPROVAL

        await self.db.flush()
        await self.db.refresh(er, ["updated_at"])
        return er

    async def mark_expense_paid(
        self, er_id: str, org_id: str, payment_method: Optional[str] = None
    ) -> ExpenseReport:
        er = await self.get_expense_report(er_id, org_id)
        if not er:
            raise ValueError("Expense report not found")
        if er.status != ExpenseReportStatus.APPROVED:
            raise ValueError("Only approved reports can be marked as paid")

        er.status = ExpenseReportStatus.PAID
        er.paid_at = datetime.now(timezone.utc)
        er.payment_method = payment_method

        # Add to spent for each line item's budget
        for item in er.line_items:
            if item.budget_id:
                await self._add_to_spent(item.budget_id, float(item.amount))

        await self.db.flush()
        await self.db.refresh(er, ["updated_at"])
        return er

    # ========================================
    # Check Requests
    # ========================================

    async def list_check_requests(
        self,
        org_id: str,
        status: Optional[str] = None,
    ) -> list[CheckRequest]:
        query = select(CheckRequest).where(
            CheckRequest.organization_id == org_id
        )
        if status:
            query = query.where(CheckRequest.status == status)
        query = query.order_by(CheckRequest.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_check_request(
        self, cr_id: str, org_id: str
    ) -> Optional[CheckRequest]:
        result = await self.db.execute(
            select(CheckRequest).where(
                CheckRequest.id == cr_id,
                CheckRequest.organization_id == org_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_check_request(
        self, org_id: str, requested_by: str, **kwargs
    ) -> CheckRequest:
        fiscal_year_id = kwargs.get("fiscal_year_id", "")
        request_number = await self._generate_request_number(
            org_id, "CK", fiscal_year_id
        )
        cr = CheckRequest(
            organization_id=org_id,
            requested_by=requested_by,
            request_number=request_number,
            **kwargs,
        )
        self.db.add(cr)
        await self.db.flush()
        await self.db.refresh(cr, ["created_at", "updated_at"])
        return cr

    async def update_check_request(
        self, cr_id: str, org_id: str, **kwargs
    ) -> CheckRequest:
        cr = await self.get_check_request(cr_id, org_id)
        if not cr:
            raise ValueError("Check request not found")
        if cr.status not in (
            CheckRequestStatus.DRAFT,
            CheckRequestStatus.SUBMITTED,
        ):
            raise ValueError("Cannot edit a check request in this status")
        for key, value in kwargs.items():
            if value is not None:
                setattr(cr, key, value)
        await self.db.flush()
        await self.db.refresh(cr, ["updated_at"])
        return cr

    async def submit_check_request(
        self, cr_id: str, org_id: str
    ) -> CheckRequest:
        cr = await self.get_check_request(cr_id, org_id)
        if not cr:
            raise ValueError("Check request not found")
        if cr.status != CheckRequestStatus.DRAFT:
            raise ValueError("Only draft requests can be submitted")

        cr.status = CheckRequestStatus.SUBMITTED

        budget_category_id = None
        if cr.budget_id:
            budget = await self.get_budget(cr.budget_id, org_id)
            if budget:
                budget_category_id = budget.category_id

        chain = await self.resolve_approval_chain(
            org_id,
            ApprovalEntityType.CHECK_REQUEST,
            float(cr.amount),
            budget_category_id,
        )

        if chain and chain.steps:
            cr.status = CheckRequestStatus.PENDING_APPROVAL
            await self.create_approval_records(
                chain,
                ApprovalEntityType.CHECK_REQUEST,
                cr.id,
                float(cr.amount),
                cr.requested_by,
            )
            all_complete = await self._check_all_steps_complete(
                ApprovalEntityType.CHECK_REQUEST, cr.id
            )
            if all_complete:
                await self._finalize_approval(
                    ApprovalEntityType.CHECK_REQUEST, cr.id, None
                )
        else:
            cr.status = CheckRequestStatus.PENDING_APPROVAL

        await self.db.flush()
        await self.db.refresh(cr, ["updated_at"])
        return cr

    async def issue_check(
        self,
        cr_id: str,
        org_id: str,
        check_number: str,
        check_date: Optional[datetime] = None,
    ) -> CheckRequest:
        cr = await self.get_check_request(cr_id, org_id)
        if not cr:
            raise ValueError("Check request not found")
        if cr.status != CheckRequestStatus.APPROVED:
            raise ValueError("Only approved requests can have checks issued")

        cr.status = CheckRequestStatus.ISSUED
        cr.check_number = check_number
        cr.check_date = check_date or datetime.now(timezone.utc)

        if cr.budget_id:
            await self._add_to_spent(cr.budget_id, float(cr.amount))

        await self.db.flush()
        await self.db.refresh(cr, ["updated_at"])
        return cr

    async def void_check(
        self, cr_id: str, org_id: str
    ) -> CheckRequest:
        cr = await self.get_check_request(cr_id, org_id)
        if not cr:
            raise ValueError("Check request not found")
        if cr.status != CheckRequestStatus.ISSUED:
            raise ValueError("Only issued checks can be voided")

        cr.status = CheckRequestStatus.VOIDED

        # Reverse the spent amount
        if cr.budget_id:
            budget = await self.get_budget(cr.budget_id, org_id)
            if budget:
                budget.amount_spent = max(
                    Decimal("0"),
                    budget.amount_spent - cr.amount,
                )

        await self.db.flush()
        await self.db.refresh(cr, ["updated_at"])
        return cr

    # ========================================
    # Dues & Assessments
    # ========================================

    async def list_dues_schedules(
        self, org_id: str
    ) -> list[DuesSchedule]:
        result = await self.db.execute(
            select(DuesSchedule)
            .where(DuesSchedule.organization_id == org_id)
            .order_by(DuesSchedule.due_date.desc())
        )
        return list(result.scalars().all())

    async def get_dues_schedule(
        self, schedule_id: str, org_id: str
    ) -> Optional[DuesSchedule]:
        result = await self.db.execute(
            select(DuesSchedule)
            .options(selectinload(DuesSchedule.member_dues))
            .where(
                DuesSchedule.id == schedule_id,
                DuesSchedule.organization_id == org_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_dues_schedule(
        self, org_id: str, created_by: str, **kwargs
    ) -> DuesSchedule:
        schedule = DuesSchedule(
            organization_id=org_id, created_by=created_by, **kwargs
        )
        self.db.add(schedule)
        await self.db.flush()
        await self.db.refresh(schedule, ["created_at", "updated_at"])
        return schedule

    async def update_dues_schedule(
        self, schedule_id: str, org_id: str, **kwargs
    ) -> DuesSchedule:
        schedule = await self.get_dues_schedule(schedule_id, org_id)
        if not schedule:
            raise ValueError("Dues schedule not found")
        for key, value in kwargs.items():
            if value is not None:
                setattr(schedule, key, value)
        await self.db.flush()
        await self.db.refresh(schedule, ["updated_at"])
        return schedule

    async def generate_member_dues(
        self, schedule_id: str, org_id: str
    ) -> int:
        """Bulk-create member_dues records for all eligible members"""
        schedule = await self.get_dues_schedule(schedule_id, org_id)
        if not schedule:
            raise ValueError("Dues schedule not found")

        # Get eligible members
        query = select(User).where(
            User.organization_id == org_id,
            User.is_active == True,  # noqa: E712
        )
        result = await self.db.execute(query)
        users = list(result.scalars().all())

        count = 0
        for user in users:
            # Check if dues already exist for this user + schedule
            existing = await self.db.execute(
                select(MemberDues).where(
                    MemberDues.dues_schedule_id == schedule_id,
                    MemberDues.user_id == user.id,
                )
            )
            if existing.scalar_one_or_none():
                continue

            dues = MemberDues(
                organization_id=org_id,
                dues_schedule_id=schedule_id,
                user_id=user.id,
                amount_due=schedule.amount,
                due_date=schedule.due_date,
            )
            self.db.add(dues)
            count += 1

        await self.db.flush()
        logger.info(
            "Generated %d member dues for schedule %s", count, schedule_id
        )
        return count

    async def list_member_dues(
        self,
        org_id: str,
        schedule_id: Optional[str] = None,
        user_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[MemberDues]:
        query = select(MemberDues).where(
            MemberDues.organization_id == org_id
        )
        if schedule_id:
            query = query.where(MemberDues.dues_schedule_id == schedule_id)
        if user_id:
            query = query.where(MemberDues.user_id == user_id)
        if status:
            query = query.where(MemberDues.status == status)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def record_dues_payment(
        self, dues_id: str, org_id: str, **kwargs
    ) -> MemberDues:
        result = await self.db.execute(
            select(MemberDues).where(
                MemberDues.id == dues_id,
                MemberDues.organization_id == org_id,
            )
        )
        dues = result.scalar_one_or_none()
        if not dues:
            raise ValueError("Member dues record not found")

        amount_paid = Decimal(str(kwargs.get("amount_paid", 0)))
        dues.amount_paid = dues.amount_paid + amount_paid
        dues.payment_method = kwargs.get("payment_method")
        dues.transaction_reference = kwargs.get("transaction_reference")
        dues.notes = kwargs.get("notes")
        dues.paid_date = datetime.now(timezone.utc)

        if dues.amount_paid >= dues.amount_due:
            dues.status = DuesStatus.PAID
        elif dues.amount_paid > 0:
            dues.status = DuesStatus.PARTIAL

        await self.db.flush()
        await self.db.refresh(dues, ["updated_at"])
        return dues

    async def waive_dues(
        self,
        dues_id: str,
        org_id: str,
        waived_by: str,
        reason: str,
    ) -> MemberDues:
        result = await self.db.execute(
            select(MemberDues).where(
                MemberDues.id == dues_id,
                MemberDues.organization_id == org_id,
            )
        )
        dues = result.scalar_one_or_none()
        if not dues:
            raise ValueError("Member dues record not found")

        dues.status = DuesStatus.WAIVED
        dues.waived_by = waived_by
        dues.waived_at = datetime.now(timezone.utc)
        dues.waive_reason = reason

        await self.db.flush()
        await self.db.refresh(dues, ["updated_at"])
        return dues

    async def get_dues_summary(
        self, org_id: str, schedule_id: Optional[str] = None
    ) -> dict:
        query = select(MemberDues).where(
            MemberDues.organization_id == org_id
        )
        if schedule_id:
            query = query.where(MemberDues.dues_schedule_id == schedule_id)
        result = await self.db.execute(query)
        all_dues = list(result.scalars().all())

        total_expected = sum(float(d.amount_due) for d in all_dues)
        total_collected = sum(float(d.amount_paid) for d in all_dues)
        total_waived = sum(
            float(d.amount_due) for d in all_dues if d.status == DuesStatus.WAIVED
        )
        total_outstanding = total_expected - total_collected - total_waived
        collection_rate = (
            (total_collected / total_expected * 100) if total_expected > 0 else 0
        )

        return {
            "total_expected": total_expected,
            "total_collected": total_collected,
            "total_outstanding": total_outstanding,
            "total_waived": total_waived,
            "collection_rate": round(collection_rate, 2),
            "members_paid": sum(
                1 for d in all_dues if d.status == DuesStatus.PAID
            ),
            "members_overdue": sum(
                1 for d in all_dues if d.status == DuesStatus.OVERDUE
            ),
            "members_waived": sum(
                1 for d in all_dues if d.status == DuesStatus.WAIVED
            ),
        }

    # ========================================
    # Export
    # ========================================

    async def list_export_mappings(
        self, org_id: str
    ) -> list[ExportMapping]:
        result = await self.db.execute(
            select(ExportMapping).where(
                ExportMapping.organization_id == org_id
            )
        )
        return list(result.scalars().all())

    async def create_export_mapping(
        self, org_id: str, **kwargs
    ) -> ExportMapping:
        mapping = ExportMapping(organization_id=org_id, **kwargs)
        self.db.add(mapping)
        await self.db.flush()
        await self.db.refresh(mapping, ["created_at", "updated_at"])
        return mapping

    async def update_export_mapping(
        self, mapping_id: str, org_id: str, **kwargs
    ) -> ExportMapping:
        result = await self.db.execute(
            select(ExportMapping).where(
                ExportMapping.id == mapping_id,
                ExportMapping.organization_id == org_id,
            )
        )
        mapping = result.scalar_one_or_none()
        if not mapping:
            raise ValueError("Export mapping not found")
        for key, value in kwargs.items():
            if value is not None:
                setattr(mapping, key, value)
        await self.db.flush()
        await self.db.refresh(mapping, ["updated_at"])
        return mapping

    async def generate_export(
        self,
        org_id: str,
        exported_by: str,
        date_start: datetime,
        date_end: datetime,
        file_format: str = "csv",
    ) -> tuple[str, int]:
        """Generate a QuickBooks-compatible export file"""
        # Gather all paid transactions in date range
        pr_result = await self.db.execute(
            select(PurchaseRequest).where(
                PurchaseRequest.organization_id == org_id,
                PurchaseRequest.status == PurchaseRequestStatus.PAID,
                PurchaseRequest.paid_at >= date_start,
                PurchaseRequest.paid_at <= date_end,
            )
        )
        prs = list(pr_result.scalars().all())

        cr_result = await self.db.execute(
            select(CheckRequest).where(
                CheckRequest.organization_id == org_id,
                CheckRequest.status == CheckRequestStatus.ISSUED,
                CheckRequest.check_date >= date_start,
                CheckRequest.check_date <= date_end,
            )
        )
        crs = list(cr_result.scalars().all())

        er_result = await self.db.execute(
            select(ExpenseReport)
            .options(selectinload(ExpenseReport.line_items))
            .where(
                ExpenseReport.organization_id == org_id,
                ExpenseReport.status == ExpenseReportStatus.PAID,
                ExpenseReport.paid_at >= date_start,
                ExpenseReport.paid_at <= date_end,
            )
        )
        ers = list(er_result.scalars().unique().all())

        # Build CSV
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Date", "Type", "Num", "Name", "Memo", "Account", "Debit", "Credit"
        ])

        record_count = 0

        for pr in prs:
            writer.writerow([
                pr.paid_at.strftime("%m/%d/%Y") if pr.paid_at else "",
                "Bill Pmt",
                pr.request_number,
                pr.vendor or "",
                pr.title,
                "",
                str(pr.actual_amount or pr.estimated_amount),
                "",
            ])
            record_count += 1

        for cr in crs:
            writer.writerow([
                cr.check_date.strftime("%m/%d/%Y") if cr.check_date else "",
                "Check",
                cr.check_number or cr.request_number,
                cr.payee_name,
                cr.memo or cr.purpose or "",
                "",
                str(cr.amount),
                "",
            ])
            record_count += 1

        for er in ers:
            for item in er.line_items:
                writer.writerow([
                    er.paid_at.strftime("%m/%d/%Y") if er.paid_at else "",
                    "Expense",
                    er.report_number,
                    item.merchant or "",
                    item.description,
                    "",
                    str(item.amount),
                    "",
                ])
                record_count += 1

        # Log the export
        log = ExportLog(
            organization_id=org_id,
            export_type="transactions",
            date_range_start=date_start,
            date_range_end=date_end,
            record_count=record_count,
            file_format=file_format,
            exported_by=exported_by,
        )
        self.db.add(log)
        await self.db.flush()

        return output.getvalue(), record_count

    async def list_export_logs(self, org_id: str) -> list[ExportLog]:
        result = await self.db.execute(
            select(ExportLog)
            .where(ExportLog.organization_id == org_id)
            .order_by(ExportLog.exported_at.desc())
        )
        return list(result.scalars().all())

    # ========================================
    # Dashboard
    # ========================================

    async def get_dashboard(self, org_id: str) -> dict:
        """Get finance dashboard data"""
        active_fy = await self.get_active_fiscal_year(org_id)

        budget_health = {
            "total_budgeted": 0,
            "total_spent": 0,
            "total_encumbered": 0,
            "total_remaining": 0,
            "percent_used": 0,
            "category_breakdown": [],
        }
        if active_fy:
            budget_health = await self.get_budget_summary(org_id, active_fy.id)

        # Count pending items
        pr_count = await self.db.execute(
            select(func.count())
            .select_from(PurchaseRequest)
            .where(
                PurchaseRequest.organization_id == org_id,
                PurchaseRequest.status == PurchaseRequestStatus.PENDING_APPROVAL,
            )
        )
        er_count = await self.db.execute(
            select(func.count())
            .select_from(ExpenseReport)
            .where(
                ExpenseReport.organization_id == org_id,
                ExpenseReport.status == ExpenseReportStatus.PENDING_APPROVAL,
            )
        )
        cr_count = await self.db.execute(
            select(func.count())
            .select_from(CheckRequest)
            .where(
                CheckRequest.organization_id == org_id,
                CheckRequest.status == CheckRequestStatus.PENDING_APPROVAL,
            )
        )

        pending_pr = pr_count.scalar() or 0
        pending_er = er_count.scalar() or 0
        pending_cr = cr_count.scalar() or 0

        dues_summary = await self.get_dues_summary(org_id)

        return {
            "budget_health": budget_health,
            "pending_approvals_count": pending_pr + pending_er + pending_cr,
            "pending_purchase_requests": pending_pr,
            "pending_expense_reports": pending_er,
            "pending_check_requests": pending_cr,
            "dues_collection_rate": dues_summary.get("collection_rate", 0),
            "recent_transactions": [],
        }

    # ========================================
    # Budget Helpers
    # ========================================

    async def _encumber_budget(
        self, budget_id: str, amount: float
    ) -> None:
        result = await self.db.execute(
            select(Budget).where(Budget.id == budget_id)
        )
        budget = result.scalar_one_or_none()
        if budget:
            budget.amount_encumbered = budget.amount_encumbered + Decimal(
                str(amount)
            )
            await self.db.flush()

    async def _release_encumbrance(
        self, budget_id: str, amount: float
    ) -> None:
        result = await self.db.execute(
            select(Budget).where(Budget.id == budget_id)
        )
        budget = result.scalar_one_or_none()
        if budget:
            budget.amount_encumbered = max(
                Decimal("0"),
                budget.amount_encumbered - Decimal(str(amount)),
            )
            await self.db.flush()

    async def _add_to_spent(
        self, budget_id: str, amount: float
    ) -> None:
        result = await self.db.execute(
            select(Budget).where(Budget.id == budget_id)
        )
        budget = result.scalar_one_or_none()
        if budget:
            budget.amount_spent = budget.amount_spent + Decimal(str(amount))
            await self.db.flush()
