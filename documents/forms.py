"""
Documents Module Forms
"""
from django import forms
from .models import DocumentCategory, Document, DocumentRequest, DocumentAcknowledgment


class DocumentCategoryForm(forms.ModelForm):
    """Form for document categories"""
    
    class Meta:
        model = DocumentCategory
        fields = ['name', 'parent', 'description', 'order', 'icon', 'color', 'requires_officer', 'is_active']
        widgets = {
            'name': forms.TextInput(attrs={'class': 'form-control'}),
            'parent': forms.Select(attrs={'class': 'form-control'}),
            'description': forms.Textarea(attrs={'class': 'form-control', 'rows': 3}),
            'order': forms.NumberInput(attrs={'class': 'form-control'}),
            'icon': forms.TextInput(attrs={'class': 'form-control', 'placeholder': 'fa-file'}),
            'color': forms.TextInput(attrs={'class': 'form-control', 'type': 'color'}),
            'requires_officer': forms.CheckboxInput(attrs={'class': 'form-check-input'}),
            'is_active': forms.CheckboxInput(attrs={'class': 'form-check-input'}),
        }


class DocumentForm(forms.ModelForm):
    """Form for creating/editing documents"""
    
    class Meta:
        model = Document
        fields = [
            'title', 'document_number', 'document_type', 'category',
            'description', 'file', 'version', 'effective_date',
            'review_date', 'tags'
        ]
        widgets = {
            'title': forms.TextInput(attrs={'class': 'form-control'}),
            'document_number': forms.TextInput(attrs={
                'class': 'form-control',
                'placeholder': 'SOP-001'
            }),
            'document_type': forms.Select(attrs={'class': 'form-control'}),
            'category': forms.Select(attrs={'class': 'form-control'}),
            'description': forms.Textarea(attrs={
                'class': 'form-control',
                'rows': 4,
                'placeholder': 'Brief description of this document...'
            }),
            'file': forms.FileInput(attrs={'class': 'form-control'}),
            'version': forms.TextInput(attrs={
                'class': 'form-control',
                'placeholder': '1.0'
            }),
            'effective_date': forms.DateInput(attrs={'type': 'date', 'class': 'form-control'}),
            'review_date': forms.DateInput(attrs={'type': 'date', 'class': 'form-control'}),
            'tags': forms.TextInput(attrs={
                'class': 'form-control',
                'placeholder': 'fire, safety, operations (comma-separated)'
            }),
        }
    
    def clean_file(self):
        """Validate uploaded file"""
        file = self.cleaned_data.get('file')
        
        if file:
            # Check file size (max 50MB)
            if file.size > 50 * 1024 * 1024:
                raise forms.ValidationError('File size must be under 50MB')
            
            # Check file extension
            allowed_extensions = ['.pdf', '.doc', '.docx']
            ext = file.name.lower().split('.')[-1]
            if f'.{ext}' not in allowed_extensions:
                raise forms.ValidationError(
                    'Only PDF and Word documents are allowed'
                )
        
        return file


class NewVersionForm(forms.ModelForm):
    """Form for creating new version of document"""
    change_summary = forms.CharField(
        widget=forms.Textarea(attrs={
            'class': 'form-control',
            'rows': 4,
            'placeholder': 'Describe the changes in this version...'
        }),
        required=True
    )
    
    class Meta:
        model = Document
        fields = ['title', 'description', 'file', 'change_summary']
        widgets = {
            'title': forms.TextInput(attrs={'class': 'form-control'}),
            'description': forms.Textarea(attrs={'class': 'form-control', 'rows': 4}),
            'file': forms.FileInput(attrs={'class': 'form-control'}),
        }


class DocumentRequestForm(forms.ModelForm):
    """Form for requesting documents"""
    
    class Meta:
        model = DocumentRequest
        fields = [
            'request_type', 'category', 'title', 'description',
            'existing_document', 'is_urgent', 'justification',
            'target_completion_date'
        ]
        widgets = {
            'request_type': forms.Select(attrs={'class': 'form-control'}),
            'category': forms.Select(attrs={'class': 'form-control'}),
            'title': forms.TextInput(attrs={
                'class': 'form-control',
                'placeholder': 'Title of requested document'
            }),
            'description': forms.Textarea(attrs={
                'class': 'form-control',
                'rows': 4,
                'placeholder': 'Describe what you need...'
            }),
            'existing_document': forms.Select(attrs={'class': 'form-control'}),
            'is_urgent': forms.CheckboxInput(attrs={'class': 'form-check-input'}),
            'justification': forms.Textarea(attrs={
                'class': 'form-control',
                'rows': 4,
                'placeholder': 'Why is this document needed?'
            }),
            'target_completion_date': forms.DateInput(attrs={'type': 'date', 'class': 'form-control'}),
        }


class AcknowledgmentForm(forms.ModelForm):
    """Form for acknowledging documents"""
    
    class Meta:
        model = DocumentAcknowledgment
        fields = ['notes']
        widgets = {
            'notes': forms.Textarea(attrs={
                'class': 'form-control',
                'rows': 3,
                'placeholder': 'Optional notes or comments...'
            }),
        }
