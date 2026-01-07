"""
Training Module Views
Handles training requirements, records, evaluations, and sessions
"""
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.mixins import LoginRequiredMixin, UserPassesTestMixin
from django.views.generic import ListView, DetailView, CreateView, UpdateView
from django.contrib import messages
from django.urls import reverse_lazy
from django.db.models import Q, Count, Avg
from django.utils import timezone
from datetime import timedelta
from .models import (
    TrainingRequirement, TrainingRecord, PracticalEvaluation,
    TrainingSession, TrainingAttendance
)
from .forms import (
    TrainingRecordForm, PracticalEvaluationForm,
    TrainingSessionForm, SignOffForm
)
from training.services import TrainingComplianceChecker


class IsTrainingOfficerMixin(UserPassesTestMixin):
    """Mixin to restrict access to Training Officers"""
    def test_func(self):
        return self.request.user.groups.filter(
            name__in=['Training Officers', 'Chief Officers']
        ).exists()


# Member-Facing Views

class MemberTrainingDashboard(LoginRequiredMixin, ListView):
    """Dashboard showing member's training status"""
    template_name = 'training/member_dashboard.html'
    context_object_name = 'records'
    
    def get_queryset(self):
        return TrainingRecord.objects.filter(
            member=self.request.user
        ).select_related('requirement', 'instructor', 'verified_by')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Get compliance status
        compliance = TrainingComplianceChecker.check_member_compliance(
            self.request.user
        )
        
        context.update({
            'compliance': compliance,
            'required_training': TrainingRequirement.objects.filter(
                requirement_type='INITIAL'
            ),
            'upcoming_sessions': TrainingSession.objects.filter(
                session_date__gte=timezone.now().date(),
                is_cancelled=False
            ).order_by('session_date')[:5],
        })
        
        return context


class TrainingRequirementList(LoginRequiredMixin, ListView):
    """List all training requirements"""
    model = TrainingRequirement
    template_name = 'training/requirement_list.html'
    context_object_name = 'requirements'
    
    def get_queryset(self):
        queryset = TrainingRequirement.objects.all()
        
        # Filter by type if provided
        req_type = self.request.GET.get('type')
        if req_type:
            queryset = queryset.filter(requirement_type=req_type)
        
        return queryset.order_by('requirement_type', 'name')


class TrainingRequirementDetail(LoginRequiredMixin, DetailView):
    """Detail view of a training requirement"""
    model = TrainingRequirement
    template_name = 'training/requirement_detail.html'
    context_object_name = 'requirement'
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Check if user has completed this requirement
        context['user_record'] = TrainingRecord.objects.filter(
            member=self.request.user,
            requirement=self.object,
            verification_status='APPROVED'
        ).first()
        
        return context


class MyTrainingRecords(LoginRequiredMixin, ListView):
    """List of user's training records"""
    template_name = 'training/my_records.html'
    context_object_name = 'records'
    
    def get_queryset(self):
        return TrainingRecord.objects.filter(
            member=self.request.user
        ).select_related(
            'requirement', 'instructor', 'verified_by'
        ).order_by('-completion_date')


class TrainingRecordDetail(LoginRequiredMixin, DetailView):
    """Detail view of a training record"""
    model = TrainingRecord
    template_name = 'training/record_detail.html'
    context_object_name = 'record'
    
    def get_queryset(self):
        # Members can only view their own records
        # Training Officers can view all
        if self.request.user.groups.filter(
            name__in=['Training Officers', 'Chief Officers']
        ).exists():
            return TrainingRecord.objects.all()
        
        return TrainingRecord.objects.filter(member=self.request.user)


class UploadTrainingRecord(LoginRequiredMixin, CreateView):
    """Upload a training completion certificate"""
    model = TrainingRecord
    form_class = TrainingRecordForm
    template_name = 'training/upload_record.html'
    success_url = reverse_lazy('training:my_records')
    
    def form_valid(self, form):
        form.instance.member = self.request.user
        form.instance.verification_status = 'PENDING'
        
        response = super().form_valid(form)
        
        messages.success(
            self.request,
            'Training record uploaded successfully. Awaiting verification by Training Officer.'
        )
        
        # Notify training officers
        self._notify_training_officers()
        
        return response
    
    def _notify_training_officers(self):
        """Send notification to training officers"""
        from core.notifications import notify_training_required
        from django.contrib.auth.models import User
        
        officers = User.objects.filter(
            groups__name='Training Officers',
            is_active=True
        )
        
        for officer in officers:
            # Send notification (implementation depends on notification system)
            pass


class TrainingSessionList(LoginRequiredMixin, ListView):
    """List upcoming training sessions"""
    model = TrainingSession
    template_name = 'training/session_list.html'
    context_object_name = 'sessions'
    
    def get_queryset(self):
        return TrainingSession.objects.filter(
            session_date__gte=timezone.now().date(),
            is_cancelled=False
        ).order_by('session_date', 'start_time')


