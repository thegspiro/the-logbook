# compliance/forms.py

from django import forms
from django.contrib.auth.models import Group
from .models import ComplianceStandard, GroupProfile

# --- 1. Compliance Standard Configuration Form ---

class ComplianceStandardForm(forms.ModelForm):
    """
    Form to create or edit a requirement for a specific role (Group).
    """
    class Meta:
        model = ComplianceStandard
        fields = ['role', 'activity_type', 'required_quantity', 'time_period']
        
        widgets = {
            'role': forms.Select(attrs={'class': 'form-control'}),
            'activity_type': forms.Select(attrs={'class': 'form-control'}),
            'time_period': forms.Select(attrs={'class': 'form-control'}),
            'required_quantity': forms.NumberInput(attrs={'step': '0.1', 'min': '0'}),
        }

# --- 2. Group Profile/Metadata Form (For the Safety Net) ---

class GroupProfileForm(forms.ModelForm):
    """
    Form to configure the metadata for a group, enabling the safety net monitoring.
    This form is used when creating a new group or editing an existing one's metadata.
    """
    class Meta:
        model = GroupProfile
        fields = ['group', 'is_temporary', 'max_duration_days', 'warning_email_list']
        
        widgets = {
            'group': forms.Select(attrs={'class': 'form-control', 'disabled': 'disabled'}), # Group should be set via the view
            'is_temporary': forms.CheckboxInput(attrs={'class': 'form-check-input'}),
            'warning_email_list': forms.Textarea(attrs={'rows': 3, 'placeholder': 'chief@dept.org, president@dept.org'}),
        }
        
    def __init__(self, *args, **kwargs):
        # We need to ensure the 'group' field is selectable if a GroupProfile doesn't exist,
        # but is read-only if we are editing an existing one.
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk:
            self.fields['group'].disabled = True
        else:
             # If creating new, show all existing groups without a profile
            groups_with_profile = GroupProfile.objects.values_list('group_id', flat=True)
            self.fields['group'].queryset = Group.objects.exclude(id__in=groups_with_profile)


# --- 3. Reporting Filter Form ---

class ComplianceReportForm(forms.Form):
    """
    Form for the Compliance Officer to define the time range for a compliance audit.
    """
    start_date = forms.DateField(
        widget=forms.DateInput(attrs={'type': 'date'}),
        required=True
    )
    end_date = forms.DateField(
        widget=forms.DateInput(attrs={'type': 'date'}),
        required=True
    )
