"""
HIPAA Compliance Models
Tracks HIPAA training, business associates, and security incidents
"""
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from django.core.exceptions import ValidationError
from datetime import timedelta


class HIPAATraining(models.Model):
    """
    Track HIPAA training completion for workforce members
    
    HIPAA Requirement: §164.308(a)(5)
    All workforce members must receive HIPAA training
    """
    TRAINING_TYPES = [
        ('INITIAL', 'Initial HIPAA Training'),
        ('ANNUAL', 'Annual Refresher'),
        ('INCIDENT', 'Post-Incident Training'),
        ('POLICY_UPDATE', 'Policy Update Training'),
    ]
    
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='hipaa_training_records'
    )
    
    training_type = models.CharField(max_length=20, choices=TRAINING_TYPES)
    training_date = models.DateField()
    completed = models.BooleanField(default=False)
    completion_date = models.DateField(null=True, blank=True)
    
    # Documentation
    acknowledgment_signed = models.BooleanField(
        default=False,
        help_text="User signed acknowledgment of understanding"
    )
    signature = models.CharField(max_length=200, blank=True)
    signature_date = models.DateTimeField(null=True, blank=True)
    
    # Content tracking
    topics_covered = models.TextField(
        help_text="List of topics covered in this training"
    )
    quiz_score = models.IntegerField(
        null=True,
        blank=True,
        help_text="Score on comprehension quiz (0-100)"
    )
    passed = models.BooleanField(
        default=False,
        help_text="Passed comprehension requirements (80% or higher)"
    )
    
    # Expiration
    expiration_date = models.DateField(
        help_text="Training expires after 1 year"
    )
    
    # Instructor
    instructor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='hipaa_training_conducted'
    )
    
    # Certificate
    certificate_number = models.CharField(max_length=50, unique=True, blank=True)
    
    class Meta:
        ordering = ['-training_date']
        indexes = [
            models.Index(fields=['user', 'expiration_date']),
        ]
    
    def __str__(self):
        return f"{self.user.get_full_name()} - {self.get_training_type_display()} ({self.training_date})"
    
    @property
    def is_expired(self):
        """Check if training has expired"""
        return self.expiration_date < timezone.now().date()
    
    @property
    def days_until_expiration(self):
        """Days until training expires"""
        if self.is_expired:
            return 0
        return (self.expiration_date - timezone.now().date()).days
    
    def save(self, *args, **kwargs):
        """Auto-set expiration date to 1 year from training"""
        if not self.expiration_date and self.training_date:
            self.expiration_date = self.training_date + timedelta(days=365)
        
        # Generate certificate number
        if not self.certificate_number and self.completed:
            self.certificate_number = f"HIPAA-{self.user.id}-{self.training_date.strftime('%Y%m%d')}"
        
        super().save(*args, **kwargs)


class BusinessAssociate(models.Model):
    """
    Track Business Associates who have access to PHI
    
    HIPAA Requirement: §164.308(b)(1)
    Must have written agreements with all business associates
    """
    name = models.CharField(max_length=200)
    company = models.CharField(max_length=200)
    
    contact_name = models.CharField(max_length=200)
    contact_email = models.EmailField()
    contact_phone = models.CharField(max_length=20)
    
    # Service provided
    service_description = models.TextField(
        help_text="What services does this BA provide?"
    )
    
    phi_access_level = models.CharField(
        max_length=50,
        choices=[
            ('FULL', 'Full PHI Access'),
            ('LIMITED', 'Limited PHI Access'),
            ('TECHNICAL', 'Technical/Infrastructure Only'),
        ]
    )
    
    # Agreement
    baa_signed = models.BooleanField(
        default=False,
        verbose_name='BAA Signed',
        help_text="Business Associate Agreement signed"
    )
    baa_signed_date = models.DateField(
        null=True,
        blank=True,
        verbose_name='BAA Signed Date'
    )
    baa_document = models.FileField(
        upload_to='hipaa/baa/',
        null=True,
        blank=True,
        help_text="Upload signed BAA document"
    )
    
    agreement_expires = models.DateField(
        help_text="When does the BAA expire?"
    )
    
    # Compliance tracking
    last_audit_date = models.DateField(null=True, blank=True)
    next_audit_date = models.DateField(null=True, blank=True)
    compliance_status = models.CharField(
        max_length=20,
        choices=[
            ('COMPLIANT', 'Compliant'),
            ('REVIEW_NEEDED', 'Review Needed'),
            ('NON_COMPLIANT', 'Non-Compliant'),
        ],
        default='COMPLIANT'
    )
    
    # Metadata
    created_date = models.DateField(auto_now_add=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='business_associates_created'
    )
    
    is_active = models.BooleanField(default=True)
    
    class Meta:
        ordering = ['name']
    
    def __str__(self):
        return f"{self.name} - {self.company}"
    
    @property
    def is_baa_expiring_soon(self):
        """Check if BAA expires within 30 days"""
        if not self.agreement_expires:
            return False
        days_until = (self.agreement_expires - timezone.now().date()).days
        return 0 < days_until <= 30
    
    @property
    def is_baa_expired(self):
        """Check if BAA has expired"""
        return self.agreement_expires < timezone.now().date()


