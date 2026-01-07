"""
Archives Module Forms
"""
from django import forms
from .models import (
    HistoricalShiftRecord, LegacyMemberData, IncidentArchive,
    AnnualReport, EquipmentHistory
)


class HistoricalShiftRecordForm(forms.ModelForm):
    """Form for historical shift records"""
    
    class Meta:
        model = HistoricalShiftRecord
        fields = [
            'shift_date', 'shift_template_name', 'start_datetime', 'end_datetime',
            'roster', 'total_positions', 'filled_positions', 'was_fully_staffed',
            'calls_responded', 'training_conducted', 'shift_notes',
            'significant_events', 'officer_in_charge'
        ]
        widgets = {
            'shift_date': forms.DateInput(attrs={'type': 'date', 'class': 'form-control'}),
            'shift_template_name': forms.TextInput(attrs={'class': 'form-control'}),
            'start_datetime': forms.DateTimeInput(attrs={'type': 'datetime-local', 'class': 'form-control'}),
            'end_datetime': forms.DateTimeInput(attrs={'type': 'datetime-local', 'class': 'form-control'}),
            'roster': forms.Textarea(attrs={
                'class': 'form-control',
                'rows': 8,
                'placeholder': 'Enter roster as JSON: {"Captain": "John Doe", "Driver": "Jane Smith", ...}'
            }),
            'total_positions': forms.NumberInput(attrs={'class': 'form-control'}),
            'filled_positions': forms.NumberInput(attrs={'class': 'form-control'}),
            'was_fully_staffed': forms.CheckboxInput(attrs={'class': 'form-check-input'}),
            'calls_responded': forms.NumberInput(attrs={'class': 'form-control'}),
            'training_conducted': forms.Textarea(attrs={'class': 'form-control', 'rows': 3}),
            'shift_notes': forms.Textarea(attrs={'class': 'form-control', 'rows': 4}),
            'significant_events': forms.Textarea(attrs={'class': 'form-control', 'rows': 4}),
            'officer_in_charge': forms.TextInput(attrs={'class': 'form-control'}),
        }


class LegacyMemberDataForm(forms.ModelForm):
    """Form for legacy member records"""
    
    class Meta:
        model = LegacyMemberData
        fields = [
            'first_name', 'last_name', 'badge_number', 'hire_date', 'separation_date',
            'separation_type', 'years_of_service', 'highest_rank',
            'certification_history', 'training_history', 'awards_commendations',
            'email', 'phone', 'address', 'photo'
        ]
        widgets = {
            'first_name': forms.TextInput(attrs={'class': 'form-control'}),
            'last_name': forms.TextInput(attrs={'class': 'form-control'}),
            'badge_number': forms.TextInput(attrs={'class': 'form-control'}),
            'hire_date': forms.DateInput(attrs={'type': 'date', 'class': 'form-control'}),
            'separation_date': forms.DateInput(attrs={'type': 'date', 'class': 'form-control'}),
            'separation_type': forms.Select(attrs={'class': 'form-control'}),
            'years_of_service': forms.NumberInput(attrs={'class': 'form-control', 'step': '0.1'}),
            'highest_rank': forms.TextInput(attrs={'class': 'form-control'}),
            'certification_history': forms.Textarea(attrs={
                'class': 'form-control',
                'rows': 4,
                'placeholder': 'List certifications held...'
            }),
            'training_history': forms.Textarea(attrs={
                'class': 'form-control',
                'rows': 4,
                'placeholder': 'List major training completed...'
            }),
            'awards_commendations': forms.Textarea(attrs={
                'class': 'form-control',
                'rows': 4,
                'placeholder': 'List awards and commendations...'
            }),
            'email': forms.EmailInput(attrs={'class': 'form-control'}),
            'phone': forms.TextInput(attrs={'class': 'form-control'}),
            'address': forms.Textarea(attrs={'class': 'form-control', 'rows': 2}),
            'photo': forms.FileInput(attrs={'class': 'form-control'}),
        }


