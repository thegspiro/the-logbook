# accounts/views.py

from datetime import date
from django.shortcuts import render, get_object_or_404, redirect
from django.views.generic import View, UpdateView
from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.urls import reverse_lazy
from django.contrib.auth.models import Group

# Import models from accounts and other apps
from .models import FireDeptUser, PersonnelRecord, PendingChange
from scheduling.models import ShiftAssignment, ShiftSlot # For shift data
from inventory.models import Transaction # For inventory data
from scheduling.utils import get_member_compliance_status # For hours/compliance
from fd_intranet.utils import ( # Role mixins for protection
    is_secretary, is_authorized_role_assignment_officer, 
    SecretaryRequiredMixin, AuthorizedRoleAssignmentOfficerMixin
)

# Placeholder imports for forms (must be created in accounts/forms.py)
# from .forms import MemberProfileForm, CertificationUploadForm, PendingChangeApprovalForm


# --- 1. Member Dashboard View (Aggregates all personalized data) ---

class MemberDashboardView(LoginRequiredMixin, View):
    """The main landing page showing shifts, compliance, and inventory."""
    
    def get(self, request):
        member = request.user
        today = date.today()
        
        # A. SHIFTS: Upcoming Assigned Shifts (from scheduling app)
        upcoming_shifts = ShiftAssignment.objects.filter(
            shift_slot__member=member,
            date__gte=today
        ).order_by('date')
        
        # B. SHIFTS: Available Open Shifts (Needs qualification check logic)
        # In a full implementation, you would filter open slots and run 
        # scheduling.utils.check_member_eligibility() on each one.
        available_slots = ShiftSlot.objects.filter(
            is_filled=False,
            shift_assignment__date__gte=today
        ).select_related('shift_assignment', 'position').order_by('shift_assignment__date')[:5]
        
        # C. COMPLIANCE: Hours and Status
        annual_compliance = get_member_compliance_status(member, period='ANNUAL')
        
        # D. INVENTORY: Assigned Items (from inventory app)
        assigned_inventory = Transaction.objects.filter(
            member=member,
            transaction_type='ASSIGNMENT',
            # Assuming a field 'is_returned=False' is added to Transaction model
            # is_returned=False 
        ).select_related('item').order_by('-transaction_date')
        
        # E. NOTICES: Top Department Notices (from documents app)
        # notices = Document.objects.filter(category='NOTICE').order_by('-upload_date')[:5]

        context = {
            'member': member,
            'upcoming_shifts': upcoming_shifts,
            'available_slots': available_slots,
            'annual_compliance': annual_compliance,
            'assigned_inventory': assigned_inventory,
            # 'notices': notices,
        }
        return render(request, 'accounts/member_dashboard.html', context)
        # 

# --- 2. Member Self-Service Update Views ---

class MemberProfileUpdateView(LoginRequiredMixin, UpdateView):
    """Allows member to initiate changes to their core profile data."""
    model = FireDeptUser
    # form_class = MemberProfileForm # Placeholder
    fields = ['address', 'city', 'state', 'zip_code', 'phone_number', 'email'] # Subset of fields
    template_name = 'accounts/profile_update.html'
    success_url = reverse_lazy('profile_edit')
    
    def get_object(self, queryset=None):
        return self.request.user

    def form_valid(self, form):
        # Instead of saving the user directly, save changes to PendingChange
