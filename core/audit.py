"""
Security Audit Logging System
Tracks all security-sensitive operations for compliance and forensics
"""
from django.db import models
from django.contrib.auth.models import User
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
import logging

audit_logger = logging.getLogger('security.audit')


class AuditLog(models.Model):
    """
    Immutable audit trail for security-sensitive operations
    
    IMPORTANT: Records in this table should NEVER be deleted
    They provide forensic evidence and compliance documentation
    """
    
    ACTION_TYPES = [
        ('LOGIN', 'User Login'),
        ('LOGOUT', 'User Logout'),
        ('LOGIN_FAILED', 'Failed Login Attempt'),
        ('PASSWORD_CHANGE', 'Password Changed'),
        ('PASSWORD_RESET', 'Password Reset Requested'),
        ('2FA_ENABLED', 'Two-Factor Authentication Enabled'),
        ('2FA_DISABLED', 'Two-Factor Authentication Disabled'),
        ('PERMISSION_CHANGE', 'Permission Modified'),
        ('ROLE_CHANGE', 'User Role Changed'),
        
        # Data access
        ('DATA_VIEW', 'Sensitive Data Viewed'),
        ('DATA_CREATE', 'Sensitive Data Created'),
        ('DATA_MODIFY', 'Sensitive Data Modified'),
        ('DATA_DELETE', 'Data Deleted'),
        ('DATA_EXPORT', 'Data Exported'),
        ('DOCUMENT_VIEW', 'Document Accessed'),
        ('DOCUMENT_DOWNLOAD', 'Document Downloaded'),
        
        # Personnel records (HIPAA-related)
        ('MEDICAL_VIEW', 'Medical Record Viewed'),
        ('MEDICAL_MODIFY', 'Medical Record Modified'),
        ('CERTIFICATION_VIEW', 'Certification Viewed'),
        ('PERSONNEL_FILE_ACCESS', 'Personnel File Accessed'),
        
        # System administration
        ('SETTING_CHANGE', 'System Setting Changed'),
        ('BACKUP_CREATED', 'Backup Created'),
        ('BACKUP_RESTORED', 'Backup Restored'),
        ('API_KEY_CREATED', 'API Key Generated'),
        ('API_KEY_REVOKED', 'API Key Revoked'),
        
        # Security events
        ('ACCOUNT_LOCKED', 'Account Locked'),
        ('ACCOUNT_UNLOCKED', 'Account Unlocked'),
        ('SUSPICIOUS_ACTIVITY', 'Suspicious Activity Detected'),
        ('ACCESS_DENIED', 'Access Denied'),
    ]
    
    # When the action occurred
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    
    # Who performed the action
    user = models.ForeignKey(
        User, 
        on_delete=models.SET_NULL, 
        null=True,
        related_name='audit_logs',
        help_text="User who performed the action (null for system actions)"
    )
    
    # What action was performed
    action = models.CharField(max_length=30, choices=ACTION_TYPES, db_index=True)
    
    # What object was affected (optional)
    content_type = models.ForeignKey(ContentType, on_delete=models.SET_NULL, null=True, blank=True)
    object_id = models.PositiveIntegerField(null=True, blank=True)
    content_object = GenericForeignKey('content_type', 'object_id')
    
    # Network information
    ip_address = models.GenericIPAddressField(null=True, blank=True, db_index=True)
    user_agent = models.CharField(max_length=500, blank=True)
    
    # Additional context (stored as JSON)
    details = models.JSONField(
        default=dict,
        help_text="Additional details about the action"
    )
    
    # Success or failure
    success = models.BooleanField(
        default=True,
        help_text="Whether the action succeeded"
    )
    
    # Risk level
    RISK_LEVELS = [
        ('LOW', 'Low Risk'),
        ('MEDIUM', 'Medium Risk'),
        ('HIGH', 'High Risk'),
        ('CRITICAL', 'Critical Risk'),
    ]
    risk_level = models.CharField(
        max_length=10,
        choices=RISK_LEVELS,
        default='LOW',
        db_index=True
    )
    
    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['timestamp', 'action']),
            models.Index(fields=['user', 'timestamp']),
            models.Index(fields=['ip_address', 'timestamp']),
            models.Index(fields=['risk_level', 'timestamp']),
        ]
        verbose_name = 'Audit Log Entry'
        verbose_name_plural = 'Audit Log Entries'
    
    def __str__(self):
        user_str = self.user.get_full_name() if self.user else "System"
        return f"{self.timestamp} - {user_str}: {self.get_action_display()}"
    
    @classmethod
    def log(cls, action, user=None, request=None, obj=None, 
            success=True, risk_level='LOW', **details):
        """
        Create an audit log entry
        
        Args:
            action: Action type from ACTION_TYPES
            user: User performing the action
            request: HTTP request object (for IP and user agent)
            obj: Object being acted upon
            success: Whether action succeeded
            risk_level: Risk level of the action
            **details: Additional context to store
            
        Returns:
            Created AuditLog instance
            
        Example:
            AuditLog.log(
                'MEDICAL_VIEW',
                user=request.user,
                request=request,
                obj=medical_record,
                risk_level='HIGH',
                record_type='Physical Exam'
            )
        """
        ip = None
        user_agent = ''
        
        if request:
            ip = cls._get_client_ip(request)
            user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]
        
        # Sanitize details - remove any passwords or tokens
        sanitized_details = cls._sanitize_details(details)
        
        log_entry = cls.objects.create(
            user=user,
            action=action,
            content_object=obj,
            ip_address=ip,
            user_agent=user_agent,
            details=sanitized_details,
            success=success,
            risk_level=risk_level
        )
        
        # Also log to file for external SIEM systems
        log_level = logging.WARNING if risk_level in ['HIGH', 'CRITICAL'] else logging.INFO
        audit_logger.log(
            log_level,
            f"AUDIT: {action} | User: {user} | IP: {ip} | Success: {success} | "
            f"Risk: {risk_level} | Details: {sanitized_details}"
        )
        
        # Alert on high-risk actions
        if risk_level in ['HIGH', 'CRITICAL']:
            cls._send_security_alert(log_entry)
        
        return log_entry
    
    @staticmethod
    def _get_client_ip(request):
        """Extract client IP from request"""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            return x_forwarded_for.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR')
    
    @staticmethod
    def _sanitize_details(details):
        """
        Remove sensitive information from audit log details
        
        CRITICAL: Never log passwords, tokens, or other secrets
        """
        sensitive_keys = [
            'password', 'passwd', 'pwd', 'secret', 'token', 
            'api_key', 'private_key', 'ssn', 'social_security'
        ]
        
        sanitized = {}
        for key, value in details.items():
            key_lower = key.lower()
            if any(sensitive in key_lower for sensitive in sensitive_keys):
                sanitized[key] = '***REDACTED***'
            else:
                sanitized[key] = value
        
        return sanitized
    
    @staticmethod
    def _send_security_alert(log_entry):
        """Send alert for high-risk security events"""
        from core.notifications import NotificationManager, NotificationType, NotificationPriority
        from django.contrib.auth.models import Group
        
        # Notify security team
        security_team = User.objects.filter(
            groups__name__in=['Chief Officers', 'Compliance Officers'],
            is_active=True
        ).distinct()
        
        if security_team:
            subject = f"Security Alert: {log_entry.get_action_display()}"
            message = (
                f"A {log_entry.risk_level} risk security event occurred:\n\n"
                f"Action: {log_entry.get_action_display()}\n"
                f"User: {log_entry.user.get_full_name() if log_entry.user else 'System'}\n"
                f"IP Address: {log_entry.ip_address}\n"
                f"Time: {log_entry.timestamp}\n"
                f"Success: {'Yes' if log_entry.success else 'No'}\n\n"
                f"Details: {log_entry.details}"
            )
            
            NotificationManager.send_notification(
                notification_type=NotificationType.GENERAL_ANNOUNCEMENT,
                recipients=list(security_team),
                subject=subject,
                message=message,
                priority=NotificationPriority.URGENT
            )


