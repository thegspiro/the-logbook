# accounts/models.py

from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils.translation import gettext_lazy as _

class FireDeptUser(AbstractUser):
    """
    Custom User model replacing Django's default, adding department-specific fields.
    """
    # Personal/Contact Information
    phone_number = models.CharField(max_length=15, blank=True, null=True)
    address = models.CharField(max_length=100, blank=True, null=True)
    city = models.CharField(max_length=50, blank=True, null=True)
    state = models.CharField(max_length=2, blank=True, null=True)
    zip_code = models.CharField(max_length=10, blank=True, null=True)
    
    # Departmental Information
    department_id = models.CharField(max_length=20, unique=True, blank=True, null=True)
    date_joined = models.DateField(_('date joined'), auto_now_add=True)

    def get_full_name(self):
        return f"{self.first_name} {self.last_name}"

    def __str__(self):
        return f"{self.get_full_name()} ({self.username})"

class Certification(models.Model):
    """Tracks required compliance certifications (EMT, CPR, AIC Clearance)."""
    name = models.CharField(max_length=100, unique=True)
    
    def __str__(self):
        return self.name

class PersonnelRecord(models.Model):
    """
    Stores a member's specific compliance documents and status. 
    Requires Secretary verification.
    """
    member = models.ForeignKey(FireDeptUser, on_delete=models.CASCADE, related_name='compliance_records')
    certification = models.ForeignKey(Certification, on_delete=models.CASCADE)
    attachment_file = models.FileField(upload_to='compliance_docs/', help_text="Upload scanned card/certificate.")
    document_expiration = models.DateField()
    
    is_verified = models.BooleanField(default=False) # CRITICAL: Secretary approval required
    submitted_by = models.ForeignKey(FireDeptUser, on_delete=models.SET_NULL, null=True, related_name='submitted_records')
    submission_date = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('member', 'certification', 'document_expiration')
        verbose_name = "Verified Certification Document"

class PendingChange(models.Model):
    """Holds member-submitted profile changes awaiting Secretary verification."""
    STATUS_CHOICES = [
        ('PENDING', 'Pending Review'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
    ]
    member = models.ForeignKey(FireDeptUser, on_delete=models.CASCADE, related_name='pending_changes')
    field_name = models.CharField(max_length=50) # e.g., 'address', 'phone_number'
    old_value = models.TextField()
    new_value = models.TextField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='PENDING')
    submitted_date = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"Change for {self.member.username}: {self.field_name}"