class TrainingSessionDetail(LoginRequiredMixin, DetailView):
    """Detail view of a training session"""
    model = TrainingSession
    template_name = 'training/session_detail.html'
    context_object_name = 'session'
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Check if user is registered
        context['is_registered'] = self.object.attendees.filter(
            id=self.request.user.id
        ).exists()
        
        # Check if session is full
        context['is_full'] = (
            self.object.max_participants and
            self.object.attendees.count() >= self.object.max_participants
        )
        
        return context


class TrainingSessionRegister(LoginRequiredMixin, DetailView):
    """Register for a training session"""
    model = TrainingSession
    
    def post(self, request, *args, **kwargs):
        session = self.get_object()
        
        # Check if already registered
        if session.attendees.filter(id=request.user.id).exists():
            messages.warning(request, 'You are already registered for this session.')
            return redirect('training:session_detail', pk=session.pk)
        
        # Check if session is full
        if session.max_participants and session.attendees.count() >= session.max_participants:
            messages.error(request, 'This session is full.')
            return redirect('training:session_detail', pk=session.pk)
        
        # Check if session is in the past
        if session.session_date < timezone.now().date():
            messages.error(request, 'Cannot register for past sessions.')
            return redirect('training:session_detail', pk=session.pk)
        
        # Register user
        session.attendees.add(request.user)
        
        messages.success(
            request,
            f'Successfully registered for "{session.title}" on {session.session_date}.'
        )
        
        return redirect('training:session_detail', pk=session.pk)


# Training Officer Views

class TrainingOfficerDashboard(IsTrainingOfficerMixin, ListView):
    """Dashboard for Training Officers"""
    template_name = 'training/officer_dashboard.html'
    context_object_name = 'pending_records'
    
    def get_queryset(self):
        return TrainingRecord.objects.filter(
            verification_status='PENDING'
        ).select_related('member', 'requirement')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Get compliance summary
        from django.contrib.auth.models import User
        active_members = User.objects.filter(is_active=True)
        
        compliance_data = []
        for member in active_members:
            compliance = TrainingComplianceChecker.check_member_compliance(member)
            compliance_data.append({
                'member': member,
                'compliance_percentage': compliance['compliance_percentage'],
                'non_compliant_count': len(compliance['non_compliant']),
                'expiring_soon_count': len(compliance['expiring_soon'])
            })
        
        # Sort by compliance percentage
        compliance_data.sort(key=lambda x: x['compliance_percentage'])
        
        context.update({
            'compliance_data': compliance_data,
            'upcoming_sessions': TrainingSession.objects.filter(
                session_date__gte=timezone.now().date(),
                is_cancelled=False
            ).order_by('session_date')[:5],
            'recent_evaluations': PracticalEvaluation.objects.all().order_by('-evaluation_date')[:10],
        })
        
        return context


class VerifyTrainingRecord(IsTrainingOfficerMixin, UpdateView):
    """Verify a training record"""
    model = TrainingRecord
    form_class = SignOffForm
    template_name = 'training/verify_record.html'
    success_url = reverse_lazy('training:officer_dashboard')
    
    def form_valid(self, form):
        record = form.save(commit=False)
        
        action = self.request.POST.get('action')
        
        if action == 'approve':
            record.verification_status = 'APPROVED'
            record.verified_by = self.request.user
            record.verified_at = timezone.now()
            messages.success(
                self.request,
                f'Training record approved for {record.member.get_full_name()}'
            )
        elif action == 'reject':
            record.verification_status = 'REJECTED'
            record.verified_by = self.request.user
            record.verified_at = timezone.now()
            messages.warning(
                self.request,
                f'Training record rejected for {record.member.get_full_name()}'
            )
        
        record.save()
        
        # Notify member
        self._notify_member(record)
        
        return redirect(self.success_url)
    
    def _notify_member(self, record):
        """Notify member of verification decision"""
        from core.notifications import NotificationManager, NotificationType, NotificationPriority
        
        if record.verification_status == 'APPROVED':
            subject = f"Training Record Approved: {record.requirement.name}"
            message = f"Your training record for {record.requirement.name} has been approved."
            priority = NotificationPriority.MEDIUM
        else:
            subject = f"Training Record Rejected: {record.requirement.name}"
            message = f"Your training record for {record.requirement.name} was rejected. Reason: {record.verification_notes or 'Not provided'}"
            priority = NotificationPriority.HIGH
        
        NotificationManager.send_notification(
            notification_type=NotificationType.TRAINING_REQUIRED,
            recipients=[record.member],
            subject=subject,
            message=message,
            priority=priority
        )


