from django.contrib.auth.mixins import AccessMixin
from django.contrib.auth.models import Group
from django.shortcuts import redirect
from django.urls import reverse_lazy
from django.contrib import messages
import logging

logger = logging.getLogger(__name__)

# --- Core Utility Functions ---

def is_in_group(user, group_name):
    """
    Utility function to check if a user belongs to a specific Django Group.
    """
    if user.is_authenticated:
        # Check if user is a superuser (admin) - they bypass all group checks
        if user.is_superuser:
            return True
        
        # Check by group name
        return user.groups.filter(name=group_name).exists()
    return False

# --- Custom Permission Mixins (Role-Based Access Control) ---

class GroupRequiredMixin(AccessMixin):
    """
    Mixin that checks if the user is in one of the specified groups.
    If the user is logged in but not authorized, they are redirected to the dashboard.
    """
    group_required = None
    
    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            # Not logged in, redirect to login page
            return self.handle_no_permission()
        
        # Check for superuser bypass
        if request.user.is_superuser:
            return super().dispatch(request, *args, **kwargs)

        if self.group_required is None:
            raise AttributeError(f"{self.__class__.__name__} is missing the 'group_required' attribute.")

        user_groups = [g.name for g in request.user.groups.all()]
        
        # Accept if ANY of the user's groups match the required group(s)
        if isinstance(self.group_required, str):
            groups_list = [self.group_required]
        else:
            groups_list = self.group_required
            
        if any(group in user_groups for group in groups_list):
            return super().dispatch(request, *args, **kwargs)
        
        # User is logged in but not authorized (handle unauthorized access)
        messages.error(request, "Access Denied: You do not have the required role for this page.")
        
        # Redirect all unauthorized members back to the main member dashboard
        return redirect(reverse_lazy('accounts:member_dashboard'))


# --- Specific Role Mixins (Based on the Groups defined in load_initial_data.py) ---

class IsSecretaryMixin(GroupRequiredMixin):
    """Requires the user to be in the 'Secretary' group."""
    group_required = 'Secretary'

class IsComplianceOfficerMixin(GroupRequiredMixin):
    """Requires the user to be in the 'Compliance Officer' group."""
    group_required = 'Compliance Officer'

class IsQuartermasterMixin(GroupRequiredMixin):
    """Requires the user to be in the 'Quartermaster' group."""
    group_required = 'Quartermaster'

class IsSchedulerMixin(GroupRequiredMixin):
    """Requires the user to be in the 'Scheduler' group."""
    group_required = 'Scheduler'
    
class IsStaffOrAdminMixin(GroupRequiredMixin):
    """Requires the user to be in the 'Secretary', 'Compliance Officer', 'Quartermaster', or 'Scheduler' groups, or be a superuser."""
    group_required = ['Secretary', 'Compliance Officer', 'Quartermaster', 'Scheduler']
