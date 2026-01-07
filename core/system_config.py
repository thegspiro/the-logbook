"""
System Configuration Model
Singleton pattern for global system settings including geographic security
"""
from django.db import models
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.utils import timezone
from core.notifications import NotificationManager, NotificationType, NotificationPriority
import logging

logger = logging.getLogger(__name__)


class SystemConfiguration(models.Model):
    """
    Singleton model for system-wide configuration
    Only one record should ever exist
    
    IMPORTANT: Settings here affect security and should only be changed
    by system administrators
    """
    
    # Country configuration for geographic security
    COUNTRY_CHOICES = [
        ('US', 'United States'),
        ('CA', 'Canada'),
        ('GB', 'United Kingdom'),
        ('AU', 'Australia'),
        ('NZ', 'New Zealand'),
        ('IE', 'Ireland'),
        ('MX', 'Mexico'),
        ('DE', 'Germany'),
        ('FR', 'France'),
        ('ES', 'Spain'),
        ('IT', 'Italy'),
        ('NL', 'Netherlands'),
        ('BE', 'Belgium'),
        ('CH', 'Switzerland'),
        ('AT', 'Austria'),
        ('SE', 'Sweden'),
        ('NO', 'Norway'),
        ('DK', 'Denmark'),
        ('FI', 'Finland'),
        ('PL', 'Poland'),
        ('JP', 'Japan'),
        ('KR', 'South Korea'),
        ('SG', 'Singapore'),
        ('BR', 'Brazil'),
        ('AR', 'Argentina'),
        ('CL', 'Chile'),
        ('ZA', 'South Africa'),
        # Add more as needed
    ]
    
    # Department Information
    department_name = models.CharField(
        max_length=200,
        default='Fire Department',
        help_text="Official department name"
    )
    
    department_abbreviation = models.CharField(
        max_length=20,
        blank=True,
        help_text="Short name or abbreviation (e.g., 'VFD', 'FD')"
    )
    
    timezone = models.CharField(
        max_length=50,
        default='America/New_York',
        help_text="Department timezone (e.g., 'America/New_York', 'Europe/London')"
    )
    
    # Geographic Security Settings
    primary_country = models.CharField(
        max_length=2,
        choices=COUNTRY_CHOICES,
        default='US',
        help_text="Primary country for geographic access control. "
                  "Users from this country are automatically allowed access."
    )
    
    secondary_country = models.CharField(
        max_length=2,
        choices=COUNTRY_CHOICES,
        blank=True,
        null=True,
        help_text="Optional secondary country (for border departments). "
                  "Users from this country are also automatically allowed."
    )
    
    geo_security_enabled = models.BooleanField(
        default=True,
        help_text="Enable geographic IP restrictions. "
                  "When enabled, only users from primary/secondary countries can access."
    )
    
    # Change tracking
    primary_country_changed_at = models.DateTimeField(null=True, blank=True)
    primary_country_changed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='primary_country_changes'
    )
    previous_primary_country = models.CharField(max_length=2, blank=True)
    
    secondary_country_changed_at = models.DateTimeField(null=True, blank=True)
    secondary_country_changed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='secondary_country_changes'
    )
    previous_secondary_country = models.CharField(max_length=2, blank=True)
    
    # Contact Information
    admin_email = models.EmailField(
        blank=True,
        help_text="Primary administrator email"
    )
    
    it_email = models.EmailField(
        blank=True,
        help_text="IT support email"
    )
    
    security_email = models.EmailField(
        blank=True,
        help_text="Security team email"
    )
    
    # Setup tracking
    setup_completed = models.BooleanField(default=False)
    setup_completed_at = models.DateTimeField(null=True, blank=True)
    setup_completed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='system_setups'
    )
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'System Configuration'
        verbose_name_plural = 'System Configuration'
    
    def __str__(self):
        return f"System Configuration - {self.department_name}"
    
    def save(self, *args, **kwargs):
        """
        Enforce singleton pattern and track country changes
        """
        # Check if this is an update to an existing config
        if self.pk:
            # Get the old instance to compare
            old_instance = SystemConfiguration.objects.get(pk=self.pk)
            
            # Check if primary country changed
            if old_instance.primary_country != self.primary_country:
                self.previous_primary_country = old_instance.primary_country
                self.primary_country_changed_at = timezone.now()
                
                # Log the change
                logger.critical(
                    f"PRIMARY COUNTRY CHANGED: {old_instance.primary_country} → {self.primary_country} "
                    f"by {self.primary_country_changed_by}"
                )
                
                # Send notifications
                self._notify_country_change(
                    'primary',
                    old_instance.primary_country,
                    self.primary_country
                )
            
            # Check if secondary country changed
            if old_instance.secondary_country != self.secondary_country:
                self.previous_secondary_country = old_instance.secondary_country or ''
                self.secondary_country_changed_at = timezone.now()
                
                logger.warning(
                    f"SECONDARY COUNTRY CHANGED: {old_instance.secondary_country} → {self.secondary_country} "
                    f"by {self.secondary_country_changed_by}"
                )
                
                # Send notifications
                self._notify_country_change(
                    'secondary',
                    old_instance.secondary_country,
                    self.secondary_country
                )
        
        # Enforce singleton - only one configuration record allowed
        if not self.pk and SystemConfiguration.objects.exists():
            raise ValidationError(
                'Only one System Configuration record is allowed. '
                'Please edit the existing configuration instead of creating a new one.'
            )
        
        super().save(*args, **kwargs)
    
    def _notify_country_change(self, country_type, old_country, new_country):
        """
        Send critical security notification when allowed countries change
        
        Args:
            country_type: 'primary' or 'secondary'
            old_country: Previous country code
            new_country: New country code
        """
        from django.contrib.auth.models import Group
        from core.audit import AuditLog
        
        # Get leadership team (Chief Officers and Compliance Officers)
        leadership = User.objects.filter(
            groups__name__in=['Chief Officers', 'Compliance Officers'],
            is_active=True
        ).distinct()
        
        if not leadership:
            logger.error("No leadership users found to notify of country change")
            return
        
        # Build message
        old_name = dict(self.COUNTRY_CHOICES).get(old_country, old_country) if old_country else 'None'
        new_name = dict(self.COUNTRY_CHOICES).get(new_country, new_country) if new_country else 'None'
        
        subject = f"🚨 CRITICAL: Geographic Security Configuration Changed - {country_type.title()} Country"
        
        message = f"""
CRITICAL SECURITY CONFIGURATION CHANGE

{'='*60}
GEOGRAPHIC ACCESS CONTROL UPDATED
{'='*60}

Configuration Type: {country_type.upper()} COUNTRY
Previous Value: {old_name} ({old_country if old_country else 'None'})
New Value: {new_name} ({new_country if new_country else 'None'})
Changed By: {self.primary_country_changed_by.get_full_name() if country_type == 'primary' else self.secondary_country_changed_by.get_full_name()}
Changed At: {timezone.now().strftime('%Y-%m-%d %H:%M:%S %Z')}

IMPACT:
{'='*60}

{self._get_impact_description(country_type, old_country, new_country)}

SECURITY IMPLICATIONS:
{'='*60}

- All users from {new_name} can now access the system without exceptions
{f"- Users from {old_name} are now BLOCKED by default" if old_country and old_country != new_country else ""}
- Existing international access exceptions remain valid
- All access attempts are logged for audit purposes
- This change is effective immediately

REQUIRED ACTIONS:
{'='*60}

1. VERIFY: Confirm this change was authorized and expected
2. REVIEW: Check all active international access exceptions
3. COMMUNICATE: Inform all affected members of this change
4. MONITOR: Watch for unusual access patterns over next 48 hours

AUDIT TRAIL:
{'='*60}

This change has been logged in the system audit trail.
Review: Admin Panel → Audit Logs → Filter by action: "SETTING_CHANGE"

If this change was NOT authorized:
1. IMMEDIATELY revert the change in Admin Panel → System Configuration
2. Contact security team: {self.security_email or 'security@yourfiredept.org'}
3. Review admin account access logs
4. Change all administrative passwords

{'='*60}
This is an automated security notification.
System Configuration: {self.department_name}
        """.strip()
        
        # Send high-priority notification to leadership
        NotificationManager.send_notification(
            notification_type=NotificationType.GENERAL_ANNOUNCEMENT,
            recipients=list(leadership),
            subject=subject,
            message=message,
            priority=NotificationPriority.URGENT,
            context={
                'country_type': country_type,
                'old_country': old_country,
                'new_country': new_country,
                'changed_by': self.primary_country_changed_by.username if country_type == 'primary' else self.secondary_country_changed_by.username
            }
        )
        
        # Also log to audit trail
        AuditLog.log(
            'SETTING_CHANGE',
            user=self.primary_country_changed_by if country_type == 'primary' else self.secondary_country_changed_by,
            success=True,
            risk_level='CRITICAL',
            setting_name=f'{country_type}_country',
            old_value=old_country,
            new_value=new_country,
            department=self.department_name
        )
    
    def _get_impact_description(self, country_type, old_country, new_country):
        """Generate description of impact based on change"""
        old_name = dict(self.COUNTRY_CHOICES).get(old_country, old_country) if old_country else 'None'
        new_name = dict(self.COUNTRY_CHOICES).get(new_country, new_country) if new_country else 'None'
        
        if country_type == 'primary':
            if not old_country:
                return f"• Initial configuration: {new_name} is now the primary allowed country"
            elif not new_country:
                return "• PRIMARY COUNTRY REMOVED: No automatic access allowed!"
            else:
                return f"""• Users from {new_name} can now access automatically
• Users from {old_name} now require international access exceptions
• This affects ALL members - existing sessions may be terminated"""
        else:  # secondary
            if not old_country and new_country:
                return f"• Secondary country ADDED: Users from {new_name} can now access automatically"
            elif old_country and not new_country:
                return f"• Secondary country REMOVED: Users from {old_name} now require exceptions"
            elif old_country and new_country:
                return f"• Secondary country changed from {old_name} to {new_name}"
            else:
                return "• No secondary country configured"
    
    @classmethod
    def get_config(cls):
        """
        Get or create the singleton configuration instance
        
        Returns:
            SystemConfiguration instance
        """
        config, created = cls.objects.get_or_create(
            pk=1,
            defaults={
                'department_name': 'Fire Department',
                'primary_country': 'US',
                'geo_security_enabled': True
            }
        )
        
        if created:
            logger.info("System configuration created with default values")
        
        return config
    
    def is_country_allowed(self, country_code):
        """
        Check if a country code is in the allowed list
        
        Args:
            country_code: ISO 3166-1 alpha-2 country code (e.g., 'US', 'CA')
            
        Returns:
            bool: True if country is allowed
        """
        if not self.geo_security_enabled:
            return True
        
        # Check primary country
        if country_code == self.primary_country:
            return True
        
        # Check secondary country if configured
        if self.secondary_country and country_code == self.secondary_country:
            return True
        
        return False
    
    def get_allowed_countries(self):
        """
        Get list of allowed country codes
        
        Returns:
            list: Country codes that are allowed
        """
        countries = [self.primary_country]
        if self.secondary_country:
            countries.append(self.secondary_country)
        return countries
    
    def get_allowed_country_names(self):
        """
        Get list of allowed country names (human-readable)
        
        Returns:
            list: Country names
        """
        country_dict = dict(self.COUNTRY_CHOICES)
        names = [country_dict.get(self.primary_country, self.primary_country)]
        if self.secondary_country:
            names.append(country_dict.get(self.secondary_country, self.secondary_country))
        return names


