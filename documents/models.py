from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from django.core.validators import FileExtensionValidator


# --- Model 1: DocumentCategory ---

class DocumentCategory(models.Model):
    """
    Organizes documents into categories (SOPs, SOGs, Forms, etc.)
    """
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    
    # Parent category for hierarchical structure
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='subcategories'
    )
    
    # Display order
    order = models.IntegerField(default=0, help_text="Display order (lower numbers first)")
    
    # Icon/color for UI
    icon = models.CharField(max_length=50, blank=True, help_text="CSS icon class")
    color = models.CharField(max_length=7, default='#007bff', help_text="Hex color code")
    
    # Access control
    requires_officer = models.BooleanField(
        default=False,
        help_text="Restrict access to officers only"
    )
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['order', 'name']
        verbose_name_plural = 'Document Categories'
    
    def __str__(self):
        if self.parent:
            return f"{self.parent.name} > {self.name}"
        return self.name
    
    @property
    def full_path(self):
        """Get full category path (e.g., 'Operations > SOPs > Fire')"""
        if self.parent:
            return f"{self.parent.full_path} > {self.name}"
        return self.name


# --- Model 2: Document ---

class Document(models.Model):
    """
    Represents a policy document, SOP, SOG, or form
    """
    DOCUMENT_TYPES = [
        ('SOP', 'Standard Operating Procedure'),
        ('SOG', 'Standard Operating Guideline'),
        ('POLICY', 'Policy Document'),
        ('FORM', 'Form/Template'),
        ('TRAINING', 'Training Material'),
        ('REFERENCE', 'Reference Document'),
        ('OTHER', 'Other'),
    ]
    
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('UNDER_REVIEW', 'Under Review'),
        ('APPROVED', 'Approved'),
        ('ARCHIVED', 'Archived'),
        ('SUPERSEDED', 'Superseded'),
    ]
    
    # Basic info
    title = models.CharField(max_length=300, db_index=True)
    document_number = models.CharField(
        max_length=50,
        unique=True,
        help_text="Unique document identifier (e.g., SOP-001)"
    )
    document_type = models.CharField(max_length=20, choices=DOCUMENT_TYPES)
    category = models.ForeignKey(DocumentCategory, on_delete=models.CASCADE, related_name='documents')
    
    # Content
    description = models.TextField(blank=True, help_text="Brief description of document purpose")
    
    # File storage
    file = models.FileField(
        upload_to='documents/%Y/%m/',
        validators=[FileExtensionValidator(allowed_extensions=['pdf', 'doc', 'docx'])],
        help_text="Upload PDF or Word document"
    )
    file_size = models.IntegerField(blank=True, help_text="File size in bytes")
    
    # Versioning
    version = models.CharField(max_length=20, default='1.0', help_text="Document version number")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    
    # Version control - link to previous version
    supersedes = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='superseded_by_doc',
        help_text="Previous version of this document"
    )
    
    # Dates
    effective_date = models.DateField(
        null=True,
        blank=True,
        help_text="Date this document takes effect"
    )
    review_date = models.DateField(
        null=True,
        blank=True,
        help_text="Date document should be reviewed"
    )
    last_reviewed = models.DateField(null=True, blank=True)
    
    # Authorship
    author = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='documents_authored'
    )
    
    # Approval
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='documents_approved'
    )
    approved_date = models.DateField(null=True, blank=True)
    
    # Tracking
    views = models.IntegerField(default=0, help_text="Number of times document was viewed")
    downloads = models.IntegerField(default=0, help_text="Number of times document was downloaded")
    
    # Tags for searchability
    tags = models.CharField(
        max_length=500,
        blank=True,
        help_text="Comma-separated tags for search"
    )
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)
    
    # Archive flag
    is_archived = models.BooleanField(default=False)
    archived_date = models.DateField(null=True, blank=True)
    
    class Meta:
        ordering = ['document_number']
        indexes = [
            models.Index(fields=['document_number']),
            models.Index(fields=['title']),
            models.Index(fields=['status']),
        ]
    
    def __str__(self):
        return f"{self.document_number} - {self.title} (v{self.version})"
    
    def save(self, *args, **kwargs):
        # Auto-set file size
        if self.file and not self.file_size:
            self.file_size = self.file.size
        
        # Archive superseded document when new version approved
        if self.status == 'APPROVED' and self.supersedes:
            self.supersedes.status = 'SUPERSEDED'
            self.supersedes.is_archived = True
            self.supersedes.archived_date = timezone.now().date()
            self.supersedes.save()
        
        super().save(*args, **kwargs)
    
    @property
    def needs_review(self):
        """Check if document needs review"""
        if self.review_date:
            return self.review_date <= timezone.now().date()
        return False


