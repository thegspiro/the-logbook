"""
Documents Module Views
Handles SOGs, SOPs, policies, and document management
"""
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.mixins import LoginRequiredMixin, UserPassesTestMixin
from django.views.generic import ListView, DetailView, CreateView, UpdateView, View
from django.contrib import messages
from django.urls import reverse_lazy
from django.db.models import Q, Count
from django.utils import timezone
from django.http import HttpResponse, FileResponse, Http404
from .models import (
    DocumentCategory, Document, RevisionHistory,
    DocumentAcknowledgment, DocumentRequest, DocumentView
)
from .forms import (
    DocumentCategoryForm, DocumentForm, DocumentRequestForm,
    NewVersionForm, AcknowledgmentForm
)
from .storage import DocumentStorageService


class IsDocumentManagerMixin(UserPassesTestMixin):
    """Mixin to restrict access to document managers"""
    def test_func(self):
        return self.request.user.groups.filter(
            name__in=['Chief Officers', 'Training Officers', 'Secretary']
        ).exists()


# Public/Member Views

class DocumentLibrary(LoginRequiredMixin, ListView):
    """Main document library view"""
    model = Document
    template_name = 'documents/library.html'
    context_object_name = 'documents'
    paginate_by = 25
    
    def get_queryset(self):
        queryset = Document.objects.filter(
            status='APPROVED',
            is_archived=False
        ).select_related('category', 'author')
        
        # Filter by category
        category_id = self.request.GET.get('category')
        if category_id:
            category = get_object_or_404(DocumentCategory, pk=category_id)
            # Include subcategories
            categories = [category] + list(category.get_descendants())
            queryset = queryset.filter(category__in=categories)
        
        # Filter by document type
        doc_type = self.request.GET.get('type')
        if doc_type:
            queryset = queryset.filter(document_type=doc_type)
        
        # Search
        search = self.request.GET.get('search')
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search) |
                Q(document_number__icontains=search) |
                Q(description__icontains=search) |
                Q(tags__icontains=search)
            )
        
        # Sort
        sort = self.request.GET.get('sort', '-modified_at')
        queryset = queryset.order_by(sort)
        
        return queryset
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Get root categories (parent=None)
        context['categories'] = DocumentCategory.objects.filter(
            parent=None,
            is_active=True
        ).order_by('order')
        
        context['document_types'] = Document.DOCUMENT_TYPES
        
        # Documents needing review
        context['needs_review_count'] = Document.objects.filter(
            status='APPROVED',
            is_archived=False
        ).filter(
            Q(review_date__lte=timezone.now().date()) |
            Q(needs_review=True)
        ).count()
        
        return context


class DocumentDetail(LoginRequiredMixin, DetailView):
    """Detail view of a document"""
    model = Document
    template_name = 'documents/document_detail.html'
    context_object_name = 'document'
    
    def get_queryset(self):
        return Document.objects.filter(
            Q(status='APPROVED') | Q(author=self.request.user)
        )
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Check if user has acknowledged
        context['has_acknowledged'] = DocumentAcknowledgment.objects.filter(
            document=self.object,
            user=self.request.user,
            version_acknowledged=self.object.version
        ).exists()
        
        # Get revision history
        context['revisions'] = RevisionHistory.objects.filter(
            document=self.object
        ).order_by('-revision_date')[:10]
        
        # Get superseded documents
        if self.object.supersedes:
            context['previous_version'] = self.object.supersedes
        
        # Log view
        self._log_view()
        
        return context
    
    def _log_view(self):
        """Log document view"""
        ip = self.request.META.get('HTTP_X_FORWARDED_FOR', self.request.META.get('REMOTE_ADDR', '')).split(',')[0].strip()
        user_agent = self.request.META.get('HTTP_USER_AGENT', '')[:500]
        
        DocumentView.objects.create(
            document=self.object,
            user=self.request.user,
            ip_address=ip,
            user_agent=user_agent,
            access_method='VIEW'
        )
        
        # Increment view counter
        self.object.views += 1
        self.object.save(update_fields=['views'])


class DocumentViewer(LoginRequiredMixin, DetailView):
    """PDF viewer for documents"""
    model = Document
    template_name = 'documents/viewer.html'
    context_object_name = 'document'
    
    def get_queryset(self):
        return Document.objects.filter(
            status='APPROVED',
            is_archived=False
        )


