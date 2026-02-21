"""
External Training Integration API Endpoints

Endpoints for managing external training providers (Vector Solutions, Target Solutions, etc.)
and syncing training records from external platforms.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from uuid import UUID
from datetime import datetime, date, timedelta
import logging

from app.core.database import get_db
from app.core.audit import log_audit_event
from app.core.security import encrypt_data
from app.services.external_training_service import ExternalTrainingSyncService
from app.models.training import (
    ExternalTrainingProvider,
    ExternalCategoryMapping,
    ExternalUserMapping,
    ExternalTrainingSyncLog,
    ExternalTrainingImport,
    TrainingCategory,
    TrainingRecord,
    TrainingStatus,
    SyncStatus,
)
from app.models.user import User
from app.schemas.training import (
    ExternalTrainingProviderCreate,
    ExternalTrainingProviderUpdate,
    ExternalTrainingProviderResponse,
    ExternalCategoryMappingCreate,
    ExternalCategoryMappingUpdate,
    ExternalCategoryMappingResponse,
    ExternalUserMappingUpdate,
    ExternalUserMappingResponse,
    ExternalTrainingSyncLogResponse,
    ExternalTrainingImportResponse,
    SyncRequest,
    SyncResponse,
    TestConnectionResponse,
    ImportRecordRequest,
    BulkImportRequest,
    BulkImportResponse,
    SyncStatus as SyncStatusEnum,
)
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


# ============================================
# External Training Providers
# ============================================


@router.get("/providers", response_model=List[ExternalTrainingProviderResponse])
async def list_providers(
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    List all external training providers for the organization.

    **Authentication required**
    **Requires permission: training.manage**
    """
    query = select(ExternalTrainingProvider).where(
        ExternalTrainingProvider.organization_id == current_user.organization_id
    )

    if active_only:
        query = query.where(ExternalTrainingProvider.active == True)

    query = query.order_by(ExternalTrainingProvider.name)

    result = await db.execute(query)
    return result.scalars().all()


