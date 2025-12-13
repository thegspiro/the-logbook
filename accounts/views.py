from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse_lazy
from django.views.generic import TemplateView, UpdateView, CreateView, View
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import HttpResponse
from django.contrib import messages
from django.db import transaction

from fd_intranet.utils import IsSecretaryMixin, IsStaffOrAdminMixin
from .models import UserProfile, MemberCertification, CertificationStandard, DataChangeRequest
from .forms import ProfileEditForm, CertificationUploadForm
from django.contrib.auth.models import User

# --- 1. MEMBER-FACING VIEWS ---

class MemberDashboardView(LoginRequiredMixin, TemplateView):
    """
    The main landing page for all logged-in members.
    Displays core profile info and lists pending certifications.
    """
    template_name = 'accounts/member_dashboard.html'
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        user = self.request.user
        
        # Display the member's approved certifications
        context['approved_certs'] = MemberCertification.objects.filter(
            user=user, verification_status='APPROVED'
        ).select_related('standard').order_by('-expiration_date')
        
        # Display certifications pending review
        context['pending_certs'] = MemberCertification.objects.filter(
            user=user, verification_status='PENDING'
        ).select_related('standard').order_by('-submission_date')
        
        # Display pending data changes
        context['pending_data_changes'] = DataChangeRequest.objects.filter(
            user=user, status='PENDING'
        ).order_by('-submitted_on')

        return context

class ProfileEditView(LoginRequiredMixin, UpdateView):
    """
    Allows a member to update their core profile fields.
    Changes are submitted as a DataChangeRequest for Secretary review.
    """
    model = UserProfile
    form_class = ProfileEditForm
    template_name = 'accounts/profile_edit.html'
    success_url = reverse_lazy('accounts:member_dashboard')

    def get_object(self):
        # Ensure only the logged-in user can edit their own profile
        return self.request.user.userprofile
    
    def form_valid(self, form):
        # We process the form data by creating a DataChangeRequest, not saving directly.
        
        # 1. Identify which fields changed
        changed_fields = form.changed_data
        user = self.request.user
        
        if not changed_fields:
            messages.info(self.request, "No changes detected.")
            return redirect(self.success_url)
            
        # 2. Create a DataChangeRequest for each changed field
        for field_name in changed_fields:
            new_value = form.cleaned_data.get(field_name)
            
            # Check for existing PENDING requests for this field
            existing_request = DataChangeRequest.objects.filter(
                user=user, field_name=field_name, status='PENDING'
            ).exists()
            
            if existing_request:
                messages.warning(self.request, f"Your request to change '{field_name}' is already pending review.")
                continue

            # Create the new request
            DataChangeRequest.objects.create(
                user=user,
                field_name=field_name,
                new_value=str(new_value) if new_value is not None else ''
            )
        
        messages.success(self.request, "Your profile updates have been submitted for Secretary review.")
        return redirect(self.success_url)

class CertificationUploadView(LoginRequiredMixin, CreateView):
    """
    Allows a member to upload a new certification document.
    The uploaded document enters the verification queue.
    """
    model = MemberCertification
    form_class = CertificationUploadForm
    template_name = 'accounts/certification_upload.html'
    success_url = reverse_lazy('accounts:member_dashboard')

    def form_valid(self, form):
        form.instance.user