class DocumentDownload(LoginRequiredMixin, View):
    """Download a document"""
    
    def get(self, request, pk):
        document = get_object_or_404(
            Document,
            pk=pk,
            status='APPROVED'
        )
        
        # Check if user has access to restricted documents
        if document.category and document.category.requires_officer:
            if not request.user.groups.filter(
                name__in=['Chief Officers', 'Line Officers', 'Training Officers']
            ).exists():
                messages.error(request, 'You do not have permission to download this document.')
                return redirect('documents:document_detail', pk=pk)
        
        # Log download
        self._log_download(document, request)
        
        # Get file URL from storage service
        storage = DocumentStorageService()
        
        try:
            if document.file:
                # Serve the file
                response = FileResponse(document.file.open('rb'))
                response['Content-Type'] = 'application/octet-stream'
                response['Content-Disposition'] = f'attachment; filename="{document.file.name}"'
                
                # Increment download counter
                document.downloads += 1
                document.save(update_fields=['downloads'])
                
                return response
            else:
                raise Http404("Document file not found")
                
        except Exception as e:
            messages.error(request, f'Error downloading document: {str(e)}')
            return redirect('documents:document_detail', pk=pk)
    
    def _log_download(self, document, request):
        """Log document download"""
        ip = request.META.get('HTTP_X_FORWARDED_FOR', request.META.get('REMOTE_ADDR', '')).split(',')[0].strip()
        user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]
        
        DocumentView.objects.create(
            document=document,
            user=request.user,
            ip_address=ip,
            user_agent=user_agent,
            access_method='DOWNLOAD'
        )


class AcknowledgeDocument(LoginRequiredMixin, CreateView):
    """Acknowledge reading a document"""
    model = DocumentAcknowledgment
    form_class = AcknowledgmentForm
    template_name = 'documents/acknowledge.html'
    
    def get_success_url(self):
        return reverse_lazy('documents:document_detail', kwargs={'pk': self.kwargs['pk']})
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['document'] = get_object_or_404(Document, pk=self.kwargs['pk'])
        return context
    
    def form_valid(self, form):
        document = get_object_or_404(Document, pk=self.kwargs['pk'])
        
        # Check if already acknowledged this version
        if DocumentAcknowledgment.objects.filter(
            document=document,
            user=self.request.user,
            version_acknowledged=document.version
        ).exists():
            messages.warning(self.request, 'You have already acknowledged this document.')
            return redirect(self.get_success_url())
        
        form.instance.document = document
        form.instance.user = self.request.user
        form.instance.version_acknowledged = document.version
        
        # Get IP and user agent
        ip = self.request.META.get('HTTP_X_FORWARDED_FOR', self.request.META.get('REMOTE_ADDR', '')).split(',')[0].strip()
        form.instance.ip_address = ip
        form.instance.user_agent = self.request.META.get('HTTP_USER_AGENT', '')[:500]
        
        response = super().form_valid(form)
        
        messages.success(
            self.request,
            f'Acknowledgment recorded for {document.title}'
        )
        
        return response


class RequestDocument(LoginRequiredMixin, CreateView):
    """Request a new document or update"""
    model = DocumentRequest
    form_class = DocumentRequestForm
    template_name = 'documents/request_document.html'
    success_url = reverse_lazy('documents:my_requests')
    
    def form_valid(self, form):
        form.instance.requested_by = self.request.user
        form.instance.status = 'PENDING'
        
        response = super().form_valid(form)
        
        messages.success(
            self.request,
            'Document request submitted successfully.'
        )
        
        # Notify document managers
        self._notify_managers()
        
        return response
    
    def _notify_managers(self):
        """Notify document managers of new request"""
        from core.notifications import NotificationManager, NotificationType, NotificationPriority
        from django.contrib.auth.models import User
        
        managers = User.objects.filter(
            groups__name__in=['Chief Officers', 'Training Officers'],
            is_active=True
        ).distinct()
        
        if managers:
            NotificationManager.send_notification(
                notification_type=NotificationType.APPROVAL_NEEDED,
                recipients=list(managers),
                subject=f"New Document Request from {self.request.user.get_full_name()}",
                message=f"{self.request.user.get_full_name()} has submitted a document request. Please review in the document management dashboard.",
                priority=NotificationPriority.MEDIUM
            )


class MyDocumentRequests(LoginRequiredMixin, ListView):
    """List user's document requests"""
    template_name = 'documents/my_requests.html'
    context_object_name = 'requests'
    
    def get_queryset(self):
        return DocumentRequest.objects.filter(
            requested_by=self.request.user
        ).order_by('-request_date')


# Document Manager Views

