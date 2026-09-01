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
from app.models.user import User


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
    # When a tracker exceeds its cap, evict down to this fraction of the cap
    # in one batch rather than back to exactly the cap. _enforce_key_caps runs
    # unthrottled on every call on a genuine hot path (detect_session_hijack
    # fires on every authenticated response) -- evicting one key at a time
    # would leave a saturated tracker sitting at the cap after every call, so
    # the very next addition re-triggers the full O(n log n) sort. A batch
    # buys headroom (10% of the cap) before the sort has to run again
    # (Codex, PR #2128).
    _EVICTION_TARGET_RATIO = 0.9

    def __init__(self):
        self.thresholds = AnomalyThresholds()
        self.alerts: List[SecurityAlert] = []
        self._login_attempts: Dict[str, List[datetime]] = defaultdict(list)
        self._session_ips: Dict[str, List[Tuple[str, datetime]]] = defaultdict(list)
        # The trusted comparison baseline for detect_session_hijack, kept
        # separate from _session_ips (below). _session_ips is the full
        # observed-IP log (audit/forensics, every request incl. attacker
        # ones); this dict holds only the single IP/timestamp a hijack
        # decision is actually made against, and it is deliberately NOT
        # updated to an IP that itself just triggered an alert (Codex, PR
        # #2132, round 6 — see the comment in detect_session_hijack). Its
        # stored timestamp IS refreshed on every call, alert or not, so
        # that the 5-minute leniency check measures time since this
        # session was last evaluated, not time since the trusted IP's
        # original confirmation (Codex, PR #2132, round 7 — same method).
        self._session_trusted_ip: Dict[str, List[Tuple[str, datetime]]] = defaultdict(
            list
        )
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

    def _enforce_key_caps(self) -> None:
        """Hard-cap every tracker (four dicts plus the endpoint set).

        The time-based sweep below is throttled to once/60s and only drops keys
        older than the window, so a burst of many distinct attacker-controlled
        keys (source IPs / user ids during credential stuffing) could grow these
        dicts without bound *between* sweeps — the cap constant existed but was
        never enforced (pitfall #9). This runs on every call, unthrottled, and
        evicts the least-recently-active keys first, in a batch rather than one
        at a time (see ``_EVICTION_TARGET_RATIO``).
        """

        def _last_ts(entries: list) -> datetime:
            if not entries:
                return datetime.min.replace(tzinfo=timezone.utc)
            last = entries[-1]
            return last[1] if isinstance(last, tuple) else last

        target_keys = int(self._MAX_TRACKING_KEYS * self._EVICTION_TARGET_RATIO)
        for tracker in (
            self._api_calls,
            self._login_attempts,
            self._session_ips,
            self._session_trusted_ip,
            self._data_transfers,
        ):
            if len(tracker) > self._MAX_TRACKING_KEYS:
                evict_count = len(tracker) - target_keys
                for key in sorted(tracker, key=lambda k: _last_ts(tracker[k]))[
                    :evict_count
                ]:
                    del tracker[key]

        # _external_endpoints is a set, not a dict keyed by request activity,
        # so it has no per-entry timestamp to evict by — a separate branch,
        # not folded into the loop above. Previously uncapped here entirely:
        # detect_data_exfiltration (the only method that grows it) called
        # this function but the four-tracker loop never touched the set, and
        # its only other cap (in _evict_stale_tracking_keys, below) sits on a
        # dead application path — nothing on the growth path ever calls that
        # method (Codex, PR #2128). Order doesn't matter for a coarse memory
        # safeguard like this one, so trim arbitrarily.
        if len(self._external_endpoints) > self._MAX_EXTERNAL_ENDPOINTS:
            target_endpoints = int(
                self._MAX_EXTERNAL_ENDPOINTS * self._EVICTION_TARGET_RATIO
            )
            evict_count = len(self._external_endpoints) - target_endpoints
            for _ in range(evict_count):
                self._external_endpoints.pop()

    def _evict_stale_tracking_keys(self) -> None:
        """Remove stale keys from in-memory tracking dicts to bound memory.

        The hard key cap runs every call; the (more expensive) time-based sweep
        runs at most once per 60 seconds.
        """
        import time as _time

        # Unthrottled — a within-60s burst must not be able to grow the dicts
        # past the cap.
        self._enforce_key_caps()

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

        # Evict _session_trusted_ip keys with no recent entries
        for key in list(self._session_trusted_ip):
            entries = self._session_trusted_ip[key]
            if not entries or entries[-1][1] < cutoff:
                del self._session_trusted_ip[key]

        # Evict _data_transfers keys with no recent entries
        day_cutoff = datetime.now(timezone.utc) - timedelta(days=2)
        for key in list(self._data_transfers):
            entries = self._data_transfers[key]
            if not entries or entries[-1][1] < day_cutoff:
                del self._data_transfers[key]

        # _external_endpoints is capped by the unconditional
        # self._enforce_key_caps() call at the top of this method — no
        # separate step needed here. (It used to have one; that block sat on
        # this method's own throttled path, which nothing on
        # detect_data_exfiltration's actual growth path ever reached — see
        # _enforce_key_caps' docstring.)

    async def _add_alert(
        self,
        db: AsyncSession,
        alert: SecurityAlert,
    ) -> None:
        """Add alert to in-memory cache and persist to database."""
        self.alerts.append(alert)
        # Trim oldest in-memory alerts to prevent unbounded growth
        if len(self.alerts) > self._MAX_IN_MEMORY_ALERTS:
            self.alerts = self.alerts[-self._MAX_IN_MEMORY_ALERTS :]
        try:
            # Use a savepoint (nested transaction) so a failure persisting
            # this alert rolls back only the alert write, not the caller's
            # outer transaction — same pattern as AuditLogger.create_log_entry
            # (app/core/audit.py). Without it, a flush failure here (e.g. a
            # transient DB error) leaves the caller's AsyncSession in
            # SQLAlchemy's "pending rollback" state even though the
            # exception is caught right here: the caller's own later
            # `db.commit()` (persisting failed_login_attempts, lockout, etc.
            # from the same request) then raises instead of completing,
            # turning what should be a routine 401 into an unhandled 500 and
            # losing every side effect the caller had already staged.
            async with db.begin_nested():
                from app.models.security_alert import AlertType as DBAlertType
                from app.models.security_alert import ThreatLevel as DBThreatLevel

                # Serialize details — convert non-serializable types
                serializable_details = {}
                for k, v in alert.details.items():
                    if isinstance(v, datetime):
                        serializable_details[k] = v.isoformat()
                    elif isinstance(v, Enum):
                        serializable_details[k] = v.value
                    else:
                        serializable_details[k] = v

                # Attribute the alert to the owning tenant so it is only
                # visible to (and acknowledgeable by) that org. Derived from
                # the alert's user; user-less alerts (pre-auth / IP-only)
                # stay NULL = platform-level.
                organization_id = None
                if alert.user_id:
                    org_result = await db.execute(
                        select(User.organization_id).where(User.id == alert.user_id)
                    )
                    organization_id = org_result.scalar_one_or_none()

                record = SecurityAlertRecord(
                    id=alert.id,
                    alert_type=DBAlertType(alert.alert_type.value),
                    threat_level=DBThreatLevel(alert.threat_level.value),
                    timestamp=alert.timestamp,
                    description=alert.description,
                    source_ip=alert.source_ip,
                    user_id=alert.user_id,
                    organization_id=organization_id,
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
        now = datetime.now(timezone.utc)
        minute_ago = now - timedelta(minutes=1)

        # Add the current call and capture the filtered 1-minute window into
        # a local variable BEFORE eviction runs below, rather than re-reading
        # self._api_calls[ip] after it. _evict_stale_tracking_keys() ->
        # _enforce_key_caps() can evict this exact ip's key when
        # the tracker is over its cap and this ip is the least-recently-
        # active one (e.g. it already has calls toward the threshold but
        # went quiet while other ips filled the tracker) -- a dict lookup
        # after that would silently come back as a fresh empty list,
        # undercounting the call rate and never reaching the threshold. Same
        # read-after-evict shape Codex found in detect_session_hijack (PR
        # #2128, round 3) and already fixed there and in detect_brute_force /
        # detect_data_exfiltration; this method had the same bug, unfixed,
        # because it evicts via _evict_stale_tracking_keys() rather than a
        # direct _enforce_key_caps() call, which the earlier fixes did not
        # touch.
        self._api_calls[ip].append(now)
        calls = [ts for ts in self._api_calls[ip] if ts > minute_ago]

        # Periodically evict stale keys to bound memory usage.
        self._evict_stale_tracking_keys()

        # Write the filtered window back AFTER eviction, not before it. The
        # read above protects this call's own decision from a corrupted
        # value, but eviction can still delete `ip`'s entry from the dict as
        # part of its batch -- if the write happened before eviction (as it
        # did through PR #2132 round 4), that delete goes through anyway,
        # and the *next* call from this ip finds no entry at all: not a
        # miscount, a missing baseline, indistinguishable from a first-ever
        # call. Writing here, after eviction has already run, guarantees the
        # tracker ends every call holding a live, current entry for the
        # calling key -- and since that entry now carries this call's
        # timestamp, it will also be among the least likely to be evicted on
        # the *next* call's sweep (round-5 fix, Codex, PR #2132).
        self._api_calls[ip] = calls

        # Check threshold
        if len(calls) > self.thresholds.api_calls_per_minute:
            alert = SecurityAlert(
                id=secrets.token_hex(16),
                alert_type=AlertType.RATE_LIMIT_EXCEEDED,
                threat_level=ThreatLevel.MEDIUM,
                timestamp=now,
                description=f"Rate limit exceeded: {len(calls)} calls/min",
                source_ip=ip,
                user_id=user_id,
                details={
                    "calls_per_minute": len(calls),
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
            # Clear attempts on successful login. This branch only overwrites
            # (never reads prior entries to decide anything), so it carries
            # none of the read-after-evict risk below -- cap enforcement can
            # run here in any position.
            self._login_attempts[ip] = []
            if user_id:
                self._login_attempts[f"user:{user_id}"] = []
            self._enforce_key_caps()
            return None

        now = datetime.now(timezone.utc)
        hour_ago = now - timedelta(hours=1)

        # Track by IP
        self._login_attempts[ip].append(now)
        ip_attempts = [ts for ts in self._login_attempts[ip] if ts > hour_ago]

        # Track by user if provided
        user_attempts: List[datetime] = []
        user_key: Optional[str] = None
        if user_id:
            user_key = f"user:{user_id}"
            self._login_attempts[user_key].append(now)
            user_attempts = [
                ts for ts in self._login_attempts[user_key] if ts > hour_ago
            ]

        # Cap enforcement runs after the reads above, captured into
        # ip_attempts/user_attempts, rather than before them. Brute-force /
        # credential-stuffing is exactly the burst that fills _login_attempts
        # (keyed by attacker-controlled ip + user id), so bound it here too —
        # _check_rate_limit isn't always on this path. But enforcing the cap
        # BEFORE this call's own read can evict the exact ip/user key just
        # appended to, and every lookup below reads straight from the dict —
        # so an evicted key would silently come back empty and never reach
        # the threshold. That is the same read-after-evict shape Codex found
        # in detect_session_hijack (PR #2128, round 3), and this method is
        # the one most likely to hit it: a wide credential-stuffing burst
        # across many attacker IPs is exactly the traffic that fills the
        # tracker to its cap. Only the hard cap (not the time-based sweep) so
        # this stays cheap on the hot login path.
        self._enforce_key_caps()

        # Write the filtered windows back AFTER cap enforcement, not before
        # it. Reading before eviction (above) protects this call's own
        # threshold decision, but eviction can still delete ip's (and/or
        # user_key's) entry from the dict as part of its batch -- writing
        # before eviction ran (as this did through PR #2132 round 4) lets
        # that delete stand, so the *next* attempt from the same ip/user
        # finds no history at all and is scored as attempt #1, not a
        # continuation. Writing here guarantees the tracker ends this call
        # holding a live, current entry for every key this call touched
        # (round-5 fix, Codex, PR #2132).
        self._login_attempts[ip] = ip_attempts
        if user_key is not None:
            self._login_attempts[user_key] = user_attempts

        # Check IP threshold
        if len(ip_attempts) >= self.thresholds.failed_logins_per_hour:
            alert = SecurityAlert(
                id=secrets.token_hex(16),
                alert_type=AlertType.BRUTE_FORCE,
                threat_level=ThreatLevel.HIGH,
                timestamp=now,
                description=f"Brute force attack detected from {ip}",
                source_ip=ip,
                user_id=user_id,
                details={
                    "failed_attempts": len(ip_attempts),
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
            if len(user_attempts) >= self.thresholds.failed_logins_per_user:
                alert = SecurityAlert(
                    id=secrets.token_hex(16),
                    alert_type=AlertType.BRUTE_FORCE,
                    threat_level=ThreatLevel.HIGH,
                    timestamp=now,
                    description=f"Brute force attack targeting user {user_id}",
                    source_ip=ip,
                    user_id=user_id,
                    details={
                        "failed_attempts": len(user_attempts),
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

        # Get previous session data BEFORE cap enforcement below.
        # _enforce_key_caps() evicts the least-recently-active keys in
        # _session_ips, and this exact session can be one of them if it has
        # gone quiet while the tracker filled up elsewhere. Reading after
        # eviction would find no prior IP for this session, treat a genuine
        # hijack as a first-ever observation, silently reset the baseline,
        # and never fire the alert (Codex, PR #2128, round 3 — a regression
        # introduced in round 1's commit 3b6b65e4, widened in round 2's
        # df7438e0, which added the call below).
        session_data = self._session_ips.get(key, [])

        # The trusted comparison baseline (see _session_trusted_ip's
        # declaration in __init__) is a *separate* tracker from the full
        # observed-IP log above, and is read before eviction for the same
        # reason: it is capped and swept by the same _enforce_key_caps()
        # call below.
        trusted_data = self._session_trusted_ip.get(key, [])

        # Called on requests, not logins — detect_brute_force's cap-enforcement
        # never fires for SSO/OAuth-only orgs, where nothing else bounds this
        # dict's growth. Hard cap only (cheap), matching detect_brute_force.
        # Runs after the read above so eviction can never remove the history
        # this call is about to compare against.
        self._enforce_key_caps()

        alert: Optional[SecurityAlert] = None
        # Defaults to promoting this call's own IP as the new trusted
        # baseline -- correct for a first-ever observation, for an IP that
        # matches the existing baseline (refreshes its timestamp), and for
        # an IP change slow enough (>= 5 minutes) not to be flagged as
        # suspicious. The one case that overrides this default, below, is a
        # hijack alert actually firing.
        new_trusted_ip = current_ip
        new_trusted_time = now

        if trusted_data:
            last_ip, last_time = trusted_data[-1]

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

                    # Do NOT promote the alerting IP to "trusted". Round 5
                    # (commit 90e373cc) made the tracker write unconditional
                    # -- including on the alert path -- to fix a real bug
                    # (see the comment below), but it wrote `current_ip`
                    # itself back as the new baseline. That silently
                    # laundered the attacker's IP into the session's known-
                    # good history: the very next request from that same
                    # attacker IP then matched "an IP already seen for this
                    # session" and fired no alert at all, so an ongoing
                    # hijack was detected exactly once. Keeping the baseline
                    # at the pre-alert IP (instead of the default set above)
                    # means the same attacker IP keeps tripping the alert on
                    # every subsequent request, until a genuinely different,
                    # non-suspicious observation (a slow IP change, or the
                    # legitimate IP returning) actually earns the promotion
                    # (Codex, PR #2132, round 6).
                    new_trusted_ip = last_ip
                    # But DO refresh the timestamp to `now`, even though the
                    # IP is being kept unchanged. Round 6 left this as
                    # `last_time` (the timestamp of the last CONFIRMED-good
                    # sighting of `last_ip`), which reads as "when was the
                    # trusted IP last seen" but is actually consulted by the
                    # `time_diff < 300` check above as "how long has it been
                    # since we last evaluated this session" -- and those are
                    # only the same thing while the session is idle. Under
                    # sustained attacker traffic they diverge: `last_time`
                    # stays pinned to the pre-hijack confirmation while real
                    # wall-clock time keeps advancing on every subsequent
                    # attacker call, so eventually `time_diff` on some later
                    # attacker call crosses 300s purely because enough time
                    # has passed since the ORIGINAL legitimate sighting -- not
                    # because the session went idle -- and the 5-minute
                    # leniency (meant for "IP changed after a genuine gap in
                    # activity, probably roaming") wrongly kicks in and
                    # silently waves the attacker's now-longstanding IP
                    # through with no alert (Codex, PR #2132, round 7).
                    #
                    # Refreshing to `now` here makes the stored timestamp
                    # mean "the last time this session was evaluated,
                    # regardless of which IP made that call" -- so the next
                    # call's `time_diff` measures the gap since THIS call,
                    # not since the session's last idle period ended. A
                    # continuously-attacking session therefore never
                    # accumulates elapsed time toward the leniency window
                    # (each attacker call keeps the gap tiny), while a
                    # genuinely idle session (no calls from anyone for 5+
                    # minutes) still earns the leniency exactly as before,
                    # because nothing refreshes the timestamp during a gap
                    # with no calls at all.
                    new_trusted_time = now

        # Write the trusted baseline back after cap enforcement (read-before
        # /write-after-evict, same shape as _session_ips below): a single
        # entry is enough since only the most recent trusted IP is ever
        # compared against.
        self._session_trusted_ip[key] = [(new_trusted_ip, new_trusted_time)]

        # Track this request unconditionally -- including when an alert just
        # fired above -- built from `session_data` (captured before eviction)
        # plus this call's own entry, rather than appending to
        # self._session_ips[key] in place. Two distinct bugs made that the
        # wrong shape: (1) the old code returned early the moment an alert
        # fired, skipping this append entirely, so a session's tracker entry
        # never advanced past its pre-hijack IP; (2) even without that early
        # return, appending to self._session_ips[key] reads whatever cap
        # enforcement above left behind, which can be nothing at all if this
        # key was evicted in the batch. Rebuilding from the pre-eviction
        # `session_data` and writing the result back is what actually fixes
        # both: the tracker always ends this call holding a live, current
        # entry for the session, so the *next* call has a real baseline to
        # compare against.
        #
        # This tracker (the full audit log, unlike _session_trusted_ip above)
        # always records `current_ip` -- including an attacker's -- because
        # it exists for forensics: an investigator reviewing a hijacked
        # session needs to see every IP that touched it, not just the ones
        # that were never flagged.
        self._session_ips[key] = (session_data + [(current_ip, now)])[-10:]

        # Both tracker writes above happen BEFORE the alert-dispatch awaits
        # below, not after -- deliberately, and unlike the two blocks'
        # position in every revision through round 8. `log_audit_event()`
        # and `_add_alert()` are real `await` points (DB I/O), and this
        # method runs on every authenticated request via the ASGI
        # middleware (security_middleware.py), against the single
        # module-level `security_monitor` instance. A second concurrent
        # request for the SAME session_id -- routine for this SPA, which
        # fires several API calls in parallel on one page load, not just an
        # attacker replaying a stolen cookie -- can run its own read/decide/
        # write while this call is suspended mid-await. With the tracker
        # write sitting *after* the awaits (the old order), that second
        # call's write would land first and then be silently clobbered by
        # this call resuming with its own now-stale `new_trusted_ip` /
        # `new_trusted_time` / `session_data` snapshot -- corrupting the
        # forensic IP log and, since this call's `now` was captured before
        # the other call's, potentially moving the trusted baseline's
        # timestamp backward. Writing first removes the only await between
        # this call's read and its write, so there is nothing left for a
        # concurrent call to interleave with (Codex, PR #2132, round 9;
        # see TestSessionHijackConcurrentInterleaving).
        if alert is not None:
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

        # Track data transfers, keeping the filtered 24h window in a local
        # variable rather than re-reading self._data_transfers[user_id] below.
        # _enforce_key_caps() (called after this block, see comment there) can
        # evict this exact user's key, and a dict lookup after that would
        # silently come back as a fresh empty list, undercounting the running
        # total and the transfer count in the alert below (same read-after-
        # evict shape Codex found in detect_session_hijack — PR #2128, round
        # 3).
        self._data_transfers[user_id].append((data_size_bytes, now))
        transfers = [
            (size, ts) for size, ts in self._data_transfers[user_id] if ts > day_ago
        ]

        # Calculate total transferred in last 24 hours from the local list
        # captured above, not another dict lookup — see comment above.
        total_transferred = sum(size for size, _ in transfers)
        total_mb = total_transferred / (1024 * 1024)

        # Called on requests, not logins — detect_brute_force's cap-enforcement
        # never fires for SSO/OAuth-only orgs, where nothing else bounds this
        # dict's growth. Hard cap only (cheap), matching detect_brute_force.
        # Runs after the transfer history above is captured into `transfers`
        # so eviction can never wipe the data this call needs to decide with.
        self._enforce_key_caps()

        # Write the filtered 24h window back AFTER cap enforcement, not
        # before it. Reading before eviction (above) protects this call's own
        # total/alert decision, but eviction can still delete user_id's entry
        # from the dict as part of its batch -- writing before eviction ran
        # (as this did through PR #2132 round 4) lets that delete stand, so
        # the *next* transfer from the same user finds no history and the
        # running 24h total silently resets to just that one transfer.
        # Writing here guarantees the tracker ends this call holding a live,
        # current entry for user_id (round-5 fix, Codex, PR #2132).
        self._data_transfers[user_id] = transfers

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
                    "transfer_count": len(transfers),
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
        organization_id: str,
    ) -> Dict[str, Any]:
        """
        Get current security status and metrics for one organization.

        All DB-backed alert/audit counts are scoped to ``organization_id`` so an
        org admin never sees another tenant's incident volume or failed-login
        rate. (The in-memory process metrics below are platform-wide counters,
        not per-tenant data.)
        """
        now = datetime.now(timezone.utc)
        hour_ago = now - timedelta(hours=1)
        org_alert = SecurityAlertRecord.organization_id == organization_id

        # Count recent alerts from DB (org-scoped)
        recent_count_result = await db.execute(
            select(func.count(SecurityAlertRecord.id)).where(
                SecurityAlertRecord.timestamp > hour_ago, org_alert
            )
        )
        total_last_hour = recent_count_result.scalar() or 0

        # Alerts by severity from DB (org-scoped)
        severity_result = await db.execute(
            select(SecurityAlertRecord.threat_level, func.count())
            .where(SecurityAlertRecord.timestamp > hour_ago, org_alert)
            .group_by(SecurityAlertRecord.threat_level)
        )
        alerts_by_severity = {
            level.value if hasattr(level, "value") else level: count
            for level, count in severity_result.all()
        }

        # Alerts by type from DB (org-scoped)
        type_result = await db.execute(
            select(SecurityAlertRecord.alert_type, func.count())
            .where(SecurityAlertRecord.timestamp > hour_ago, org_alert)
            .group_by(SecurityAlertRecord.alert_type)
        )
        alerts_by_type = {
            atype.value if hasattr(atype, "value") else atype: count
            for atype, count in type_result.all()
        }

        # Unacknowledged count from DB (org-scoped)
        unack_result = await db.execute(
            select(func.count(SecurityAlertRecord.id)).where(
                SecurityAlertRecord.acknowledged.is_(False),
                org_alert,
            )
        )
        unacknowledged = unack_result.scalar() or 0

        # Verify log integrity
        integrity_result = await self.verify_log_integrity(db)

        # Failed-login stats from the audit log, scoped by the audit log's
        # organization_id column. Failed attempts against unknown usernames
        # have no user and no org — platform-level, same as before.
        failed_logins_result = await db.execute(
            select(func.count(AuditLog.id))
            .where(AuditLog.event_type == AUDIT_EVENT_LOGIN_FAILED)
            .where(AuditLog.timestamp > hour_ago)
            .where(AuditLog.organization_id == str(organization_id))
        )
        failed_logins_hour = failed_logins_result.scalar() or 0

        # NOTE: the in-memory trackers below are process-global counters, not
        # per-tenant. We expose only counts, never the external-endpoint URLs
        # (which are another tenant's data-exfil destinations).
        external_endpoints_count = len(self._external_endpoints)

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
                "external_endpoints_detected": external_endpoints_count,
            },
            "thresholds": {
                "failed_logins_per_hour": self.thresholds.failed_logins_per_hour,
                "api_calls_per_minute": self.thresholds.api_calls_per_minute,
                "large_data_export_mb": self.thresholds.large_data_export_mb,
            },
        }

    async def get_recent_alerts(
        self,
        organization_id: str,
        limit: int = 50,
        threat_level: Optional[ThreatLevel] = None,
        alert_type: Optional[AlertType] = None,
        db: Optional[AsyncSession] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get recent security alerts for one organization from the database.

        Scoped to ``organization_id`` — an org only ever sees its own alerts;
        platform-level (user-less) alerts are not returned here.
        """
        if db is not None:
            from app.models.security_alert import AlertType as DBAlertType
            from app.models.security_alert import ThreatLevel as DBThreatLevel

            query = (
                select(SecurityAlertRecord)
                .where(SecurityAlertRecord.organization_id == organization_id)
                .order_by(SecurityAlertRecord.timestamp.desc())
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

        # No db session: the in-memory alert list carries no organization_id, so
        # it cannot be safely tenant-scoped. Return nothing rather than risk
        # leaking another org's alerts. (Real callers always pass a db session.)
        return []

    async def acknowledge_alert(
        self,
        alert_id: str,
        organization_id: str,
        db: AsyncSession,
        username: Optional[str] = None,
    ) -> bool:
        """
        Acknowledge a security alert (persisted to DB).

        Scoped to ``organization_id`` so an admin can only acknowledge their own
        org's alerts — not suppress another tenant's incidents.
        """
        result = await db.execute(
            select(SecurityAlertRecord).where(
                SecurityAlertRecord.id == alert_id,
                SecurityAlertRecord.organization_id == organization_id,
            )
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
        organization_id: str,
        db: AsyncSession,
        username: Optional[str] = None,
    ) -> bool:
        """
        Mark a security alert as resolved (persisted to DB).

        Scoped to ``organization_id`` so an admin can only resolve their own
        org's alerts.
        """
        result = await db.execute(
            select(SecurityAlertRecord).where(
                SecurityAlertRecord.id == alert_id,
                SecurityAlertRecord.organization_id == organization_id,
            )
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


async def report_privilege_escalation_attempt(
    db: AsyncSession,
    user_id: str,
    target_resource: str,
    ip_address: Optional[str] = None,
) -> None:
    """Record a BLOCKED privilege-escalation attempt (best-effort).

    Called from the role/permission-grant ceiling checks when a caller is denied
    for trying to grant permissions beyond their own authority. Fires a CRITICAL
    alert and commits it so the record survives the 403 the caller is about to
    raise — ``_add_alert`` only flushes, and the raise would otherwise roll the
    session back. Never propagates: security monitoring must not break the
    request it observes.
    """
    try:
        alert = await security_monitor.detect_privilege_escalation(
            db,
            user_id=user_id,
            action="modify_permissions",
            target_resource=target_resource,
            ip_address=ip_address,
        )
        if alert is not None:
            await db.commit()
    except Exception as exc:
        logger.warning("Privilege-escalation reporting failed: {}", exc)
