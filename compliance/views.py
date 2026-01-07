"""
Compliance Module Views
Handles medical physicals, fit tests, immunizations, and OSHA logs
"""
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.mixins import LoginRequiredMixin, UserPassesTestMixin
from django.views.generic import ListView, DetailView, CreateView, UpdateView
from django.contrib import messages
from django.urls import reverse_lazy
from django.db.models import Q, Count
from django.utils import timezone
from datetime import timedelta
from .models import MedicalPhysical, FitTest, Immunization, OSHALog, ExposureIncident
from .alerts import ComplianceAlertService
from .hipaa_models import HIPAATraining, BusinessAssociate, SecurityBreach


class IsComplianceOfficerMixin(UserPassesTestMixin):
    """Mixin to restrict access to Compliance Officers"""
    def test_func(self):
        return self.request.user.groups.filter(
            name__in=['Compliance Officers', 'Chief Officers']
        ).exists()


# Member-Facing Views

class MemberComplianceDashboard(LoginRequiredMixin, ListView):
    """Dashboard showing member's compliance status"""
    template_name = 'compliance/member_dashboard.html'
    context_object_name = 'physicals'
    
    def get_queryset(self):
        return MedicalPhysical.objects.filter(
            member=self.request.user
        ).order_by('-exam_date')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Get most recent records
        context['current_physical'] = MedicalPhysical.objects.filter(
            member=self.request.user,
            result='CLEARED'
        ).order_by('-exam_date').first()
        
        context['current_fit_test'] = FitTest.objects.filter(
            member=self.request.user
        ).order_by('-test_date').first()
        
        context['immunizations'] = Immunization.objects.filter(
            member=self.request.user
        ).order_by('vaccine_type', '-administration_date')
        
        # Check what's expiring soon
        thirty_days = timezone.now().date() + timedelta(days=30)
        
        context['expiring_soon'] = []
        
        if context['current_physical'] and context['current_physical'].next_exam_due:
            if context['current_physical'].next_exam_due <= thirty_days:
                context['expiring_soon'].append({
                    'type': 'Physical',
                    'date': context['current_physical'].next_exam_due
                })
        
        if context['current_fit_test'] and context['current_fit_test'].is_expired:
            context['expiring_soon'].append({
                'type': 'Fit Test',
                'date': context['current_fit_test'].expiration_date
            })
        
        return context


# Compliance Officer Views

class ComplianceOfficerDashboard(IsComplianceOfficerMixin, ListView):
    """Dashboard for Compliance Officers"""
    template_name = 'compliance/officer_dashboard.html'
    context_object_name = 'members'
    
    def get_queryset(self):
        from django.contrib.auth.models import User
        return User.objects.filter(is_active=True).order_by('last_name', 'first_name')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Get compliance summary
        summary = ComplianceAlertService.get_department_compliance_summary()
        context['summary'] = summary
        
        # Get items needing attention
        thirty_days = timezone.now().date() + timedelta(days=30)
        
        context['physicals_overdue'] = MedicalPhysical.objects.filter(
            next_exam_due__lt=timezone.now().date()
        ).select_related('member').count()
        
        context['physicals_expiring'] = MedicalPhysical.objects.filter(
            next_exam_due__gte=timezone.now().date(),
            next_exam_due__lte=thirty_days
        ).select_related('member').count()
        
        context['fit_tests_expired'] = FitTest.objects.filter(
            expiration_date__lt=timezone.now().date()
        ).select_related('member').count()
        
        # Recent exposure incidents
        context['recent_exposures'] = ExposureIncident.objects.all().order_by('-incident_date')[:10]
        
        return context


class MemberComplianceDetail(IsComplianceOfficerMixin, DetailView):
    """Detailed compliance view for a specific member"""
    template_name = 'compliance/member_compliance_detail.html'
    context_object_name = 'member'
    
    def get_object(self):
        from django.contrib.auth.models import User
        return get_object_or_404(User, pk=self.kwargs['pk'])
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        member = self.object
        
        context['physicals'] = MedicalPhysical.objects.filter(
            member=member
        ).order_by('-exam_date')
        
        context['fit_tests'] = FitTest.objects.filter(
            member=member
        ).order_by('-test_date')
        
        context['immunizations'] = Immunization.objects.filter(
            member=member
        ).order_by('vaccine_type', '-administration_date')
        
        context['exposures'] = ExposureIncident.objects.filter(
            exposed_member=member
        ).order_by('-incident_date')
        
        return context


class AddMedicalPhysical(IsComplianceOfficerMixin, CreateView):
    """Add medical physical record"""
    model = MedicalPhysical
    template_name = 'compliance/add_physical.html'
    fields = [
        'member', 'exam_type', 'exam_date', 'provider_name',
        'result', 'restrictions', 'notes'
    ]
    success_url = reverse_lazy('compliance:officer_dashboard')
    
    def get_form(self):
        form = super().get_form()
        # Add Bootstrap classes
        for field in form.fields:
            form.fields[field].widget.attrs['class'] = 'form-control'
        return form
    
    def form_valid(self, form):
        response = super().form_valid(form)
        
        messages.success(
            self.request,
            f'Medical physical recorded for {form.instance.member.get_full_name()}'
        )
        
        return response


class AddFitTest(IsComplianceOfficerMixin, CreateView):
    """Add fit test record"""
    model = FitTest
    template_name = 'compliance/add_fit_test.html'
    fields = [
        'member', 'test_date', 'test_type', 'mask_manufacturer',
        'mask_model', 'mask_size', 'fit_factor', 'passed'
    ]
    success_url = reverse_lazy('compliance:officer_dashboard')
    
    def get_form(self):
        form = super().get_form()
        for field in form.fields:
            form.fields[field].widget.attrs['class'] = 'form-control'
        return form