@router.post("/providers", response_model=ExternalTrainingProviderResponse, status_code=status.HTTP_201_CREATED)
async def create_provider(
    provider: ExternalTrainingProviderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Create a new external training provider configuration.

    **Authentication required**
    **Requires permission: training.manage**
    """
    # Encrypt sensitive credentials before storing
    new_provider = ExternalTrainingProvider(
        organization_id=current_user.organization_id,
        created_by=current_user.id,
        name=provider.name,
        provider_type=provider.provider_type,
        description=provider.description,
        api_base_url=provider.api_base_url,
        api_key=encrypt_data(provider.api_key) if provider.api_key else None,
        api_secret=encrypt_data(provider.api_secret) if provider.api_secret else None,
        client_id=provider.client_id,
        client_secret=encrypt_data(provider.client_secret) if provider.client_secret else None,
        auth_type=provider.auth_type,
        config=provider.config.model_dump() if provider.config else None,
        auto_sync_enabled=provider.auto_sync_enabled,
        sync_interval_hours=provider.sync_interval_hours,
        default_category_id=str(provider.default_category_id) if provider.default_category_id else None,
    )

    db.add(new_provider)
    await db.commit()
    await db.refresh(new_provider)

    await log_audit_event(
        db=db,
        event_type="external_training_created",
        event_category="training",
        severity="info",
        event_data={
            "provider_id": str(new_provider.id),
            "provider_name": new_provider.name,
            "provider_type": new_provider.provider_type,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return new_provider


@router.get("/providers/{provider_id}", response_model=ExternalTrainingProviderResponse)
async def get_provider(
    provider_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Get details of a specific external training provider.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(ExternalTrainingProvider)
        .where(ExternalTrainingProvider.id == str(provider_id))
        .where(ExternalTrainingProvider.organization_id == current_user.organization_id)
    )
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found"
        )

    return provider


@router.patch("/providers/{provider_id}", response_model=ExternalTrainingProviderResponse)
async def update_provider(
    provider_id: UUID,
    provider_update: ExternalTrainingProviderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Update an external training provider configuration.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(ExternalTrainingProvider)
        .where(ExternalTrainingProvider.id == str(provider_id))
        .where(ExternalTrainingProvider.organization_id == current_user.organization_id)
    )
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found"
        )

    # Update fields
    update_data = provider_update.model_dump(exclude_unset=True)

    # Handle config separately
    if 'config' in update_data and update_data['config']:
        update_data['config'] = update_data['config'].model_dump() if hasattr(update_data['config'], 'model_dump') else update_data['config']

    # Handle UUID conversion
    if 'default_category_id' in update_data:
        update_data['default_category_id'] = str(update_data['default_category_id']) if update_data['default_category_id'] else None

    # Encrypt sensitive credential fields before storing
    _secret_fields = ('api_key', 'api_secret', 'client_secret')
    for field in _secret_fields:
        if field in update_data and update_data[field]:
            update_data[field] = encrypt_data(update_data[field])

    for field, value in update_data.items():
        setattr(provider, field, value)

    # Reset connection verification if credentials changed
    if any(k in update_data for k in ['api_key', 'api_secret', 'client_id', 'client_secret', 'api_base_url']):
        provider.connection_verified = False
        provider.connection_error = None

    await db.commit()
    await db.refresh(provider)

    return provider


@router.delete("/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Delete an external training provider (soft delete).

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(ExternalTrainingProvider)
        .where(ExternalTrainingProvider.id == str(provider_id))
        .where(ExternalTrainingProvider.organization_id == current_user.organization_id)
    )
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found"
        )

    provider.active = False
    await db.commit()


@router.post("/providers/{provider_id}/test", response_model=TestConnectionResponse)
async def test_provider_connection(
    provider_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Test the connection to an external training provider.

    **Authentication required**
    **Requires permission: training.manage**
    """
    logger = logging.getLogger(__name__)

    result = await db.execute(
        select(ExternalTrainingProvider)
        .where(ExternalTrainingProvider.id == str(provider_id))
        .where(ExternalTrainingProvider.organization_id == current_user.organization_id)
    )
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found"
        )

    # Use the sync service to test the connection
    sync_service = ExternalTrainingSyncService(db)

    try:
        success, message = await sync_service.test_connection(provider)

        # Update provider status
        provider.connection_verified = success
        provider.last_connection_test = datetime.utcnow()
        provider.connection_error = None if success else message
        await db.commit()

        return TestConnectionResponse(
            success=success,
            message=message,
            details={"provider_type": provider.provider_type.value}
        )

    except Exception as e:
        logger.exception(f"Connection test failed for provider {provider_id}")
        provider.connection_verified = False
        provider.last_connection_test = datetime.utcnow()
        provider.connection_error = str(e)
        await db.commit()

        return TestConnectionResponse(
            success=False,
            message="Connection test failed. Check provider credentials and URL.",
            details=None
        )
    finally:
        await sync_service.close()


# ============================================
# Sync Operations
# ============================================


async def perform_sync_task(
    provider_id: str,
    sync_type: str,
    from_date: Optional[date],
    to_date: Optional[date],
    user_id: Optional[str],
    organization_id: str,
):
    """
    Background task to perform the actual sync operation.
    This runs outside the request lifecycle.
    """
    from app.core.database import async_session_factory

    logger = logging.getLogger(__name__)
    logger.info(f"Starting background sync for provider {provider_id}")

    async with async_session_factory() as db:
        try:
            # Get provider
            result = await db.execute(
                select(ExternalTrainingProvider)
                .where(ExternalTrainingProvider.id == str(provider_id))
            )
            provider = result.scalar_one_or_none()

            if not provider:
                logger.error(f"Provider {provider_id} not found for sync")
                return

            # Run the sync
            sync_service = ExternalTrainingSyncService(db)
            try:
                sync_log = await sync_service.sync_training_records(
                    provider=provider,
                    sync_type=sync_type,
                    from_date=from_date,
                    to_date=to_date,
                    user_id=user_id,
                )
                logger.info(
                    f"Sync completed for provider {provider_id}: "
                    f"fetched={sync_log.records_fetched}, "
                    f"imported={sync_log.records_imported}, "
                    f"failed={sync_log.records_failed}"
                )
            finally:
                await sync_service.close()

        except Exception as e:
            logger.exception(f"Background sync failed for provider {provider_id}: {e}")


