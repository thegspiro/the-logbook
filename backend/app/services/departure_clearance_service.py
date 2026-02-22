"""
Departure Clearance Service

Manages the end-to-end pipeline for when a member leaves the department:
  1. Initiate clearance — snapshot all outstanding items into line items
  2. Resolve line items — mark each as returned, damaged, written off, or waived
  3. Complete clearance — finalize once all items are accounted for
  4. Query clearances — dashboard views for admins and the departing member

The clearance is the authoritative checklist that staff work through as
the member turns in gear. Each resolution triggers the underlying
inventory operation (unassign, check-in, pool return) so stock levels
stay accurate.
"""

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, Any, List, Optional, Tuple
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.models.inventory import (
    DepartureClearance,
    DepartureClearanceItem,
    ItemAssignment,
    CheckOutRecord,
    ItemIssuance,
    InventoryItem,
    ClearanceStatus,
    ClearanceLineDisposition,
    ItemCondition,
)
from app.models.user import User

logger = logging.getLogger(__name__)


class DepartureClearanceService:
    """Service for the member departure property return pipeline."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # 1. Initiate clearance
    # ------------------------------------------------------------------

    async def initiate_clearance(
        self,
        user_id: str,
        organization_id: str,
        initiated_by: str,
        departure_type: Optional[str] = None,
        return_deadline_days: int = 14,
        notes: Optional[str] = None,
    ) -> Tuple[Optional[DepartureClearance], Optional[str]]:
        """
        Create a departure clearance for a member, snapshotting every
        outstanding item (permanent assignments, active checkouts,
        unreturned pool issuances) into clearance line items.

        Returns (clearance, None) on success or (None, error_message).
        """
        try:
            # Check for existing open clearance
            existing = await self.db.execute(
                select(DepartureClearance).where(
                    DepartureClearance.organization_id == organization_id,
                    DepartureClearance.user_id == user_id,
                    DepartureClearance.status.in_([
                        ClearanceStatus.INITIATED,
                        ClearanceStatus.IN_PROGRESS,
                    ]),
                )
            )
            if existing.scalar_one_or_none():
                return None, "An open departure clearance already exists for this member"

            deadline = datetime.now(timezone.utc) + timedelta(days=return_deadline_days)

            clearance = DepartureClearance(
                organization_id=organization_id,
                user_id=user_id,
                status=ClearanceStatus.INITIATED,
                initiated_by=initiated_by,
                departure_type=departure_type,
                return_deadline=deadline,
                notes=notes,
            )
            self.db.add(clearance)
            await self.db.flush()  # get clearance.id

            line_items: List[DepartureClearanceItem] = []

            # --- Permanent assignments ---
            assign_result = await self.db.execute(
                select(ItemAssignment)
                .where(
                    ItemAssignment.organization_id == organization_id,
                    ItemAssignment.user_id == user_id,
                    ItemAssignment.is_active == True,  # noqa: E712
                )
                .options(selectinload(ItemAssignment.item))
            )
            for assignment in assign_result.scalars().all():
                item = assignment.item
                line_items.append(DepartureClearanceItem(
                    clearance_id=clearance.id,
                    organization_id=organization_id,
                    source_type="assignment",
                    source_id=str(assignment.id),
                    item_id=str(item.id) if item else None,
                    item_name=item.name if item else "Unknown Item",
                    item_serial_number=item.serial_number if item else None,
                    item_asset_tag=item.asset_tag if item else None,
                    item_value=item.current_value if item else None,
                    quantity=1,
                    disposition=ClearanceLineDisposition.PENDING,
                ))

            # --- Active checkouts ---
            checkout_result = await self.db.execute(
                select(CheckOutRecord)
                .where(
                    CheckOutRecord.organization_id == organization_id,
                    CheckOutRecord.user_id == user_id,
                    CheckOutRecord.is_returned == False,  # noqa: E712
                )
                .options(selectinload(CheckOutRecord.item))
            )
            for checkout in checkout_result.scalars().all():
                item = checkout.item
                line_items.append(DepartureClearanceItem(
                    clearance_id=clearance.id,
                    organization_id=organization_id,
                    source_type="checkout",
                    source_id=str(checkout.id),
                    item_id=str(item.id) if item else None,
                    item_name=item.name if item else "Unknown Item",
                    item_serial_number=item.serial_number if item else None,
                    item_asset_tag=item.asset_tag if item else None,
                    item_value=item.current_value if item else None,
                    quantity=1,
                    disposition=ClearanceLineDisposition.PENDING,
                ))

            # --- Unreturned pool issuances ---
            issuance_result = await self.db.execute(
                select(ItemIssuance)
                .where(
                    ItemIssuance.organization_id == organization_id,
                    ItemIssuance.user_id == user_id,
                    ItemIssuance.is_returned == False,  # noqa: E712
                )
                .options(selectinload(ItemIssuance.item))
            )
            for issuance in issuance_result.scalars().all():
                item = issuance.item
                per_unit_value = (
                    float(item.current_value or 0) / max(1, (item.quantity or 0) + (item.quantity_issued or 0))
                    if item else 0
                )
                line_items.append(DepartureClearanceItem(
                    clearance_id=clearance.id,
                    organization_id=organization_id,
                    source_type="issuance",
                    source_id=str(issuance.id),
                    item_id=str(item.id) if item else None,
                    item_name=item.name if item else "Unknown Item",
                    item_serial_number=None,  # pool items don't have individual serials
                    item_asset_tag=None,
                    item_value=Decimal(str(round(per_unit_value * issuance.quantity_issued, 2))),
                    quantity=issuance.quantity_issued,
                    disposition=ClearanceLineDisposition.PENDING,
                ))

            for li in line_items:
                self.db.add(li)

            # Update summary counts
            total_value = sum(float(li.item_value or 0) for li in line_items)
            clearance.total_items = len(line_items)
            clearance.items_outstanding = len(line_items)
            clearance.items_cleared = 0
            clearance.total_value = Decimal(str(round(total_value, 2)))
            clearance.value_outstanding = Decimal(str(round(total_value, 2)))

            await self.db.commit()
            await self.db.refresh(clearance)
            return clearance, None

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to initiate departure clearance: {e}")
            return None, str(e)

    # ------------------------------------------------------------------
    # 2. Resolve a clearance line item
    # ------------------------------------------------------------------

    async def resolve_line_item(
        self,
        clearance_item_id: str,
        organization_id: str,
        resolved_by: str,
        disposition: str,
        return_condition: Optional[str] = None,
        resolution_notes: Optional[str] = None,
    ) -> Tuple[Optional[DepartureClearanceItem], Optional[str]]:
        """
        Resolve a single clearance line item (mark as returned, damaged,
        written off, or waived) and perform the corresponding inventory
        operation.
        """
        try:
            # Validate disposition
            try:
                disp = ClearanceLineDisposition(disposition)
            except ValueError:
                valid = [d.value for d in ClearanceLineDisposition if d != ClearanceLineDisposition.PENDING]
                return None, f"Invalid disposition '{disposition}'. Valid values: {valid}"

            if disp == ClearanceLineDisposition.PENDING:
                return None, "Cannot set disposition back to 'pending'"

            # Load the line item
            result = await self.db.execute(
                select(DepartureClearanceItem)
                .where(
                    DepartureClearanceItem.id == clearance_item_id,
                    DepartureClearanceItem.organization_id == organization_id,
                )
                .options(selectinload(DepartureClearanceItem.clearance))
            )
            line_item = result.scalar_one_or_none()
            if not line_item:
                return None, "Clearance line item not found"

            if line_item.disposition != ClearanceLineDisposition.PENDING:
                return None, f"Item already resolved as '{line_item.disposition.value}'"

            clearance = line_item.clearance
            if clearance.status in (ClearanceStatus.COMPLETED, ClearanceStatus.CLOSED_INCOMPLETE):
                return None, "Clearance is already closed"

            cond_enum = None
            if return_condition:
                try:
                    cond_enum = ItemCondition(return_condition)
                except ValueError:
                    return None, f"Invalid return_condition '{return_condition}'"

            # --- Perform the underlying inventory operation ---
            from app.services.inventory_service import InventoryService
            inv_svc = InventoryService(self.db)

            if disp in (ClearanceLineDisposition.RETURNED, ClearanceLineDisposition.RETURNED_DAMAGED):
                effective_condition = cond_enum or (
                    ItemCondition.DAMAGED if disp == ClearanceLineDisposition.RETURNED_DAMAGED else ItemCondition.GOOD
                )
                if line_item.source_type == "assignment":
                    success, err = await inv_svc.unassign_item(
                        item_id=UUID(line_item.item_id) if line_item.item_id else None,
                        organization_id=UUID(organization_id),
                        returned_by=UUID(resolved_by),
                        return_condition=effective_condition,
                        return_notes=resolution_notes,
                    )
                    if err:
                        return None, f"Failed to unassign item: {err}"

                elif line_item.source_type == "checkout":
                    success, err = await inv_svc.checkin_item(
                        checkout_id=UUID(line_item.source_id),
                        organization_id=UUID(organization_id),
                        checked_in_by=UUID(resolved_by),
                        return_condition=effective_condition,
                        damage_notes=resolution_notes if disp == ClearanceLineDisposition.RETURNED_DAMAGED else None,
                    )
                    if err:
                        return None, f"Failed to check in item: {err}"

                elif line_item.source_type == "issuance":
                    success, err = await inv_svc.return_to_pool(
                        issuance_id=UUID(line_item.source_id),
                        organization_id=UUID(organization_id),
                        returned_by=UUID(resolved_by),
                        return_condition=effective_condition,
                        return_notes=resolution_notes,
                    )
                    if err:
                        return None, f"Failed to return pool item: {err}"

            # For written_off and waived, we don't move inventory back —
            # just record the disposition. The item stays in its current state
            # (assigned/checked_out) but the clearance line is resolved.

            # Update the line item
            now = datetime.now(timezone.utc)
            line_item.disposition = disp
            line_item.return_condition = cond_enum
            line_item.resolved_at = now
            line_item.resolved_by = resolved_by
            line_item.resolution_notes = resolution_notes

            # Recalculate clearance summary
            await self._recalculate_clearance(clearance)

            await self.db.commit()
            await self.db.refresh(line_item)
            return line_item, None

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to resolve clearance line item: {e}")
            return None, str(e)

    # ------------------------------------------------------------------
    # 3. Complete / close clearance
    # ------------------------------------------------------------------

    async def complete_clearance(
        self,
        clearance_id: str,
        organization_id: str,
        completed_by: str,
        force_close: bool = False,
        notes: Optional[str] = None,
    ) -> Tuple[Optional[DepartureClearance], Optional[str]]:
        """
        Complete a clearance. If all items are resolved, status becomes
        'completed'. If force_close is True and items are still pending,
        status becomes 'closed_incomplete'.
        """
        try:
            result = await self.db.execute(
                select(DepartureClearance)
                .where(
                    DepartureClearance.id == clearance_id,
                    DepartureClearance.organization_id == organization_id,
                )
                .options(selectinload(DepartureClearance.line_items))
            )
            clearance = result.scalar_one_or_none()
            if not clearance:
                return None, "Clearance not found"

            if clearance.status in (ClearanceStatus.COMPLETED, ClearanceStatus.CLOSED_INCOMPLETE):
                return None, f"Clearance is already {clearance.status.value}"

            pending_count = sum(
                1 for li in clearance.line_items
                if li.disposition == ClearanceLineDisposition.PENDING
            )

            if pending_count > 0 and not force_close:
                return None, (
                    f"{pending_count} item(s) still pending. "
                    f"Resolve all items first or use force_close=True to close with outstanding items."
                )

            now = datetime.now(timezone.utc)
            clearance.completed_at = now
            clearance.completed_by = completed_by
            if notes:
                clearance.notes = (clearance.notes or "") + f"\n\nClosure note: {notes}" if clearance.notes else notes

            if pending_count == 0:
                clearance.status = ClearanceStatus.COMPLETED
            else:
                clearance.status = ClearanceStatus.CLOSED_INCOMPLETE

            await self.db.commit()
            await self.db.refresh(clearance)

            # After completing clearance, check if auto-archive should trigger
            from app.services.member_archive_service import check_and_auto_archive
            await check_and_auto_archive(self.db, clearance.user_id, organization_id)

            return clearance, None

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to complete clearance: {e}")
            return None, str(e)

    # ------------------------------------------------------------------
    # 4. Query helpers
    # ------------------------------------------------------------------

    async def get_clearance(
        self, clearance_id: str, organization_id: str
    ) -> Optional[DepartureClearance]:
        """Get a clearance with all line items."""
        result = await self.db.execute(
            select(DepartureClearance)
            .where(
                DepartureClearance.id == clearance_id,
                DepartureClearance.organization_id == organization_id,
            )
            .options(selectinload(DepartureClearance.line_items))
        )
        return result.scalar_one_or_none()

    async def get_clearance_for_user(
        self, user_id: str, organization_id: str, active_only: bool = True
    ) -> Optional[DepartureClearance]:
        """Get the active clearance for a specific user."""
        query = select(DepartureClearance).where(
            DepartureClearance.organization_id == organization_id,
            DepartureClearance.user_id == user_id,
        ).options(selectinload(DepartureClearance.line_items))

        if active_only:
            query = query.where(
                DepartureClearance.status.in_([
                    ClearanceStatus.INITIATED,
                    ClearanceStatus.IN_PROGRESS,
                ])
            )

        query = query.order_by(DepartureClearance.initiated_at.desc()).limit(1)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def list_clearances(
        self,
        organization_id: str,
        status_filter: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        List clearances for the organization with member name,
        optionally filtered by status.
        """
        query = (
            select(DepartureClearance, User.first_name, User.last_name)
            .join(User, DepartureClearance.user_id == User.id)
            .where(DepartureClearance.organization_id == organization_id)
        )

        if status_filter:
            try:
                cs = ClearanceStatus(status_filter)
                query = query.where(DepartureClearance.status == cs)
            except ValueError:
                pass  # ignore invalid filter, return all

        # Count
        count_q = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_q)).scalar()

        # Paginate
        query = query.order_by(DepartureClearance.initiated_at.desc()).offset(skip).limit(limit)
        rows = (await self.db.execute(query)).all()

        summaries = []
        for clearance, first_name, last_name in rows:
            summaries.append({
                "id": clearance.id,
                "user_id": clearance.user_id,
                "member_name": f"{first_name} {last_name}".strip(),
                "status": clearance.status.value,
                "total_items": clearance.total_items,
                "items_cleared": clearance.items_cleared,
                "items_outstanding": clearance.items_outstanding,
                "total_value": float(clearance.total_value),
                "value_outstanding": float(clearance.value_outstanding),
                "initiated_at": clearance.initiated_at,
                "completed_at": clearance.completed_at,
                "return_deadline": clearance.return_deadline,
                "departure_type": clearance.departure_type,
            })

        return summaries, total

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _recalculate_clearance(self, clearance: DepartureClearance) -> None:
        """Recalculate summary counts from line items."""
        result = await self.db.execute(
            select(DepartureClearanceItem).where(
                DepartureClearanceItem.clearance_id == clearance.id
            )
        )
        items = result.scalars().all()

        cleared = 0
        pending = 0
        value_outstanding = Decimal("0")

        for li in items:
            if li.disposition == ClearanceLineDisposition.PENDING:
                pending += 1
                value_outstanding += Decimal(str(li.item_value or 0))
            else:
                cleared += 1

        clearance.items_cleared = cleared
        clearance.items_outstanding = pending
        clearance.value_outstanding = value_outstanding

        # Update status
        if pending == 0 and clearance.total_items > 0:
            # All resolved but don't auto-complete — leave as in_progress
            # until explicitly completed so staff can review
            pass

        if cleared > 0 and clearance.status == ClearanceStatus.INITIATED:
            clearance.status = ClearanceStatus.IN_PROGRESS
