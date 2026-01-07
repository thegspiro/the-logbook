"""
Geographic IP Security System
Blocks access from outside the United States with per-user temporary exceptions

SECURITY FEATURES:
- Blocks all non-US IP addresses by default
- Per-user temporary international access
- Automatic expiration of exceptions
- Alert system for suspicious access patterns
- Audit logging for all geographic access attempts
"""
import requests
import logging
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from django.core.cache import cache
from datetime import timedelta
from typing import Tuple, Optional
from core.notifications import NotificationManager, NotificationType, NotificationPriority

logger = logging.getLogger(__name__)


class IPGeolocation(models.Model):
    """
    Cache of IP geolocation lookups to reduce API calls
    """
    ip_address = models.GenericIPAddressField(unique=True, db_index=True)
    country_code = models.CharField(max_length=2, help_text="ISO 3166-1 alpha-2 country code")
    country_name = models.CharField(max_length=100)
    region = models.CharField(max_length=100, blank=True)
    city = models.CharField(max_length=100, blank=True)
    
    # ISP information
    isp = models.CharField(max_length=200, blank=True)
    organization = models.CharField(max_length=200, blank=True)
    
    # Coordinates
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    
    # Metadata
    lookup_date = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(auto_now=True)
    access_count = models.IntegerField(default=1)
    
    # Risk assessment
    is_proxy = models.BooleanField(default=False)
    is_vpn = models.BooleanField(default=False)
    is_tor = models.BooleanField(default=False)
    threat_level = models.IntegerField(default=0, help_text="0=safe, 100=dangerous")
    
    class Meta:
        ordering = ['-last_seen']
        indexes = [
            models.Index(fields=['country_code', 'last_seen']),
        ]
    
    def __str__(self):
        return f"{self.ip_address} - {self.country_name}"
    
    @property
    def is_us(self):
        """Check if IP is from United States"""
        return self.country_code == 'US'
    
    @property
    def is_suspicious(self):
        """Check if IP shows suspicious characteristics"""
        return self.is_proxy or self.is_vpn or self.is_tor or self.threat_level > 50


class InternationalAccessException(models.Model):
    """
    Temporary exception allowing specific user to access from outside US
    """
    STATUS_CHOICES = [
        ('PENDING', 'Pending Approval'),
        ('APPROVED', 'Approved'),
        ('DENIED', 'Denied'),
        ('EXPIRED', 'Expired'),
        ('REVOKED', 'Revoked'),
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='international_access_exceptions')
    
    # Justification
    reason = models.TextField(help_text="Reason for international access (e.g., vacation, deployment)")
    destination_country = models.CharField(max_length=100, help_text="Country user will be accessing from")
    
    # Time period
    start_date = models.DateTimeField(help_text="When exception becomes active")
    end_date = models.DateTimeField(help_text="When exception expires")
    
    # Approval workflow
    requested_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='international_access_requests',
        help_text="Who requested the exception (usually the user or their supervisor)"
    )
    requested_at = models.DateTimeField(auto_now_add=True)
    
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='international_access_approvals',
        help_text="IT staff member who approved"
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='PENDING', db_index=True)
    
    # Usage tracking
    times_used = models.IntegerField(default=0)
    last_used = models.DateTimeField(null=True, blank=True)
    
    # Notes
    admin_notes = models.TextField(blank=True, help_text="Notes from IT staff")
    
    class Meta:
        ordering = ['-requested_at']
        indexes = [
            models.Index(fields=['user', 'status', 'end_date']),
        ]
    
    def __str__(self):
        return f"{self.user.get_full_name()} - {self.destination_country} ({self.status})"
    
    @property
    def is_active(self):
        """Check if exception is currently active"""
        if self.status != 'APPROVED':
            return False
        
        now = timezone.now()
        return self.start_date <= now <= self.end_date
    
    def check_and_update_status(self):
        """Check if exception has expired and update status"""
        if self.status == 'APPROVED' and self.end_date < timezone.now():
            self.status = 'EXPIRED'
            self.save()
            
            # Notify user that exception has expired
            self._send_expiration_notification()
    
    def record_usage(self):
        """Record that this exception was used"""
        self.times_used += 1
        self.last_used = timezone.now()
        self.save()
    
    def _send_expiration_notification(self):
        """Notify user that their international access has expired"""
        NotificationManager.send_notification(
            notification_type=NotificationType.GENERAL_ANNOUNCEMENT,
            recipients=[self.user],
            subject="International Access Expired",
            message=f"Your international access exception for {self.destination_country} has expired. "
                   f"If you need continued access, please submit a new request.",
            priority=NotificationPriority.MEDIUM
        )