class IncidentArchiveForm(forms.ModelForm):
    """Form for incident archives"""
    
    class Meta:
        model = IncidentArchive
        fields = [
            'incident_number', 'incident_date', 'incident_time', 'incident_type',
            'address', 'latitude', 'longitude', 'dispatch_time', 'enroute_time',
            'onscene_time', 'clear_time', 'units_responded', 'personnel',
            'incident_commander', 'description', 'actions_taken',
            'patient_transported', 'property_damage', 'injuries', 'fatalities',
            'incident_report'
        ]
        widgets = {
            'incident_number': forms.TextInput(attrs={'class': 'form-control'}),
            'incident_date': forms.DateInput(attrs={'type': 'date', 'class': 'form-control'}),
            'incident_time': forms.TimeInput(attrs={'type': 'time', 'class': 'form-control'}),
            'incident_type': forms.Select(attrs={'class': 'form-control'}),
            'address': forms.TextInput(attrs={'class': 'form-control'}),
            'latitude': forms.NumberInput(attrs={'class': 'form-control', 'step': 'any'}),
            'longitude': forms.NumberInput(attrs={'class': 'form-control', 'step': 'any'}),
            'dispatch_time': forms.TimeInput(attrs={'type': 'time', 'class': 'form-control'}),
            'enroute_time': forms.TimeInput(attrs={'type': 'time', 'class': 'form-control'}),
            'onscene_time': forms.TimeInput(attrs={'type': 'time', 'class': 'form-control'}),
            'clear_time': forms.TimeInput(attrs={'type': 'time', 'class': 'form-control'}),
            'units_responded': forms.Textarea(attrs={'class': 'form-control', 'rows': 2}),
            'personnel': forms.Textarea(attrs={'class': 'form-control', 'rows': 3}),
            'incident_commander': forms.TextInput(attrs={'class': 'form-control'}),
            'description': forms.Textarea(attrs={'class': 'form-control', 'rows': 4}),
            'actions_taken': forms.Textarea(attrs={'class': 'form-control', 'rows': 4}),
            'patient_transported': forms.CheckboxInput(attrs={'class': 'form-check-input'}),
            'property_damage': forms.NumberInput(attrs={'class': 'form-control', 'step': '0.01'}),
            'injuries': forms.NumberInput(attrs={'class': 'form-control'}),
            'fatalities': forms.NumberInput(attrs={'class': 'form-control'}),
            'incident_report': forms.FileInput(attrs={'class': 'form-control'}),
        }


