from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta


# --- Model 1: GearCategory ---

class GearCategory(models.Model):
    """
    Categorizes gear items (PPE, Tools, Medical, etc.)
    """
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    
    # NFPA tracking
    requires_nfpa_tracking = models.BooleanField(
        default=False,
        help_text="Does this category require NFPA 10-year retirement tracking?"
    )
    
    # Inspection requirements
    requires_inspection = models.BooleanField(default=True)
    inspection_frequency_days = models.IntegerField(
        default=365,
        help_text="How often items in this category must be inspected (in days)"
    )
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return self.name
    
    class Meta:
        ordering = ['name']
        verbose_name_plural = 'Gear Categories'


# --- Model 2: GearItem ---

class GearItem(models.Model):
    """
    Represents a specific piece of gear or equipment
    """
    CONDITION_CHOICES = [
        ('NEW', 'New'),
        ('GOOD', 'Good Condition'),
        ('FAIR', 'Fair - Minor Wear'),
        ('POOR', 'Poor - Needs Replacement'),
        ('OUT_OF_SERVICE', 'Out of Service'),
        ('RETIRED', 'Retired'),
    ]
    
    category = models.ForeignKey(GearCategory, on_delete=models.CASCADE, related_name='items')
    
    # Identification
    item_number = models.CharField(max_length=50, unique=True, help_text="Unique identifier/serial number")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    manufacturer = models.CharField(max_length=100, blank=True)
    model_number = models.CharField(max_length=100, blank=True)
    
    # Size/Fit (for PPE)
    size = models.CharField(max_length=20, blank=True, help_text="Size (S, M, L, XL, etc.)")
    
    # Purchase info
    purchase_date = models.DateField(null=True, blank=True)
    purchase_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    vendor = models.CharField(max_length=200, blank=True)
    
    # NFPA 10-year retirement tracking
    manufacture_date = models.DateField(
        null=True,
        blank=True,
        help_text="Date item was manufactured (for NFPA retirement tracking)"
    )
    retirement_date = models.DateField(
        null=True,
        blank=True,
        help_text="Date item must be retired per NFPA standards"
    )
    
    # Current status
    condition = models.CharField(max_length=20, choices=CONDITION_CHOICES, default='GOOD')
    is_available = models.BooleanField(default=True, help_text="Is this item available for assignment?")
    
    # Location tracking
    current_location = models.CharField(
        max_length=200,
        default="Storage",
        help_text="Where is this item currently located?"
    )
    
    # Assignment
    assigned_to = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_gear',
        help_text="Member this item is currently assigned to"
    )
    
    # Photos
    photo = models.ImageField(upload_to='gear_photos/', null=True, blank=True)
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)
    notes = models.TextField(blank=True)
    
    def __str__(self):
        return f"{self.item_number} - {self.name}"
    
    @property
    def days_until_retirement(self):
        """Calculate days remaining until NFPA retirement"""
        if self.retirement_date:
            delta = self.retirement_date - timezone.now().date()
            return delta.days
        return None
    
    @property
    def is_approaching_retirement(self):
        """Check if item is within 6 months of retirement"""
        if self.retirement_date:
            warning_date = timezone.now().date() + timedelta(days=180)
            return self.retirement_date <= warning_date
        return False
    
    def save(self, *args, **kwargs):
        # Auto-calculate retirement date if manufacture date is set and category requires NFPA tracking
        if self.manufacture_date and self.category.requires_nfpa_tracking and not self.retirement_date:
            self.retirement_date = self.manufacture_date + timedelta(days=3650)  # 10 years
        
        # Auto-set condition to RETIRED if past retirement date
        if self.retirement_date and self.retirement_date < timezone.now().date():
            self.condition = 'RETIRED'
            self.is_available = False
        
        super().save(*args, **kwargs)
    
    class Meta:
        ordering = ['item_number']


# --- Model 3: GearInspection ---

