from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse_lazy
from django.views.generic import TemplateView, View, CreateView, UpdateView
from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib import messages
from django.db.models import Q
from datetime import date, timedelta

from fd_intranet.utils import IsComplianceOfficerMixin
from .models import SafetyStandard, MemberComplianceRecord, SafetyNetConfiguration
from .forms import SafetyStandardForm, MemberComplianceRecordForm, SafetyNetConfigurationForm
from accounts.models import UserProfile, MemberCertification
from scheduling.models import Shift, ShiftSlot, Position
from django.contrib.auth.models import User

# --- 1. COMPLIANCE OFFICER DASHBOARD AND OVERVIEWS ---

class ComplianceDashboardView(IsComplianceOfficerMixin, TemplateView):
    """
    Main landing page for the Compliance Officer.
    Provides an overview of department compliance and access to safety net tools.
    """
    template_name = 'compliance/compliance_dashboard.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # 1. Compliance Status Overview
        # Find all active members
        active_members_count = User.objects.filter(is_active=True, is_staff=False).count()
        
        # Find all mandatory annual standards
        mandatory_standards = SafetyStandard.objects.filter(is_mandatory_annual=True)
        
        # Calculate non-compliant members for all mandatory standards
        non_compliant_users = User.objects.none()
        for standard in mandatory_standards:
            # Users who are active but do NOT have a current, compliant record
            non_compliant_users |= User.objects.filter(
                is_active=True, is_staff=False
            ).exclude(
                membercompliancerecord__standard=standard,
                membercompliancerecord__is_compliant=True,
                membercompliancerecord__date_met__gte=date.today() - timedelta(days=365) # Met within last year
            )
            
        # Get unique non-compliant users
        non_compliant_count = non_compliant_users.distinct().count()

        context['total_active_members'] = active_members_count
        context['non_compliant_count'] = non_compliant_count
        context['compliance_percentage'] = (
            (active_members_count - non_compliant_count) / active_members_count * 100
            if active_members_count > 0 else 0
        )

        # 2. Safety Net Overview
        context['safety_nets'] = SafetyNetConfiguration.objects.filter(is_active=True).order_by('type', 'name')
        
        # 3. Qualification Gaps in Upcoming Shifts
        context['upcoming_gaps'] = self.get_upcoming_gaps()
        
        return context
        
    def get_upcoming_gaps(self):
        """Identifies open slots in upcoming shifts where a qualification gap exists."""
        shifts = Shift.objects.filter(date__gte=date.today()).order_by('date')[:7]
        gap_data = []

        for shift in shifts:
            slots = shift.slots.filter(is_filled=False, position__required_certification__isnull=False)
            if slots.exists():
                gap_data.append({
                    'shift': shift,
                    'slots_with_gap': [
                        slot.position.code for slot in slots
                    ]
                })
        return gap_data

# --- 2. SAFETY STANDARD AND MEMBER RECORD MANAGEMENT ---

class SafetyStandardListView(IsComplianceOfficerMixin, TemplateView):
    """Lists all defined safety standards."""
    template_name = 'compliance/safety_standard_list.html'
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['standards'] = SafetyStandard.objects.all().order_by('name')
        return context

class SafetyStandardCreateUpdateView(IsComplianceOfficerMixin, CreateView, UpdateView):
    """Allows creation and updating of SafetyStandards."""
    model = SafetyStandard
    form_class = SafetyStandardForm
    template_name = 'compliance/safety_standard_form.html'
    success_url = reverse_lazy('compliance:safety_standard_list')

    def form_valid(self, form):
        action = 'updated' if self.object else 'created'
        messages.success(self.request, f"Safety Standard '{form.instance.name}' {action} successfully.")
        return super().form_valid(form)

class MemberRecordCreateView(IsComplianceOfficerMixin, CreateView):
    """Allows creation of a new compliance record for a member."""
    model = MemberComplianceRecord
    form_class = MemberComplianceRecordForm
    template_name = 'compliance/member_record_form.html'
    success_url = reverse_lazy('compliance:compliance_dashboard')

    def form_valid(self, form):
        form.instance.verified_by = self.request.user
        messages.success(self.request, f"Compliance record created for {form.instance.user.username}.")
        return super().form_valid(form)

# --- 3. SAFETY NET CONFIGURATION ---

class SafetyNetListView(IsComplianceOfficerMixin, TemplateView):
    """Lists all active and inactive safety net configurations."""
    template_name = 'compliance/safety_net_list.html'
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['active_nets'] = SafetyNetConfiguration.objects.filter(is_active=True).order_by('type', 'name')
        context['inactive_nets'] = SafetyNetConfiguration.objects.filter(is_active=False).order_by('type', 'name')
        return context

class SafetyNetCreateUpdateView(IsComplianceOfficerMixin, CreateView, UpdateView):
    """Allows creation and updating of SafetyNetConfiguration rules."""
    model = SafetyNetConfiguration
    form_class = SafetyNetConfigurationForm
    template_name = 'compliance/safety_net_form.html'
    success_url = reverse_lazy('compliance:safety_net_list')

    def form_valid(self, form):
        action = 'updated' if self.object else 'created'
        messages.success(self.request, f"Safety Net '{form.instance.name}' {action} successfully.")
        return super().form_valid(form)

# --- 4. CORE COMPLIANCE CHECK FUNCTION (Used by other apps like Scheduling) ---

class RunSafetyCheckView(IsComplianceOfficerMixin, View):
    """
    An administrative endpoint to manually trigger a full department compliance check.
    (In a production system, this would typically run as a scheduled background task.)
    """
    def get(self, request):
        
        # Get all active mandatory standards
        mandatory_standards = SafetyStandard.objects.filter(is_mandatory_annual=True)
        active_members = User.objects.filter(is_active=True, is_staff=False)
        
        non_compliant_count = 0
        
        for user in active_members:
            is_user_compliant = True
            
            for standard in mandatory_standards:
                # Check for a current, compliant record for this standard
                is_compliant = MemberComplianceRecord.objects.filter(
                    user=user,
                    standard=standard,
                    is_compliant=True
