"""
Forms Service

Business logic for custom forms including form definitions,
fields, submissions, public forms, integrations, and reporting.
"""

import html as html_lib
import re
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security_middleware import InputSanitizer
from app.models.forms import (
    FieldType,
    Form,
    FormCategory,
    FormField,
    FormIntegration,
    FormStatus,
    FormSubmission,
    IntegrationTarget,
    IntegrationType,
)
from app.models.user import User, UserStatus


class FormsService:
    """Service for forms management"""

    # Maximum lengths for submitted field values
    MAX_TEXT_LENGTH = 5000
    MAX_TEXTAREA_LENGTH = 50000
    MAX_NAME_LENGTH = 255
    MAX_EMAIL_LENGTH = 254

    # ------------------------------------------------------------------
    # Required target fields and label-based fallback maps per
    # integration type.  These are used for:
    #   1. Server-side validation when creating/updating integrations
    #   2. Fallback mapping when field_mappings are stale or empty
    # ------------------------------------------------------------------
    _REQUIRED_FIELDS: Dict[str, set] = {
        IntegrationType.EQUIPMENT_ASSIGNMENT: {"member_id", "item_id"},
        IntegrationType.EVENT_REGISTRATION: {"event_id"},
        IntegrationType.EVENT_REQUEST: {"contact_name", "contact_email"},
    }

    _EQUIPMENT_LABEL_MAP: Dict[str, str] = {
        "member": "member_id",
        "member id": "member_id",
        "assigned to": "member_id",
        "assignee": "member_id",
        "item": "item_id",
        "item id": "item_id",
        "equipment": "item_id",
        "equipment id": "item_id",
        "reason": "reason",
        "notes": "reason",
        "reason / notes": "reason",
    }

    _EVENT_REGISTRATION_LABEL_MAP: Dict[str, str] = {
        "event": "event_id",
        "event id": "event_id",
        "notes": "notes",
        "comments": "notes",
    }

    _EVENT_REQUEST_LABEL_MAP: Dict[str, str] = {
        "contact name": "contact_name",
        "name": "contact_name",
        "full name": "contact_name",
        "your name": "contact_name",
        "contact email": "contact_email",
        "email": "contact_email",
        "email address": "contact_email",
        "phone": "contact_phone",
        "phone number": "contact_phone",
        "contact phone": "contact_phone",
        "telephone": "contact_phone",
        "organization": "organization_name",
        "organization name": "organization_name",
        "org name": "organization_name",
        "company": "organization_name",
        "outreach type": "outreach_type",
        "type": "outreach_type",
        "request type": "outreach_type",
        "description": "description",
        "event description": "description",
        "details": "description",
        "date flexibility": "date_flexibility",
        "preferred timeframe": "preferred_timeframe",
        "timeframe": "preferred_timeframe",
        "preferred date": "preferred_timeframe",
        "time of day": "preferred_time_of_day",
        "preferred time": "preferred_time_of_day",
        "audience size": "audience_size",
        "expected attendees": "audience_size",
        "number of attendees": "audience_size",
        "attendees": "audience_size",
        "age group": "age_group",
        "age range": "age_group",
        "venue preference": "venue_preference",
        "venue": "venue_preference",
        "venue address": "venue_address",
        "location": "venue_address",
        "address": "venue_address",
        "special requests": "special_requests",
        "additional notes": "special_requests",
        "special needs": "special_requests",
    }

    _LABEL_MAPS: Dict[str, Dict[str, str]] = {
        IntegrationType.EQUIPMENT_ASSIGNMENT: _EQUIPMENT_LABEL_MAP,
        IntegrationType.EVENT_REGISTRATION: _EVENT_REGISTRATION_LABEL_MAP,
        IntegrationType.EVENT_REQUEST: _EVENT_REQUEST_LABEL_MAP,
    }

    # Field-type fallback (used when labels are ambiguous).
    _INTEGRATION_FIELD_TYPE_MAP: Dict[str, Dict[str, str]] = {
        IntegrationType.EVENT_REQUEST: {
            "email": "contact_email",
            "phone": "contact_phone",
        },
    }

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
            str_value = str_value.replace("\x00", "")

            # HTML-escape to prevent stored XSS
            str_value = html_lib.escape(str_value)

            # Enforce length limits by field type
            field_type = (
                field.field_type
                if isinstance(field.field_type, str)
                else field.field_type.value
            )
            if field_type == FieldType.TEXTAREA.value:
                max_len = field.max_length or FormsService.MAX_TEXTAREA_LENGTH
            elif field_type == FieldType.EMAIL.value:
                max_len = FormsService.MAX_EMAIL_LENGTH
            else:
                max_len = field.max_length or FormsService.MAX_TEXT_LENGTH

            if len(str_value) > max_len:
                return (
                    {},
                    f"Value for '{field.label}' exceeds maximum length of {max_len} characters",
                )

            # Enforce min_length if set
            if (
                field.min_length
                and field.required
                and len(str_value.strip()) < field.min_length
            ):
                return (
                    {},
                    f"Value for '{field.label}' must be at least {field.min_length} characters",
                )

            # Type-specific validation
            if field_type == FieldType.EMAIL.value and str_value.strip():
                email_pattern = r"^[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$"
                raw_value = html_lib.unescape(str_value)
                if not re.match(email_pattern, raw_value):
                    return {}, f"Invalid email format for '{field.label}'"
                # Check for header injection
                if "\n" in raw_value or "\r" in raw_value:
                    return {}, f"Invalid email format for '{field.label}'"

            if field_type == FieldType.PHONE.value and str_value.strip():
                raw_value = html_lib.unescape(str_value)
                digits_only = re.sub(r"[^\d+\-() ]", "", raw_value)
                if digits_only != raw_value:
                    return {}, f"Invalid phone number for '{field.label}'"

            if field_type == FieldType.NUMBER.value and str_value.strip():
                try:
                    num_val = float(html_lib.unescape(str_value))
                    if field.min_value is not None and num_val < field.min_value:
                        return (
                            {},
                            f"Value for '{field.label}' must be at least {field.min_value}",
                        )
                    if field.max_value is not None and num_val > field.max_value:
                        return (
                            {},
                            f"Value for '{field.label}' must be at most {field.max_value}",
                        )
                except ValueError:
                    return {}, f"Invalid number for '{field.label}'"

            if (
                field_type in (FieldType.SELECT.value, FieldType.RADIO.value)
                and str_value.strip()
            ):
                # Validate against allowed options
                if field.options:
                    allowed = {
                        opt.value if hasattr(opt, "value") else opt.get("value", "")
                        for opt in field.options
                    }
                    raw_value = html_lib.unescape(str_value)
                    if raw_value not in allowed:
                        return {}, f"Invalid option for '{field.label}'"

            if field_type == FieldType.CHECKBOX.value and str_value.strip():
                # Validate each comma-separated value against allowed options
                if field.options:
                    allowed = {
                        opt.value if hasattr(opt, "value") else opt.get("value", "")
                        for opt in field.options
                    }
                    raw_value = html_lib.unescape(str_value)
                    for part in raw_value.split(","):
                        if part and part not in allowed:
                            return {}, f"Invalid option for '{field.label}'"

            # Validation pattern check
            if field.validation_pattern and str_value.strip():
                try:
                    raw_value = html_lib.unescape(str_value)
                    if not re.match(field.validation_pattern, raw_value):
                        return (
                            {},
                            f"Value for '{field.label}' does not match the required format",
                        )
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
                email_pattern = r"^[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$"
                if not re.match(email_pattern, raw_email):
                    return None, None, "Invalid submitter email format"
                if "\n" in raw_email or "\r" in raw_email:
                    return None, None, "Invalid submitter email format"
                clean_email = html_lib.escape(raw_email.lower())

        return clean_name, clean_email, None

    # ============================================
    # Form Management
    # ============================================

    # Maps IntegrationType → IntegrationTarget so the caller only needs
    # to specify the integration_type (e.g. "membership_interest") and the
    # correct target_module is derived automatically.
    _INTEGRATION_TYPE_TO_TARGET: Dict[str, str] = {
        IntegrationType.MEMBERSHIP_INTEREST: IntegrationTarget.MEMBERSHIP,
        IntegrationType.EQUIPMENT_ASSIGNMENT: IntegrationTarget.INVENTORY,
        IntegrationType.EVENT_REGISTRATION: IntegrationTarget.EVENTS,
        IntegrationType.EVENT_REQUEST: IntegrationTarget.EVENTS,
    }

    async def create_form(
        self, organization_id: UUID, form_data: Dict[str, Any], created_by: UUID
    ) -> Tuple[Optional[Form], Optional[str]]:
        """Create a new form with optional fields.

        When *integration_type* is included in *form_data* the method
        will auto-create a ``FormIntegration`` with label-based
        field-mappings so the form is immediately usable by the target
        module (pipeline, inventory, events, etc.).
        """
        from loguru import logger

        try:
            fields_data = form_data.pop("fields", None) or []
            integration_type_str = form_data.pop("integration_type", None)

            form = Form(
                organization_id=organization_id, created_by=created_by, **form_data
            )
            self.db.add(form)
            await self.db.flush()  # Get form.id before adding fields

            # Add fields if provided
            created_fields: List[FormField] = []
            for i, field_data in enumerate(fields_data):
                if isinstance(field_data, dict):
                    field_data["sort_order"] = field_data.get("sort_order", i)
                    field = FormField(form_id=form.id, **field_data)
                    self.db.add(field)
                    created_fields.append(field)

            # Flush so we have field IDs for the integration mapping.
            if created_fields:
                await self.db.flush()

            # Auto-create integration when a type hint is provided.
            if integration_type_str and created_fields:
                self._auto_create_integration(
                    form, created_fields, integration_type_str, organization_id, logger
                )

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

    def _auto_create_integration(
        self,
        form: Form,
        fields: List[FormField],
        integration_type_str: str,
        organization_id: UUID,
        logger: Any,
    ) -> None:
        """Build field-mappings from labels and create a FormIntegration.

        Called during ``create_form`` when the caller supplies an
        ``integration_type`` (e.g. from a starter template).  Uses the
        same label maps defined on this class for consistency with the
        submission-time fallback logic.
        """
        from app.models.user import generate_uuid

        try:
            integration_type = IntegrationType(integration_type_str)
        except ValueError:
            logger.warning(
                f"Unknown integration_type '{integration_type_str}' — "
                "skipping auto-integration."
            )
            return

        target_module = self._INTEGRATION_TYPE_TO_TARGET.get(integration_type)
        if not target_module:
            return

        # Use the membership pipeline service label map for membership,
        # otherwise use FormsService label maps.
        if integration_type == IntegrationType.MEMBERSHIP_INTEREST:
            from app.services.membership_pipeline_service import (
                MembershipPipelineService,
            )

            label_map = MembershipPipelineService._LABEL_MAP
            ft_map = MembershipPipelineService._FIELD_TYPE_MAP
        else:
            label_map = self._LABEL_MAPS.get(integration_type, {})
            ft_map = self._INTEGRATION_FIELD_TYPE_MAP.get(integration_type, {})

        field_mappings: Dict[str, str] = {}
        used_targets: set = set()

        # Pass 1: match by label.
        for field in fields:
            normalised = field.label.strip().lower()
            target = label_map.get(normalised)
            if target and target not in used_targets:
                field_mappings[str(field.id)] = target
                used_targets.add(target)

        # Pass 2: match by field_type for any remaining targets.
        for field in fields:
            if str(field.id) in field_mappings:
                continue
            ft = field.field_type
            if hasattr(ft, "value"):
                ft = ft.value
            target = ft_map.get(ft)
            if target and target not in used_targets:
                field_mappings[str(field.id)] = target
                used_targets.add(target)

        if not field_mappings:
            logger.warning(
                f"Could not auto-map any fields for integration "
                f"{integration_type_str} on form {form.id}"
            )
            return

        integration = FormIntegration(
            id=generate_uuid(),
            form_id=form.id,
            organization_id=str(organization_id),
            target_module=target_module,
            integration_type=integration_type,
            field_mappings=field_mappings,
            is_active=True,
        )
        self.db.add(integration)

        logger.info(
            f"Auto-created {integration_type_str} integration for form "
            f"{form.id} with {len(field_mappings)} field mapping(s)"
        )

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
            safe_search = (
                search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            )
            search_term = f"%{safe_search}%"
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
            .where(Form.is_public == True)  # noqa: E712
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
                if (
                    new_status == FormStatus.PUBLISHED.value
                    and form.status != FormStatus.PUBLISHED
                ):
                    update_data["published_at"] = datetime.now(timezone.utc)

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
        """Delete a form and all its fields/submissions.

        Blocks deletion if the form is actively referenced by a
        membership pipeline step — deleting it would silently break
        the pipeline.
        """
        try:
            from app.models.membership_pipeline import MembershipPipelineStep

            form = await self.get_form_by_id(form_id, organization_id)
            if not form:
                return False, "Form not found"

            # Check whether any pipeline step references this form.
            step_result = await self.db.execute(
                select(
                    MembershipPipelineStep.id,
                    MembershipPipelineStep.name,
                ).where(
                    func.json_unquote(
                        func.json_extract(
                            MembershipPipelineStep.config, "$.form_id"
                        )
                    )
                    == str(form_id)
                )
            )
            referencing_steps = step_result.all()
            if referencing_steps:
                step_names = ", ".join(
                    s.name or s.id for s in referencing_steps
                )
                return False, (
                    f"This form cannot be deleted because it is used by "
                    f"pipeline step(s): {step_names}. Remove the form "
                    f"reference from those steps first."
                )

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

    async def _refresh_integration_mappings(self, form: Form) -> None:
        """Re-map field_mappings on every active integration for *form*.

        Called after field add / rename / delete so that integrations
        stay in sync with the current set of form fields.  Uses the
        same label-based mapping logic as ``_auto_create_integration``
        and the submission-time fallback.
        """
        from loguru import logger

        from app.services.membership_pipeline_service import MembershipPipelineService

        if not form.integrations:
            return

        # Reload fields to get the latest set (including any just-added
        # field or excluding any just-deleted field).
        fields_result = await self.db.execute(
            select(FormField).where(FormField.form_id == str(form.id))
        )
        fields = list(fields_result.scalars().all())
        if not fields:
            return

        for integration in form.integrations:
            if not integration.is_active:
                continue

            int_type = integration.integration_type
            if hasattr(int_type, "value"):
                int_type = int_type.value

            # Pick the right label + field-type maps.
            if int_type == IntegrationType.MEMBERSHIP_INTEREST:
                label_map = MembershipPipelineService._LABEL_MAP
                ft_map = MembershipPipelineService._FIELD_TYPE_MAP
            else:
                label_map = self._LABEL_MAPS.get(int_type, {})
                ft_map = self._INTEGRATION_FIELD_TYPE_MAP.get(int_type, {})

            if not label_map:
                continue

            new_mappings: Dict[str, str] = {}
            used_targets: set = set()

            for field in fields:
                normalised = field.label.strip().lower()
                target = label_map.get(normalised)
                if target and target not in used_targets:
                    new_mappings[str(field.id)] = target
                    used_targets.add(target)

            for field in fields:
                if str(field.id) in new_mappings:
                    continue
                ft = field.field_type
                if hasattr(ft, "value"):
                    ft = ft.value
                target = ft_map.get(ft)
                if target and target not in used_targets:
                    new_mappings[str(field.id)] = target
                    used_targets.add(target)

            if new_mappings != (integration.field_mappings or {}):
                old_count = len(integration.field_mappings or {})
                integration.field_mappings = new_mappings
                logger.info(
                    f"Refreshed {int_type} integration for form {form.id}: "
                    f"{old_count} → {len(new_mappings)} mapping(s)"
                )

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
            await self.db.flush()

            # Refresh integration mappings so new field is picked up.
            await self._refresh_integration_mappings(form)

            await self.db.commit()
            await self.db.refresh(field)
            return field, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def update_field(
        self,
        field_id: UUID,
        form_id: UUID,
        organization_id: UUID,
        update_data: Dict[str, Any],
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

            await self.db.flush()

            # If the label or field_type changed, refresh integration
            # mappings so they stay in sync.
            if "label" in update_data or "field_type" in update_data:
                await self._refresh_integration_mappings(form)

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
            await self.db.flush()

            # Refresh integration mappings to remove the deleted field.
            await self._refresh_integration_mappings(form)

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
            sanitized_data, sanitize_error = self._sanitize_submission_data(
                data, form.fields
            )
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
            sanitized_data, sanitize_error = self._sanitize_submission_data(
                data, form.fields
            )
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
        query = (
            query.order_by(FormSubmission.submitted_at.desc()).offset(skip).limit(limit)
        )
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

    async def reprocess_submission_integrations(
        self, submission_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[FormSubmission], Optional[str]]:
        """Re-run integrations for an existing submission."""
        try:
            # Load the submission with its form and integrations
            result = await self.db.execute(
                select(FormSubmission)
                .where(FormSubmission.id == str(submission_id))
                .where(FormSubmission.organization_id == str(organization_id))
                .options(
                    selectinload(FormSubmission.form).selectinload(Form.integrations),
                    selectinload(FormSubmission.form).selectinload(Form.fields),
                )
            )
            submission = result.scalar_one_or_none()
            if not submission:
                return None, "Submission not found"

            if not submission.form:
                return None, "Associated form not found"

            # Reset integration state and re-process
            submission.integration_processed = False
            submission.integration_result = None
            await self.db.flush()

            await self._process_integrations(submission, submission.form)
            await self.db.refresh(submission)
            return submission, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

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

    def _validate_field_mappings(
        self,
        integration_type: str,
        field_mappings: Dict[str, str],
        form: Form,
    ) -> Optional[str]:
        """Validate that field_mappings references valid form field IDs and
        covers all required target fields for the integration type.

        Returns an error string, or ``None`` when valid.
        """
        required = self._REQUIRED_FIELDS.get(integration_type)
        if required is None:
            # Membership interest validation is handled by its own service.
            return None

        if not field_mappings:
            return (
                f"field_mappings cannot be empty — the following target fields "
                f"are required: {', '.join(sorted(required))}"
            )

        form_field_ids = {str(f.id) for f in (form.fields or [])}
        bad_ids = [fid for fid in field_mappings if fid not in form_field_ids]
        if bad_ids:
            return (
                f"field_mappings references field IDs that do not exist on "
                f"this form: {', '.join(bad_ids)}"
            )

        mapped_targets = set(field_mappings.values())
        missing = required - mapped_targets
        if missing:
            return (
                f"field_mappings is missing required target field(s): "
                f"{', '.join(sorted(missing))}"
            )

        return None

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
                integration_type = IntegrationType(
                    integration_data["integration_type"]
                )
            except (ValueError, KeyError):
                return None, "Invalid integration type"

            # Validate field_mappings covers required target fields
            field_mappings = integration_data.get("field_mappings") or {}
            mapping_error = self._validate_field_mappings(
                integration_type, field_mappings, form
            )
            if mapping_error:
                return None, mapping_error

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

            # Validate field_mappings when they are being changed
            if "field_mappings" in update_data:
                form = await self.get_form_by_id(form_id, organization_id)
                if form:
                    int_type = update_data.get(
                        "integration_type", integration.integration_type
                    )
                    mapping_error = self._validate_field_mappings(
                        int_type, update_data["field_mappings"] or {}, form
                    )
                    if mapping_error:
                        return None, mapping_error

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
        """Process integrations after a form submission.

        Two paths are supported:

        1. **Direct** (preferred) — ``form.integration_type`` is set on
           the form itself.  Label-based mapping is used inline; no
           ``FormIntegration`` record is needed.
        2. **Legacy** — one or more ``FormIntegration`` rows linked to
           the form provide explicit ``field_mappings``.

        Both paths can coexist during migration: if a form has
        ``integration_type`` set *and* legacy ``FormIntegration`` rows
        for the same type, only the direct path runs to avoid
        duplicate processing.
        """
        results: Dict[str, Any] = {}
        handled_types: set[str] = set()

        # ---- Direct path: form.integration_type ----
        int_type = getattr(form, "integration_type", None)
        if int_type:
            try:
                if int_type == IntegrationType.MEMBERSHIP_INTEREST:
                    result = await self._process_membership_interest(
                        submission, integration=None, form=form
                    )
                    results["membership_interest"] = result
                elif int_type == IntegrationType.EQUIPMENT_ASSIGNMENT:
                    result = await self._process_equipment_assignment(
                        submission, integration=None, form=form
                    )
                    results["equipment_assignment"] = result
                elif int_type == IntegrationType.EVENT_REGISTRATION:
                    result = await self._process_event_registration(
                        submission, integration=None, form=form
                    )
                    results["event_registration"] = result
                elif int_type == IntegrationType.EVENT_REQUEST:
                    result = await self._process_event_request(
                        submission, integration=None, form=form
                    )
                    results["event_request"] = result
                handled_types.add(int_type)
            except Exception as e:
                results[int_type] = {
                    "success": False,
                    "error": str(e),
                }
                handled_types.add(int_type)

        # ---- Legacy path: FormIntegration records ----
        for integration in form.integrations or []:
            if not integration.is_active:
                continue
            it = integration.integration_type
            if hasattr(it, "value"):
                it = it.value
            if it in handled_types:
                continue  # Already processed via direct path

            try:
                if it == IntegrationType.MEMBERSHIP_INTEREST:
                    result = await self._process_membership_interest(
                        submission, integration, form=form
                    )
                    results["membership_interest"] = result
                elif it == IntegrationType.EQUIPMENT_ASSIGNMENT:
                    result = await self._process_equipment_assignment(
                        submission, integration, form=form
                    )
                    results["equipment_assignment"] = result
                elif it == IntegrationType.EVENT_REGISTRATION:
                    result = await self._process_event_registration(
                        submission, integration, form=form
                    )
                    results["event_registration"] = result
                elif it == IntegrationType.EVENT_REQUEST:
                    result = await self._process_event_request(
                        submission, integration, form=form
                    )
                    results["event_request"] = result
            except Exception as e:
                results[it] = {
                    "success": False,
                    "error": str(e),
                }

        if results:
            submission.integration_processed = True
            submission.integration_result = results
            await self.db.commit()

    def _apply_label_fallback(
        self,
        integration_type: str,
        mapped_data: Dict[str, Any],
        sub_data: Dict[str, Any],
        form: Optional[Form],
    ) -> Dict[str, Any]:
        """Try to fill missing target fields by matching form-field labels.

        Uses the integration-specific ``_LABEL_MAPS`` and
        ``_INTEGRATION_FIELD_TYPE_MAP`` tables defined on the class.
        Returns the (potentially augmented) *mapped_data* dict.
        """
        from loguru import logger

        label_map = self._LABEL_MAPS.get(integration_type)
        if label_map is None or not form:
            return mapped_data

        form_fields = getattr(form, "fields", None)
        if not form_fields:
            return mapped_data

        logger.debug(
            f"Label-based fallback triggered for {integration_type} — "
            f"mapped={list(mapped_data.keys())}"
        )

        field_lookup = {str(f.id): f for f in form_fields}
        used_targets = set(mapped_data.keys())
        ft_map = self._INTEGRATION_FIELD_TYPE_MAP.get(integration_type, {})

        for fid, value in sub_data.items():
            if not value:
                continue
            field_def = field_lookup.get(fid)
            if not field_def:
                continue
            normalised_label = field_def.label.strip().lower()
            target = label_map.get(normalised_label)
            if not target and ft_map:
                ft = field_def.field_type
                if hasattr(ft, "value"):
                    ft = ft.value
                target = ft_map.get(ft)
            if target and target not in used_targets:
                mapped_data[target] = value
                used_targets.add(target)

        return mapped_data

    async def _process_membership_interest(
        self,
        submission: FormSubmission,
        integration: Optional[FormIntegration] = None,
        form: Optional[Form] = None,
    ) -> Dict[str, Any]:
        """
        Process a membership interest form submission.
        Maps form fields to prospect fields and auto-creates a
        ProspectiveMember record in the org's default pipeline.

        When *integration* is ``None`` (the direct path via
        ``form.integration_type``), label-based mapping is used as the
        primary strategy — no ``field_mappings`` dict is needed.

        When *integration* is provided (legacy path), its
        ``field_mappings`` are tried first and label-based mapping is
        used as a fallback for any missing required fields.

        Safe to call multiple times for the same submission (e.g. via
        reprocess): if a prospect already exists for this submission it
        is returned without creating a duplicate.
        """
        from loguru import logger

        from app.models.membership_pipeline import ProspectiveMember
        from app.services.membership_pipeline_service import MembershipPipelineService

        sub_data: Dict[str, Any] = (
            submission.data if isinstance(submission.data, dict) else {}
        )
        mapped_data: Dict[str, Any] = {}

        # --- Phase 1: field_mappings (legacy path only) ---
        if integration is not None:
            mappings = integration.field_mappings or {}
            for field_id, target_field in mappings.items():
                if field_id in sub_data:
                    mapped_data[target_field] = sub_data[field_id]

        # --- Phase 2: label-based mapping (always runs) ---
        # For the direct path this is the *only* mapping strategy.
        # For the legacy path it fills in anything field_mappings missed.
        form_fields = getattr(form, "fields", None) if form else None
        has_required = (
            mapped_data.get("first_name")
            and mapped_data.get("last_name")
            and mapped_data.get("email")
        )
        if not has_required and form_fields:
            if integration is not None:
                logger.debug(
                    f"Field-ID mapping incomplete for submission {submission.id} — "
                    f"mapped={list(mapped_data.keys())}. "
                    f"Augmenting with label-based mapping."
                )
            field_lookup = {str(f.id): f for f in form_fields}
            used_targets = set(mapped_data.keys())

            for fid, value in sub_data.items():
                if not value:
                    continue
                field_def = field_lookup.get(fid)
                if not field_def:
                    continue
                normalised_label = field_def.label.strip().lower()
                target = MembershipPipelineService._LABEL_MAP.get(normalised_label)
                if not target:
                    ft = field_def.field_type
                    if hasattr(ft, "value"):
                        ft = ft.value
                    target = MembershipPipelineService._FIELD_TYPE_MAP.get(ft)
                if target and target not in used_targets:
                    mapped_data[target] = value
                    used_targets.add(target)

            has_required = (
                mapped_data.get("first_name")
                and mapped_data.get("last_name")
                and mapped_data.get("email")
            )

        if not has_required:
            missing = [
                f
                for f in ("first_name", "last_name", "email")
                if not mapped_data.get(f)
            ]
            return {
                "success": False,
                "mapped_data": mapped_data,
                "prospect_id": None,
                "message": (
                    f"Prospect creation skipped — missing required field(s): "
                    f"{', '.join(missing)}"
                ),
            }

        # ---- Resolve the pipeline that references this form ----
        pipeline_id = await self._resolve_pipeline_for_form(
            str(form.id) if form else str(submission.form_id)
        )

        # ---- Duplicate guard (idempotent for reprocess) ----
        existing_result = await self.db.execute(
            select(ProspectiveMember).where(
                ProspectiveMember.form_submission_id == str(submission.id)
            )
        )
        existing_prospect = existing_result.scalars().first()
        if existing_prospect is not None:
            # If the prospect landed in the wrong pipeline (or none),
            # reassign it to the correct one so reprocessing actually
            # fixes the problem for the user.
            if pipeline_id and str(existing_prospect.pipeline_id or "") != pipeline_id:
                await self._reassign_prospect_pipeline(
                    existing_prospect, pipeline_id
                )
            return {
                "success": True,
                "mapped_data": mapped_data,
                "prospect_id": str(existing_prospect.id),
                "message": "Prospect already exists for this submission",
            }

        # ---- Create new prospect ----
        try:
            pipeline_service = MembershipPipelineService(self.db)
            prospect_data = {
                "first_name": mapped_data.get("first_name", ""),
                "last_name": mapped_data.get("last_name", ""),
                "email": mapped_data.get("email", ""),
                "phone": mapped_data.get("phone"),
                "mobile": mapped_data.get("mobile"),
                "date_of_birth": mapped_data.get("date_of_birth"),
                "address_street": mapped_data.get("address_street"),
                "address_city": mapped_data.get("address_city"),
                "address_state": mapped_data.get("address_state"),
                "address_zip": mapped_data.get("address_zip"),
                "interest_reason": mapped_data.get("interest_reason"),
                "referral_source": mapped_data.get("referral_source"),
                "form_submission_id": str(submission.id),
                "metadata_": mapped_data,
            }
            if pipeline_id:
                prospect_data["pipeline_id"] = pipeline_id
            prospect = await pipeline_service.create_prospect(
                organization_id=str(submission.organization_id),
                data=prospect_data,
                created_by=None,  # System-created
            )
            prospect_id = str(prospect.id)

            # create_prospect() may return an existing prospect if the
            # email matches an active application (duplicate detection).
            is_duplicate = (
                prospect.form_submission_id
                and prospect.form_submission_id != str(submission.id)
            )
            if is_duplicate:
                logger.info(
                    f"Duplicate application detected for "
                    f"{mapped_data.get('email')} — existing prospect "
                    f"{prospect_id} returned"
                )
                return {
                    "success": True,
                    "mapped_data": mapped_data,
                    "prospect_id": prospect_id,
                    "message": (
                        "Duplicate application detected — an active "
                        "application already exists for this email. "
                        "Notification sent."
                    ),
                }

            logger.info(
                f"Auto-created prospect {prospect_id} from "
                f"form submission {submission.id}"
            )

            # ---- Auto-complete the form_submission pipeline step ----
            # The prospect was just created from this form, so mark the
            # form_submission step as COMPLETED and store the mapped data
            # in action_result so coordinators can review it.
            await self._complete_form_submission_step(
                pipeline_service,
                prospect,
                submission,
                mapped_data,
                logger,
            )

            return {
                "success": True,
                "mapped_data": mapped_data,
                "prospect_id": prospect_id,
                "message": "Prospect auto-created from membership interest form",
            }
        except Exception as e:
            logger.error(
                f"Failed to auto-create prospect from "
                f"form submission {submission.id}: {e}"
            )
            return {
                "success": False,
                "mapped_data": mapped_data,
                "prospect_id": None,
                "message": f"Prospect creation failed: {e}",
            }

    async def _resolve_pipeline_for_form(
        self, form_id: str
    ) -> Optional[str]:
        """Find the pipeline whose step references *form_id* in its config.

        When a membership pipeline step is configured with a form as its
        starting point, the step's ``config`` JSON contains
        ``{"form_id": "<uuid>"}``.  This method looks up that step and
        returns the owning pipeline's ID so that prospects created from
        form submissions are assigned to the correct pipeline — not just
        the organisation's default.

        Returns ``None`` if no step references the form, in which case
        ``create_prospect`` will fall back to the default pipeline.
        """
        from app.models.membership_pipeline import MembershipPipelineStep

        result = await self.db.execute(
            select(MembershipPipelineStep.pipeline_id).where(
                func.json_unquote(
                    func.json_extract(
                        MembershipPipelineStep.config, "$.form_id"
                    )
                )
                == str(form_id)
            )
        )
        pipeline_id = result.scalars().first()
        return str(pipeline_id) if pipeline_id else None

    async def _reassign_prospect_pipeline(
        self, prospect: "ProspectiveMember", pipeline_id: str
    ) -> None:
        """Move an existing prospect to a different pipeline.

        This is used when reprocessing a form submission whose prospect
        was originally created in the wrong pipeline (e.g. because the
        pipeline_id resolution was missing).

        Steps:
        1. Delete old step-progress records
        2. Update the prospect's pipeline_id and current_step_id
        3. Initialize new step-progress records for the target pipeline
        """
        from loguru import logger

        from app.models.membership_pipeline import ProspectStepProgress
        from app.services.membership_pipeline_service import (
            MembershipPipelineService,
        )

        old_pipeline_id = prospect.pipeline_id
        logger.info(
            f"Reassigning prospect {prospect.id} from pipeline "
            f"{old_pipeline_id} to {pipeline_id}"
        )

        # 1. Remove old step-progress records
        await self.db.execute(
            delete(ProspectStepProgress).where(
                ProspectStepProgress.prospect_id == str(prospect.id)
            )
        )

        # 2. Resolve the first step of the new pipeline
        pipeline_service = MembershipPipelineService(self.db)
        first_step_id = await pipeline_service._get_first_step_id(pipeline_id)

        # 3. Update the prospect
        prospect.pipeline_id = pipeline_id
        prospect.current_step_id = first_step_id

        # 4. Initialize step progress for the new pipeline
        await pipeline_service._initialize_step_progress(
            prospect.id, pipeline_id, first_step_id
        )

        await self.db.flush()

    async def _complete_form_submission_step(
        self,
        pipeline_service: Any,
        prospect: Any,
        submission: FormSubmission,
        mapped_data: Dict[str, Any],
        logger: Any,
    ) -> None:
        """Mark the form_submission pipeline step as COMPLETED.

        After ``create_prospect()`` the prospect exists and its first
        step is ``IN_PROGRESS``, but nobody told the pipeline that the
        form was actually submitted.  This method:

        1. Finds the ``form_submission`` step whose ``config.form_id``
           matches this form.
        2. Marks its ``ProspectStepProgress`` as COMPLETED.
        3. Stores the mapped submission data in ``action_result`` so
           coordinators can review the original answers.
        4. Advances the prospect to the next step.
        """
        from app.models.membership_pipeline import (
            MembershipPipelineStep,
            PipelineStepType,
            ProspectStepProgress,
            StepProgressStatus,
        )

        if not prospect.pipeline_id:
            return

        form_id = str(submission.form_id)

        # Find the form_submission step that references this form.
        steps_result = await self.db.execute(
            select(MembershipPipelineStep).where(
                MembershipPipelineStep.pipeline_id == str(prospect.pipeline_id),
                MembershipPipelineStep.step_type == PipelineStepType.FORM_SUBMISSION,
            )
        )
        form_steps = steps_result.scalars().all()

        target_step = None
        for step in form_steps:
            config = step.config or {}
            if config.get("form_id") == form_id:
                target_step = step
                break

        if not target_step:
            logger.debug(
                f"No form_submission step referencing form {form_id} in "
                f"pipeline {prospect.pipeline_id} — skipping auto-complete"
            )
            return

        # Find the progress record for this step.
        progress_result = await self.db.execute(
            select(ProspectStepProgress).where(
                ProspectStepProgress.prospect_id == str(prospect.id),
                ProspectStepProgress.step_id == str(target_step.id),
            )
        )
        progress = progress_result.scalars().first()

        if not progress:
            logger.warning(
                f"No progress record for prospect {prospect.id} / "
                f"step {target_step.id} — cannot auto-complete"
            )
            return

        if progress.status == StepProgressStatus.COMPLETED:
            return  # Already done (e.g. reprocess).

        progress.status = StepProgressStatus.COMPLETED
        progress.completed_at = datetime.now(timezone.utc)
        progress.notes = "Auto-completed: form submitted"
        progress.action_result = {
            "form_submission_id": str(submission.id),
            "form_id": form_id,
            "mapped_data": mapped_data,
        }

        # Advance the prospect to the next step.
        try:
            await pipeline_service._advance_current_step(
                prospect, str(target_step.id)
            )
        except Exception as e:
            logger.warning(
                f"Failed to advance prospect {prospect.id} past "
                f"step {target_step.id}: {e}"
            )

        logger.info(
            f"Auto-completed form_submission step {target_step.id} for "
            f"prospect {prospect.id} (submission {submission.id})"
        )

    async def _process_equipment_assignment(
        self,
        submission: FormSubmission,
        integration: Optional[FormIntegration] = None,
        form: Optional[Form] = None,
    ) -> Dict[str, Any]:
        """
        Process an equipment assignment form submission.
        Maps form data to inventory assignment fields for processing.
        """
        sub_data: Dict[str, Any] = (
            submission.data if isinstance(submission.data, dict) else {}
        )
        mapped_data: Dict[str, Any] = {}

        if integration is not None:
            mappings = integration.field_mappings or {}
            for field_id, target_field in mappings.items():
                if field_id in sub_data:
                    mapped_data[target_field] = sub_data[field_id]

        # Label-based mapping — primary path when integration is None,
        # fallback when field_mappings are stale.
        if not (mapped_data.get("member_id") and mapped_data.get("item_id")):
            mapped_data = self._apply_label_fallback(
                IntegrationType.EQUIPMENT_ASSIGNMENT, mapped_data, sub_data, form
            )

        # Validate required fields for equipment assignment
        missing = [
            f
            for f in ("member_id", "item_id")
            if not mapped_data.get(f)
        ]
        if missing:
            return {
                "success": False,
                "error": (
                    f"Equipment assignment missing required mapping(s): "
                    f"{', '.join(missing)}"
                ),
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

    async def _process_event_registration(
        self,
        submission: FormSubmission,
        integration: Optional[FormIntegration] = None,
        form: Optional[Form] = None,
    ) -> Dict[str, Any]:
        """
        Process a public event registration form submission.
        Creates an EventRSVP (if the submitter is a member) or stores
        registration data for admin review.
        """
        sub_data: Dict[str, Any] = (
            submission.data if isinstance(submission.data, dict) else {}
        )
        mapped_data: Dict[str, Any] = {}

        if integration is not None:
            mappings = integration.field_mappings or {}
            for field_id, target_field in mappings.items():
                if field_id in sub_data:
                    mapped_data[target_field] = sub_data[field_id]

        # Label-based mapping — primary path when integration is None,
        # fallback when field_mappings are stale.
        if not mapped_data.get("event_id"):
            mapped_data = self._apply_label_fallback(
                IntegrationType.EVENT_REGISTRATION, mapped_data, sub_data, form
            )

        event_id = mapped_data.get("event_id")
        if not event_id:
            return {
                "success": False,
                "error": "event_id mapping is required for event registration",
            }

        # If the submitter is an authenticated member, create an RSVP
        if submission.submitted_by:
            try:
                from app.core.utils import generate_uuid
                from app.models.event import EventRSVP, RSVPStatus

                rsvp = EventRSVP(
                    id=generate_uuid(),
                    organization_id=submission.organization_id,
                    event_id=event_id,
                    user_id=submission.submitted_by,
                    status=RSVPStatus.GOING,
                    notes=mapped_data.get("notes", "Registered via form"),
                )
                self.db.add(rsvp)
                await self.db.flush()
                return {
                    "success": True,
                    "rsvp_id": rsvp.id,
                    "message": "Member RSVP created via form registration",
                }
            except Exception as e:
                return {"success": False, "error": str(e)}
        else:
            # Public/anonymous submission — store for admin review
            return {
                "success": True,
                "mapped_data": mapped_data,
                "message": "Event registration recorded for admin review",
            }

    async def _process_event_request(
        self,
        submission: FormSubmission,
        integration: Optional[FormIntegration] = None,
        form: Optional[Form] = None,
    ) -> Dict[str, Any]:
        """
        Process an event request form submission.
        Creates an EventRequest record for coordinator review.
        """
        from app.models.event_request import (
            EventRequest,
            EventRequestActivity,
            EventRequestStatus,
        )

        sub_data: Dict[str, Any] = (
            submission.data if isinstance(submission.data, dict) else {}
        )
        mapped_data: Dict[str, Any] = {}

        if integration is not None:
            mappings = integration.field_mappings or {}
            for field_id, target_field in mappings.items():
                if field_id in sub_data:
                    mapped_data[target_field] = sub_data[field_id]

        # Label-based mapping — primary path when integration is None,
        # fallback when field_mappings are stale.
        if not (mapped_data.get("contact_name") and mapped_data.get("contact_email")):
            mapped_data = self._apply_label_fallback(
                IntegrationType.EVENT_REQUEST, mapped_data, sub_data, form
            )

        contact_name = mapped_data.get("contact_name", "")
        contact_email = mapped_data.get("contact_email", "")
        if not contact_name or not contact_email:
            missing = [
                f
                for f in ("contact_name", "contact_email")
                if not mapped_data.get(f)
            ]
            return {
                "success": False,
                "error": (
                    f"Event request missing required mapping(s): "
                    f"{', '.join(missing)}"
                ),
            }

        try:
            event_request = EventRequest(
                organization_id=submission.organization_id,
                contact_name=contact_name,
                contact_email=contact_email,
                contact_phone=mapped_data.get("contact_phone"),
                organization_name=mapped_data.get("organization_name"),
                outreach_type=mapped_data.get("outreach_type", "other"),
                description=mapped_data.get("description", "Submitted via form"),
                date_flexibility=mapped_data.get("date_flexibility", "flexible"),
                preferred_timeframe=mapped_data.get("preferred_timeframe"),
                preferred_time_of_day=mapped_data.get(
                    "preferred_time_of_day", "flexible"
                ),
                audience_size=(
                    int(mapped_data["audience_size"])
                    if mapped_data.get("audience_size")
                    else None
                ),
                age_group=mapped_data.get("age_group"),
                venue_preference=mapped_data.get("venue_preference", "their_location"),
                venue_address=mapped_data.get("venue_address"),
                special_requests=mapped_data.get("special_requests"),
                status=EventRequestStatus.SUBMITTED,
                form_submission_id=str(submission.id),
                ip_address=submission.ip_address,
            )
            self.db.add(event_request)
            await self.db.flush()

            activity = EventRequestActivity(
                request_id=event_request.id,
                action="submitted",
                new_status=EventRequestStatus.SUBMITTED.value,
                notes="Request submitted via public form",
            )
            self.db.add(activity)
            await self.db.flush()

            return {
                "success": True,
                "event_request_id": event_request.id,
                "status_token": event_request.status_token,
                "message": "Event request created for coordinator review",
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ============================================
    # Member Lookup
    # ============================================

    async def search_members(
        self, organization_id: UUID, query: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Search members by name, membership number, or email for member_lookup fields"""
        safe_query = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        search_term = f"%{safe_query}%"
        result = await self.db.execute(
            select(User)
            .where(User.organization_id == str(organization_id))
            .where(User.status == UserStatus.ACTIVE)
            .where(
                or_(
                    User.first_name.ilike(search_term),
                    User.last_name.ilike(search_term),
                    User.email.ilike(search_term),
                    User.membership_number.ilike(search_term),
                    func.concat(User.first_name, " ", User.last_name).ilike(
                        search_term
                    ),
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
                "membership_number": u.membership_number,
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
            .where(Form.is_template == False)  # noqa: E712
        )
        total_forms = total_result.scalar()

        # Published forms
        published_result = await self.db.execute(
            select(func.count(Form.id))
            .where(Form.organization_id == org_id_str)
            .where(Form.status == FormStatus.PUBLISHED)
            .where(Form.is_template == False)  # noqa: E712
        )
        published_forms = published_result.scalar()

        # Draft forms
        draft_result = await self.db.execute(
            select(func.count(Form.id))
            .where(Form.organization_id == org_id_str)
            .where(Form.status == FormStatus.DRAFT)
            .where(Form.is_template == False)  # noqa: E712
        )
        draft_forms = draft_result.scalar()

        # Public forms
        public_result = await self.db.execute(
            select(func.count(Form.id))
            .where(Form.organization_id == org_id_str)
            .where(Form.is_public == True)  # noqa: E712
            .where(Form.is_template == False)  # noqa: E712
        )
        public_forms = public_result.scalar()

        # Total submissions
        total_subs_result = await self.db.execute(
            select(func.count(FormSubmission.id)).where(
                FormSubmission.organization_id == org_id_str
            )
        )
        total_submissions = total_subs_result.scalar()

        # Submissions this month
        first_of_month = date.today().replace(day=1)
        month_subs_result = await self.db.execute(
            select(func.count(FormSubmission.id))
            .where(FormSubmission.organization_id == org_id_str)
            .where(
                FormSubmission.submitted_at
                >= datetime.combine(first_of_month, datetime.min.time())
            )
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
