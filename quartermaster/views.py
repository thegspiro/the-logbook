"""
Quartermaster Module Views
Handles gear management, inspections, assignments, and requests
"""
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.mixins import LoginRequiredMixin, UserPassesTestMixin
from django.views.generic import ListView, DetailView, CreateView, UpdateView
from django.contrib import messages
from django.urls import reverse_lazy
from django.db.models import Q, Count
from django.utils import timezone
from datetime import timedelta
from .models import (
    GearCategory, GearItem, GearInspection,
    GearAssignment, GearRequest, InventoryAudit
)
from .forms import (
    GearItemForm, GearInspectionForm, GearRequestForm,
    GearAssignmentForm, InventoryAuditForm
)


class IsQuartermasterMixin(UserPassesTestMixin):
    """Mixin to restrict access to Quartermaster"""
    def test_func(self):
        return self.request.user.groups.filter(
            name__in=['Quartermaster', 'Chief Officers']
        ).exists()


# Member-Facing Views

class MemberGearDashboard(LoginRequiredMixin, ListView):
    """Dashboard showing member's assigned gear"""
    template_name = 'quartermaster/member_dashboard.html'
    context_object_name = 'assignments'
    
    def get_queryset(self):
        return GearAssignment.objects.filter(
            assigned_to=self.request.user,
            is_active=True
        ).select_related('gear_item', 'gear_item__category')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Get gear requests
        context['my_requests'] = GearRequest.objects.filter(
            requested_by=self.request.user
        ).order_by('-request_date')[:10]
        
        # Get upcoming inspection reminders
        thirty_days = timezone.now().date() + timedelta(days=30)
        context['upcoming_inspections'] = GearInspection.objects.filter(
            gear_item__gearassignment__assigned_to=self.request.user,
            gear_item__gearassignment__is_active=True,
            next_inspection_due__lte=thirty_days,
            next_inspection_due__gte=timezone.now().date()
        ).select_related('gear_item').distinct()
        
        return context


class GearCatalog(LoginRequiredMixin, ListView):
    """Browse available gear catalog"""
    model = GearItem
    template_name = 'quartermaster/gear_catalog.html'
    context_object_name = 'items'
    paginate_by = 24
    
    def get_queryset(self):
        queryset = GearItem.objects.filter(
            condition__in=['NEW', 'GOOD', 'FAIR']
        ).select_related('category')
        
        # Filter by category
        category_id = self.request.GET.get('category')
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        
        # Filter by availability
        available_only = self.request.GET.get('available')
        if available_only:
            queryset = queryset.filter(is_available=True)
        
        # Search
        search = self.request.GET.get('search')
        if search:
            queryset = queryset.filter(
                Q(item_number__icontains=search) |
                Q(manufacturer__icontains=search) |
                Q(model_number__icontains=search)
            )
        
        return queryset.order_by('category', 'item_number')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['categories'] = GearCategory.objects.all()
        return context


class GearItemDetail(LoginRequiredMixin, DetailView):
    """Detail view of a gear item"""
    model = GearItem
    template_name = 'quartermaster/gear_detail.html'
    context_object_name = 'item'
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Get inspection history
        context['inspections'] = GearInspection.objects.filter(
            gear_item=self.object
        ).order_by('-inspection_date')[:10]
        
        # Get assignment history
        context['assignments'] = GearAssignment.objects.filter(
            gear_item=self.object
        ).order_by('-assigned_date')[:10]
        
        # Check if assigned to current user
        context['is_mine'] = GearAssignment.objects.filter(
            gear_item=self.object,
            assigned_to=self.request.user,
            is_active=True
        ).exists()
        
        return context


class RequestGear(LoginRequiredMixin, CreateView):
    """Submit a gear request"""
    model = GearRequest
    form_class = GearRequestForm
    template_name = 'quartermaster/request_gear.html'
    success_url = reverse_lazy('quartermaster:dashboard')
    
    def form_valid(self, form):
        form.instance.requested_by = self.request.user
        form.instance.request_date = timezone.now().date()
        form.instance.status = 'PENDING'
        
        response = super().form_valid(form)
        
        messages.success(
            self.request,
            'Gear request submitted successfully. You will be notified when it is processed.'
        )
        
        # Notify quartermaster
        self._notify_quartermaster()
        
        return response
    
    def _notify_quartermaster(self):
        """Send notification to quartermaster"""
        from core.notifications import NotificationManager, NotificationType, NotificationPriority
        from django.contrib.auth.models import User
        
        quartermasters = User.objects.filter(
            groups__name='Quartermaster',
            is_active=True
        )
        
        if quartermasters:
            NotificationManager.send_notification(
                notification_type=NotificationType.APPROVAL_NEEDED,
                recipients=list(quartermasters),
                subject=f"New Gear Request from {self.request.user.get_full_name()}",
                message=f"{self.request.user.get_full_name()} has submitted a gear request. Please review in the quartermaster dashboard.",
                priority=NotificationPriority.MEDIUM
            )


