"""
Tamper-Proof Audit Logging System

Implements blockchain-inspired hash chain for immutable audit logs
with cryptographic integrity verification.
"""

import hashlib
import time
from typing import Dict, Any, Optional, List
from datetime import datetime, UTC
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from loguru import logger

from app.models.audit import AuditLog, AuditLogCheckpoint
from app.core.database import get_db


class AuditLogger:
    """
    Tamper-proof audit logger with cryptographic hash chains
    """
    
    @staticmethod
    def calculate_hash(log_data: Dict[str, Any], previous_hash: str) -> str:
        """
        Calculate SHA-256 hash for log entry
        
        Creates a deterministic hash from log entry data and previous hash,
        forming a blockchain-inspired chain.
        """
        # Create deterministic string from log data
        data_string = "|".join([
            str(log_data.get("timestamp", "")),
            str(log_data.get("timestamp_nanos", "")),
            str(log_data.get("event_type", "")),
            str(log_data.get("user_id", "")),
            str(log_data.get("ip_address", "")),
            str(log_data.get("event_data", {})),
            previous_hash,
        ])
        
        # Calculate SHA-256 hash
        return hashlib.sha256(data_string.encode()).hexdigest()
    
    async def create_log_entry(
        self,
        db: AsyncSession,
        event_type: str,
        event_category: str,
        severity: str,
        event_data: Dict[str, Any],
        user_id: Optional[str] = None,
        username: Optional[str] = None,
        session_id: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        geo_location: Optional[Dict[str, Any]] = None,
    ) -> AuditLog:
        """
        Create a new tamper-proof audit log entry
        
        Each entry contains:
        - Event details
        - User/session information
        - Previous entry's hash (forming the chain)
        - Current entry's hash (calculated from all data + previous hash)
        """
        try:
            # Use a savepoint (nested transaction) so that audit log failures
            # don't roll back the caller's transaction
            async with db.begin_nested():
                # Get the last log entry to get previous hash
                result = await db.execute(
                    select(AuditLog)
                    .order_by(AuditLog.id.desc())
                    .limit(1)
                )
                last_log = result.scalar_one_or_none()
                previous_hash = last_log.current_hash if last_log else "0" * 64

                # Create log entry data
                timestamp = datetime.now(UTC)
                timestamp_nanos = time.time_ns()

                log_data = {
                    "timestamp": timestamp.isoformat(),
                    "timestamp_nanos": timestamp_nanos,
                    "event_type": event_type,
                    "event_category": event_category,
                    "severity": severity,
                    "user_id": user_id,
                    "ip_address": ip_address,
                    "event_data": event_data,
                }

                # Calculate current hash
                current_hash = self.calculate_hash(log_data, previous_hash)

                # Create log entry
                log_entry = AuditLog(
                    timestamp=timestamp,
                    timestamp_nanos=timestamp_nanos,
                    event_type=event_type,
                    event_category=event_category,
                    severity=severity,
                    user_id=user_id,
                    username=username,
                    session_id=session_id,
                    ip_address=ip_address,
                    user_agent=user_agent,
                    geo_location=geo_location,
                    event_data=event_data,
                    previous_hash=previous_hash,
                    current_hash=current_hash,
                )

                db.add(log_entry)
                await db.flush()
                await db.refresh(log_entry)

            return log_entry

        except Exception as e:
            logger.error(f"Failed to create audit log: {e}")
            # Don't re-raise - audit log failures should not break the caller's
            # operation. The savepoint rollback already undid the audit changes
            # without affecting the outer transaction.
            return None
    
    async def verify_integrity(
        self,
        db: AsyncSession,
        start_id: Optional[int] = None,
        end_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Verify the integrity of the audit log chain
        
        Returns:
            Dict with verification results including:
            - verified: bool - whether integrity check passed
            - total_checked: int - number of entries checked
            - errors: List - any integrity violations found
        """
        # Build query
        query = select(AuditLog).order_by(AuditLog.id)
        
        if start_id:
            query = query.where(AuditLog.id >= start_id)
        if end_id:
            query = query.where(AuditLog.id <= end_id)
        
        result = await db.execute(query)
        logs = result.scalars().all()
        
        if not logs:
            return {
                "verified": True,
                "total_checked": 0,
                "first_id": None,
                "last_id": None,
                "errors": [],
            }
        
        results = {
            "verified": True,
            "total_checked": len(logs),
            "first_id": logs[0].id,
            "last_id": logs[-1].id,
            "errors": [],
        }
        
        # Verify each log entry
        for i, log in enumerate(logs):
            # Recalculate hash
            log_data = {
                "timestamp": log.timestamp.isoformat(),
                "timestamp_nanos": log.timestamp_nanos,
                "event_type": log.event_type,
                "user_id": str(log.user_id) if log.user_id else "",
                "ip_address": str(log.ip_address) if log.ip_address else "",
                "event_data": log.event_data,
            }
            
            calculated_hash = self.calculate_hash(log_data, log.previous_hash)
            
            # Check if hash matches
            if calculated_hash != log.current_hash:
                results["verified"] = False
                results["errors"].append({
                    "log_id": log.id,
                    "error": "Hash mismatch - log entry has been tampered with",
                    "expected_hash": log.current_hash,
                    "calculated_hash": calculated_hash,
                })
            
            # Check chain integrity (except for first entry)
            if i > 0:
                previous_log = logs[i - 1]
                if log.previous_hash != previous_log.current_hash:
                    results["verified"] = False
                    results["errors"].append({
                        "log_id": log.id,
                        "error": "Chain broken - previous hash does not match",
                        "expected_previous": log.previous_hash,
                        "actual_previous": previous_log.current_hash,
                    })
        
        return results
    
    async def create_checkpoint(
        self,
        db: AsyncSession,
        first_log_id: int,
        last_log_id: int,
    ) -> AuditLogCheckpoint:
        """
        Create an integrity checkpoint for a range of audit logs
        
        This provides a cryptographic snapshot that can be used
        to verify integrity of historical logs.
        """
        # Get all logs in range
        result = await db.execute(
            select(AuditLog)
            .where(AuditLog.id >= first_log_id)
            .where(AuditLog.id <= last_log_id)
            .order_by(AuditLog.id)
        )
        logs = result.scalars().all()
        
        if not logs:
            raise ValueError("No logs found in specified range")
        
        # Calculate Merkle root (simplified - hash of all hashes)
        all_hashes = "".join([log.current_hash for log in logs])
        merkle_root = hashlib.sha256(all_hashes.encode()).hexdigest()
        
        # Create checkpoint hash
        checkpoint_data = f"{first_log_id}|{last_log_id}|{len(logs)}|{merkle_root}"
        checkpoint_hash = hashlib.sha256(checkpoint_data.encode()).hexdigest()
        
        # Create checkpoint
        checkpoint = AuditLogCheckpoint(
            first_log_id=first_log_id,
            last_log_id=last_log_id,
            total_entries=len(logs),
            merkle_root=merkle_root,
            checkpoint_hash=checkpoint_hash,
        )
        
        db.add(checkpoint)
        await db.flush()
        await db.refresh(checkpoint)
        
        logger.info(f"Created checkpoint for logs {first_log_id}-{last_log_id}")
        
        return checkpoint


# Global audit logger instance
audit_logger = AuditLogger()


# Convenience function for logging events
async def log_event(
    db: AsyncSession,
    event_type: str,
    event_data: Dict[str, Any],
    event_category: str = "general",
    severity: str = "info",
    **kwargs,
):
    """
    Convenience function to log an event

    Usage:
        await log_event(
            db,
            "user_login",
            {"username": "john.doe"},
            event_category="auth",
            severity="INFO",
            user_id=user.id,
            ip_address=request.client.host,
        )
    """
    return await audit_logger.create_log_entry(
        db=db,
        event_type=event_type,
        event_category=event_category,
        severity=severity,
        event_data=event_data,
        **kwargs,
    )


# Alias for consistency with auth service
async def log_audit_event(
    db: AsyncSession,
    event_type: str,
    event_category: str,
    severity: str,
    event_data: Dict[str, Any],
    **kwargs,
):
    """
    Log an audit event (alias for log_event with different parameter order)
    """
    return await audit_logger.create_log_entry(
        db=db,
        event_type=event_type,
        event_category=event_category,
        severity=severity,
        event_data=event_data,
        **kwargs,
    )


async def verify_audit_log_integrity(
    db: AsyncSession,
    start_id: Optional[int] = None,
    end_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Verify the integrity of the audit log chain.

    This is a critical zero-trust function that should be called:
    - On application startup
    - Periodically via scheduled tasks
    - On-demand via admin API

    Args:
        db: Database session
        start_id: Optional start ID for range verification
        end_id: Optional end ID for range verification

    Returns:
        Verification result with status and any detected issues
    """
    result = await audit_logger.verify_integrity(db, start_id, end_id)

    # Log the verification itself
    await audit_logger.create_log_entry(
        db=db,
        event_type="audit_integrity_check",
        event_category="security",
        severity="critical" if not result["verified"] else "info",
        event_data={
            "verified": result["verified"],
            "total_checked": result["total_checked"],
            "first_id": result.get("first_id"),
            "last_id": result.get("last_id"),
            "errors_found": len(result.get("errors", [])),
        },
    )

    if not result["verified"]:
        logger.critical(
            f"AUDIT LOG INTEGRITY FAILURE: {len(result['errors'])} issues detected"
        )
        for error in result["errors"]:
            logger.critical(f"  - Log ID {error['log_id']}: {error['error']}")

    return result


async def get_audit_log_status(db: AsyncSession) -> Dict[str, Any]:
    """
    Get current audit log status and statistics.

    Returns:
        Status information including total entries, latest entry, and last checkpoint
    """
    # Get total count
    result = await db.execute(select(func.count(AuditLog.id)))
    total_count = result.scalar()

    # Get latest entry
    result = await db.execute(
        select(AuditLog).order_by(AuditLog.id.desc()).limit(1)
    )
    latest_entry = result.scalar_one_or_none()

    # Get latest checkpoint
    result = await db.execute(
        select(AuditLogCheckpoint).order_by(AuditLogCheckpoint.id.desc()).limit(1)
    )
    latest_checkpoint = result.scalar_one_or_none()

    return {
        "total_entries": total_count,
        "latest_entry": {
            "id": latest_entry.id if latest_entry else None,
            "timestamp": latest_entry.timestamp.isoformat() if latest_entry else None,
            "event_type": latest_entry.event_type if latest_entry else None,
            "current_hash": latest_entry.current_hash if latest_entry else None,
        } if latest_entry else None,
        "latest_checkpoint": {
            "id": latest_checkpoint.id if latest_checkpoint else None,
            "checkpoint_time": latest_checkpoint.checkpoint_time.isoformat() if latest_checkpoint else None,
            "first_log_id": latest_checkpoint.first_log_id if latest_checkpoint else None,
            "last_log_id": latest_checkpoint.last_log_id if latest_checkpoint else None,
            "merkle_root": latest_checkpoint.merkle_root if latest_checkpoint else None,
        } if latest_checkpoint else None,
    }