@router.post("/providers/{provider_id}/sync", response_model=SyncResponse)
async def trigger_sync(
    provider_id: UUID,
    sync_request: SyncRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Trigger a sync operation with an external training provider.

    The sync runs as a background task. Use the sync-logs endpoint to check progress.

    **Authentication required**
    **Requires permission: training.manage**
    """
    logger = logging.getLogger(__name__)

    result = await db.execute(
        select(ExternalTrainingProvider)
        .where(ExternalTrainingProvider.id == str(provider_id))
        .where(ExternalTrainingProvider.organization_id == current_user.organization_id)
        .where(ExternalTrainingProvider.active == True)
    )
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found or inactive"
        )

    # Check if there's already a sync in progress
    existing_sync = await db.execute(
        select(ExternalTrainingSyncLog)
        .where(ExternalTrainingSyncLog.provider_id == str(provider_id))
        .where(ExternalTrainingSyncLog.status.in_([SyncStatus.PENDING, SyncStatus.IN_PROGRESS]))
    )
    if existing_sync.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A sync operation is already in progress for this provider"
        )

    # Add background task to perform the sync
    background_tasks.add_task(
        perform_sync_task,
        provider_id=str(provider_id),
        sync_type=sync_request.sync_type,
        from_date=sync_request.from_date,
        to_date=sync_request.to_date,
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
    )

    logger.info(f"Sync initiated for provider {provider_id} by user {current_user.id}")

    return SyncResponse(
        sync_log_id=None,  # Log will be created by background task
        status=SyncStatusEnum.PENDING,
        message="Sync operation initiated. Check sync logs for progress.",
        records_fetched=0,
        records_imported=0,
        records_failed=0,
    )


@router.get("/providers/{provider_id}/sync-logs", response_model=List[ExternalTrainingSyncLogResponse])
async def list_sync_logs(
    provider_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    List sync logs for a provider.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(ExternalTrainingSyncLog)
        .where(ExternalTrainingSyncLog.provider_id == str(provider_id))
        .where(ExternalTrainingSyncLog.organization_id == str(current_user.organization_id))
        .order_by(ExternalTrainingSyncLog.started_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


# ============================================
# Category Mappings
# ============================================


@router.get("/providers/{provider_id}/category-mappings", response_model=List[ExternalCategoryMappingResponse])
async def list_category_mappings(
    provider_id: UUID,
    unmapped_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    List category mappings for a provider.

    **Authentication required**
    **Requires permission: training.manage**
    """
    query = (
        select(ExternalCategoryMapping)
        .where(ExternalCategoryMapping.provider_id == str(provider_id))
        .where(ExternalCategoryMapping.organization_id == str(current_user.organization_id))
    )

    if unmapped_only:
        query = query.where(ExternalCategoryMapping.is_mapped == False)

    query = query.order_by(ExternalCategoryMapping.external_category_name)

    result = await db.execute(query)
    mappings = result.scalars().all()

    # Enrich with internal category names
    response = []
    for mapping in mappings:
        mapping_dict = {
            "id": mapping.id,
            "provider_id": mapping.provider_id,
            "organization_id": mapping.organization_id,
            "external_category_id": mapping.external_category_id,
            "external_category_name": mapping.external_category_name,
            "external_category_code": mapping.external_category_code,
            "internal_category_id": mapping.internal_category_id,
            "is_mapped": mapping.is_mapped,
            "auto_mapped": mapping.auto_mapped,
            "created_at": mapping.created_at,
            "updated_at": mapping.updated_at,
            "mapped_by": mapping.mapped_by,
            "internal_category_name": None,
        }

        if mapping.internal_category_id:
            cat_result = await db.execute(
                select(TrainingCategory.name).where(TrainingCategory.id == mapping.internal_category_id)
            )
            cat_name = cat_result.scalar_one_or_none()
            mapping_dict["internal_category_name"] = cat_name

        response.append(ExternalCategoryMappingResponse(**mapping_dict))

    return response


@router.patch("/providers/{provider_id}/category-mappings/{mapping_id}", response_model=ExternalCategoryMappingResponse)
async def update_category_mapping(
    provider_id: UUID,
    mapping_id: UUID,
    mapping_update: ExternalCategoryMappingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Update a category mapping.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(ExternalCategoryMapping)
        .where(ExternalCategoryMapping.id == str(mapping_id))
        .where(ExternalCategoryMapping.provider_id == str(provider_id))
        .where(ExternalCategoryMapping.organization_id == str(current_user.organization_id))
    )
    mapping = result.scalar_one_or_none()

    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category mapping not found"
        )

    # Update fields
    if mapping_update.internal_category_id is not None:
        mapping.internal_category_id = str(mapping_update.internal_category_id) if mapping_update.internal_category_id else None
        mapping.is_mapped = mapping_update.internal_category_id is not None
        mapping.auto_mapped = False
        mapping.mapped_by = current_user.id

    if mapping_update.is_mapped is not None:
        mapping.is_mapped = mapping_update.is_mapped

    await db.commit()
    await db.refresh(mapping)

    # Get internal category name
    internal_category_name = None
    if mapping.internal_category_id:
        cat_result = await db.execute(
            select(TrainingCategory.name).where(TrainingCategory.id == mapping.internal_category_id)
        )
        internal_category_name = cat_result.scalar_one_or_none()

    return ExternalCategoryMappingResponse(
        id=mapping.id,
        provider_id=mapping.provider_id,
        organization_id=mapping.organization_id,
        external_category_id=mapping.external_category_id,
        external_category_name=mapping.external_category_name,
        external_category_code=mapping.external_category_code,
        internal_category_id=mapping.internal_category_id,
        is_mapped=mapping.is_mapped,
        auto_mapped=mapping.auto_mapped,
        created_at=mapping.created_at,
        updated_at=mapping.updated_at,
        mapped_by=mapping.mapped_by,
        internal_category_name=internal_category_name,
    )