class CountryChangeLog(models.Model):
    """
    Immutable log of all country configuration changes
    Separate from SystemConfiguration for audit purposes
    
    CRITICAL SECURITY:
    - Records are IMMUTABLE after creation
    - No edits allowed (enforced in save method)
    - No deletions allowed (enforced in admin)
    - Tamper attempts are logged and alerted
    - Weekly digest sent to IT Director
    """
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    changed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    
    change_type = models.CharField(
        max_length=20,
        choices=[
            ('PRIMARY', 'Primary Country Change'),
            ('SECONDARY', 'Secondary Country Change'),
            ('GEO_SECURITY', 'Geographic Security Enabled/Disabled'),
        ]
    )
    
    old_value = models.CharField(max_length=50, blank=True)
    new_value = models.CharField(max_length=50)
    
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    
    # Leadership notification tracking
    leadership_notified = models.BooleanField(default=False)
    leadership_notified_at = models.DateTimeField(null=True, blank=True)
    notification_recipient_count = models.IntegerField(default=0)
    
    # Justification
    change_reason = models.TextField(
        blank=True,
        help_text="Why was this change made?"
    )
    
    # Tamper protection
    is_locked = models.BooleanField(
        default=True,
        help_text="Once locked, record cannot be modified"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    checksum = models.CharField(
        max_length=64,
        blank=True,
        help_text="SHA256 checksum for integrity verification"
    )
    
    class Meta:
        ordering = ['-timestamp']
        verbose_name = 'Country Change Log'
        verbose_name_plural = 'Country Change Logs'
        permissions = [
            ('view_sensitive_logs', 'Can view sensitive audit logs'),
        ]
    
    def __str__(self):
        return f"{self.get_change_type_display()} - {self.timestamp.strftime('%Y-%m-%d %H:%M')}"
    
    def save(self, *args, **kwargs):
        """
        Override save to enforce immutability and generate checksum
        """
        # If this is an update (has pk) and record is locked, DENY
        if self.pk and self.is_locked:
            # Log tamper attempt
            self._log_tamper_attempt('EDIT_ATTEMPT')
            raise ValidationError(
                'This audit log record is locked and cannot be modified. '
                'Audit logs are immutable for compliance and forensic purposes.'
            )
        
        # Generate checksum on first save
        if not self.pk:
            self.is_locked = True  # Lock immediately
            super().save(*args, **kwargs)  # Save to get pk
            self.checksum = self._generate_checksum()
            # Update with checksum (bypass lock check)
            super(CountryChangeLog, self).save(update_fields=['checksum'])
        else:
            super().save(*args, **kwargs)
    
    def delete(self, *args, **kwargs):
        """
        Override delete to prevent deletion
        """
        self._log_tamper_attempt('DELETE_ATTEMPT')
        raise ValidationError(
            'Audit log records cannot be deleted. '
            'This is a security violation and has been logged.'
        )
    
    def _generate_checksum(self):
        """
        Generate SHA256 checksum of record data for integrity verification
        
        Returns:
            str: Hexadecimal checksum
        """
        import hashlib
        
        # Concatenate all important fields
        data = f"{self.pk}|{self.timestamp}|{self.changed_by_id}|{self.change_type}|" \
               f"{self.old_value}|{self.new_value}|{self.change_reason}|{self.created_at}"
        
        return hashlib.sha256(data.encode()).hexdigest()
    
    def verify_integrity(self):
        """
        Verify record has not been tampered with
        
        Returns:
            bool: True if checksum matches, False if tampered
        """
        if not self.checksum:
            return False
        
        expected_checksum = self._generate_checksum()
        is_valid = expected_checksum == self.checksum
        
        if not is_valid:
            # Record has been tampered with!
            self._log_tamper_attempt('CHECKSUM_MISMATCH')
        
        return is_valid
    
    def _log_tamper_attempt(self, attempt_type):
        """
        Log tampering attempt and send critical alert
        
        Args:
            attempt_type: Type of tampering (EDIT_ATTEMPT, DELETE_ATTEMPT, CHECKSUM_MISMATCH)
        """
        from core.audit import AuditLog
        from django.contrib.auth.models import User
        import logging
        
        logger = logging.getLogger(__name__)
        
        # Get current user if available
        from threading import current_thread
        user = getattr(current_thread(), 'user', None)
        
        # Log to audit trail
        logger.critical(
            f"AUDIT LOG TAMPER ATTEMPT: {attempt_type} on CountryChangeLog #{self.pk} "
            f"by user: {user.username if user else 'UNKNOWN'}"
        )
        
        # Create audit log entry
        AuditLog.log(
            'SUSPICIOUS_ACTIVITY',
            user=user,
            success=False,
            risk_level='CRITICAL',
            attempt_type=f'AUDIT_LOG_TAMPER_{attempt_type}',
            target_log_id=self.pk,
            target_log_type='CountryChangeLog'
        )
        
        # Send immediate alert to IT Director and Security Team
        self._send_tamper_alert(attempt_type, user)
    
    def _send_tamper_alert(self, attempt_type, user):
        """
        Send critical security alert about tamper attempt
        
        Args:
            attempt_type: Type of tampering
            user: User who attempted tampering
        """
        from core.notifications import NotificationManager, NotificationType, NotificationPriority
        from django.contrib.auth.models import Group, User as DjangoUser
        
        # Get IT Director and Security Team
        recipients = DjangoUser.objects.filter(
            groups__name__in=['Chief Officers', 'IT Director'],
            is_active=True
        ).distinct()
        
        if not recipients:
            return
        
        # Get system configuration for contact info
        from core.system_config import SystemConfiguration
        config = SystemConfiguration.get_config()
        
        subject = "🚨 CRITICAL SECURITY ALERT: Audit Log Tampering Attempt"
        
        message = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL SECURITY VIOLATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AUDIT LOG TAMPERING DETECTED

Attempt Type: {attempt_type}
Target Record: CountryChangeLog #{self.pk}
Original Change: {self.get_change_type_display()}
Original Timestamp: {self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}
Attempted By: {user.get_full_name() if user else 'UNKNOWN'} ({user.username if user else 'N/A'})
Attempt Time: {timezone.now().strftime('%Y-%m-%d %H:%M:%S')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEVERITY: CRITICAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Someone attempted to {'modify' if attempt_type == 'EDIT_ATTEMPT' else 'delete'} 
an immutable audit log record. This is a serious security violation.

POSSIBLE SCENARIOS:
1. Unauthorized access to admin panel
2. Compromised administrator account
3. Malicious insider threat
4. Accidental admin action (unlikely due to protections)

IMMEDIATE ACTIONS REQUIRED:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. VERIFY: Contact {user.get_full_name() if user else 'the user'} immediately
   Phone: {user.userprofile.phone_number if user and hasattr(user, 'userprofile') else 'N/A'}
   Email: {user.email if user else 'N/A'}

2. INVESTIGATE: Review recent admin panel activity
   - Check admin access logs
   - Review all recent changes
   - Look for other suspicious activity

3. SECURE: If unauthorized access suspected:
   - Disable the user account immediately
   - Force password reset for all administrators
   - Review and revoke all admin sessions
   - Check for other compromised accounts

4. DOCUMENT: This incident must be documented:
   - Screenshot this email
   - Export audit logs
   - Document timeline of events
   - Prepare incident report

5. NOTIFY: Inform department leadership
   - Chief Officer: {config.admin_email or 'N/A'}
   - Security Team: {config.security_email or 'N/A'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECORD DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Change Type: {self.get_change_type_display()}
Old Value: {self.old_value}
New Value: {self.new_value}
Changed By: {self.changed_by.get_full_name() if self.changed_by else 'SYSTEM'}
Original Date: {self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}
Reason: {self.change_reason or 'Not provided'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SYSTEM PROTECTION STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ PROTECTED: The audit log was NOT modified
✅ LOGGED: This tampering attempt has been logged
✅ ALERTED: IT Director and Security Team notified
✅ INTEGRITY: Record checksum verification in place

The system successfully prevented unauthorized modification.
However, the attempt itself is a security concern.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is an automated critical security alert.
For assistance: {config.security_email or 'security@yourfiredept.org'}

DO NOT IGNORE THIS MESSAGE.
        """.strip()
        
        NotificationManager.send_notification(
            notification_type=NotificationType.GENERAL_ANNOUNCEMENT,
            recipients=list(recipients),
            subject=subject,
            message=message,
            priority=NotificationPriority.URGENT
        )
    
    @classmethod
    def log_change(cls, change_type, old_value, new_value, changed_by, request=None, reason=''):
        """
        Create an immutable log entry for country changes
        
        Args:
            change_type: Type of change
            old_value: Previous value
            new_value: New value
            changed_by: User who made the change
            request: HTTP request object
            reason: Justification for change
        """
        ip = None
        user_agent = ''
        
        if request:
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
            if x_forwarded_for:
                ip = x_forwarded_for.split(',')[0].strip()
            else:
                ip = request.META.get('REMOTE_ADDR')
            user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]
        
        log = cls.objects.create(
            changed_by=changed_by,
            change_type=change_type,
            old_value=old_value,
            new_value=new_value,
            ip_address=ip,
            user_agent=user_agent,
            change_reason=reason
        )
        
        logger.critical(
            f"COUNTRY CONFIGURATION CHANGED: {change_type} | "
            f"From: {old_value} → To: {new_value} | "
            f"By: {changed_by.username} | IP: {ip}"
        )
        
        return log
    
    @classmethod
    def verify_all_integrity(cls):
        """
        Verify integrity of all log records
        
        Returns:
            dict: Results of integrity check
        """
        results = {
            'total': 0,
            'valid': 0,
            'invalid': 0,
            'tampered_records': []
        }
        
        for log in cls.objects.all():
            results['total'] += 1
            if log.verify_integrity():
                results['valid'] += 1
            else:
                results['invalid'] += 1
                results['tampered_records'].append({
                    'id': log.pk,
                    'timestamp': log.timestamp,
                    'change_type': log.change_type
                })
        
        return results