class MyGearRequests(LoginRequiredMixin, ListView):
    """List member's gear requests"""
    template_name = 'quartermaster/my_requests.html'
    context_object_name = 'requests'
    
    def get_queryset(self):
        return GearRequest.objects.filter(
            requested_by=self.request.user
        ).order_by('-request_date')


# Quartermaster Views

class QuartermasterDashboard(IsQuartermasterMixin, ListView):
    """Dashboard for Quartermaster"""
    template_name = 'quartermaster/qm_dashboard.html'
    context_object_name = 'pending_requests'
    
    def get_queryset(self):
        return GearRequest.objects.filter(
            status='PENDING'
        ).select_related('requested_by', 'category')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Items needing inspection
        context['inspection_due'] = GearItem.objects.filter(
            gearinspection__next_inspection_due__lte=timezone.now().date() + timedelta(days=30),
            condition__in=['GOOD', 'FAIR']
        ).distinct().count()
        
        # Items approaching retirement
        context['approaching_retirement'] = GearItem.objects.filter(
            category__requires_nfpa_tracking=True
        ).annotate(
            days_remaining=(
                models.F('retirement_date') - timezone.now().date()
            )
        ).filter(
            days_remaining__lte=180,
            days_remaining__gt=0
        ).count()
        
        # Items out of service
        context['out_of_service'] = GearItem.objects.filter(
            condition='OUT_OF_SERVICE'
        ).count()
        
        # Recent inspections
        context['recent_inspections'] = GearInspection.objects.all().order_by('-inspection_date')[:10]
        
        return context


class InventoryManagement(IsQuartermasterMixin, ListView):
    """Manage full inventory"""
    model = GearItem
    template_name = 'quartermaster/inventory.html'
    context_object_name = 'items'
    paginate_by = 50
    
    def get_queryset(self):
        queryset = GearItem.objects.select_related('category', 'assigned_to')
        
        # Filters
        category_id = self.request.GET.get('category')
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        
        condition = self.request.GET.get('condition')
        if condition:
            queryset = queryset.filter(condition=condition)
        
        location = self.request.GET.get('location')
        if location:
            queryset = queryset.filter(current_location__icontains=location)
        
        return queryset.order_by('category', 'item_number')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['categories'] = GearCategory.objects.all()
        context['conditions'] = GearItem.CONDITION_CHOICES
        return context


class AddGearItem(IsQuartermasterMixin, CreateView):
    """Add new gear item to inventory"""
    model = GearItem
    form_class = GearItemForm
    template_name = 'quartermaster/add_gear.html'
    success_url = reverse_lazy('quartermaster:qm_dashboard')
    
    def form_valid(self, form):
        response = super().form_valid(form)
        
        messages.success(
            self.request,
            f'Gear item {form.instance.item_number} added to inventory.'
        )
        
        return response


class EditGearItem(IsQuartermasterMixin, UpdateView):
    """Edit gear item"""
    model = GearItem
    form_class = GearItemForm
    template_name = 'quartermaster/edit_gear.html'
    success_url = reverse_lazy('quartermaster:inventory')


class ConductInspection(IsQuartermasterMixin, CreateView):
    """Conduct gear inspection"""
    model = GearInspection
    form_class = GearInspectionForm
    template_name = 'quartermaster/conduct_inspection.html'
    success_url = reverse_lazy('quartermaster:qm_dashboard')
    
    def form_valid(self, form):
        form.instance.inspector = self.request.user
        form.instance.inspection_date = timezone.now().date()
        
        response = super().form_valid(form)
        
        # Update gear item condition if failed
        if form.instance.result == 'FAIL':
            gear_item = form.instance.gear_item
            gear_item.condition = 'OUT_OF_SERVICE'
            gear_item.is_available = False
            gear_item.save()
            
            messages.warning(
                self.request,
                f'Inspection FAILED. {gear_item.item_number} marked as OUT OF SERVICE.'
            )
        else:
            messages.success(
                self.request,
                f'Inspection completed for {form.instance.gear_item.item_number}'
            )
        
        return response