# ============================================
# User Mappings
# ============================================


@router.get("/providers/{provider_id}/user-mappings", response_model=List[ExternalUserMappingResponse])
async def list_user_mappings(
    provider_id: UUID,
    unmapped_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    List user mappings for a provider.

    **Authentication required**
    **Requires permission: training.manage**
    """
    query = (
        select(ExternalUserMapping)
        .where(ExternalUserMapping.provider_id == str(provider_id))
        .where(ExternalUserMapping.organization_id == str(current_user.organization_id))
    )

    if unmapped_only:
        query = query.where(ExternalUserMapping.is_mapped == False)

    query = query.order_by(ExternalUserMapping.external_name)

    result = await db.execute(query)
    mappings = result.scalars().all()

    # Enrich with internal user details
    response = []
    for mapping in mappings:
        mapping_dict = {
            "id": mapping.id,
            "provider_id": mapping.provider_id,
            "organization_id": mapping.organization_id,
            "external_user_id": mapping.external_user_id,
            "external_username": mapping.external_username,
            "external_email": mapping.external_email,
            "external_name": mapping.external_name,
            "internal_user_id": mapping.internal_user_id,
            "is_mapped": mapping.is_mapped,
            "auto_mapped": mapping.auto_mapped,
            "created_at": mapping.created_at,
            "updated_at": mapping.updated_at,
            "mapped_by": mapping.mapped_by,
            "internal_user_name": None,
            "internal_user_email": None,
        }

        if mapping.internal_user_id:
            user_result = await db.execute(
                select(User.full_name, User.email).where(User.id == mapping.internal_user_id)
            )
            user_data = user_result.one_or_none()
            if user_data:
                mapping_dict["internal_user_name"] = user_data.full_name
                mapping_dict["internal_user_email"] = user_data.email

        response.append(ExternalUserMappingResponse(**mapping_dict))

    return response


@router.patch("/providers/{provider_id}/user-mappings/{mapping_id}", response_model=ExternalUserMappingResponse)
async def update_user_mapping(
    provider_id: UUID,
    mapping_id: UUID,
    mapping_update: ExternalUserMappingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Update a user mapping.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(ExternalUserMapping)
        .where(ExternalUserMapping.id == str(mapping_id))
        .where(ExternalUserMapping.provider_id == str(provider_id))
        .where(ExternalUserMapping.organization_id == str(current_user.organization_id))
    )
    mapping = result.scalar_one_or_none()

    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User mapping not found"
        )

    # Update fields
    if mapping_update.internal_user_id is not None:
        mapping.internal_user_id = str(mapping_update.internal_user_id) if mapping_update.internal_user_id else None
        mapping.is_mapped = mapping_update.internal_user_id is not None
        mapping.auto_mapped = False
        mapping.mapped_by = current_user.id

    if mapping_update.is_mapped is not None:
        mapping.is_mapped = mapping_update.is_mapped

    await db.commit()
    await db.refresh(mapping)

    # Get internal user details
    internal_user_name = None
    internal_user_email = None
    if mapping.internal_user_id:
        user_result = await db.execute(
            select(User.full_name, User.email).where(User.id == mapping.internal_user_id)
        )
        user_data = user_result.one_or_none()
        if user_data:
            internal_user_name = user_data.full_name
            internal_user_email = user_data.email

    return ExternalUserMappingResponse(
        id=mapping.id,
        provider_id=mapping.provider_id,
        organization_id=mapping.organization_id,
        external_user_id=mapping.external_user_id,
        external_username=mapping.external_username,
        external_email=mapping.external_email,
        external_name=mapping.external_name,
        internal_user_id=mapping.internal_user_id,
        is_mapped=mapping.is_mapped,
        auto_mapped=mapping.auto_mapped,
        created_at=mapping.created_at,
        updated_at=mapping.updated_at,
        mapped_by=mapping.mapped_by,
        internal_user_name=internal_user_name,
        internal_user_email=internal_user_email,
    )


# ============================================
# Imported Records
# ============================================


@router.get("/providers/{provider_id}/imports", response_model=List[ExternalTrainingImportResponse])
async def list_imported_records(
    provider_id: UUID,
    status: Optional[str] = Query(None, description="Filter by import status"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    List imported training records from a provider.

    **Authentication required**
    **Requires permission: training.manage**
    """
    query = (
        select(ExternalTrainingImport)
        .where(ExternalTrainingImport.provider_id == str(provider_id))
        .where(ExternalTrainingImport.organization_id == str(current_user.organization_id))
    )

    if status:
        query = query.where(ExternalTrainingImport.import_status == status)

    query = query.order_by(ExternalTrainingImport.created_at.desc()).offset(offset).limit(limit)

    result = await db.execute(query)
    return result.scalars().all()


@router.post("/providers/{provider_id}/imports/{import_id}/import", response_model=ExternalTrainingImportResponse)
async def import_single_record(
    provider_id: UUID,
    import_id: UUID,
    import_request: ImportRecordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Import a single external training record into the system.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(ExternalTrainingImport)
        .where(ExternalTrainingImport.id == str(import_id))
        .where(ExternalTrainingImport.provider_id == str(provider_id))
        .where(ExternalTrainingImport.organization_id == str(current_user.organization_id))
    )
    ext_import = result.scalar_one_or_none()

    if not ext_import:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Import record not found"
        )

    if ext_import.import_status == "imported":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This record has already been imported"
        )

    try:
        # Create internal training record
        training_record = TrainingRecord(
            organization_id=current_user.organization_id,
            user_id=str(import_request.user_id),
            course_name=ext_import.course_title,
            course_code=ext_import.course_code,
            training_type="continuing_education",  # Default, could be mapped
            completion_date=ext_import.completion_date.date() if ext_import.completion_date else None,
            hours_completed=(ext_import.duration_minutes or 0) / 60.0,
            status=TrainingStatus.COMPLETED,
            score=ext_import.score,
            passed=ext_import.passed,
            notes=f"Imported from external provider. External ID: {ext_import.external_record_id}",
            created_by=current_user.id,
        )

        db.add(training_record)
        await db.flush()

        # Update import record
        ext_import.training_record_id = training_record.id
        ext_import.user_id = str(import_request.user_id)
        ext_import.import_status = "imported"
        ext_import.imported_at = datetime.utcnow()
        ext_import.import_error = None

        await db.commit()
        await db.refresh(ext_import)

        await log_audit_event(
            db=db,
            event_type="external_training_verified",
            event_category="training",
            severity="info",
            event_data={
                "import_id": str(import_id),
                "provider_id": str(provider_id),
                "training_record_id": str(training_record.id),
                "course_title": ext_import.course_title,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

        return ext_import

    except Exception as e:
        logger.exception(f"Failed to import record for provider {provider_id}")
        await db.rollback()
        ext_import.import_status = "failed"
        ext_import.import_error = str(e)
        await db.commit()
        await db.refresh(ext_import)

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to import record. Check the provider configuration and try again."
        )


@router.post("/providers/{provider_id}/imports/bulk", response_model=BulkImportResponse)
async def bulk_import_records(
    provider_id: UUID,
    bulk_request: BulkImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Bulk import multiple external training records.

    **Authentication required**
    **Requires permission: training.manage**
    """
    imported = 0
    skipped = 0
    failed = 0
    errors = []

    for import_id in bulk_request.external_import_ids:
        result = await db.execute(
            select(ExternalTrainingImport)
            .where(ExternalTrainingImport.id == str(import_id))
            .where(ExternalTrainingImport.provider_id == str(provider_id))
            .where(ExternalTrainingImport.organization_id == str(current_user.organization_id))
        )
        ext_import = result.scalar_one_or_none()

        if not ext_import:
            skipped += 1
            errors.append(f"Import {import_id} not found")
            continue

        if ext_import.import_status == "imported":
            skipped += 1
            continue

        # Try to find user mapping
        user_id = ext_import.user_id
        if not user_id and bulk_request.auto_map_users and ext_import.external_user_id:
            # Try to find user mapping
            mapping_result = await db.execute(
                select(ExternalUserMapping)
                .where(ExternalUserMapping.provider_id == str(provider_id))
                .where(ExternalUserMapping.external_user_id == ext_import.external_user_id)
                .where(ExternalUserMapping.is_mapped == True)
            )
            mapping = mapping_result.scalar_one_or_none()
            if mapping:
                user_id = mapping.internal_user_id

        if not user_id:
            skipped += 1
            errors.append(f"No user mapping for import {import_id}")
            continue

        try:
            # Create training record
            training_record = TrainingRecord(
                organization_id=current_user.organization_id,
                user_id=user_id,
                course_name=ext_import.course_title,
                course_code=ext_import.course_code,
                training_type="continuing_education",
                completion_date=ext_import.completion_date.date() if ext_import.completion_date else None,
                hours_completed=(ext_import.duration_minutes or 0) / 60.0,
                status=TrainingStatus.COMPLETED,
                score=ext_import.score,
                passed=ext_import.passed,
                notes=f"Imported from external provider. External ID: {ext_import.external_record_id}",
                created_by=current_user.id,
            )

            db.add(training_record)
            await db.flush()

            ext_import.training_record_id = training_record.id
            ext_import.user_id = user_id
            ext_import.import_status = "imported"
            ext_import.imported_at = datetime.utcnow()
            ext_import.import_error = None

            imported += 1

        except Exception as e:
            logger.exception(f"Bulk import failed for record {import_id}")
            failed += 1
            errors.append(f"Failed to import record {import_id}")
            ext_import.import_status = "failed"
            ext_import.import_error = str(e)

    await db.commit()

    return BulkImportResponse(
        total=len(bulk_request.external_import_ids),
        imported=imported,
        skipped=skipped,
        failed=failed,
        errors=errors[:10]  # Limit error messages
    )