class SecurityBreach(models.Model):
    """
    Track potential security breaches involving PHI
    
    HIPAA Requirement: §164.308(a)(6)
    Must identify and respond to security incidents
    """
    BREACH_TYPES = [
        ('UNAUTHORIZED_ACCESS', 'Unauthorized Access to PHI'),
        ('LOST_DEVICE', 'Lost/Stolen Device with PHI'),
        ('EMAIL_MISDIRECT', 'Email Sent to Wrong Recipient'),
        ('HACKING', 'Hacking/IT Incident'),
        ('IMPROPER_DISPOSAL', 'Improper Disposal of PHI'),
        ('EMPLOYEE_SNOOPING', 'Employee Unauthorized Access'),
        ('VENDOR_BREACH', 'Business Associate Breach'),
        ('OTHER', 'Other'),
    ]
    
    SEVERITY_LEVELS = [
        ('LOW', 'Low Risk - No notification required'),
        ('MODERATE', 'Moderate Risk - Individual notification'),
        ('HIGH', 'High Risk - Individual + HHS notification'),
        ('CRITICAL', 'Critical - Individual + HHS + Media notification'),
    ]
    
    # Discovery
    discovered_date = models.DateTimeField(auto_now_add=True)
    discovered_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='breaches_discovered'
    )
    
    # Incident details
    breach_type = models.CharField(max_length=30, choices=BREACH_TYPES)
    severity = models.CharField(max_length=10, choices=SEVERITY_LEVELS)
    
    incident_date = models.DateTimeField(
        help_text="When did the breach occur?"
    )
    description = models.TextField(
        help_text="Detailed description of what happened"
    )
    
    # Affected data
    affected_members = models.ManyToManyField(
        User,
        related_name='phi_breaches',
        blank=True
    )
    number_affected = models.IntegerField(
        default=0,
        help_text="Total number of individuals affected"
    )
    
    phi_types_exposed = models.TextField(
        help_text="What types of PHI were exposed? (medical records, SSN, etc.)"
    )
    
    # Risk assessment
    risk_of_harm = models.TextField(
        help_text="Assessment of potential harm to individuals"
    )
    
    # Notification tracking
    notification_required = models.BooleanField(
        default=True,
        help_text="Is notification to individuals required?"
    )
    
    individuals_notified = models.BooleanField(default=False)
    notification_date = models.DateTimeField(null=True, blank=True)
    notification_method = models.CharField(
        max_length=50,
        blank=True,
        choices=[
            ('MAIL', 'First-class mail'),
            ('EMAIL', 'Email (if permitted)'),
            ('PHONE', 'Telephone'),
            ('SUBSTITUTE', 'Substitute notice (if contact info insufficient)'),
        ]
    )
    
    hhs_notification_required = models.BooleanField(
        default=False,
        help_text="Notify HHS? (Required if 500+ affected)"
    )
    hhs_notified = models.BooleanField(default=False)
    hhs_notification_date = models.DateTimeField(null=True, blank=True)
    
    media_notification_required = models.BooleanField(
        default=False,
        help_text="Media notification? (Required if 500+ in jurisdiction)"
    )
    media_notified = models.BooleanField(default=False)
    media_notification_date = models.DateTimeField(null=True, blank=True)
    
    # Investigation
    investigated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='breaches_investigated'
    )
    investigation_started = models.DateTimeField(null=True, blank=True)
    investigation_complete = models.BooleanField(default=False)
    investigation_completed_date = models.DateTimeField(null=True, blank=True)
    
    root_cause = models.TextField(
        blank=True,
        help_text="What caused this breach?"
    )
    
    corrective_actions = models.TextField(
        blank=True,
        help_text="What steps were taken to prevent future occurrences?"
    )
    
    # Documentation
    incident_report = models.FileField(
        upload_to='hipaa/breaches/',
        null=True,
        blank=True
    )
    
    class Meta:
        ordering = ['-discovered_date']
        verbose_name_plural = 'Security Breaches'
    
    def __str__(self):
        return f"{self.get_breach_type_display()} - {self.discovered_date.date()}"
    
    @property
    def days_since_discovery(self):
        """Days since breach was discovered"""
        return (timezone.now() - self.discovered_date).days
    
    @property
    def notification_deadline(self):
        """60-day deadline for notification"""
        return self.discovered_date + timedelta(days=60)
    
    @property
    def is_notification_overdue(self):
        """Check if past 60-day notification deadline"""
        if not self.notification_required:
            return False
        if self.individuals_notified:
            return False
        return timezone.now() > self.notification_deadline
    
    def save(self, *args, **kwargs):
        """Auto-determine notification requirements"""
        # 500+ affected requires HHS and possibly media notification
        if self.number_affected >= 500:
            self.hhs_notification_required = True
            self.media_notification_required = True  # If in same jurisdiction
        
        super().save(*args, **kwargs)


