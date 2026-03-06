"""
Security Monitoring Service

Comprehensive security monitoring with:
- Data exfiltration detection
- Intrusion detection and anomaly monitoring
- Log integrity protection
- Security alerts and notifications (persisted to DB)
- Session hijacking detection
- Brute force detection
"""

import json
import secrets
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from ipaddress import ip_address, ip_network
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event, verify_audit_log_integrity
from app.core.constants import AUDIT_EVENT_LOGIN_FAILED
from app.models.audit import AuditLog
from app.models.security_alert import SecurityAlertRecord


class ThreatLevel(str, Enum):
    """Security threat severity levels"""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlertType(str, Enum):
    """Types of security alerts"""

    BRUTE_FORCE = "brute_force"
    SESSION_HIJACK = "session_hijack"
    DATA_EXFILTRATION = "data_exfiltration"
    LOG_TAMPERING = "log_tampering"
    ANOMALY_DETECTED = "anomaly_detected"
    UNAUTHORIZED_ACCESS = "unauthorized_access"
    PRIVILEGE_ESCALATION = "privilege_escalation"
    SUSPICIOUS_ACTIVITY = "suspicious_activity"
    EXTERNAL_DATA_TRANSFER = "external_data_transfer"
    RATE_LIMIT_EXCEEDED = "rate_limit_exceeded"


@dataclass
class SecurityAlert:
    """Security alert data structure"""

    id: str
    alert_type: AlertType
    threat_level: ThreatLevel
    timestamp: datetime
    description: str
    source_ip: Optional[str] = None
    user_id: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)
    acknowledged: bool = False
    resolved: bool = False


@dataclass
class AnomalyThresholds:
    """Configurable thresholds for anomaly detection"""

    # Login anomalies
    failed_logins_per_hour: int = 10
    failed_logins_per_user: int = 5
    logins_from_new_locations: int = 3

    # Data transfer anomalies
    large_data_export_mb: int = 50
    bulk_record_access: int = 100
    api_calls_per_minute: int = 60

    # Session anomalies
    concurrent_sessions: int = 3
    session_ip_changes: int = 2

    # Access anomalies
    permission_denied_per_hour: int = 20
    admin_actions_per_hour: int = 50


