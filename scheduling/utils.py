from datetime import date
from django.contrib.auth.models import User
from accounts.models import MemberCertification
from .models import ShiftSlot

# --- Core Shift Logic Functions ---

def check_qualification(user: User, required_cert_name: str) -> bool:
    """
    Checks if a given user holds a currently APPROVED and NON-EXPIRED certification
    that matches the required_cert_name for a position.
    
    Args:
        user: The User object attempting to sign up.
        required_cert_name: The name of the CertificationStandard required.
        
    Returns:
        True if the user is qualified, False otherwise.
    """
    if not required_cert_name:
        # No certification required for this position
        return True

    try:
        # Find the user's APPROVED certification matching the required standard
        # Note: We rely on the accounts app logic to ensure only one APPROVED cert exists per standard.
        approved_cert = MemberCertification.objects.get(
            user=user,
            standard__name=required_cert_name,
            verification_status='APPROVED'
        )
        
        # Check for expiration
        if approved_cert.expiration_date:
            # If the expiration date is today or in the future, they are qualified.
            if approved_cert.expiration_date >= date.today():
                return True
            else:
                # Certification is expired
                return False
        
        # If no expiration date is required/set, they are qualified (since it's approved)
        return True

    except MemberCertification.DoesNotExist:
        # User does not have an APPROVED certification for the required standard
        return False


def check_shift_overlap(user: User, shift_slot: ShiftSlot) -> bool:
    """
    Checks if a user is already signed up for any other slot within the same Shift instance.
    Prevents a user from signing up for both Captain and Driver on the same 12-hour shift.
    
    Args:
        user: The User object attempting to sign up.
        shift_slot: The specific ShiftSlot the user is attempting to fill.
        
    Returns:
        True if an overlap exists (i.e., they are already on the shift), False otherwise.
    """
    # Check for any existing ShiftSlot filled by the user on the same parent Shift
    overlap_exists = ShiftSlot.objects.filter(
        shift=shift_slot.shift,  # Same Shift instance
        filled_by=user           # Filled by the current user
    ).exists()
    
    return overlap_exists