class AddImmunization(IsComplianceOfficerMixin, CreateView):
    """Add immunization record"""
    model = Immunization
    template_name = 'compliance/add_immunization.html'
    fields = [
        'member', 'vaccine_type', 'administration_date',
        'dose_number', 'total_doses', 'lot_number',
        'administered_by', 'clinic_name', 'expiration_date'
    ]
    success_url = reverse_lazy('compliance:officer_dashboard')
    
    def get_form(self):
        form = super().get_form()
        for field in form.fields:
            form.fields[field].widget.attrs['class'] = 'form-control'
        return form


class OSHALogList(IsComplianceOfficerMixin, ListView):
    """List OSHA 300 logs"""
    model = OSHALog
    template_name = 'compliance/osha_logs.html'
    context_object_name = 'logs'
    paginate_by = 50
    
    def get_queryset(self):
        queryset = OSHALog.objects.select_related('employee')
        
        # Filter by year
        year = self.request.GET.get('year')
        if year:
            queryset = queryset.filter(incident_date__year=year)
        
        # Filter by recordable
        recordable = self.request.GET.get('recordable')
        if recordable == 'yes':
            queryset = queryset.filter(is_recordable=True)
        
        return queryset.order_by('-incident_date')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Get available years
        context['years'] = OSHALog.objects.dates('incident_date', 'year', order='DESC')
        
        return context


class AddOSHALog(IsComplianceOfficerMixin, CreateView):
    """Add OSHA log entry"""
    model = OSHALog
    template_name = 'compliance/add_osha_log.html'
    fields = [
        'employee', 'incident_date', 'incident_time', 'incident_type',
        'incident_description', 'injury_illness_description', 'body_part_affected',
        'severity', 'days_away_from_work', 'days_on_restricted_duty',
        'is_recordable', 'is_privacy_case', 'treatment_provided'
    ]
    success_url = reverse_lazy('compliance:osha_logs')
    
    def get_form(self):
        form = super().get_form()
        for field in form.fields:
            if field != 'is_recordable' and field != 'is_privacy_case':
                form.fields[field].widget.attrs['class'] = 'form-control'
        return form


class AddExposureIncident(IsComplianceOfficerMixin, CreateView):
    """Record exposure incident"""
    model = ExposureIncident
    template_name = 'compliance/add_exposure.html'
    fields = [
        'exposed_member', 'incident_date', 'incident_time', 'exposure_type',
        'route_of_exposure', 'source_individual_known', 'source_details',
        'decontamination_performed', 'decontamination_details',
        'baseline_testing_completed', 'prophylaxis_offered',
        'follow_up_required', 'follow_up_schedule'
    ]
    success_url = reverse_lazy('compliance:officer_dashboard')
    
    def get_form(self):
        form = super().get_form()
        for field in form.fields:
            if not isinstance(form.fields[field].widget, forms.CheckboxInput):
                form.fields[field].widget.attrs['class'] = 'form-control'
        return form
    
    def form_valid(self, form):
        # Auto-create OSHA log entry if applicable
        exposure = form.save()
        
        # Bloodborne pathogen exposures are recordable
        if exposure.exposure_type == 'BLOODBORNE':
            OSHALog.objects.create(
                employee=exposure.exposed_member,
                incident_date=exposure.incident_date,
                incident_time=exposure.incident_time,
                incident_type='EXPOSURE',
                incident_description=f"Bloodborne pathogen exposure: {exposure.get_route_of_exposure_display()}",
                injury_illness_description=exposure.source_details or 'Exposure incident',
                severity='MEDICAL_TREATMENT',
                is_recordable=True,
                exposure_incident=exposure
            )
        
        messages.success(
            self.request,
            f'Exposure incident recorded for {exposure.exposed_member.get_full_name()}'
        )
        
        return redirect(self.success_url)


class ComplianceReports(IsComplianceOfficerMixin, ListView):
    """Generate compliance reports"""
    template_name = 'compliance/reports.html'
    context_object_name = 'members'
    
    def get_queryset(self):
        from django.contrib.auth.models import User
        return User.objects.filter(is_active=True)
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Department summary
        context['summary'] = ComplianceAlertService.get_department_compliance_summary()
        
        # Physical exams by status
        context['physicals_current'] = MedicalPhysical.objects.filter(
            result='CLEARED',
            next_exam_due__gte=timezone.now().date()
        ).count()
        
        context['physicals_expiring_soon'] = MedicalPhysical.objects.filter(
            next_exam_due__gte=timezone.now().date(),
            next_exam_due__lte=timezone.now().date() + timedelta(days=30)
        ).count()
        
        context['physicals_overdue'] = MedicalPhysical.objects.filter(
            next_exam_due__lt=timezone.now().date()
        ).count()
        
        # Fit tests
        context['fit_tests_current'] = FitTest.objects.filter(
            expiration_date__gte=timezone.now().date()
        ).count()
        
        context['fit_tests_expired'] = FitTest.objects.filter(
            expiration_date__lt=timezone.now().date()
        ).count()
        
        # OSHA stats (current year)
        current_year = timezone.now().year
        context['osha_incidents_ytd'] = OSHALog.objects.filter(
            incident_date__year=current_year
        ).count()
        
        context['osha_recordable_ytd'] = OSHALog.objects.filter(
            incident_date__year=current_year,
            is_recordable=True
        ).count()
        
        return context
