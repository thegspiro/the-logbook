"""
Security Monitoring API Endpoints

Provides endpoints for:
- Security status and metrics
- Alert management
- Log integrity verification
- Intrusion detection status
- Data exfiltration monitoring
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.dependencies import get_current_user, require_permission
from app.models.user import User
from app.services.security_monitoring import (
    security_monitor,
    ThreatLevel,
    AlertType,
)
from app.core.audit import (
    log_audit_event,
    verify_audit_log_integrity,
    get_audit_log_status,
    audit_logger,
)


router = APIRouter()


@router.get("/status")
async def get_security_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
):
    """
    Get current security status and metrics

    Returns:
        - Overall security status
        - Log integrity verification results
        - Recent alert counts by severity and type
        - Security metrics and thresholds
    """
    status = await security_monitor.get_security_status(db)

    await log_audit_event(
        db=db,
        event_type="security_status_viewed",
        event_category="audit",
        severity="info",
        event_data={"viewer": current_user.username},
        user_id=str(current_user.id),
        ip_address=request.client.host if request.client else None,
    )

    return status


@router.get("/alerts")
async def get_security_alerts(
    request: Request,
    limit: int = Query(50, ge=1, le=500),
    threat_level: Optional[str] = Query(None),
    alert_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
):
    """
    Get recent security alerts

    Query parameters:
        - limit: Maximum number of alerts to return (1-500)
        - threat_level: Filter by threat level (low, medium, high, critical)
        - alert_type: Filter by alert type
    """
    # Parse threat level if provided
    threat_level_enum = None
    if threat_level:
        try:
            threat_level_enum = ThreatLevel(threat_level.lower())
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid threat_level. Must be one of: {[t.value for t in ThreatLevel]}"
            )

    # Parse alert type if provided
    alert_type_enum = None
    if alert_type:
        try:
            alert_type_enum = AlertType(alert_type.lower())
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid alert_type. Must be one of: {[t.value for t in AlertType]}"
            )

    alerts = await security_monitor.get_recent_alerts(
        limit=limit,
        threat_level=threat_level_enum,
        alert_type=alert_type_enum,
    )

    return {"alerts": alerts, "total": len(alerts)}


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
):
    """
    Acknowledge a security alert
    """
    success = security_monitor.acknowledge_alert(alert_id)

    if not success:
        raise HTTPException(status_code=404, detail="Security alert not found. It may have already been resolved or removed.")

    await log_audit_event(
        db=db,
        event_type="security_alert_acknowledged",
        event_category="security",
        severity="info",
        event_data={
            "alert_id": alert_id,
            "acknowledged_by": current_user.username,
        },
        user_id=str(current_user.id),
        ip_address=request.client.host if request.client else None,
    )

    return {"status": "acknowledged", "alert_id": alert_id}


@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
):
    """
    Mark a security alert as resolved
    """
    success = security_monitor.resolve_alert(alert_id)

    if not success:
        raise HTTPException(status_code=404, detail="Security alert not found. It may have already been resolved or removed.")

    await log_audit_event(
        db=db,
        event_type="security_alert_resolved",
        event_category="security",
        severity="info",
        event_data={
            "alert_id": alert_id,
            "resolved_by": current_user.username,
        },
        user_id=str(current_user.id),
        ip_address=request.client.host if request.client else None,
    )

    return {"status": "resolved", "alert_id": alert_id}


@router.get("/audit-log/integrity")
async def verify_audit_integrity(
    request: Request,
    start_id: Optional[int] = Query(None, description="Start log ID for range check"),
    end_id: Optional[int] = Query(None, description="End log ID for range check"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
):
    """
    Verify audit log integrity

    This endpoint performs cryptographic verification of the audit log hash chain.
    Any tampering with historical logs will be detected.

    Query parameters:
        - start_id: Optional start log ID for range verification
        - end_id: Optional end log ID for range verification
    """
    result = await verify_audit_log_integrity(db, start_id, end_id)

    # The verification itself is logged in verify_audit_log_integrity

    return {
        "verified": result["verified"],
        "total_checked": result["total_checked"],
        "first_id": result.get("first_id"),
        "last_id": result.get("last_id"),
        "errors": result.get("errors", []),
        "message": "Audit log integrity verified" if result["verified"] else "INTEGRITY FAILURE DETECTED",
    }


@router.get("/audit-log/status")
async def get_audit_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
):
    """
    Get audit log status and statistics
    """
    status = await get_audit_log_status(db)
    return status


@router.post("/audit-log/checkpoint")
async def create_audit_checkpoint(
    request: Request,
    first_log_id: int = Query(..., description="First log ID to include"),
    last_log_id: int = Query(..., description="Last log ID to include"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.export")),
):
    """
    Create an integrity checkpoint for a range of audit logs

    This creates a cryptographic snapshot (Merkle root) that can be used
    to verify the integrity of historical logs.
    """
    try:
        checkpoint = await audit_logger.create_checkpoint(db, first_log_id, last_log_id)

        await log_audit_event(
            db=db,
            event_type="audit_checkpoint_created",
            event_category="audit",
            severity="info",
            event_data={
                "checkpoint_id": checkpoint.id,
                "first_log_id": first_log_id,
                "last_log_id": last_log_id,
                "total_entries": checkpoint.total_entries,
                "merkle_root": checkpoint.merkle_root,
                "created_by": current_user.username,
            },
            user_id=str(current_user.id),
            ip_address=request.client.host if request.client else None,
        )

        return {
            "checkpoint_id": checkpoint.id,
            "first_log_id": checkpoint.first_log_id,
            "last_log_id": checkpoint.last_log_id,
            "total_entries": checkpoint.total_entries,
            "merkle_root": checkpoint.merkle_root,
            "checkpoint_hash": checkpoint.checkpoint_hash,
            "created_at": checkpoint.created_at.isoformat() if checkpoint.created_at else None,
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/intrusion-detection/status")
async def get_intrusion_detection_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
):
    """
    Get intrusion detection system status

    Returns current monitoring status including:
    - Tracked sessions
    - Rate limiting violations
    - Brute force detection status
    - Session hijacking detection status
    """
    status = await security_monitor.get_security_status(db)

    return {
        "monitoring_active": True,
        "tracked_sessions": status["metrics"]["tracked_sessions"],
        "rate_limit_violations": status["metrics"]["active_rate_limit_violations"],
        "external_endpoints_detected": status["metrics"]["external_endpoints_detected"],
        "failed_logins_last_hour": status["metrics"]["failed_logins_last_hour"],
        "thresholds": status["thresholds"],
    }


@router.get("/data-exfiltration/status")
async def get_data_exfiltration_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
):
    """
    Get data exfiltration monitoring status

    Returns:
    - External endpoints that have received data
    - Large data transfer alerts
    - Bulk access patterns
    """
    status = await security_monitor.get_security_status(db)

    # Get exfiltration-related alerts
    exfil_alerts = await security_monitor.get_recent_alerts(
        limit=20,
        alert_type=AlertType.DATA_EXFILTRATION,
    )
    external_alerts = await security_monitor.get_recent_alerts(
        limit=20,
        alert_type=AlertType.EXTERNAL_DATA_TRANSFER,
    )

    return {
        "monitoring_active": True,
        "external_endpoints_detected": status["metrics"]["external_endpoints_detected"],
        "recent_exfiltration_alerts": exfil_alerts,
        "external_transfer_alerts": external_alerts,
        "thresholds": {
            "large_data_export_mb": status["thresholds"]["large_data_export_mb"],
        },
    }


@router.post("/manual-check")
async def trigger_manual_security_check(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.export")),
):
    """
    Trigger a manual security check

    Performs:
    - Full audit log integrity verification
    - Review of recent security events
    - Status of all monitoring systems
    """
    # Verify audit log integrity
    integrity_result = await verify_audit_log_integrity(db)

    # Get current security status
    status = await security_monitor.get_security_status(db)

    # Log the manual check
    await log_audit_event(
        db=db,
        event_type="manual_security_check",
        event_category="security",
        severity="info",
        event_data={
            "initiated_by": current_user.username,
            "integrity_verified": integrity_result["verified"],
            "alerts_found": status["alerts"]["total_last_hour"],
        },
        user_id=str(current_user.id),
        ip_address=request.client.host if request.client else None,
    )

    return {
        "check_completed": True,
        "timestamp": status["timestamp"],
        "integrity": {
            "verified": integrity_result["verified"],
            "entries_checked": integrity_result["total_checked"],
            "errors": len(integrity_result.get("errors", [])),
        },
        "alerts": status["alerts"],
        "metrics": status["metrics"],
        "overall_status": "secure" if integrity_result["verified"] and status["alerts"]["total_last_hour"] == 0 else "requires_attention",
    }
