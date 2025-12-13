# scheduling/models.py

from datetime import timedelta
from django.db import models
from django.contrib.auth.models import Group
from accounts.models import FireDeptUser, Certification # Import external models

class ShiftType(models.Model):
    """Categorizes shifts (Operational Coverage, Mandatory Training, etc.)."""
    name = models.CharField(max_length=50, unique=True)
    is_coverage_shift = models.BooleanField(default=True, help_text="Checked if this shift counts toward mandatory operational hours.")

    def __str__(self):
        return self.name

class ShiftTemplate(models.Model):
    """A reusable pattern for a shift (e.g., 'Day Shift A')."""
    name = models.CharField(max_length=50, unique=True)
    standard_start_time = models.TimeField()
    required_staff = models.IntegerField(default=1, help_text="Minimum total members needed for this shift.")
    shift_type = models.ForeignKey(ShiftType, on_delete=models.PROTECT)

    def __str__(self):
        return f"{self.name} ({self.standard_start_time.strftime('%H:%M')})"

class ShiftPosition(models.Model):
    """Defines operational roles within a shift (Driver, AIC, EMS Third) and their requirements."""
    name = models.CharField(max_length=50, unique=True)
    required_roles = models.ManyToManyField(Group, blank=True, help_text="Required Django Groups/Roles for this position.")
    required_certifications = models.ManyToManyField(Certification, blank=True, help_text="Required active certifications for this position.")

    def __str__(self):
        return self.name

class ShiftAssignment(models.Model):
    """An instance of a shift template on a specific date (the actual shift event)."""
    shift_template = models.ForeignKey(ShiftTemplate, on_delete=models.PROTECT)
    date = models.DateField()
    start_datetime = models.DateTimeField()
    end_datetime = models.DateTimeField()
    
    class Meta:
        unique_together = ('shift_template', 'date')
        ordering = ['date', 'start_datetime']
        verbose_name = "Shift Assignment"
    
    def __str__(self):
        return f"{self.shift_template.name} on {self.date}"

class ShiftSlot(models.Model):
    """An individual position to be filled on a specific ShiftAssignment."""
    shift_assignment = models.ForeignKey(ShiftAssignment, on_delete=models.CASCADE, related_name='shift_slots')
    position = models.ForeignKey(ShiftPosition, on_delete=models.PROTECT)
    member = models.ForeignKey(FireDeptUser, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_slots')
    
    is_filled = models.BooleanField(default=False)
    # Allows a scheduler to override and assign someone manually
    manually_assigned_by = models.ForeignKey(FireDeptUser, on_delete=models.SET_NULL, null=True, blank=True, related_name='manual_assignments')
    
    class Meta:
        verbose_name = "Shift Slot Position"
    
    def __str__(self):
        return f"{self.position.name} - {self.shift_assignment}"