class DocumentManagementDashboard(IsDocumentManagerMixin, ListView):
    """Dashboard for document managers"""
    template_name = 'documents/management_dashboard.html'
    context_object_name = 'pending_requests'
    
    def get_queryset(self):
        return DocumentRequest.objects.filter(
            status='PENDING'
        ).select_related('requested_by', 'category')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Documents needing review
        context['needs_review'] = Document.objects.filter(
            status='APPROVED',
            is_archived=False
        ).filter(
            Q(review_date__lte=timezone.now().date()) |
            Q(needs_review=True)
        ).count()
        
        # Drafts
        context['draft_count'] = Document.objects.filter(
            status='DRAFT'
        ).count()
        
        # Under review
        context['review_count'] = Document.objects.filter(
            status='UNDER_REVIEW'
        ).count()
        
        # Recent uploads
        context['recent_documents'] = Document.objects.all().order_by('-created_at')[:10]
        
        return context


class CreateDocument(IsDocumentManagerMixin, CreateView):
    """Create new document"""
    model = Document
    form_class = DocumentForm
    template_name = 'documents/create_document.html'
    success_url = reverse_lazy('documents:management_dashboard')
    
    def form_valid(self, form):
        form.instance.author = self.request.user
        form.instance.status = 'DRAFT'
        
        response = super().form_valid(form)
        
        messages.success(
            self.request,
            f'Document {form.instance.document_number} created as draft.'
        )
        
        return response


class EditDocument(IsDocumentManagerMixin, UpdateView):
    """Edit existing document"""
    model = Document
    form_class = DocumentForm
    template_name = 'documents/edit_document.html'
    success_url = reverse_lazy('documents:management_dashboard')
    
    def get_queryset(self):
        # Can only edit non-finalized documents
        return Document.objects.filter(
            status__in=['DRAFT', 'UNDER_REVIEW']
        )


class CreateNewVersion(IsDocumentManagerMixin, CreateView):
    """Create new version of existing document"""
    model = Document
    form_class = NewVersionForm
    template_name = 'documents/new_version.html'
    success_url = reverse_lazy('documents:management_dashboard')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['original'] = get_object_or_404(Document, pk=self.kwargs['pk'])
        return context
    
    def form_valid(self, form):
        original = get_object_or_404(Document, pk=self.kwargs['pk'])
        
        # Create new version
        new_doc = form.save(commit=False)
        new_doc.author = self.request.user
        new_doc.status = 'DRAFT'
        new_doc.supersedes = original
        new_doc.category = original.category
        new_doc.document_type = original.document_type
        
        # Increment version
        try:
            major, minor = original.version.split('.')
            new_doc.version = f"{major}.{int(minor) + 1}"
        except:
            new_doc.version = "2.0"
        
        new_doc.save()
        
        # Create revision history
        RevisionHistory.objects.create(
            document=new_doc,
            version=new_doc.version,
            revised_by=self.request.user,
            change_summary=form.cleaned_data.get('change_summary', ''),
            previous_file=original.file
        )
        
        messages.success(
            self.request,
            f'New version {new_doc.version} created for {original.title}'
        )
        
        return redirect('documents:document_detail', pk=new_doc.pk)


class ApproveDocument(IsDocumentManagerMixin, UpdateView):
    """Approve a document"""
    model = Document
    fields = []
    template_name = 'documents/approve_document.html'
    success_url = reverse_lazy('documents:management_dashboard')
    
    def get_queryset(self):
        return Document.objects.filter(
            status__in=['DRAFT', 'UNDER_REVIEW']
        )
    
    def form_valid(self, form):
        document = form.save(commit=False)
        document.status = 'APPROVED'
        document.approved_by = self.request.user
        document.approved_date = timezone.now().date()
        
        if not document.effective_date:
            document.effective_date = timezone.now().date()
        
        document.save()
        
        # If this supersedes another document, archive the old one
        if document.supersedes:
            old_doc = document.supersedes
            old_doc.status = 'SUPERSEDED'
            old_doc.is_archived = True
            old_doc.archived_date = timezone.now()
            old_doc.save()
        
        messages.success(
            self.request,
            f'Document {document.document_number} approved and published.'
        )
        
        # Notify relevant users
        self._notify_users(document)
        
        return redirect(self.success_url)
    
    def _notify_users(self, document):
        """Notify users of new/updated document"""
        from core.notifications import notify_document_updated
        from django.contrib.auth.models import User
        
        # Notify all active members if it's a major policy
        if document.document_type in ['SOP', 'POLICY']:
            users = User.objects.filter(is_active=True)
            notify_document_updated(document, users)


