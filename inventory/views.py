from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse_lazy
from django.views.generic import TemplateView, View, CreateView, UpdateView, ListView, DetailView
from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib import messages
from django.db.models import Sum, Q
from django.utils import timezone
from datetime import timedelta

from fd_intranet.utils import IsQuartermasterMixin
from .models import Asset, Category, MaintenanceLog, SupplyRequest
from .forms import AssetForm, CategoryForm, MaintenanceLogForm, SupplyRequestForm, SupplyRequestProcessForm

# --- 1. MEMBER-FACING VIEWS ---

class SupplyRequestCreateView(LoginRequiredMixin, CreateView):
    """
    Allows any logged-in member to submit a request for supplies.
    """
    model = SupplyRequest
    form_class = SupplyRequestForm
    template_name = 'inventory/supply_request_form.html'
    success_url = reverse_lazy('inventory:request_list')

    def form_valid(self, form):
        form.instance.requested_by = self.request.user
        messages.success(self.request, "Your supply request has been submitted to the Quartermaster.")
        return super().form_valid(form)


class SupplyRequestListView(LoginRequiredMixin, ListView):
    """
    Displays a list of the current user's past and pending supply requests.
    """
    model = SupplyRequest
    template_name = 'inventory/supply_request_list.html'
    context_object_name = 'requests'

    def get_queryset(self):
        # Members only see their own requests
        return SupplyRequest.objects.filter(requested_by=self.request.user).order_by('-request_date')


# --- 2. QUARTERMASTER-FACING VIEWS ---

class QuartermasterDashboardView(IsQuartermasterMixin, TemplateView):
    """
    Main landing page for the Quartermaster. Provides an overview of pending requests
    and critical asset status.
    """
    template_name = 'inventory/quartermaster_dashboard.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Pending Requests Overview
        context['pending_requests'] = SupplyRequest.objects.filter(status='PENDING').order_by('-request_date')[:10]
        context['pending_count'] = SupplyRequest.objects.filter(status='PENDING').count()
        
        # Critical Asset Status
        context['out_of_service_count'] = Asset.objects.filter(status='OUT').count()
        
        # Upcoming Inspections (Next 30 days)
        thirty_days = timezone.now().date() + timedelta(days=30)
        context['upcoming_inspections'] = Asset.objects.filter(
            next_inspection_date__lte=thirty_days,
            status='SERVICE'
        ).order_by('next_inspection_date')[:10]
        
        return context


# --- 3. ASSET MANAGEMENT ---

class AssetListView(IsQuartermasterMixin, ListView):
    """Lists all assets with filtering and sorting capabilities."""
    model = Asset
    template_name = 'inventory/asset_list.html'
    context_object_name = 'assets'
    paginate_by = 25

    def get_queryset(self):
        """Get assets with optional filtering"""
        queryset = Asset.objects.all().select_related('category')
        
        # Filter by category
        category_id = self.request.GET.get('category')
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        
        # Filter by status
        status = self.request.GET.get('status')
        if status:
            queryset = queryset.filter(status=status)
        
        # Search functionality
        search = self.request.GET.get('search')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(asset_tag__icontains=search) |
                Q(serial_number__icontains=search)
            )
        
        return queryset.order_by('asset_tag', 'name')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['categories'] = Category.objects.all().order_by('name')
        return context


class AssetDetailView(IsQuartermasterMixin, DetailView):
    """View detailed information about a specific asset"""
    model = Asset
    template_name = 'inventory/asset_detail.html'
    context_object_name = 'asset'
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        # Get maintenance history for this asset
        context['maintenance_logs'] = MaintenanceLog.objects.filter(
            asset=self.object
        ).order_by('-date_of_service')[:10]
        return context


