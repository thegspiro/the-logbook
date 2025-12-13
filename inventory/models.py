# inventory/models.py

from django.db import models
from accounts.models import FireDeptUser # Import external model

class InventoryItem(models.Model):
    """Base item definition (e.g., 'Fire Helmet', 'Class A Uniform')."""
    name = models.CharField(max_length=100, unique=True)
    serial_tracked = models.BooleanField(default=True, help_text="If True, each item instance requires a unique serial number.")
    is_ppe = models.BooleanField(default=True, help_text="Checked if this item is Personal Protective Equipment.")
    life_expectancy_years = models.IntegerField(default=5, help_text="Expected lifespan for budgeting/replacement.")
    
    def __str__(self):
        return self.name

class StockLevel(models.Model):
    """Tracks the current quantity of an item at a specific location/status."""
    item = models.ForeignKey(InventoryItem, on_delete=models.CASCADE)
    location = models.CharField(max_length=100, default='Main Station Stock')
    current_quantity = models.IntegerField(default=0)
    
    def __str__(self):
        return f"{self.item.name} Stock at {self.location}"

class Transaction(models.Model):
    """Records every movement or status change of inventory items (Assignment, Return, Sale, Retirement)."""
    TRANSACTION_TYPES = [
        ('ASSIGNMENT', 'Assigned to Member'),
        ('RETURN', 'Returned to Stock'),
        ('SALE', 'Internal Sale'),
        ('RETIREMENT', 'Retired/Disposed')
    ]
    item = models.ForeignKey(InventoryItem, on_delete=models.PROTECT)
    member = models.ForeignKey(FireDeptUser, on_delete=models.SET_NULL, null=True, blank=True, help_text="The member involved in the transaction (assigned to/returned by).")
    
    transaction_type = models.CharField(max_length=15, choices=TRANSACTION_TYPES)
    quantity = models.IntegerField(default=1)
    
    # Tracking for serialized items
    serial_number = models.CharField(max_length=50, blank=True, null=True)
    
    transaction_date = models.DateTimeField(auto_now_add=True)
    recorded_by = models.ForeignKey(FireDeptUser, on_delete=models.PROTECT, related_name='recorded_transactions')

    def __str__(self):
        return f"{self.transaction_type} of {self.quantity} x {self.item.name}"
