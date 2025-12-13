from django.contrib.auth.mixins import UserPassesTestMixin
from django.shortcuts import redirect
from django.urls import reverse_lazy

# --- Custom Group-Based Permission Mixins ---

class IsSecretaryMixin(UserPassesTestMixin):
    """
    Mixin to check if the user belongs to the 'Secretary' group.
    Used to gate access to member verification queues and core user management.
    """
    def test_func(self):
        # The 'Secretary' group is created via the load_initial_data management command
        return self.request.user.groups.filter(name='Secretary').exists()

    def handle_no_permission(self):
        # Redirect unauthorized users to the dashboard
        return redirect(reverse_lazy('member_dashboard'))

class IsComplianceOfficerMixin(UserPassesTestMixin):
    """
    Mixin to check if the user belongs to the 'Compliance Officer' group.
    Used to gate access to the Compliance Dashboard and monitoring tools.
    """
    def test_func(self):
        return self.request.user.groups.filter(name='Compliance Officer').exists()

    def handle_no_permission(self):
        return redirect(reverse_lazy('member_dashboard'))

class IsQuartermasterMixin(UserPassesTestMixin):
    """
    Mixin to check if the user belongs to the 'Quartermaster' group.
    Used to gate access to the Inventory Management Dashboard.
    """
    def test_func(self):
        return self.request.user.groups.filter(name='Quartermaster').exists()

    def handle_no_permission(self):
        return redirect(reverse_lazy('member_dashboard'))

class IsSchedulerMixin(UserPassesTestMixin):
    """
    Mixin to check if the user belongs to the 'Scheduler' group.
    Used to gate access to the Shift Template and Mass Generation tools.
    """
    def test_func(self):
        return self.request.user.groups.filter(name='Scheduler').exists()

    def handle_no_permission(self):
        return redirect(reverse_lazy('member_dashboard'))

# General Staff Mixin (Superusers and Admins are always staff)
class IsStaffOrAdminMixin(UserPassesTestMixin):
    """
    Mixin to check if the user is a staff member or superuser.
    This is often used for generic admin-level access.
    """
    def test_func(self):
        return self.request.user.is_staff
    
    def handle_no_permission(self):
        return redirect(reverse_lazy('member_dashboard'))
