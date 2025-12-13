# compliance/models.py

from django.db import models
from django.contrib.auth.models import Group

class ComplianceStandard(models.Model):
    """Defines mandatory hour requirements linked to a member role."""
    PERIOD_CHOICES = [
        ('ANNUAL', 'Annual'), 
        ('SEMI_ANNUAL', 'Semi-Annual'),
        ('MONTHLY', 'Monthly')
    ]
    ACTIVITY_CHOICES = [
        ('SHIFT_HOURS', 'Shift Hours'), 
        ('TRAINING_HOURS', 'Training Hours'),
        ('ADMIN_HOURS', 'Administrative Hours')
    ]
    
    role = models.ForeignKey(Group, on_delete=models.CASCADE, help_text="The member role this standard applies to.")
    activity_type = models.CharField(max_length=20, choices=ACTIVITY_CHOICES)
    required_quantity = models.DecimalField(max_digits=5, decimal_places=1, help_text="Minimum hours required.")
    time_period = models.CharField(max_length=15, choices=PERIOD_CHOICES)

    class Meta:
        unique_together = ('role', 'activity_type', 'time_period')
        verbose_name = "Compliance Standard"
        
    def __str__(self):
        return f"{self.role.name}: {self.activity_type} ({self.required_quantity} hrs)"

class GroupProfile(models.Model):
    """
    Metadata attached to Django Groups used for the administrative safety net 
    (monitoring temporary roles).
    """
    group = models.OneToOneField(Group, on_delete=models.CASCADE, related_name='compliance_profile')
    is_temporary = models.BooleanField(default=False, help_text="True for roles like 'Probationary' that require eventual exit.")
    max_duration_days = models.IntegerField(default=0, help_text="Max days allowed in this group before an email alert is triggered.")
    warning_email_list = models.TextField(blank=True, help_text="Comma-separated emails for alerts when duration is exceeded.")
    
    def __str__(self):
        return f"Profile for {self.group.name}"
