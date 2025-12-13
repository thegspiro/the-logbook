from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.core.exceptions import ValidationError

# --- Choices for Verification Status ---
VERIFICATION_STATUS_CHOICES = [
    ('PENDING', 'Pending Review'),
    ('APPROVED', 'Approved'),
    ('REJECTED', 'Rejected'),
]

# --- Model 1: UserProfile (Extending the built-in User) ---

class UserProfile(models.Model):
    """
    Extends the default Django User model with FD-specific information 
    that requires verification by a Secretary.
    """
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    
    # Core Member Details
    badge_number = models.CharField(max_length=10, blank=True, null=True, unique=True)
    phone_number = models.CharField(max_length=15, blank=True, null=True)
    date_of_birth = models.DateField(blank=True, null=True)
    
    # Internal Status
    is_active_member = models.BooleanField(default=True)
    
    # Metadata
    last_profile_update = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile for {self.user.username}"

# Signal: Automatically create a UserProfile when a new User is created
@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)

@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    instance.userprofile.save()


# --- Model 2: CertificationStandard ---

class CertificationStandard(models.Model):
    """
    Defines the official standards for certifications (e.g., 'EMT-B License').
    These are populated by the load_initial_data command.
    """
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    # True if the certification has an expiration date requirement (e.g., CPR)
    requires_expiration = models.BooleanField(default=True) 

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['name']


# --- Model 3: MemberCertification (User-submitted documents) ---

class MemberCertification(models.Model):
    """
    Represents a certification held by a member. This is the user's data.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    standard = models.ForeignKey(CertificationStandard, on_delete=models.CASCADE)
    
    # User-submitted data fields
    issue_date = models.DateField()
    expiration_date = models.DateField(blank=True, null=True)
    
    # Document storage (The file uploaded by the member)
    document = models.FileField(upload_to='cert_documents/') 
    
    # Verification Fields
    verification_status = models.CharField(max_length=10, choices=VERIFICATION_STATUS_CHOICES, default='PENDING')
    submission_date = models.DateTimeField(auto_now_add=True)
    verified_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='verified_certs')

    def __str__(self):
        return f"{self.user.username}'s {self.standard.name} ({self.verification_status})"

    class Meta:
        # Prevents a user from having two active 'APPROVED