class ConductPracticalEvaluation(IsTrainingOfficerMixin, CreateView):
    """Conduct a practical evaluation"""
    model = PracticalEvaluation
    form_class = PracticalEvaluationForm
    template_name = 'training/conduct_evaluation.html'
    success_url = reverse_lazy('training:officer_dashboard')
    
    def form_valid(self, form):
        form.instance.evaluator = self.request.user
        form.instance.evaluation_date = timezone.now().date()
        
        response = super().form_valid(form)
        
        messages.success(
            self.request,
            f'Evaluation completed for {form.instance.member.get_full_name()}'
        )
        
        # Notify member of results
        self._notify_member(form.instance)
        
        return response
    
    def _notify_member(self, evaluation):
        """Notify member of evaluation results"""
        from core.notifications import NotificationManager, NotificationType, NotificationPriority
        
        if evaluation.result == 'PASS':
            subject = f"Evaluation Passed: {evaluation.get_evaluation_type_display()}"
            message = f"Congratulations! You passed your {evaluation.get_evaluation_type_display()} evaluation."
            priority = NotificationPriority.MEDIUM
        elif evaluation.result == 'FAIL':
            subject = f"Evaluation Not Passed: {evaluation.get_evaluation_type_display()}"
            message = f"Your {evaluation.get_evaluation_type_display()} evaluation requires additional practice. Please review the feedback and schedule a re-evaluation."
            priority = NotificationPriority.HIGH
        else:  # REMEDIAL
            subject = f"Remedial Training Required: {evaluation.get_evaluation_type_display()}"
            message = f"Your {evaluation.get_evaluation_type_display()} evaluation requires remedial training. Please contact your training officer."
            priority = NotificationPriority.HIGH
        
        NotificationManager.send_notification(
            notification_type=NotificationType.TRAINING_REQUIRED,
            recipients=[evaluation.member],
            subject=subject,
            message=message,
            priority=priority
        )


class CreateTrainingSession(IsTrainingOfficerMixin, CreateView):
    """Create a new training session"""
    model = TrainingSession
    form_class = TrainingSessionForm
    template_name = 'training/create_session.html'
    success_url = reverse_lazy('training:officer_dashboard')
    
    def form_valid(self, form):
        form.instance.instructor = self.request.user
        
        response = super().form_valid(form)
        
        messages.success(
            self.request,
            f'Training session "{form.instance.title}" created for {form.instance.session_date}'
        )
        
        return response


class ManageTrainingSession(IsTrainingOfficerMixin, UpdateView):
    """Manage a training session (mark attendance, etc.)"""
    model = TrainingSession
    template_name = 'training/manage_session.html'
    fields = ['is_cancelled', 'notes']
    success_url = reverse_lazy('training:officer_dashboard')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Get attendance records
        attendance = TrainingAttendance.objects.filter(
            session=self.object
        ).select_related('attendee')
        
        context['attendance_records'] = attendance
        context['registered_attendees'] = self.object.attendees.all()
        
        return context
    
    def post(self, request, *args, **kwargs):
        self.object = self.get_object()
        
        # Handle attendance marking
        if 'mark_attendance' in request.POST:
            return self._mark_attendance(request)
        
        return super().post(request, *args, **kwargs)
    
    def _mark_attendance(self, request):
        """Mark attendance for session"""
        session = self.object
        
        # Get all attendee IDs that were checked
        attended_ids = request.POST.getlist('attended')
        
        # Update or create attendance records
        for attendee in session.attendees.all():
            attended = str(attendee.id) in attended_ids
            
            attendance, created = TrainingAttendance.objects.get_or_create(
                session=session,
                attendee=attendee,
                defaults={
                    'attended': attended,
                    'attendance_marked_by': request.user,
                    'attendance_marked_at': timezone.now()
                }
            )
            
            if not created:
                attendance.attended = attended
                attendance.attendance_marked_by = request.user
                attendance.attendance_marked_at = timezone.now()
                attendance.save()
        
        messages.success(request, 'Attendance marked successfully.')
        return redirect('training:manage_session', pk=session.pk)


class ComplianceReport(IsTrainingOfficerMixin, ListView):
    """Generate training compliance report"""
    template_name = 'training/compliance_report.html'
    context_object_name = 'members'
    
    def get_queryset(self):
        from django.contrib.auth.models import User
        return User.objects.filter(is_active=True).order_by('last_name', 'first_name')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Get department-wide compliance
        dept_compliance = TrainingComplianceChecker.get_department_compliance_report()
        
        # Get detailed compliance for each member
        member_compliance = []
        for member in context['members']:
            compliance = TrainingComplianceChecker.check_member_compliance(member)
            member_compliance.append({
                'member': member,
                'data': compliance
            })
        
        context.update({
            'department_compliance': dept_compliance,
            'member_compliance': member_compliance,
        })
        
        return context