class SuspiciousAccessAttempt(models.Model):
    """
    Tracks suspicious access attempts from unusual locations
    """
    ATTEMPT_TYPES = [
        ('NON_US', 'Non-US IP Address'),
        ('MULTIPLE_COUNTRIES', 'Multiple Countries in Short Time'),
        ('BLOCKED_COUNTRY', 'High-Risk Country'),
        ('PROXY_VPN', 'Proxy/VPN Detected'),
        ('TOR', 'TOR Exit Node'),
        ('RAPID_LOCATION_CHANGE', 'Impossible Travel Speed'),
    ]
    
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='suspicious_access_attempts')
    ip_address = models.GenericIPAddressField()
    geolocation = models.ForeignKey(IPGeolocation, on_delete=models.SET_NULL, null=True)
    
    attempt_type = models.CharField(max_length=30, choices=ATTEMPT_TYPES)
    was_blocked = models.BooleanField(default=True)
    
    # Context
    user_agent = models.CharField(max_length=500, blank=True)
    details = models.JSONField(default=dict)
    
    # Response
    it_notified = models.BooleanField(default=False)
    it_notified_at = models.DateTimeField(null=True, blank=True)
    
    resolved = models.BooleanField(default=False)
    resolved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='resolved_suspicious_access'
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_notes = models.TextField(blank=True)
    
    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['user', 'timestamp']),
            models.Index(fields=['was_blocked', 'resolved']),
        ]
    
    def __str__(self):
        return f"{self.user.get_full_name()} - {self.get_attempt_type_display()} ({self.timestamp})"


