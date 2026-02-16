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
from app.core.security_middleware import InputSanitizer

import re
import html as html_lib


class FormsService:
    """Service for forms management"""

    # Maximum lengths for submitted field values
    MAX_TEXT_LENGTH = 5000
    MAX_TEXTAREA_LENGTH = 50000
    MAX_NAME_LENGTH = 255
    MAX_EMAIL_LENGTH = 254

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Input Sanitization & Validation
    # ============================================

    @staticmethod
    def _sanitize_submission_data(
        data: Dict[str, Any], fields: list
    ) -> Tuple[Dict[str, Any], Optional[str]]:
        """
        Sanitize all submitted form values against their field definitions.
        Returns (sanitized_data, error_message).
        """
        field_map = {str(f.id): f for f in fields}
        sanitized = {}

        for field_id, value in data.items():
            if field_id not in field_map:
                # Ignore values for unknown field IDs (don't store arbitrary keys)
                continue

            field = field_map[field_id]

            # Coerce to string for sanitization
            if value is None:
                sanitized[field_id] = ""
                continue

            str_value = str(value)

            # Remove null bytes
            str_value = str_value.replace('\x00', '')

            # HTML-escape to prevent stored XSS
            str_value = html_lib.escape(str_value)

            # Enforce length limits by field type
            field_type = field.field_type if isinstance(field.field_type, str) else field.field_type.value
            if field_type == "textarea":
                max_len = field.max_length or FormsService.MAX_TEXTAREA_LENGTH
            elif field_type == "email":
                max_len = FormsService.MAX_EMAIL_LENGTH
            else:
                max_len = field.max_length or FormsService.MAX_TEXT_LENGTH

            if len(str_value) > max_len:
                return {}, f"Value for '{field.label}' exceeds maximum length of {max_len} characters"

            # Enforce min_length if set
            if field.min_length and field.required and len(str_value.strip()) < field.min_length:
                return {}, f"Value for '{field.label}' must be at least {field.min_length} characters"

            # Type-specific validation
            if field_type == "email" and str_value.strip():
                email_pattern = r'^[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$'
                raw_value = html_lib.unescape(str_value)
                if not re.match(email_pattern, raw_value):
                    return {}, f"Invalid email format for '{field.label}'"
                # Check for header injection
                if '\n' in raw_value or '\r' in raw_value:
                    return {}, f"Invalid email format for '{field.label}'"

            if field_type == "phone" and str_value.strip():
                raw_value = html_lib.unescape(str_value)
                digits_only = re.sub(r'[^\d+\-() ]', '', raw_value)
                if digits_only != raw_value:
                    return {}, f"Invalid phone number for '{field.label}'"

            if field_type == "number" and str_value.strip():
                try:
                    num_val = float(html_lib.unescape(str_value))
                    if field.min_value is not None and num_val < field.min_value:
                        return {}, f"Value for '{field.label}' must be at least {field.min_value}"
                    if field.max_value is not None and num_val > field.max_value:
                        return {}, f"Value for '{field.label}' must be at most {field.max_value}"
                except ValueError:
                    return {}, f"Invalid number for '{field.label}'"

            if field_type in ("select", "radio") and str_value.strip():
                # Validate against allowed options
                if field.options:
                    allowed = {opt.value if hasattr(opt, 'value') else opt.get('value', '') for opt in field.options}
                    raw_value = html_lib.unescape(str_value)
                    if raw_value not in allowed:
                        return {}, f"Invalid option for '{field.label}'"

            if field_type == "checkbox" and str_value.strip():
                # Validate each comma-separated value against allowed options
                if field.options:
                    allowed = {opt.value if hasattr(opt, 'value') else opt.get('value', '') for opt in field.options}
                    raw_value = html_lib.unescape(str_value)
                    for part in raw_value.split(','):
                        if part and part not in allowed:
                            return {}, f"Invalid option for '{field.label}'"

            # Validation pattern check
            if field.validation_pattern and str_value.strip():
                try:
                    raw_value = html_lib.unescape(str_value)
                    if not re.match(field.validation_pattern, raw_value):
                        return {}, f"Value for '{field.label}' does not match the required format"
                except re.error:
                    pass  # Skip invalid regex patterns

            sanitized[field_id] = str_value

        return sanitized, None

    @staticmethod
    def _sanitize_submitter_info(
        name: Optional[str], email: Optional[str]
    ) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """
        Sanitize submitter name and email.
        Returns (sanitized_name, sanitized_email, error).
        """
        clean_name = None
        clean_email = None

        if name:
            clean_name = InputSanitizer.sanitize_string(name, max_length=255)

        if email:
            raw_email = email.strip()[:254]
            # Basic format check
            if raw_email:
                email_pattern = r'^[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$'
                if not re.match(email_pattern, raw_email):
                    return None, None, "Invalid submitter email format"
                if '\n' in raw_email or '\r' in raw_email:
                    return None, None, "Invalid submitter email format"
                clean_email = html_lib.escape(raw_email.lower())

        return clean_name, clean_email, None

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
            .where(Form.organization_id == str(organization_id))
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
            .where(Form.id == str(form_id))
            .where(Form.organization_id == str(organization_id))
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
                .where(FormField.id == str(field_id))
                .where(FormField.form_id == str(form_id))
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
                .where(FormField.id == str(field_id))
                .where(FormField.form_id == str(form_id))
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

            # Sanitize and validate all submitted values
            sanitized_data, sanitize_error = self._sanitize_submission_data(data, form.fields)
            if sanitize_error:
                return None, sanitize_error

            submission = FormSubmission(
                organization_id=organization_id,
                form_id=form_id,
                submitted_by=submitted_by,
                data=sanitized_data,
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
        honeypot_value: Optional[str] = None,
    ) -> Tuple[Optional[FormSubmission], Optional[str]]:
        """Submit a public form (no authentication required)"""
        try:
            # Honeypot bot detection - if the hidden field has a value, it's a bot
            if honeypot_value:
                # Silently reject but return success to not tip off the bot
                return None, None

            form = await self.get_form_by_slug(slug)
            if not form:
                return None, "Form not found or not available"

            # Validate required fields
            for field in form.fields:
                if field.required and str(field.id) not in data:
                    return None, f"Required field '{field.label}' is missing"

            # Sanitize and validate all submitted values
            sanitized_data, sanitize_error = self._sanitize_submission_data(data, form.fields)
            if sanitize_error:
                return None, sanitize_error

            # Sanitize submitter info
            clean_name, clean_email, info_error = self._sanitize_submitter_info(
                submitter_name, submitter_email
            )
            if info_error:
                return None, info_error

            submission = FormSubmission(
                organization_id=form.organization_id,
                form_id=form.id,
                data=sanitized_data,
                submitter_name=clean_name,
                submitter_email=clean_email,
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
            .where(FormSubmission.form_id == str(form_id))
            .where(FormSubmission.organization_id == str(organization_id))
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
            .where(FormSubmission.id == str(submission_id))
            .where(FormSubmission.organization_id == str(organization_id))
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
                .where(FormIntegration.id == str(integration_id))
                .where(FormIntegration.form_id == str(form_id))
                .where(FormIntegration.organization_id == str(organization_id))
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
                .where(FormIntegration.id == str(integration_id))
                .where(FormIntegration.form_id == str(form_id))
                .where(FormIntegration.organization_id == str(organization_id))
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
            .where(User.organization_id == str(organization_id))
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
        org_id_str = str(organization_id)
        total_result = await self.db.execute(
            select(func.count(Form.id))
            .where(Form.organization_id == org_id_str)
            .where(Form.is_template == False)
        )
        total_forms = total_result.scalar()

        # Published forms
        published_result = await self.db.execute(
            select(func.count(Form.id))
            .where(Form.organization_id == org_id_str)
            .where(Form.status == FormStatus.PUBLISHED)
            .where(Form.is_template == False)
        )
        published_forms = published_result.scalar()

        # Draft forms
        draft_result = await self.db.execute(
            select(func.count(Form.id))
            .where(Form.organization_id == org_id_str)
            .where(Form.status == FormStatus.DRAFT)
            .where(Form.is_template == False)
        )
        draft_forms = draft_result.scalar()

        # Public forms
        public_result = await self.db.execute(
            select(func.count(Form.id))
            .where(Form.organization_id == org_id_str)
            .where(Form.is_public == True)
            .where(Form.is_template == False)
        )
        public_forms = public_result.scalar()

        # Total submissions
        total_subs_result = await self.db.execute(
            select(func.count(FormSubmission.id))
            .where(FormSubmission.organization_id == org_id_str)
        )
        total_submissions = total_subs_result.scalar()

        # Submissions this month
        first_of_month = date.today().replace(day=1)
        month_subs_result = await self.db.execute(
            select(func.count(FormSubmission.id))
            .where(FormSubmission.organization_id == org_id_str)
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