class LoginAttempt(models.Model):
    """
    Track login attempts for brute-force detection
    Separate from AuditLog for performance (frequent writes)
    """
    
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    username = models.CharField(max_length=150, db_index=True)
    ip_address = models.GenericIPAddressField(db_index=True)
    user_agent = models.CharField(max_length=500, blank=True)
    success = models.BooleanField(default=False)
    failure_reason = models.CharField(max_length=100, blank=True)
    
    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['username', 'timestamp']),
            models.Index(fields=['ip_address', 'timestamp']),
        ]
    
    @classmethod
    def log_attempt(cls, username, ip_address, success, request=None, failure_reason=''):
        """Log a login attempt"""
        user_agent = ''
        if request:
            user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]
        
        return cls.objects.create(
            username=username,
            ip_address=ip_address,
            success=success,
            user_agent=user_agent,
            failure_reason=failure_reason
        )
    
    @classmethod
    def check_brute_force(cls, username=None, ip_address=None, minutes=5, max_attempts=5):
        """
        Check if username or IP has too many failed attempts
        
        Args:
            username: Username to check
            ip_address: IP address to check
            minutes: Time window to check
            max_attempts: Maximum failed attempts allowed
            
        Returns:
            (is_blocked, attempts_count, message)
        """
        from django.utils import timezone
        from datetime import timedelta
        
        cutoff_time = timezone.now() - timedelta(minutes=minutes)
        
        # Check by username
        if username:
            failed_attempts = cls.objects.filter(
                username=username,
                success=False,
                timestamp__gte=cutoff_time
            ).count()
            
            if failed_attempts >= max_attempts:
                return True, failed_attempts, f"Account temporarily locked due to {failed_attempts} failed login attempts"
        
        # Check by IP
        if ip_address:
            failed_attempts = cls.objects.filter(
                ip_address=ip_address,
                success=False,
                timestamp__gte=cutoff_time
            ).count()
            
            if failed_attempts >= max_attempts:
                return True, failed_attempts, f"IP address temporarily blocked due to {failed_attempts} failed login attempts"
        
        return False, 0, ""


# Convenience functions for common audit events
def log_login(user, request, success=True):
    """Log user login"""
    return AuditLog.log(
        'LOGIN' if success else 'LOGIN_FAILED',
        user=user,
        request=request,
        success=success,
        risk_level='LOW' if success else 'MEDIUM'
    )

def log_sensitive_data_access(user, request, obj, action='DATA_VIEW'):
    """Log access to sensitive data"""
    return AuditLog.log(
        action,
        user=user,
        request=request,
        obj=obj,
        risk_level='HIGH',
        object_type=obj.__class__.__name__
    )

def log_permission_change(user, request, target_user, old_permissions, new_permissions):
    """Log permission changes"""
    return AuditLog.log(
        'PERMISSION_CHANGE',
        user=user,
        request=request,
        obj=target_user,
        risk_level='CRITICAL',
        target_user=target_user.get_full_name(),
        old_permissions=list(old_permissions),
        new_permissions=list(new_permissions)
    )