class AssetCreateUpdateView(IsQuartermasterMixin, CreateView):
    """Create or update an asset record"""
    model = Asset
    form_class = AssetForm
    template_name = 'inventory/asset_form.html'
    success_url = reverse_lazy('inventory:asset_list')
    
    def get_object(self, queryset=None):
        """If pk is in URL, this is an update operation"""
        pk = self.kwargs.get('pk')
        if pk:
            return get_object_or_404(Asset, pk=pk)
        return None
    
    def form_valid(self, form):
        if self.object:
            messages.success(self.request, f"Asset {form.instance.asset_tag} updated successfully.")
        else:
            messages.success(self.request, f"Asset {form.instance.asset_tag} created successfully.")
        return super().form_valid(form)


# --- 4. MAINTENANCE LOGS ---

class MaintenanceLogCreateView(IsQuartermasterMixin, CreateView):
    """Create a maintenance log entry for an asset"""
    model = MaintenanceLog
    form_class = MaintenanceLogForm
    template_name = 'inventory/maintenance_log_form.html'
    
    def get_success_url(self):
        # Redirect back to asset detail page
        return reverse_lazy('inventory:asset_detail', kwargs={'pk': self.object.asset.pk})
    
    def form_valid(self, form):
        form.instance.logged_by = self.request.user
        
        # If new inspection date provided, update the asset
        if form.instance.new_next_inspection_date:
            asset = form.instance.asset
            asset.last_inspection_date = form.instance.date_of_service
            asset.next_inspection_date = form.instance.new_next_inspection_date
            asset.save()
        
        messages.success(self.request, "Maintenance log recorded successfully.")
        return super().form_valid(form)
    
    def get_initial(self):
        """Pre-populate asset field if provided in URL"""
        initial = super().get_initial()
        asset_id = self.request.GET.get('asset')
        if asset_id:
            initial['asset'] = asset_id
        return initial


# --- 5. SUPPLY REQUEST QUEUE ---

class SupplyRequestQueueView(IsQuartermasterMixin, ListView):
    """View all pending supply requests for quartermaster to process"""
    model = SupplyRequest
    template_name = 'inventory/supply_request_queue.html'
    context_object_name = 'requests'
    paginate_by = 25
    
    def get_queryset(self):
        queryset = SupplyRequest.objects.all().select_related('requested_by')
        
        # Filter by status
        status = self.request.GET.get('status')
        if status:
            queryset = queryset.filter(status=status)
        else:
            # Default to showing pending requests
            queryset = queryset.filter(status='PENDING')
        
        return queryset.order_by('-request_date')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['status_choices'] = SupplyRequest.STATUS_CHOICES
        return context


class SupplyRequestProcessView(IsQuartermasterMixin, UpdateView):
    """Process a specific supply request"""
    model = SupplyRequest
    form_class = SupplyRequestProcessForm
    template_name = 'inventory/supply_request_process.html'
    success_url = reverse_lazy('inventory:request_queue')
    context_object_name = 'request_obj'  # Avoid name collision with 'request'
    
    def form_valid(self, form):
        # Mark as processed
        if form.instance.status != 'PENDING':
            form.instance.date_processed = timezone.now()
        
        messages.success(
            self.request,
            f"Request from {form.instance.requested_by.get_full_name()} updated to {form.instance.get_status_display()}."
        )
        return super().form_valid(form)


# --- 6. CATEGORY MANAGEMENT ---

class CategoryListView(IsQuartermasterMixin, ListView):
    """List all inventory categories"""
    model = Category
    template_name = 'inventory/category_list.html'
    context_object_name = 'categories'
    
    def get_queryset(self):
        return Category.objects.all().order_by('name')


class CategoryCreateUpdateView(IsQuartermasterMixin, CreateView):
    """Create or update a category"""
    model = Category
    form_class = CategoryForm
    template_name = 'inventory/category_form.html'
    success_url = reverse_lazy('inventory:category_list')
    
    def get_object(self, queryset=None):
        """If pk is in URL, this is an update operation"""
        pk = self.kwargs.get('pk')
        if pk:
            return get_object_or_404(Category, pk=pk)
        return None
    
    def form_valid(self, form):
        if self.object:
            messages.success(self.request, f"Category '{form.instance.name}' updated successfully.")
        else:
            messages.success(self.request, f"Category '{form.instance.name}' created successfully.")
        return super().form_valid(form)