class AnnualReportForm(forms.ModelForm):
    """Form for annual reports"""
    
    class Meta:
        model = AnnualReport
        fields = [
            'year', 'total_calls', 'fire_calls', 'ems_calls', 'mva_calls',
            'service_calls', 'false_alarms', 'mutual_aid_given', 'mutual_aid_received',
            'avg_response_time', 'avg_turnout_time', 'total_members',
            'active_firefighters', 'probationary_members', 'officers',
            'new_members', 'separated_members', 'total_training_hours',
            'training_sessions_held', 'certifications_earned', 'apparatus_count',
            'apparatus_hours', 'budget', 'fundraising_revenue',
            'chief_message', 'highlights', 'challenges', 'goals_next_year',
            'report_document'
        ]
        widgets = {
            'year': forms.NumberInput(attrs={'class': 'form-control', 'min': 1900, 'max': 2100}),
            'total_calls': forms.NumberInput(attrs={'class': 'form-control'}),
            'fire_calls': forms.NumberInput(attrs={'class': 'form-control'}),
            'ems_calls': forms.NumberInput(attrs={'class': 'form-control'}),
            'mva_calls': forms.NumberInput(attrs={'class': 'form-control'}),
            'service_calls': forms.NumberInput(attrs={'class': 'form-control'}),
            'false_alarms': forms.NumberInput(attrs={'class': 'form-control'}),
            'mutual_aid_given': forms.NumberInput(attrs={'class': 'form-control'}),
            'mutual_aid_received': forms.NumberInput(attrs={'class': 'form-control'}),
            'avg_response_time': forms.NumberInput(attrs={'class': 'form-control', 'step': '0.1'}),
            'avg_turnout_time': forms.NumberInput(attrs={'class': 'form-control', 'step': '0.1'}),
            'total_members': forms.NumberInput(attrs={'class': 'form-control'}),
            'active_firefighters': forms.NumberInput(attrs={'class': 'form-control'}),
            'probationary_members': forms.NumberInput(attrs={'class': 'form-control'}),
            'officers': forms.NumberInput(attrs={'class': 'form-control'}),
            'new_members': forms.NumberInput(attrs={'class': 'form-control'}),
            'separated_members': forms.NumberInput(attrs={'class': 'form-control'}),
            'total_training_hours': forms.NumberInput(attrs={'class': 'form-control', 'step': '0.5'}),
            'training_sessions_held': forms.NumberInput(attrs={'class': 'form-control'}),
            'certifications_earned': forms.NumberInput(attrs={'class': 'form-control'}),
            'apparatus_count': forms.NumberInput(attrs={'class': 'form-control'}),
            'apparatus_hours': forms.NumberInput(attrs={'class': 'form-control', 'step': '0.1'}),
            'budget': forms.NumberInput(attrs={'class': 'form-control', 'step': '0.01'}),
            'fundraising_revenue': forms.NumberInput(attrs={'class': 'form-control', 'step': '0.01'}),
            'chief_message': forms.Textarea(attrs={'class': 'form-control', 'rows': 6}),
            'highlights': forms.Textarea(attrs={'class': 'form-control', 'rows': 6}),
            'challenges': forms.Textarea(attrs={'class': 'form-control', 'rows': 4}),
            'goals_next_year': forms.Textarea(attrs={'class': 'form-control', 'rows': 4}),
            'report_document': forms.FileInput(attrs={'class': 'form-control'}),
        }


class EquipmentHistoryForm(forms.ModelForm):
    """Form for equipment history"""
    
    class Meta:
        model = EquipmentHistory
        fields = [
            'equipment_name', 'equipment_type', 'unit_number', 'acquisition_date',
            'acquisition_cost', 'manufacturer', 'model', 'year', 'vin_serial',
            'in_service_date', 'out_of_service_date', 'disposition',
            'total_miles', 'total_engine_hours', 'total_calls_responded',
            'significant_events', 'photo', 'documentation'
        ]
        widgets = {
            'equipment_name': forms.TextInput(attrs={'class': 'form-control'}),
            'equipment_type': forms.TextInput(attrs={'class': 'form-control'}),
            'unit_number': forms.TextInput(attrs={'class': 'form-control'}),
            'acquisition_date': forms.DateInput(attrs={'type': 'date', 'class': 'form-control'}),
            'acquisition_cost': forms.NumberInput(attrs={'class': 'form-control', 'step': '0.01'}),
            'manufacturer': forms.TextInput(attrs={'class': 'form-control'}),
            'model': forms.TextInput(attrs={'class': 'form-control'}),
            'year': forms.NumberInput(attrs={'class': 'form-control', 'min': 1900, 'max': 2100}),
            'vin_serial': forms.TextInput(attrs={'class': 'form-control'}),
            'in_service_date': forms.DateInput(attrs={'type': 'date', 'class': 'form-control'}),
            'out_of_service_date': forms.DateInput(attrs={'type': 'date', 'class': 'form-control'}),
            'disposition': forms.Select(attrs={'class': 'form-control'}),
            'total_miles': forms.NumberInput(attrs={'class': 'form-control'}),
            'total_engine_hours': forms.NumberInput(attrs={'class': 'form-control', 'step': '0.1'}),
            'total_calls_responded': forms.NumberInput(attrs={'class': 'form-control'}),
            'significant_events': forms.Textarea(attrs={'class': 'form-control', 'rows': 4}),
            'photo': forms.FileInput(attrs={'class': 'form-control'}),
            'documentation': forms.FileInput(attrs={'class': 'form-control'}),
        }