class GeoSecurityService:
    """
    Service for handling geographic IP security
    """
    
    # Geolocation API settings
    # Using ipapi.co (free tier: 1000 requests/day, no API key required)
    # For production, consider ip-api.com, ipgeolocation.io, or MaxMind GeoIP2
    GEOIP_API_URL = "https://ipapi.co/{ip}/json/"
    
    # Cache timeout (24 hours)
    CACHE_TIMEOUT = 86400
    
    # High-risk countries (can be configured)
    HIGH_RISK_COUNTRIES = [
        'KP',  # North Korea
        'IR',  # Iran
        'SY',  # Syria
        'CU',  # Cuba
        # Add more as needed
    ]
    
    @classmethod
    def check_ip_access(cls, ip_address: str, user: User, request=None) -> Tuple[bool, str, Optional[IPGeolocation]]:
        """
        Check if IP address is allowed to access the system
        
        Args:
            ip_address: IP address to check
            user: User attempting to access
            request: HTTP request object
            
        Returns:
            (is_allowed, reason, geolocation)
            
        Example:
            is_allowed, reason, geo = GeoSecurityService.check_ip_access(
                '8.8.8.8', 
                request.user, 
                request
            )
        """
        # Skip check for localhost/private IPs during development
        if cls._is_private_ip(ip_address):
            return True, "Private/local IP address", None
        
        # Get geolocation info
        geo = cls.get_ip_geolocation(ip_address)
        
        if not geo:
            # Could not determine location - DENY by default (fail secure)
            logger.warning(f"Could not geolocate IP {ip_address}, denying access")
            cls._log_suspicious_attempt(
                user, ip_address, None, 'NON_US', 
                True, request, {'reason': 'Geolocation lookup failed'}
            )
            return False, "Unable to verify your location. Access denied.", None
        
        # Check if US IP
        if geo.is_us:
            return True, "US IP address", geo
        
        # Check for active international access exception
        has_exception = cls._check_international_exception(user, geo)
        
        if has_exception:
            # User has valid exception
            logger.info(f"User {user.username} accessing from {geo.country_name} with approved exception")
            return True, f"Approved international access ({geo.country_name})", geo
        
        # No exception - BLOCK
        logger.warning(f"Blocked access from {geo.country_name} for user {user.username}")
        
        # Log suspicious attempt
        cls._log_suspicious_attempt(
            user, ip_address, geo, 'NON_US', 
            True, request, {'country': geo.country_name}
        )
        
        # Check if this is a repeated attempt - notify IT
        cls._check_repeated_attempts(user, ip_address, geo)
        
        return False, f"Access from {geo.country_name} is not permitted. Contact IT if you need international access.", geo
    
    @classmethod
    def get_ip_geolocation(cls, ip_address: str) -> Optional[IPGeolocation]:
        """
        Get geolocation information for an IP address
        Uses cached data when available
        
        Args:
            ip_address: IP address to lookup
            
        Returns:
            IPGeolocation object or None
        """
        # Check cache first
        cache_key = f"geoip_{ip_address}"
        cached = cache.get(cache_key)
        if cached:
            return cached
        
        # Check database
        try:
            geo = IPGeolocation.objects.get(ip_address=ip_address)
            
            # Update access count and last seen
            geo.access_count += 1
            geo.last_seen = timezone.now()
            geo.save()
            
            # Cache it
            cache.set(cache_key, geo, cls.CACHE_TIMEOUT)
            return geo
        
        except IPGeolocation.DoesNotExist:
            # Need to lookup from API
            return cls._lookup_ip_geolocation(ip_address)
    
    @classmethod
    def _lookup_ip_geolocation(cls, ip_address: str) -> Optional[IPGeolocation]:
        """
        Lookup IP geolocation from external API and cache it
        
        Args:
            ip_address: IP address to lookup
            
        Returns:
            IPGeolocation object or None
        """
        try:
            url = cls.GEOIP_API_URL.format(ip=ip_address)
            response = requests.get(url, timeout=5)
            response.raise_for_status()
            data = response.json()
            
            # Check for error response
            if data.get('error'):
                logger.error(f"GeoIP API error for {ip_address}: {data.get('reason')}")
                return None
            
            # Create database record
            geo = IPGeolocation.objects.create(
                ip_address=ip_address,
                country_code=data.get('country_code', 'XX'),
                country_name=data.get('country_name', 'Unknown'),
                region=data.get('region', ''),
                city=data.get('city', ''),
                isp=data.get('org', ''),
                organization=data.get('org', ''),
                latitude=data.get('latitude'),
                longitude=data.get('longitude'),
            )
            
            # Cache it
            cache_key = f"geoip_{ip_address}"
            cache.set(cache_key, geo, cls.CACHE_TIMEOUT)
            
            logger.info(f"Geolocated {ip_address} to {geo.country_name}")
            return geo
        
        except requests.RequestException as e:
            logger.error(f"Failed to lookup geolocation for {ip_address}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error in geolocation lookup: {e}")
            return None
    
    @classmethod
    def _check_international_exception(cls, user: User, geo: IPGeolocation) -> bool:
        """
        Check if user has active international access exception
        
        Args:
            user: User to check
            geo: IP geolocation
            
        Returns:
            True if user has valid exception
        """
        now = timezone.now()
        
        # Get active exceptions
        exceptions = InternationalAccessException.objects.filter(
            user=user,
            status='APPROVED',
            start_date__lte=now,
            end_date__gte=now
        )
        
        for exception in exceptions:
            # Record usage
            exception.record_usage()
            return True
        
        # Check for expired exceptions and update them
        InternationalAccessException.objects.filter(
            user=user,
            status='APPROVED',
            end_date__lt=now
        ).update(status='EXPIRED')
        
        return False
    
    @classmethod
    def _log_suspicious_attempt(cls, user: User, ip_address: str, geo: Optional[IPGeolocation],
                                attempt_type: str, was_blocked: bool, request, details: dict):
        """Log suspicious access attempt"""
        from core.audit import AuditLog
        
        user_agent = ''
        if request:
            user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]
        
        # Create suspicious attempt record
        attempt = SuspiciousAccessAttempt.objects.create(
            user=user,
            ip_address=ip_address,
            geolocation=geo,
            attempt_type=attempt_type,
            was_blocked=was_blocked,
            user_agent=user_agent,
            details=details
        )
        
        # Also log to audit trail
        AuditLog.log(
            'ACCESS_DENIED' if was_blocked else 'SUSPICIOUS_ACTIVITY',
            user=user,
            request=request,
            success=not was_blocked,
            risk_level='CRITICAL',
            ip_address=ip_address,
            country=geo.country_name if geo else 'Unknown',
            attempt_type=attempt_type,
            **details
        )
        
        return attempt
    
    @classmethod
    def _check_repeated_attempts(cls, user: User, ip_address: str, geo: IPGeolocation):
        """
        Check for repeated access attempts and notify IT team
        
        Args:
            user: User making attempts
            ip_address: IP address
            geo: Geolocation data
        """
        # Check attempts in last hour
        one_hour_ago = timezone.now() - timedelta(hours=1)
        
        recent_attempts = SuspiciousAccessAttempt.objects.filter(
            user=user,
            timestamp__gte=one_hour_ago,
            was_blocked=True
        ).count()
        
        # Threshold: 3 attempts in an hour
        if recent_attempts >= 3:
            # Get the most recent attempt
            latest_attempt = SuspiciousAccessAttempt.objects.filter(
                user=user,
                was_blocked=True
            ).first()
            
            # Only notify if we haven't notified recently
            if latest_attempt and not latest_attempt.it_notified:
                cls._notify_it_team(user, ip_address, geo, recent_attempts)
                
                # Mark as notified
                latest_attempt.it_notified = True
                latest_attempt.it_notified_at = timezone.now()
                latest_attempt.save()
    
    @classmethod
    def _notify_it_team(cls, user: User, ip_address: str, geo: IPGeolocation, attempt_count: int):
        """
        Send alert to IT team about repeated suspicious access attempts
        
        Args:
            user: User making attempts
            ip_address: IP address
            geo: Geolocation data
            attempt_count: Number of attempts
        """
        from django.contrib.auth.models import Group
        
        # Get IT staff
        it_staff = User.objects.filter(
            groups__name='Chief Officers',
            is_active=True
        ).distinct()
        
        if not it_staff:
            logger.error("No IT staff found to notify about suspicious access")
            return
        
        # Build message
        subject = f"🚨 SECURITY ALERT: Multiple blocked access attempts - {user.get_full_name()}"
        
        message = f"""
SECURITY ALERT: Multiple Blocked Access Attempts

User: {user.get_full_name()} ({user.username})
IP Address: {ip_address}
Location: {geo.city}, {geo.region}, {geo.country_name}
ISP/Organization: {geo.organization}
Attempts in last hour: {attempt_count}
Time: {timezone.now().strftime('%Y-%m-%d %H:%M:%S %Z')}

This user has attempted to access the system multiple times from a non-US location.

POSSIBLE REASONS:
1. User is traveling internationally and forgot to request access
2. Account credentials have been compromised
3. Unauthorized access attempt

RECOMMENDED ACTIONS:
1. Contact the user immediately to verify their location
2. If legitimate travel, create an International Access Exception
3. If suspicious, consider temporarily disabling the account
4. Review audit logs for this user

To create an international access exception:
1. Go to Admin Panel → International Access Exceptions
2. Create new exception for user: {user.username}
3. Set destination country: {geo.country_name}
4. Set time period for access

To review audit logs:
Admin Panel → Audit Logs → Filter by user: {user.username}

Do not reply to this automated message. Contact IT Security if you need assistance.
        """.strip()
        
        # Send notification
        NotificationManager.send_notification(
            notification_type=NotificationType.APPROVAL_NEEDED,
            recipients=list(it_staff),
            subject=subject,
            message=message,
            priority=NotificationPriority.URGENT,
            context={
                'user_id': user.id,
                'ip_address': ip_address,
                'country': geo.country_name,
                'attempt_count': attempt_count
            }
        )
        
        logger.critical(
            f"IT team notified: {attempt_count} blocked attempts from "
            f"{geo.country_name} for user {user.username}"
        )
    
    @staticmethod
    def _is_private_ip(ip_address: str) -> bool:
        """
        Check if IP is private/local (for development)
        
        Args:
            ip_address: IP to check
            
        Returns:
            True if private IP
        """
        # Common private/local IPs
        private_ranges = [
            '127.',       # Localhost
            '10.',        # Private Class A
            '192.168.',   # Private Class C
            '172.16.',    # Private Class B (start)
            '172.31.',    # Private Class B (end)
            '::1',        # IPv6 localhost
            'fe80:',      # IPv6 link-local
        ]
        
        return any(ip_address.startswith(prefix) for prefix in private_ranges)


# Convenience function for use in views/middleware
def check_geographic_access(request, user) -> Tuple[bool, str]:
    """
    Convenience function to check geographic access in views
    
    Args:
        request: HTTP request
        user: User attempting access
        
    Returns:
        (is_allowed, message)
        
    Usage:
        is_allowed, message = check_geographic_access(request, request.user)
        if not is_allowed:
            messages.error(request, message)
            return redirect('blocked')
    """
    ip = GeoSecurityService._get_client_ip(request)
    is_allowed, reason, geo = GeoSecurityService.check_ip_access(ip, user, request)
    return is_allowed, reason


def _get_client_ip(request) -> str:
    """Extract client IP from request"""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        return x_forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '')