class SecurityMonitoringService:
    """
    Comprehensive security monitoring and intrusion detection
    """

    # Caps to prevent unbounded in-memory growth under sustained traffic.
    _MAX_IN_MEMORY_ALERTS = 500
    _MAX_TRACKING_KEYS = 5_000
    _MAX_EXTERNAL_ENDPOINTS = 200

    def __init__(self):
        self.thresholds = AnomalyThresholds()
        self.alerts: List[SecurityAlert] = []
        self._login_attempts: Dict[str, List[datetime]] = defaultdict(list)
        self._session_ips: Dict[str, List[Tuple[str, datetime]]] = defaultdict(list)
        self._data_transfers: Dict[str, List[Tuple[int, datetime]]] = defaultdict(list)
        self._api_calls: Dict[str, List[datetime]] = defaultdict(list)
        self._external_endpoints: set = set()

        # Known safe internal network ranges
        self._internal_networks = [
            ip_network("10.0.0.0/8"),
            ip_network("172.16.0.0/12"),
            ip_network("192.168.0.0/16"),
            ip_network("127.0.0.0/8"),
        ]

        # Suspicious patterns to detect
        self._suspicious_patterns = {
            "sql_injection": [
                "' OR '1'='1",
                "'; DROP TABLE",
                "UNION SELECT",
                "1=1",
                "/**/",
                "@@version",
                "SLEEP(",
            ],
            "xss": [
                "<script",
                "javascript:",
                "onerror=",
                "onload=",
                "eval(",
                "document.cookie",
            ],
            "path_traversal": [
                "../",
                "..\\",
                "%2e%2e",
                "%252e%252e",
            ],
            "command_injection": [
                "; ls",
                "| cat",
                "$(",
                "`",
                "&&",
                "||",
            ],
        }

        self._last_eviction: float = 0.0

    def _evict_stale_tracking_keys(self) -> None:
        """Remove stale keys from in-memory tracking dicts to bound memory.

        Runs at most once per 60 seconds to avoid overhead.
        """
        import time as _time

        now = _time.monotonic()
        if now - self._last_eviction < 60:
            return
        self._last_eviction = now

        cutoff = datetime.now(timezone.utc) - timedelta(hours=2)

        # Evict _api_calls keys with no recent entries
        for key in list(self._api_calls):
            entries = self._api_calls[key]
            if not entries or entries[-1] < cutoff:
                del self._api_calls[key]

        # Evict _login_attempts keys with no recent entries
        for key in list(self._login_attempts):
            entries = self._login_attempts[key]
            if not entries or entries[-1] < cutoff:
                del self._login_attempts[key]

        # Evict _session_ips keys with no recent entries
        for key in list(self._session_ips):
            entries = self._session_ips[key]
            if not entries or entries[-1][1] < cutoff:
                del self._session_ips[key]

        # Evict _data_transfers keys with no recent entries
        day_cutoff = datetime.now(timezone.utc) - timedelta(days=2)
        for key in list(self._data_transfers):
            entries = self._data_transfers[key]
            if not entries or entries[-1][1] < day_cutoff:
                del self._data_transfers[key]

        # Cap _external_endpoints
        if len(self._external_endpoints) > self._MAX_EXTERNAL_ENDPOINTS:
            # Keep only the most recent entries (set is unordered, so just trim)
            excess = len(self._external_endpoints) - self._MAX_EXTERNAL_ENDPOINTS
            for _ in range(excess):
                self._external_endpoints.pop()

    async def _add_alert(
        self,
        db: AsyncSession,
        alert: SecurityAlert,
    ) -> None:
        """Add alert to in-memory cache and persist to database."""
        self.alerts.append(alert)
        # Trim oldest in-memory alerts to prevent unbounded growth
        if len(self.alerts) > self._MAX_IN_MEMORY_ALERTS:
            self.alerts = self.alerts[-self._MAX_IN_MEMORY_ALERTS:]
        try:
            from app.models.security_alert import (
                AlertType as DBAlertType,
                ThreatLevel as DBThreatLevel,
            )

            # Serialize details — convert non-serializable types
            serializable_details = {}
            for k, v in alert.details.items():
                if isinstance(v, datetime):
                    serializable_details[k] = v.isoformat()
                elif isinstance(v, Enum):
                    serializable_details[k] = v.value
                else:
                    serializable_details[k] = v

            record = SecurityAlertRecord(
                id=alert.id,
                alert_type=DBAlertType(alert.alert_type.value),
                threat_level=DBThreatLevel(alert.threat_level.value),
                timestamp=alert.timestamp,
                description=alert.description,
                source_ip=alert.source_ip,
                user_id=alert.user_id,
                details=serializable_details,
                acknowledged=alert.acknowledged,
                resolved=alert.resolved,
            )
            db.add(record)
            await db.flush()
        except Exception as e:
            logger.warning(f"Failed to persist security alert {alert.id}: {e}")

    async def analyze_request(
        self,
        db: AsyncSession,
        request_data: Dict[str, Any],
        user_id: Optional[str] = None,
    ) -> Optional[SecurityAlert]:
        """
        Analyze incoming request for security threats
        """
        alerts = []

        # Check for injection attempts
        alert = await self._check_injection_patterns(db, request_data, user_id)
        if alert:
            alerts.append(alert)

        # Check rate limiting
        ip = request_data.get("ip_address", "unknown")
        alert = await self._check_rate_limit(db, ip, user_id)
        if alert:
            alerts.append(alert)

        # Return highest severity alert
        if alerts:
            return max(alerts, key=lambda a: list(ThreatLevel).index(a.threat_level))
        return None

    async def _check_injection_patterns(
        self,
        db: AsyncSession,
        request_data: Dict[str, Any],
        user_id: Optional[str],
    ) -> Optional[SecurityAlert]:
        """
        Check request data for injection patterns
        """
        # Serialize all request data to check
        data_str = json.dumps(request_data).lower()

        for pattern_type, patterns in self._suspicious_patterns.items():
            for pattern in patterns:
                if pattern.lower() in data_str:
                    alert = SecurityAlert(
                        id=secrets.token_hex(16),
                        alert_type=AlertType.SUSPICIOUS_ACTIVITY,
                        threat_level=ThreatLevel.HIGH,
                        timestamp=datetime.now(timezone.utc),
                        description=f"Potential {pattern_type.replace('_', ' ')} attempt detected",
                        source_ip=request_data.get("ip_address"),
                        user_id=user_id,
                        details={
                            "pattern_type": pattern_type,
                            "matched_pattern": pattern,
                            "request_path": request_data.get("path", "unknown"),
                        },
                    )

                    # Log the alert
                    await log_audit_event(
                        db=db,
                        event_type="security_alert",
                        event_category="security",
                        severity="critical",
                        event_data=alert.__dict__,
                        user_id=user_id,
                        ip_address=request_data.get("ip_address"),
                    )

                    await self._add_alert(db, alert)
                    return alert

        return None

    async def _check_rate_limit(
        self,
        db: AsyncSession,
        ip: str,
        user_id: Optional[str],
    ) -> Optional[SecurityAlert]:
        """
        Check for rate limit violations that might indicate attacks
        """
        # Periodically evict stale keys to bound memory usage
        self._evict_stale_tracking_keys()

        now = datetime.now(timezone.utc)
        minute_ago = now - timedelta(minutes=1)

        # Clean old entries
        self._api_calls[ip] = [ts for ts in self._api_calls[ip] if ts > minute_ago]

        # Add current call
        self._api_calls[ip].append(now)

        # Check threshold
        if len(self._api_calls[ip]) > self.thresholds.api_calls_per_minute:
            alert = SecurityAlert(
                id=secrets.token_hex(16),
                alert_type=AlertType.RATE_LIMIT_EXCEEDED,
                threat_level=ThreatLevel.MEDIUM,
                timestamp=now,
                description=f"Rate limit exceeded: {len(self._api_calls[ip])} calls/min",
                source_ip=ip,
                user_id=user_id,
                details={
                    "calls_per_minute": len(self._api_calls[ip]),
                    "threshold": self.thresholds.api_calls_per_minute,
                },
            )
            await self._add_alert(db, alert)
            return alert

        return None

    async def detect_brute_force(
        self,
        db: AsyncSession,
        ip: str,
        user_id: Optional[str] = None,
        success: bool = False,
    ) -> Optional[SecurityAlert]:
        """
        Detect brute force login attempts
        """
        if success:
            # Clear attempts on successful login
            self._login_attempts[ip] = []
            if user_id:
                self._login_attempts[f"user:{user_id}"] = []
            return None

        now = datetime.now(timezone.utc)
        hour_ago = now - timedelta(hours=1)

        # Track by IP
        self._login_attempts[ip].append(now)
        self._login_attempts[ip] = [
            ts for ts in self._login_attempts[ip] if ts > hour_ago
        ]

        # Track by user if provided
        if user_id:
            key = f"user:{user_id}"
            self._login_attempts[key].append(now)
            self._login_attempts[key] = [
                ts for ts in self._login_attempts[key] if ts > hour_ago
            ]

        # Check IP threshold
        if len(self._login_attempts[ip]) >= self.thresholds.failed_logins_per_hour:
            alert = SecurityAlert(
                id=secrets.token_hex(16),
                alert_type=AlertType.BRUTE_FORCE,
                threat_level=ThreatLevel.HIGH,
                timestamp=now,
                description=f"Brute force attack detected from {ip}",
                source_ip=ip,
                user_id=user_id,
                details={
                    "failed_attempts": len(self._login_attempts[ip]),
                    "time_window": "1 hour",
                    "threshold": self.thresholds.failed_logins_per_hour,
                },
            )

            await log_audit_event(
                db=db,
                event_type="brute_force_detected",
                event_category="security",
                severity="critical",
                event_data=alert.__dict__,
                ip_address=ip,
                user_id=user_id,
            )

            await self._add_alert(db, alert)
            return alert

        # Check per-user threshold
        if user_id:
            key = f"user:{user_id}"
            if len(self._login_attempts[key]) >= self.thresholds.failed_logins_per_user:
                alert = SecurityAlert(
                    id=secrets.token_hex(16),
                    alert_type=AlertType.BRUTE_FORCE,
                    threat_level=ThreatLevel.HIGH,
                    timestamp=now,
                    description=f"Brute force attack targeting user {user_id}",
                    source_ip=ip,
                    user_id=user_id,
                    details={
                        "failed_attempts": len(self._login_attempts[key]),
                        "time_window": "1 hour",
                        "threshold": self.thresholds.failed_logins_per_user,
                    },
                )

                await log_audit_event(
                    db=db,
                    event_type="brute_force_detected",
                    event_category="security",
                    severity="critical",
                    event_data=alert.__dict__,
                    ip_address=ip,
                    user_id=user_id,
                )

                await self._add_alert(db, alert)
                return alert

        return None

    async def detect_session_hijack(
        self,
        db: AsyncSession,
        session_id: str,
        current_ip: str,
        user_agent: str,
        user_id: str,
    ) -> Optional[SecurityAlert]:
        """
        Detect potential session hijacking by monitoring IP/UA changes
        """
        now = datetime.now(timezone.utc)
        key = f"session:{session_id}"

        # Get previous session data
        session_data = self._session_ips.get(key, [])

        if session_data:
            last_ip, last_time = session_data[-1]

            # Check if IP changed within a short time (potential hijack)
            if last_ip != current_ip:
                time_diff = (now - last_time).total_seconds()

                # IP change within 5 minutes is suspicious
                if time_diff < 300:
                    alert = SecurityAlert(
                        id=secrets.token_hex(16),
                        alert_type=AlertType.SESSION_HIJACK,
                        threat_level=ThreatLevel.CRITICAL,
                        timestamp=now,
                        description=f"Potential session hijacking: IP changed from {last_ip} to {current_ip}",
                        source_ip=current_ip,
                        user_id=user_id,
                        details={
                            "session_id": session_id,
                            "previous_ip": last_ip,
                            "current_ip": current_ip,
                            "time_since_last_request": time_diff,
                        },
                    )

                    await log_audit_event(
                        db=db,
                        event_type="session_hijack_suspected",
                        event_category="security",
                        severity="critical",
                        event_data=alert.__dict__,
                        ip_address=current_ip,
                        user_id=user_id,
                        session_id=session_id,
                    )

                    await self._add_alert(db, alert)
                    return alert

        # Track this request
        self._session_ips[key].append((current_ip, now))

        # Keep only last 10 entries
        if len(self._session_ips[key]) > 10:
            self._session_ips[key] = self._session_ips[key][-10:]

        return None

    async def detect_data_exfiltration(
        self,
        db: AsyncSession,
        user_id: str,
        data_size_bytes: int,
        endpoint: str,
        destination: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> Optional[SecurityAlert]:
        """
        Detect potential data exfiltration attempts

        Monitors:
        - Large data exports
        - Bulk record access
        - Transfers to external/unknown destinations
        """
        now = datetime.now(timezone.utc)
        day_ago = now - timedelta(days=1)

        # Track data transfers
        self._data_transfers[user_id].append((data_size_bytes, now))
        self._data_transfers[user_id] = [
            (size, ts) for size, ts in self._data_transfers[user_id] if ts > day_ago
        ]

        # Calculate total transferred in last 24 hours
        total_transferred = sum(size for size, _ in self._data_transfers[user_id])
        total_mb = total_transferred / (1024 * 1024)

        alerts = []

        # Check for large single transfer
        data_size_mb = data_size_bytes / (1024 * 1024)
        if data_size_mb > self.thresholds.large_data_export_mb:
            alert = SecurityAlert(
                id=secrets.token_hex(16),
                alert_type=AlertType.DATA_EXFILTRATION,
                threat_level=ThreatLevel.HIGH,
                timestamp=now,
                description=f"Large data export: {data_size_mb:.2f} MB",
                source_ip=ip_address,
                user_id=user_id,
                details={
                    "data_size_mb": data_size_mb,
                    "endpoint": endpoint,
                    "threshold_mb": self.thresholds.large_data_export_mb,
                    "total_24h_mb": total_mb,
                },
            )
            alerts.append(alert)

        # Check for external destination
        if destination and self._is_external_destination(destination):
            alert = SecurityAlert(
                id=secrets.token_hex(16),
                alert_type=AlertType.EXTERNAL_DATA_TRANSFER,
                threat_level=ThreatLevel.CRITICAL,
                timestamp=now,
                description=f"Data transfer to external destination: {destination}",
                source_ip=ip_address,
                user_id=user_id,
                details={
                    "destination": destination,
                    "data_size_bytes": data_size_bytes,
                    "endpoint": endpoint,
                },
            )
            alerts.append(alert)

            # Track external endpoint
            self._external_endpoints.add(destination)

        # Check for unusual cumulative transfer
        if total_mb > self.thresholds.large_data_export_mb * 5:
            alert = SecurityAlert(
                id=secrets.token_hex(16),
                alert_type=AlertType.DATA_EXFILTRATION,
                threat_level=ThreatLevel.CRITICAL,
                timestamp=now,
                description=f"Excessive data transfer: {total_mb:.2f} MB in 24h",
                source_ip=ip_address,
                user_id=user_id,
                details={
                    "total_24h_mb": total_mb,
                    "transfer_count": len(self._data_transfers[user_id]),
                },
            )
            alerts.append(alert)

        # Log all alerts
        for alert in alerts:
            await log_audit_event(
                db=db,
                event_type="data_exfiltration_alert",
                event_category="security",
                severity="critical",
                event_data=alert.__dict__,
                ip_address=ip_address,
                user_id=user_id,
            )
            await self._add_alert(db, alert)

        # Return highest severity
        if alerts:
            return max(alerts, key=lambda a: list(ThreatLevel).index(a.threat_level))
        return None

    def _is_external_destination(self, destination: str) -> bool:
        """
        Check if a destination is external (not internal network)
        """
        try:
            # Extract host from URL if needed
            if "://" in destination:
                host = destination.split("://")[1].split("/")[0].split(":")[0]
            else:
                host = destination.split("/")[0].split(":")[0]

            # Try to parse as IP
            try:
                addr = ip_address(host)
                for network in self._internal_networks:
                    if addr in network:
                        return False
                return True
            except ValueError:
                # Not an IP, assume external domain
                if host in ("localhost", "127.0.0.1"):
                    return False
                return True

        except Exception:
            return True  # Assume external if can't parse

    async def verify_log_integrity(
        self,
        db: AsyncSession,
    ) -> Dict[str, Any]:
        """
        Verify audit log integrity and detect tampering
        """
        result = await verify_audit_log_integrity(db)

        if not result["verified"]:
            alert = SecurityAlert(
                id=secrets.token_hex(16),
                alert_type=AlertType.LOG_TAMPERING,
                threat_level=ThreatLevel.CRITICAL,
                timestamp=datetime.now(timezone.utc),
                description="Audit log tampering detected!",
                details={
                    "errors": result["errors"],
                    "total_checked": result["total_checked"],
                },
            )

            await log_audit_event(
                db=db,
                event_type="log_tampering_detected",
                event_category="security",
                severity="critical",
                event_data={
                    "verified": False,
                    "errors_found": len(result["errors"]),
                    "details": result["errors"][:10],  # First 10 errors
                },
            )

            await self._add_alert(db, alert)

        return result

    async def detect_privilege_escalation(
        self,
        db: AsyncSession,
        user_id: str,
        action: str,
        target_resource: str,
        ip_address: Optional[str] = None,
    ) -> Optional[SecurityAlert]:
        """
        Detect unauthorized privilege escalation attempts
        """
        suspicious_actions = [
            "assign_admin_role",
            "modify_permissions",
            "delete_audit_logs",
            "access_all_users",
            "modify_security_settings",
            "bypass_authentication",
        ]

        if action in suspicious_actions:
            alert = SecurityAlert(
                id=secrets.token_hex(16),
                alert_type=AlertType.PRIVILEGE_ESCALATION,
                threat_level=ThreatLevel.CRITICAL,
                timestamp=datetime.now(timezone.utc),
                description=f"Privilege escalation attempt: {action}",
                source_ip=ip_address,
                user_id=user_id,
                details={
                    "action": action,
                    "target_resource": target_resource,
                },
            )

            await log_audit_event(
                db=db,
                event_type="privilege_escalation_attempt",
                event_category="security",
                severity="critical",
                event_data=alert.__dict__,
                ip_address=ip_address,
                user_id=user_id,
            )

            await self._add_alert(db, alert)
            return alert

        return None

    async def get_security_status(
        self,
        db: AsyncSession,
    ) -> Dict[str, Any]:
        """
        Get current security status and metrics
        """
        now = datetime.now(timezone.utc)
        hour_ago = now - timedelta(hours=1)

        # Count recent alerts from DB
        recent_count_result = await db.execute(
            select(func.count(SecurityAlertRecord.id)).where(
                SecurityAlertRecord.timestamp > hour_ago
            )
        )
        total_last_hour = recent_count_result.scalar() or 0

        # Alerts by severity from DB
        severity_result = await db.execute(
            select(SecurityAlertRecord.threat_level, func.count())
            .where(SecurityAlertRecord.timestamp > hour_ago)
            .group_by(SecurityAlertRecord.threat_level)
        )
        alerts_by_severity = {
            level.value if hasattr(level, "value") else level: count
            for level, count in severity_result.all()
        }

        # Alerts by type from DB
        type_result = await db.execute(
            select(SecurityAlertRecord.alert_type, func.count())
            .where(SecurityAlertRecord.timestamp > hour_ago)
            .group_by(SecurityAlertRecord.alert_type)
        )
        alerts_by_type = {
            atype.value if hasattr(atype, "value") else atype: count
            for atype, count in type_result.all()
        }

        # Unacknowledged count from DB
        unack_result = await db.execute(
            select(func.count(SecurityAlertRecord.id)).where(
                SecurityAlertRecord.acknowledged == False  # noqa: E712
            )
        )
        unacknowledged = unack_result.scalar() or 0

        # Verify log integrity
        integrity_result = await self.verify_log_integrity(db)

        # Get failed login stats from audit log
        failed_logins_result = await db.execute(
            select(func.count(AuditLog.id))
            .where(AuditLog.event_type == AUDIT_EVENT_LOGIN_FAILED)
            .where(AuditLog.timestamp > hour_ago)
        )
        failed_logins_hour = failed_logins_result.scalar() or 0

        # Get external endpoints detected
        external_endpoints = list(self._external_endpoints)[:10]

        return {
            "status": (
                "healthy"
                if integrity_result["verified"] and total_last_hour == 0
                else "alert"
            ),
            "timestamp": now.isoformat(),
            "log_integrity": {
                "verified": integrity_result["verified"],
                "total_checked": integrity_result["total_checked"],
                "errors": len(integrity_result.get("errors", [])),
            },
            "alerts": {
                "total_last_hour": total_last_hour,
                "by_severity": alerts_by_severity,
                "by_type": alerts_by_type,
                "unacknowledged": unacknowledged,
            },
            "metrics": {
                "failed_logins_last_hour": failed_logins_hour,
                "active_rate_limit_violations": sum(
                    1
                    for calls in self._api_calls.values()
                    if len(calls) > self.thresholds.api_calls_per_minute
                ),
                "tracked_sessions": len(self._session_ips),
                "external_endpoints_detected": external_endpoints,
            },
            "thresholds": {
                "failed_logins_per_hour": self.thresholds.failed_logins_per_hour,
                "api_calls_per_minute": self.thresholds.api_calls_per_minute,
                "large_data_export_mb": self.thresholds.large_data_export_mb,
            },
        }

    async def get_recent_alerts(
        self,
        limit: int = 50,
        threat_level: Optional[ThreatLevel] = None,
        alert_type: Optional[AlertType] = None,
        db: Optional[AsyncSession] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get recent security alerts from the database.
        Falls back to in-memory list if no db session is provided.
        """
        if db is not None:
            from app.models.security_alert import (
                AlertType as DBAlertType,
                ThreatLevel as DBThreatLevel,
            )

            query = select(SecurityAlertRecord).order_by(
                SecurityAlertRecord.timestamp.desc()
            )
            if threat_level:
                query = query.where(
                    SecurityAlertRecord.threat_level
                    == DBThreatLevel(threat_level.value)
                )
            if alert_type:
                query = query.where(
                    SecurityAlertRecord.alert_type == DBAlertType(alert_type.value)
                )
            query = query.limit(limit)

            result = await db.execute(query)
            records = result.scalars().all()

            return [
                {
                    "id": r.id,
                    "alert_type": (
                        r.alert_type.value
                        if hasattr(r.alert_type, "value")
                        else r.alert_type
                    ),
                    "threat_level": (
                        r.threat_level.value
                        if hasattr(r.threat_level, "value")
                        else r.threat_level
                    ),
                    "timestamp": r.timestamp.isoformat() if r.timestamp else None,
                    "description": r.description,
                    "source_ip": r.source_ip,
                    "user_id": r.user_id,
                    "details": r.details or {},
                    "acknowledged": r.acknowledged,
                    "resolved": r.resolved,
                }
                for r in records
            ]

        # Fallback to in-memory list
        alerts = self.alerts.copy()

        if threat_level:
            alerts = [a for a in alerts if a.threat_level == threat_level]

        if alert_type:
            alerts = [a for a in alerts if a.alert_type == alert_type]

        alerts.sort(key=lambda a: a.timestamp, reverse=True)

        return [
            {
                "id": a.id,
                "alert_type": a.alert_type.value,
                "threat_level": a.threat_level.value,
                "timestamp": a.timestamp.isoformat(),
                "description": a.description,
                "source_ip": a.source_ip,
                "user_id": a.user_id,
                "details": a.details,
                "acknowledged": a.acknowledged,
                "resolved": a.resolved,
            }
            for a in alerts[:limit]
        ]

    async def acknowledge_alert(
        self,
        alert_id: str,
        db: AsyncSession,
        username: Optional[str] = None,
    ) -> bool:
        """
        Acknowledge a security alert (persisted to DB)
        """
        result = await db.execute(
            select(SecurityAlertRecord).where(SecurityAlertRecord.id == alert_id)
        )
        record = result.scalar_one_or_none()
        if record:
            record.acknowledged = True
            record.acknowledged_by = username
            record.acknowledged_at = datetime.now(timezone.utc)
            await db.flush()
            # Also update in-memory cache
            for alert in self.alerts:
                if alert.id == alert_id:
                    alert.acknowledged = True
                    break
            return True
        return False

    async def resolve_alert(
        self,
        alert_id: str,
        db: AsyncSession,
        username: Optional[str] = None,
    ) -> bool:
        """
        Mark a security alert as resolved (persisted to DB)
        """
        result = await db.execute(
            select(SecurityAlertRecord).where(SecurityAlertRecord.id == alert_id)
        )
        record = result.scalar_one_or_none()
        if record:
            record.resolved = True
            record.resolved_by = username
            record.resolved_at = datetime.now(timezone.utc)
            await db.flush()
            # Also update in-memory cache
            for alert in self.alerts:
                if alert.id == alert_id:
                    alert.resolved = True
                    break
            return True
        return False


# Global instance
security_monitor = SecurityMonitoringService()