class EmergencyAccess(models.Model):
    """
    Track emergency "break glass" access to PHI
    
    HIPAA Requirement: §164.312(a)(2)(ii)
    Implement procedures for emergency access
    """
    EMERGENCY_TYPES = [
        ('MEDICAL_EMERGENCY', 'Medical Emergency'),
        ('DISASTER', 'Disaster/Mass Casualty'),
        ('SYSTEM_FAILURE', 'System Failure'),
        ('ADMINISTRATIVE', 'Administrative Emergency'),
        ('OTHER', 'Other'),
    ]
    
    # Access details
    accessed_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='emergency_accesses'
    )
    accessed_at = models.DateTimeField(auto_now_add=True)
    
    # What was accessed
    record_type = models.CharField(max_length=50)
    record_id = models.IntegerField()
    member_affected = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='emergency_access_to_records'
    )
    
    # Justification
    emergency_type = models.CharField(max_length=30, choices=EMERGENCY_TYPES)
    justification = models.TextField(
        help_text="Why was emergency access needed?"
    )
    
    # Approval/Review
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='emergency_access_approvals',
        help_text="Retroactive approval by supervisor"
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='emergency_access_reviews'
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_notes = models.TextField(blank=True)
    
    # Legitimacy
    was_legitimate = models.BooleanField(
        default=True,
        help_text="Was this a legitimate emergency access?"
    )
    
    # Metadata
    ip_address = models.GenericIPAddressField(null=True)
    user_agent = models.CharField(max_length=500, blank=True)
    
    class Meta:
        ordering = ['-accessed_at']
        verbose_name_plural = 'Emergency Accesses'
    
    def __str__(self):
        return f"{self.accessed_by.get_full_name()} - {self.get_emergency_type_display()} ({self.accessed_at})"
    
    @property
    def needs_review(self):
        """Check if access needs supervisory review"""
        return not self.reviewed_by and self.accessed_at < (timezone.now() - timedelta(days=1))
