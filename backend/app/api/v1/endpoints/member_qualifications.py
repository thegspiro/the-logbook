"""
Member Qualifications API Endpoints

What a member is certified to do (EMT, Paramedic, Driver/Operator, …), entered
directly rather than as a side effect of a training record:

GET    /users/{user_id}/qualifications          - every qualification on record
PUT    /users/{user_id}/qualifications/{code}   - record or correct one
DELETE /users/{user_id}/qualifications/{code}   - withdraw one
POST   /users/qualifications/import             - CSV bulk entry (dry run first)

Shift eligibility reads these rows as of the shift date, so every write here
changes who may be rostered for an EMT, medic, driver or firefighter seat.
"""

from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.user import User
from app.schemas.member_qualification import (
    MemberQualificationImportResponse,
    MemberQualificationResponse,
    MemberQualificationUpsert,
)
from app.services.qualification_import_service import QualificationImportService
from app.services.qualification_service import (
    QUALIFICATIONS,
    QualificationService,
    qualification_label,
)
from app.utils.org_timezone import resolve_org_today
from app.utils.upload_limits import read_upload_limited

router = APIRouter()

MAX_QUALIFICATION_CSV_BYTES = 2 * 1024 * 1024


async def _load_member(db: AsyncSession, user_id: str, organization_id: str) -> User:
    result = await db.execute(
        select(User).where(
            User.id == str(user_id),
            User.organization_id == str(organization_id),
            User.deleted_at.is_(None),
        )
    )
    return ensure_found(result.scalar_one_or_none(), "Member")


async def _list_response(
    db: AsyncSession, member: User
) -> List[MemberQualificationResponse]:
    service = QualificationService(db)
    rows = await service.list_for_member(str(member.id), str(member.organization_id))
    today = await resolve_org_today(db, str(member.organization_id))
    # in_force comes from the same predicate shift eligibility applies, so the
    # panel can never call a card current that the scheduler would refuse.
    in_force = set(
        QualificationService.codes_in_force(
            [(r.qualification_code, r.granted_on, r.expires_on) for r in rows], today
        )
    )
    return [
        MemberQualificationResponse(
            id=str(r.id),
            user_id=str(r.user_id),
            qualification_code=r.qualification_code,
            label=qualification_label(r.qualification_code),
            positions=list(
                QUALIFICATIONS.get(r.qualification_code, {}).get("positions", [])
            ),
            granted_on=r.granted_on,
            expires_on=r.expires_on,
            notes=None if service.is_record_sourced(r) else r.notes,
            source="training_record" if service.is_record_sourced(r) else "manual",
            in_force=r.qualification_code in in_force,
        )
        for r in rows
    ]


@router.get(
    "/{user_id}/qualifications", response_model=List[MemberQualificationResponse]
)
async def list_member_qualifications(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Every qualification on a member's record, lapsed ones included.

    `in_force` says whether shift eligibility would count it today; `source`
    says whether it came from a completed training record or was entered
    directly.

    **Requires permission: members.manage**
    """
    member = await _load_member(db, user_id, current_user.organization_id)
    return await _list_response(db, member)


@router.put(
    "/{user_id}/qualifications/{code}",
    response_model=List[MemberQualificationResponse],
)
async def upsert_member_qualification(
    user_id: str,
    code: str,
    payload: MemberQualificationUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Record a qualification a member holds, or correct its dates.

    An entry made here is the officer's: voiding a training record for the
    same qualification later does not remove it.

    **Requires permission: members.manage**
    """
    member = await _load_member(db, user_id, current_user.organization_id)
    async with handle_service_errors("Failed to save the qualification"):
        await QualificationService(db).grant_manual(
            user_id=str(member.id),
            organization_id=str(member.organization_id),
            qualification_code=code,
            granted_on=payload.granted_on,
            expires_on=payload.expires_on,
            notes=payload.notes,
        )
        await db.commit()

    await log_audit_event(
        db=db,
        event_type="member_qualification_saved",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(member.id),
            "qualification_code": code,
            "granted_on": (
                payload.granted_on.isoformat() if payload.granted_on else None
            ),
            "expires_on": (
                payload.expires_on.isoformat() if payload.expires_on else None
            ),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return await _list_response(db, member)


@router.delete(
    "/{user_id}/qualifications/{code}",
    response_model=List[MemberQualificationResponse],
)
async def delete_member_qualification(
    user_id: str,
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Withdraw a qualification from a member's record.

    **Requires permission: members.manage**
    """
    member = await _load_member(db, user_id, current_user.organization_id)
    removed = await QualificationService(db).revoke(
        str(member.id), str(member.organization_id), code
    )
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Qualification not found"
        )
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="member_qualification_removed",
        event_category="user_management",
        severity="info",
        event_data={"target_user_id": str(member.id), "qualification_code": code},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return await _list_response(db, member)


@router.post("/qualifications/import", response_model=MemberQualificationImportResponse)
async def import_member_qualifications(
    file: UploadFile = File(...),
    dry_run: bool = Query(
        True,
        description="Validate and report without writing; false writes the "
        "rows that passed",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Import qualifications members already hold from a CSV file.

    Columns: `membership_number` or `email` (to find the member in this
    department), `qualification` (code or name), and optionally `granted_on`,
    `expires_on` (YYYY-MM-DD) and `notes`. Every row is validated and each
    failing row is reported by line number. A dry run (the default) writes
    nothing; `dry_run=false` writes the rows that passed.

    **Requires permission: members.manage**
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")
    try:
        contents = await read_upload_limited(file, MAX_QUALIFICATION_CSV_BYTES)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="CSV file exceeds the 2MB limit.",
        )
    try:
        text = contents.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400, detail="Unable to decode file. Please use UTF-8."
        )

    async with handle_service_errors("Failed to import qualifications"):
        result = await QualificationImportService(db).import_csv(
            text, str(current_user.organization_id), dry_run=dry_run
        )
        if not dry_run:
            await db.commit()

    if not dry_run and result.imported:
        await log_audit_event(
            db=db,
            event_type="member_qualifications_imported",
            event_category="user_management",
            severity="info",
            event_data={
                "imported": result.imported,
                "rejected_rows": len(result.errors),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

    return MemberQualificationImportResponse(
        dry_run=dry_run,
        total_rows=result.total_rows,
        valid_rows=len(result.rows),
        imported=result.imported,
        rows=[
            {
                "row": r.row,
                "user_id": r.user_id,
                "member_name": r.member_name,
                "qualification_code": r.qualification_code,
                "label": qualification_label(r.qualification_code),
                "granted_on": r.granted_on,
                "expires_on": r.expires_on,
                "action": r.action,
            }
            for r in result.rows
        ],
        errors=[{"row": e.row, "message": e.message} for e in result.errors],
    )