# --- Model 3: RevisionHistory ---

class RevisionHistory(models.Model):
    """
    Tracks changes made to documents
    """
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='revisions')
    
    # Revision details
    version = models.CharField(max_length=20)
    revision_date = models.DateTimeField(default=timezone.now)
    revised_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    
    # Changes
    change_summary = models.TextField(help_text="Summary of changes made in this revision")
    
    # Optional: store old file
    previous_file = models.FileField(
        upload_to='documents/revisions/',
        null=True,
        blank=True,
        help_text="Backup of previous version"
    )
    
    class Meta:
        ordering = ['-revision_date']
        verbose_name_plural = 'Revision Histories'
    
    def __str__(self):
        return f"{self.document.document_number} v{self.version} - {self.revision_date.date()}"


# --- Model 4: DocumentAcknowledgment ---

class DocumentAcknowledgment(models.Model):
    """
    Tracks member acknowledgment of reading/understanding documents
    """
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='acknowledgments')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='document_acknowledgments')
    
    # Acknowledgment details
    acknowledged_at = models.DateTimeField(default=timezone.now)
    version_acknowledged = models.CharField(max_length=20, help_text="Version that was acknowledged")
    
    # Optional: signature/confirmation
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    
    # Notes
    notes = models.TextField(blank=True, help_text="Optional notes from the member")
    
    class Meta:
        ordering = ['-acknowledged_at']
        unique_together = ('document', 'user', 'version_acknowledged')
    
    def __str__(self):
        return f"{self.user.get_full_name()} acknowledged {self.document.document_number} v{self.version_acknowledged}"


# --- Model 5: DocumentRequest ---

class DocumentRequest(models.Model):
    """
    Allows members to request new documents or updates to existing ones
    """
    REQUEST_TYPES = [
        ('NEW', 'New Document'),
        ('UPDATE', 'Update Existing Document'),
        ('CLARIFICATION', 'Request Clarification'),
    ]
    
    STATUS_CHOICES = [
        ('PENDING', 'Pending Review'),
        ('UNDER_REVIEW', 'Under Review'),
        ('APPROVED', 'Approved'),
        ('IN_PROGRESS', 'In Progress'),
        ('COMPLETED', 'Completed'),
        ('REJECTED', 'Rejected'),
    ]
    
    requested_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='document_requests')
    request_type = models.CharField(max_length=20, choices=REQUEST_TYPES)
    
    # Request details
    title = models.CharField(max_length=300, help_text="Proposed document title or subject")
    description = models.TextField(help_text="Describe what's needed and why")
    category = models.ForeignKey(
        DocumentCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True
    )
    
    # If updating existing document
    existing_document = models.ForeignKey(
        Document,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='update_requests'
    )
    
    # Priority
    is_urgent = models.BooleanField(default=False)
    justification = models.TextField(blank=True, help_text="Why is this urgent?")
    
    # Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    
    # Review
    assigned_to = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_document_requests',
        help_text="Who is working on this request"
    )
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='document_requests_reviewed'
    )
    review_notes = models.TextField(blank=True)
    
    # Completion
    completed_document = models.ForeignKey(
        Document,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='originating_requests',
        help_text="The document that fulfilled this request"
    )
    
    # Timestamps
    request_date = models.DateTimeField(auto_now_add=True)
    target_completion_date = models.DateField(null=True, blank=True)
    completed_date = models.DateField(null=True, blank=True)
    
    class Meta:
        ordering = ['-request_date']
    
    def __str__(self):
        return f"{self.title} - {self.get_status_display()}"


# --- Model 6: DocumentView ---

class DocumentView(models.Model):
    """
    Tracks individual document views for analytics
    """
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='view_logs')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='document_views')
    
    viewed_at = models.DateTimeField(auto_now_add=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    
    # How they accessed it
    access_method = models.CharField(
        max_length=20,
        choices=[('VIEW', 'Viewed Online'), ('DOWNLOAD', 'Downloaded')],
        default='VIEW'
    )
    
    class Meta:
        ordering = ['-viewed_at']
        indexes = [
            models.Index(fields=['document', 'viewed_at']),
        ]
    
    def __str__(self):
        return f"{self.user.get_full_name()} viewed {self.document.document_number}"
