"""
Forms Service

Business logic for custom forms including form definitions,
fields, submissions, public forms, integrations, and reporting.
"""

from typing import List, Optional, Dict, Tuple, Any
from datetime import datetime, date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.models.forms import (
    Form,
    FormField,
    FormSubmission,
    FormIntegration,
    FormStatus,
    FormCategory,
    FieldType,
    IntegrationTarget,
    IntegrationType,
)
from app.models.user import Organization, User, UserStatus


class FormsService:
    """Service for forms management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Form Management
    # ============================================

    async def create_form(
        self, organization_id: UUID, form_data: Dict[str, Any], created_by: UUID
    ) -> Tuple[Optional[Form], Optional[str]]:
        """Create a new form with optional fields"""
        try:
            fields_data = form_data.pop("fields", None) or []

            form = Form(
                organization_id=organization_id,
                created_by=created_by,
                **form_data
            )
            self.db.add(form)
            await self.db.flush()  # Get form.id before adding fields

            # Add fields if provided
            for i, field_data in enumerate(fields_data):
                if isinstance(field_data, dict):
                    field_data["sort_order"] = field_data.get("sort_order", i)
                    field = FormField(form_id=form.id, **field_data)
                    self.db.add(field)

            await self.db.commit()
            await self.db.refresh(form)

            # Reload with fields and integrations
            result = await self.db.execute(
                select(Form)
                .where(Form.id == form.id)
                .options(selectinload(Form.fields), selectinload(Form.integrations))
            )
            return result.scalar_one(), None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_forms(
        self,
        organization_id: UUID,
        status: Optional[FormStatus] = None,
        category: Optional[FormCategory] = None,
        search: Optional[str] = None,
        is_template: Optional[bool] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[Form], int]:
        """Get forms with filtering and pagination"""
        query = (
            select(Form)
            .where(Form.organization_id == organization_id)
            .options(selectinload(Form.fields))
        )

        if status:
            query = query.where(Form.status == status)

        if category:
            query = query.where(Form.category == category)

        if is_template is not None:
            query = query.where(Form.is_template == is_template)

        if search:
            search_term = f"%{search}%"
            query = query.where(
                or_(
                    Form.name.ilike(search_term),
                    Form.description.ilike(search_term),
                )
            )

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # Get paginated results
        query = query.order_by(Form.updated_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        forms = result.scalars().all()

        return forms, total

    async def get_form_by_id(
        self, form_id: UUID, organization_id: UUID
    ) -> Optional[Form]:
        """Get form by ID with fields and integrations"""
        result = await self.db.execute(
            select(Form)
            .where(Form.id == form_id)
            .where(Form.organization_id == organization_id)
            .options(selectinload(Form.fields), selectinload(Form.integrations))
        )
        return result.scalar_one_or_none()

    async def get_form_by_slug(self, slug: str) -> Optional[Form]:
        """Get a published public form by its slug"""
        result = await self.db.execute(
            select(Form)
            .where(Form.public_slug == slug)
            .where(Form.is_public == True)
            .where(Form.status == FormStatus.PUBLISHED)
            .options(selectinload(Form.fields), selectinload(Form.integrations))
        )
        return result.scalar_one_or_none()

    async def update_form(
        self, form_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[Form], Optional[str]]:
        """Update a form"""
        try:
            form = await self.get_form_by_id(form_id, organization_id)
            if not form:
                return None, "Form not found"

            # Handle status changes
            if "status" in update_data:
                new_status = update_data["status"]
                if new_status == "published" and form.status != FormStatus.PUBLISHED:
                    update_data["published_at"] = datetime.now()

            for key, value in update_data.items():
                setattr(form, key, value)

            await self.db.commit()
            await self.db.refresh(form)
            return form, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def delete_form(
        self, form_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Delete a form and all its fields/submissions"""
        try:
            form = await self.get_form_by_id(form_id, organization_id)
            if not form:
                return False, "Form not found"

            await self.db.delete(form)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def publish_form(
        self, form_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[Form], Optional[str]]:
        """Publish a form (make it available for submissions)"""
        return await self.update_form(form_id, organization_id, {"status": "published"})

    async def archive_form(
        self, form_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[Form], Optional[str]]:
        """Archive a form"""
        return await self.update_form(form_id, organization_id, {"status": "archived"})

    # ============================================
    # Field Management
    # ============================================

    async def add_field(
        self, form_id: UUID, organization_id: UUID, field_data: Dict[str, Any]
    ) -> Tuple[Optional[FormField], Optional[str]]:
        """Add a field to a form"""
        try:
            form = await self.get_form_by_id(form_id, organization_id)
            if not form:
                return None, "Form not found"

            # Auto-set sort_order if not provided
            if "sort_order" not in field_data or field_data["sort_order"] is None:
                max_order = max((f.sort_order for f in form.fields), default=-1)
                field_data["sort_order"] = max_order + 1

            field = FormField(form_id=form_id, **field_data)
            self.db.add(field)
            await self.db.commit()
            await self.db.refresh(field)
            return field, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def update_field(
        self, field_id: UUID, form_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[FormField], Optional[str]]:
        """Update a form field"""
        try:
            # Verify form belongs to organization
            form = await self.get_form_by_id(form_id, organization_id)
            if not form:
                return None, "Form not found"

            result = await self.db.execute(
                select(FormField)
                .where(FormField.id == field_id)
                .where(FormField.form_id == form_id)
            )
            field = result.scalar_one_or_none()
            if not field:
                return None, "Field not found"

            for key, value in update_data.items():
                setattr(field, key, value)

            await self.db.commit()
            await self.db.refresh(field)
            return field, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def delete_field(
        self, field_id: UUID, form_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Delete a form field"""
        try:
            form = await self.get_form_by_id(form_id, organization_id)
            if not form:
                return False, "Form not found"

            result = await self.db.execute(
                select(FormField)
                .where(FormField.id == field_id)
                .where(FormField.form_id == form_id)
            )
            field = result.scalar_one_or_none()
            if not field:
                return False, "Field not found"

            await self.db.delete(field)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def reorder_fields(
        self, form_id: UUID, organization_id: UUID, field_order: List[str]
    ) -> Tuple[bool, Optional[str]]:
        """Reorder fields based on provided ID list"""
        try:
            form = await self.get_form_by_id(form_id, organization_id)
            if not form:
                return False, "Form not found"

            field_map = {str(f.id): f for f in form.fields}
            for i, fid in enumerate(field_order):
                if fid in field_map:
                    field_map[fid].sort_order = i

            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    # ============================================
    # Submission Management
    # ============================================

    async def submit_form(
        self,
        form_id: UUID,
        organization_id: UUID,
        data: Dict[str, Any],
        submitted_by: Optional[UUID] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> Tuple[Optional[FormSubmission], Optional[str]]:
        """Submit a form (authenticated user)"""
        try:
            form = await self.get_form_by_id(form_id, organization_id)
            if not form:
                return None, "Form not found"

            if form.status != FormStatus.PUBLISHED:
                return None, "Form is not accepting submissions"

            # Validate required fields
            for field in form.fields:
                if field.required and str(field.id) not in data:
                    return None, f"Required field '{field.label}' is missing"

            submission = FormSubmission(
                organization_id=organization_id,
                form_id=form_id,
                submitted_by=submitted_by,
                data=data,
                ip_address=ip_address,
                user_agent=user_agent,
            )
            self.db.add(submission)
            await self.db.commit()
            await self.db.refresh(submission)

            # Process integrations
            await self._process_integrations(submission, form)

            return submission, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def submit_public_form(
        self,
        slug: str,
        data: Dict[str, Any],
        submitter_name: Optional[str] = None,
        submitter_email: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> Tuple[Optional[FormSubmission], Optional[str]]:
        """Submit a public form (no authentication required)"""
        try:
            form = await self.get_form_by_slug(slug)
            if not form:
                return None, "Form not found or not available"

            # Validate required fields
            for field in form.fields:
                if field.required and str(field.id) not in data:
                    return None, f"Required field '{field.label}' is missing"

            submission = FormSubmission(
                organization_id=form.organization_id,
                form_id=form.id,
                data=data,
                submitter_name=submitter_name,
                submitter_email=submitter_email,
                is_public_submission=True,
                ip_address=ip_address,
                user_agent=user_agent,
            )
            self.db.add(submission)
            await self.db.commit()
            await self.db.refresh(submission)

            # Process integrations
            await self._process_integrations(submission, form)

            return submission, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_submissions(
        self,
        form_id: UUID,
        organization_id: UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[FormSubmission], int]:
        """Get submissions for a form"""
        query = (
            select(FormSubmission)
            .where(FormSubmission.form_id == form_id)
            .where(FormSubmission.organization_id == organization_id)
            .options(selectinload(FormSubmission.submitter))
        )

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # Paginated results
        query = query.order_by(FormSubmission.submitted_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        submissions = result.scalars().all()

        return submissions, total

    async def get_submission_by_id(
        self, submission_id: UUID, organization_id: UUID
    ) -> Optional[FormSubmission]:
        """Get a specific submission"""
        result = await self.db.execute(
            select(FormSubmission)
            .where(FormSubmission.id == submission_id)
            .where(FormSubmission.organization_id == organization_id)
            .options(
                selectinload(FormSubmission.submitter),
                selectinload(FormSubmission.form),
            )
        )
        return result.scalar_one_or_none()

    async def delete_submission(
        self, submission_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Delete a form submission"""
        try:
            submission = await self.get_submission_by_id(submission_id, organization_id)
            if not submission:
                return False, "Submission not found"

            await self.db.delete(submission)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    # ============================================
    # Integration Management
    # ============================================

    async def add_integration(
        self,
        form_id: UUID,
        organization_id: UUID,
        integration_data: Dict[str, Any],
    ) -> Tuple[Optional[FormIntegration], Optional[str]]:
        """Add an integration to a form"""
        try:
            form = await self.get_form_by_id(form_id, organization_id)
            if not form:
                return None, "Form not found"

            # Validate target_module and integration_type
            try:
                IntegrationTarget(integration_data["target_module"])
            except (ValueError, KeyError):
                return None, "Invalid target module"

            try:
                IntegrationType(integration_data["integration_type"])
            except (ValueError, KeyError):
                return None, "Invalid integration type"

            integration = FormIntegration(
                form_id=form_id,
                organization_id=organization_id,
                **integration_data,
            )
            self.db.add(integration)
            await self.db.commit()
            await self.db.refresh(integration)
            return integration, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def update_integration(
        self,
        integration_id: UUID,
        form_id: UUID,
        organization_id: UUID,
        update_data: Dict[str, Any],
    ) -> Tuple[Optional[FormIntegration], Optional[str]]:
        """Update a form integration"""
        try:
            result = await self.db.execute(
                select(FormIntegration)
                .where(FormIntegration.id == integration_id)
                .where(FormIntegration.form_id == form_id)
                .where(FormIntegration.organization_id == organization_id)
            )
            integration = result.scalar_one_or_none()
            if not integration:
                return None, "Integration not found"

            for key, value in update_data.items():
                setattr(integration, key, value)

            await self.db.commit()
            await self.db.refresh(integration)
            return integration, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def delete_integration(
        self,
        integration_id: UUID,
        form_id: UUID,
        organization_id: UUID,
    ) -> Tuple[bool, Optional[str]]:
        """Delete a form integration"""
        try:
            result = await self.db.execute(
                select(FormIntegration)
                .where(FormIntegration.id == integration_id)
                .where(FormIntegration.form_id == form_id)
                .where(FormIntegration.organization_id == organization_id)
            )
            integration = result.scalar_one_or_none()
            if not integration:
                return False, "Integration not found"

            await self.db.delete(integration)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def _process_integrations(
        self, submission: FormSubmission, form: Form
    ) -> None:
        """Process integrations after a form submission"""
        if not form.integrations:
            return

        results = {}
        for integration in form.integrations:
            if not integration.is_active:
                continue

            try:
                if integration.integration_type == IntegrationType.MEMBERSHIP_INTEREST:
                    result = await self._process_membership_interest(
                        submission, integration
                    )
                    results["membership_interest"] = result
                elif integration.integration_type == IntegrationType.EQUIPMENT_ASSIGNMENT:
                    result = await self._process_equipment_assignment(
                        submission, integration
                    )
                    results["equipment_assignment"] = result
            except Exception as e:
                results[integration.integration_type] = {
                    "success": False,
                    "error": str(e),
                }

        if results:
            submission.integration_processed = True
            submission.integration_result = results
            await self.db.commit()

    async def _process_membership_interest(
        self, submission: FormSubmission, integration: FormIntegration
    ) -> Dict[str, Any]:
        """
        Process a membership interest form submission.
        Stores the interest record with mapped fields for admin review.
        """
        mappings = integration.field_mappings or {}
        mapped_data = {}

        for field_id, target_field in mappings.items():
            if field_id in submission.data:
                mapped_data[target_field] = submission.data[field_id]

        # The submission itself serves as the membership interest record.
        # Admins can review it in the submissions view with the mapped data.
        return {
            "success": True,
            "mapped_data": mapped_data,
            "message": "Membership interest recorded for admin review",
        }

    async def _process_equipment_assignment(
        self, submission: FormSubmission, integration: FormIntegration
    ) -> Dict[str, Any]:
        """
        Process an equipment assignment form submission.
        Maps form data to inventory assignment fields for processing.
        """
        mappings = integration.field_mappings or {}
        mapped_data = {}

        for field_id, target_field in mappings.items():
            if field_id in submission.data:
                mapped_data[target_field] = submission.data[field_id]

        # Validate required fields for equipment assignment
        if "member_id" not in mapped_data:
            return {
                "success": False,
                "error": "Member ID mapping is required for equipment assignment",
            }

        if "item_id" not in mapped_data:
            return {
                "success": False,
                "error": "Item ID mapping is required for equipment assignment",
            }

        # Try to perform the assignment via the inventory service
        try:
            from app.services.inventory_service import InventoryService

            inventory_service = InventoryService(self.db)
            assignment, error = await inventory_service.assign_item_to_user(
                item_id=mapped_data["item_id"],
                user_id=mapped_data["member_id"],
                organization_id=submission.organization_id,
                assigned_by=submission.submitted_by or mapped_data.get("member_id"),
                reason=mapped_data.get("reason", "Assigned via form submission"),
            )

            if error:
                return {"success": False, "error": error}

            return {
                "success": True,
                "assignment_id": str(assignment.id) if assignment else None,
                "message": "Equipment assigned successfully",
            }
        except ImportError:
            return {
                "success": False,
                "error": "Inventory service not available",
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ============================================
    # Member Lookup
    # ============================================

    async def search_members(
        self, organization_id: UUID, query: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Search members by name, badge number, or email for member_lookup fields"""
        search_term = f"%{query}%"
        result = await self.db.execute(
            select(User)
            .where(User.organization_id == organization_id)
            .where(User.status == UserStatus.ACTIVE)
            .where(
                or_(
                    User.first_name.ilike(search_term),
                    User.last_name.ilike(search_term),
                    User.email.ilike(search_term),
                    User.badge_number.ilike(search_term),
                    func.concat(User.first_name, " ", User.last_name).ilike(search_term),
                )
            )
            .order_by(User.last_name, User.first_name)
            .limit(limit)
        )
        users = result.scalars().all()

        return [
            {
                "id": str(u.id),
                "first_name": u.first_name or "",
                "last_name": u.last_name or "",
                "full_name": f"{u.first_name or ''} {u.last_name or ''}".strip(),
                "badge_number": u.badge_number,
                "rank": u.rank,
                "station": u.station,
                "email": u.email,
            }
            for u in users
        ]

    # ============================================
    # Summary & Reporting
    # ============================================

    async def get_summary(self, organization_id: UUID) -> Dict[str, Any]:
        """Get forms summary statistics"""
        # Total forms (non-template)
        total_result = await self.db.execute(
            select(func.count(Form.id))
            .where(Form.organization_id == organization_id)
            .where(Form.is_template == False)
        )
        total_forms = total_result.scalar()

        # Published forms
        published_result = await self.db.execute(
            select(func.count(Form.id))
            .where(Form.organization_id == organization_id)
            .where(Form.status == FormStatus.PUBLISHED)
            .where(Form.is_template == False)
        )
        published_forms = published_result.scalar()

        # Draft forms
        draft_result = await self.db.execute(
            select(func.count(Form.id))
            .where(Form.organization_id == organization_id)
            .where(Form.status == FormStatus.DRAFT)
            .where(Form.is_template == False)
        )
        draft_forms = draft_result.scalar()

        # Public forms
        public_result = await self.db.execute(
            select(func.count(Form.id))
            .where(Form.organization_id == organization_id)
            .where(Form.is_public == True)
            .where(Form.is_template == False)
        )
        public_forms = public_result.scalar()

        # Total submissions
        total_subs_result = await self.db.execute(
            select(func.count(FormSubmission.id))
            .where(FormSubmission.organization_id == organization_id)
        )
        total_submissions = total_subs_result.scalar()

        # Submissions this month
        first_of_month = date.today().replace(day=1)
        month_subs_result = await self.db.execute(
            select(func.count(FormSubmission.id))
            .where(FormSubmission.organization_id == organization_id)
            .where(FormSubmission.submitted_at >= datetime.combine(first_of_month, datetime.min.time()))
        )
        submissions_this_month = month_subs_result.scalar()

        return {
            "total_forms": total_forms,
            "published_forms": published_forms,
            "draft_forms": draft_forms,
            "total_submissions": total_submissions,
            "submissions_this_month": submissions_this_month,
            "public_forms": public_forms,
        }