class GearInspection(models.Model):
    """
    Tracks inspections of gear items
    """
    INSPECTION_RESULT = [
        ('PASS', 'Pass - Item is serviceable'),
        ('PASS_WITH_NOTES', 'Pass with Minor Issues'),
        ('FAIL', 'Fail - Item needs repair/replacement'),
    ]
    
    gear_item = models.ForeignKey(GearItem, on_delete=models.CASCADE, related_name='inspections')
    
    # Inspection details
    inspection_date = models.DateField(default=timezone.now)
    inspector = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='gear_inspections_conducted'
    )
    
    result = models.CharField(max_length=20, choices=INSPECTION_RESULT)
    
    # Findings
    findings = models.TextField(
        blank=True,
        help_text="Detailed findings from inspection"
    )
    deficiencies = models.TextField(
        blank=True,
        help_text="Any deficiencies or issues found"
    )
    
    # Actions taken
    action_taken = models.TextField(
        blank=True,
        help_text="What action was taken (repaired, replaced, etc.)"
    )
    
    # Photos
    photo = models.ImageField(
        upload_to='inspection_photos/',
        null=True,
        blank=True,
        help_text="Photo documenting inspection or deficiency"
    )
    
    # Next inspection
    next_inspection_due = models.DateField(
        null=True,
        blank=True,
        help_text="When the next inspection is due"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"{self.gear_item.item_number} - {self.inspection_date} ({self.result})"
    
    def save(self, *args, **kwargs):
        # Auto-calculate next inspection date based on category
        if not self.next_inspection_due and self.gear_item.category.requires_inspection:
            self.next_inspection_due = self.inspection_date + timedelta(
                days=self.gear_item.category.inspection_frequency_days
            )
        
        # Update gear item condition if failed
        if self.result == 'FAIL':
            self.gear_item.condition = 'OUT_OF_SERVICE'
            self.gear_item.is_available = False
            self.gear_item.save()
        
        super().save(*args, **kwargs)
    
    class Meta:
        ordering = ['-inspection_date']


# --- Model 4: GearAssignment ---

class GearAssignment(models.Model):
    """
    Tracks the history of gear assignments to members
    """
    gear_item = models.ForeignKey(GearItem, on_delete=models.CASCADE, related_name='assignment_history')
    assigned_to = models.ForeignKey(User, on_delete=models.CASCADE, related_name='gear_assignment_history')
    
    # Assignment period
    assigned_date = models.DateField(default=timezone.now)
    return_date = models.DateField(null=True, blank=True, help_text="Date gear was returned")
    
    # Condition tracking
    condition_at_issue = models.CharField(
        max_length=20,
        choices=GearItem.CONDITION_CHOICES,
        default='GOOD'
    )
    condition_at_return = models.CharField(
        max_length=20,
        choices=GearItem.CONDITION_CHOICES,
        blank=True,
        help_text="Condition when returned"
    )
    
    # Notes
    assignment_notes = models.TextField(blank=True, help_text="Notes about this assignment")
    return_notes = models.TextField(blank=True, help_text="Notes about the return/condition")
    
    # Tracking
    assigned_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='gear_assignments_issued'
    )
    
    is_active = models.BooleanField(default=True, help_text="Is this the current active assignment?")
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        status = "Active" if self.is_active else f"Returned {self.return_date}"
        return f"{self.gear_item.item_number} → {self.assigned_to.get_full_name()} ({status})"
    
    class Meta:
        ordering = ['-assigned_date']


# --- Model 5: GearRequest ---

class GearRequest(models.Model):
    """
    Allows members to request gear items
    """
    REQUEST_STATUS = [
        ('PENDING', 'Pending Review'),
        ('APPROVED', 'Approved'),
        ('ISSUED', 'Issued'),
        ('DENIED', 'Denied'),
        ('CANCELLED', 'Cancelled'),
    ]
    
    requested_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='gear_requests')
    
    # What they're requesting
    category = models.ForeignKey(GearCategory, on_delete=models.CASCADE)
    item_description = models.TextField(help_text="Describe what you need")
    size_needed = models.CharField(max_length=20, blank=True)
    
    # Priority
    is_urgent = models.BooleanField(default=False, help_text="Is this request urgent?")
    justification = models.TextField(help_text="Why do you need this item?")
    
    # Status
    status = models.CharField(max_length=20, choices=REQUEST_STATUS, default='PENDING')
    
    # Review
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='gear_requests_reviewed'
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_notes = models.TextField(blank=True)
    
    # Fulfillment
    issued_item = models.ForeignKey(
        GearItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='requests_fulfilled',
        help_text="The specific item that was issued"
    )
    issued_at = models.DateTimeField(null=True, blank=True)
    
    # Timestamps
    request_date = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"{self.requested_by.get_full_name()} - {self.category.name} ({self.status})"
    
    class Meta:
        ordering = ['-request_date']


# --- Model 6: InventoryAudit ---

class InventoryAudit(models.Model):
    """
    Records periodic inventory audits
    """
    audit_date = models.DateField(default=timezone.now)
    conducted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='inventory_audits_conducted'
    )
    
    # Scope
    category = models.ForeignKey(
        GearCategory,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        help_text="Leave blank for full inventory audit"
    )
    
    # Results
    items_counted = models.IntegerField(default=0)
    discrepancies_found = models.IntegerField(default=0)
    
    notes = models.TextField(blank=True, help_text="Findings and notes from the audit")
    
    # Completion
    is_complete = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        scope = self.category.name if self.category else "Full Inventory"
        return f"Audit: {scope} - {self.audit_date}"
    
    class Meta:
        ordering = ['-audit_date']