class ArchiveDocument(IsDocumentManagerMixin, UpdateView):
    """Archive a document"""
    model = Document
    fields = []
    template_name = 'documents/archive_document.html'
    success_url = reverse_lazy('documents:management_dashboard')
    
    def form_valid(self, form):
        document = form.save(commit=False)
        document.is_archived = True
        document.archived_date = timezone.now()
        document.save()
        
        messages.success(
            self.request,
            f'Document {document.document_number} archived.'
        )
        
        return redirect(self.success_url)


class ProcessDocumentRequest(IsDocumentManagerMixin, UpdateView):
    """Process document request"""
    model = DocumentRequest
    template_name = 'documents/process_request.html'
    fields = ['status', 'assigned_to', 'review_notes', 'completed_document']
    success_url = reverse_lazy('documents:management_dashboard')
    
    def form_valid(self, form):
        request_obj = form.save(commit=False)
        
        action = self.request.POST.get('action')
        
        if action == 'approve':
            request_obj.status = 'APPROVED'
            request_obj.reviewed_by = self.request.user
            request_obj.reviewed_at = timezone.now()
        elif action == 'reject':
            request_obj.status = 'REJECTED'
            request_obj.reviewed_by = self.request.user
            request_obj.reviewed_at = timezone.now()
        elif action == 'assign':
            request_obj.status = 'IN_PROGRESS'
            request_obj.reviewed_by = self.request.user
            request_obj.reviewed_at = timezone.now()
        
        request_obj.save()
        
        # Notify requester
        self._notify_requester(request_obj)
        
        messages.success(self.request, 'Document request processed.')
        return redirect(self.success_url)
    
    def _notify_requester(self, request_obj):
        """Notify requester of decision"""
        from core.notifications import NotificationManager, NotificationType, NotificationPriority
        
        if request_obj.status == 'APPROVED':
            subject = "Document Request Approved"
            message = "Your document request has been approved and assigned."
        elif request_obj.status == 'REJECTED':
            subject = "Document Request Rejected"
            message = f"Your document request was rejected. Reason: {request_obj.review_notes or 'Not provided'}"
        else:
            subject = "Document Request In Progress"
            message = "Your document request is being worked on."
        
        NotificationManager.send_notification(
            notification_type=NotificationType.DOCUMENT_UPDATED,
            recipients=[request_obj.requested_by],
            subject=subject,
            message=message,
            priority=NotificationPriority.MEDIUM
        )


# Category Management

class CategoryManagement(IsDocumentManagerMixin, ListView):
    """Manage document categories"""
    model = DocumentCategory
    template_name = 'documents/category_management.html'
    context_object_name = 'categories'
    
    def get_queryset(self):
        return DocumentCategory.objects.filter(parent=None).order_by('order')


class CreateCategory(IsDocumentManagerMixin, CreateView):
    """Create document category"""
    model = DocumentCategory
    form_class = DocumentCategoryForm
    template_name = 'documents/create_category.html'
    success_url = reverse_lazy('documents:category_management')


class EditCategory(IsDocumentManagerMixin, UpdateView):
    """Edit document category"""
    model = DocumentCategory
    form_class = DocumentCategoryForm
    template_name = 'documents/edit_category.html'
    success_url = reverse_lazy('documents:category_management')


# Reports and Analytics

class DocumentAnalytics(IsDocumentManagerMixin, ListView):
    """Document analytics and usage reports"""
    template_name = 'documents/analytics.html'
    context_object_name = 'documents'
    
    def get_queryset(self):
        return Document.objects.filter(status='APPROVED')
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Most viewed documents
        context['most_viewed'] = Document.objects.filter(
            status='APPROVED'
        ).order_by('-views')[:10]
        
        # Most downloaded
        context['most_downloaded'] = Document.objects.filter(
            status='APPROVED'
        ).order_by('-downloads')[:10]
        
        # Documents by type
        context['by_type'] = Document.objects.filter(
            status='APPROVED'
        ).values('document_type').annotate(count=Count('id'))
        
        # Recent views
        context['recent_views'] = DocumentView.objects.all().order_by('-viewed_at')[:20]
        
        return context


class AcknowledgmentReport(IsDocumentManagerMixin, DetailView):
    """Show who has acknowledged a document"""
    model = Document
    template_name = 'documents/acknowledgment_report.html'
    context_object_name = 'document'
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Get all acknowledgments
        context['acknowledgments'] = DocumentAcknowledgment.objects.filter(
            document=self.object
        ).order_by('-acknowledged_at')
        
        # Get members who haven't acknowledged (if mandatory)
        from django.contrib.auth.models import User
        acknowledged_users = context['acknowledgments'].values_list('user_id', flat=True)
        context['not_acknowledged'] = User.objects.filter(
            is_active=True
        ).exclude(id__in=acknowledged_users)
        
        return context