class AssignGear(IsQuartermasterMixin, CreateView):
    """Assign gear to a member"""
    model = GearAssignment
    form_class = GearAssignmentForm
    template_name = 'quartermaster/assign_gear.html'
    success_url = reverse_lazy('quartermaster:qm_dashboard')
    
    def get_initial(self):
        initial = super().get_initial()
        gear_id = self.request.GET.get('gear')
        if gear_id:
            initial['gear_item'] = gear_id
        return initial
    
    def form_valid(self, form):
        form.instance.assigned_date = timezone.now().date()
        form.instance.is_active = True
        
        # Update gear item
        gear_item = form.instance.gear_item
        gear_item.assigned_to = form.instance.assigned_to
        gear_item.is_available = False
        gear_item.save()
        
        response = super().form_valid(form)
        
        messages.success(
            self.request,
            f'{gear_item.item_number} assigned to {form.instance.assigned_to.get_full_name()}'
        )
        
        # Notify member
        self._notify_member(form.instance)
        
        return response
    
    def _notify_member(self, assignment):
        """Notify member of gear assignment"""
        from core.notifications import NotificationManager, NotificationType, NotificationPriority
        
        NotificationManager.send_notification(
            notification_type=NotificationType.GENERAL_ANNOUNCEMENT,
            recipients=[assignment.assigned_to],
            subject=f"Gear Assigned: {assignment.gear_item.item_number}",
            message=f"You have been assigned gear item {assignment.gear_item.item_number}. "
                   f"Please review the assignment details and sign for receipt.",
            priority=NotificationPriority.MEDIUM
        )


class ProcessGearRequest(IsQuartermasterMixin, UpdateView):
    """Process a gear request"""
    model = GearRequest
    template_name = 'quartermaster/process_request.html'
    fields = ['status', 'issued_item', 'review_notes']
    success_url = reverse_lazy('quartermaster:qm_dashboard')
    
    def form_valid(self, form):
        request_obj = form.save(commit=False)
        
        action = self.request.POST.get('action')
        
        if action == 'approve':
            request_obj.status = 'APPROVED'
            request_obj.reviewed_by = self.request.user
            request_obj.reviewed_at = timezone.now()
            messages.success(self.request, 'Gear request approved.')
        elif action == 'deny':
            request_obj.status = 'DENIED'
            request_obj.reviewed_by = self.request.user
            request_obj.reviewed_at = timezone.now()
            messages.warning(self.request, 'Gear request denied.')
        elif action == 'issue':
            request_obj.status = 'ISSUED'
            request_obj.reviewed_by = self.request.user
            request_obj.reviewed_at = timezone.now()
            request_obj.issued_at = timezone.now()
            messages.success(self.request, 'Gear issued.')
        
        request_obj.save()
        
        # Notify member
        self._notify_member(request_obj)
        
        return redirect(self.success_url)
    
    def _notify_member(self, request_obj):
        """Notify member of request decision"""
        from core.notifications import NotificationManager, NotificationType, NotificationPriority
        
        if request_obj.status == 'APPROVED':
            subject = "Gear Request Approved"
            message = f"Your gear request has been approved. Gear will be issued shortly."
            priority = NotificationPriority.MEDIUM
        elif request_obj.status == 'ISSUED':
            subject = "Gear Issued"
            message = f"Your gear request has been fulfilled. Item: {request_obj.issued_item}"
            priority = NotificationPriority.MEDIUM
        else:  # DENIED
            subject = "Gear Request Denied"
            message = f"Your gear request was denied. Reason: {request_obj.review_notes or 'Not provided'}"
            priority = NotificationPriority.MEDIUM
        
        NotificationManager.send_notification(
            notification_type=NotificationType.GENERAL_ANNOUNCEMENT,
            recipients=[request_obj.requested_by],
            subject=subject,
            message=message,
            priority=priority
        )


class ConductInventoryAudit(IsQuartermasterMixin, CreateView):
    """Conduct inventory audit"""
    model = InventoryAudit
    form_class = InventoryAuditForm
    template_name = 'quartermaster/conduct_audit.html'
    success_url = reverse_lazy('quartermaster:qm_dashboard')
    
    def form_valid(self, form):
        form.instance.conducted_by = self.request.user
        form.instance.audit_date = timezone.now().date()
        
        response = super().form_valid(form)
        
        messages.success(
            self.request,
            f'Inventory audit completed. {form.instance.discrepancies_found} discrepancies found.'
        )
        
        return response
