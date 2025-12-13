# scheduling/forms.py

from django import forms
from .models import ShiftTemplate, ShiftPosition, ShiftAssignment, ShiftSlot
from django.contrib.auth.models import Group
from accounts.models import Certification

# --- 1. Shift Template Creation Form ---

class ShiftTemplateForm(forms.ModelForm):
    """
    Form to create or edit a ShiftTemplate (e.g., 'Day Shift A').
    """
    class Meta:
        model = ShiftTemplate
        fields = ['name', 'shift_type', 'standard_start_time', 'required_staff']
        widgets = {
            'standard_start_time': forms.TimeInput(format='%H:%M', attrs={'type': 'time'}),
        }

# --- 2. Shift Position Requirement FormSet ---
# Note: In a real Django project, you would use formsets to handle the dynamic 
# addition of required positions (Driver, AIC, etc.) to a ShiftTemplate.

class ShiftPositionRequirementForm(forms.ModelForm):
    """
    A base form for defining the requirements for one position slot within a shift template.
    This form is designed to be used within a FormSet.
    """
    required_roles = forms.ModelMultipleChoiceField(
        queryset=Group.objects.all(),
        required=False,
        widget=forms.CheckboxSelectMultiple
    )
    required_certifications = forms.ModelMultipleChoiceField(
        queryset=Certification.objects.all(),
        required=False,
        widget=forms.CheckboxSelectMultiple
    )
    
    class Meta:
        model = ShiftPosition
        fields = ['name', 'required_roles', 'required_certifications']

# --- 3. Mass Schedule Generation Form (Scheduler Dashboard Tool) ---

class MassScheduleGenerationForm(forms.Form):
    """
    Form used by the Scheduler to generate a large volume of shifts automatically.
    """
    start_date = forms.DateField(
        widget=forms.DateInput(attrs={'type': 'date'}),
        label="Start Date for Generation"
    )
    end_date = forms.DateField(
        widget=forms.DateInput(attrs={'type': 'date'}),
        label="End Date for Generation"
    )
    
    # Allow the scheduler to select which templates to apply to the date range
    templates_to_generate = forms.ModelMultipleChoiceField(
        queryset=ShiftTemplate.objects.all(),
        widget=forms.CheckboxSelectMultiple,
        label="Select Shift Templates to Generate"
    )

### 8. Scheduling Views (`scheduling/views.py`)

This file contains the views for the protected **Scheduler Dashboard** and the logic for mass generating shifts.

```python
# scheduling/views.py

from datetime import timedelta
from django.shortcuts import render, redirect
from django.views.generic import View
from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib import messages
from django.db import transaction

from .models import ShiftTemplate, ShiftAssignment, ShiftSlot, ShiftPosition
from .forms import MassScheduleGenerationForm # Assuming ShiftTemplateForm is also imported
from fd_intranet.utils import is_scheduler # For decorator/mixin

# --- Utility Function: Core Shift Generation Logic ---

def generate_shift_assignments(start_date, end_date, templates):
    """
    Takes a date range and a list of templates and creates ShiftAssignment and ShiftSlot records.
    """
    current_date = start_date
    created_count = 0
    
    while current_date <= end_date:
        for template in templates:
            # 1. Calculate the start and end datetime
            start_datetime = template.standard_start_time
            
            # The assignment's start/end datetime uses the date from the loop
            assignment_start = current_date.replace(
                hour=start_datetime.hour, 
                minute=start_datetime.minute
            )
            assignment_end = assignment_start + timedelta(hours=12)
            
            # 2. Create the ShiftAssignment record
            shift_assignment = ShiftAssignment.objects.create(
                shift_template=template,
                date=current_date,
                start_datetime=assignment_start,
                end_datetime=assignment_end
            )
            
            # 3. Create the required ShiftSlots (The positions that need to be filled)
            # This logic assumes a predefined set of ShiftPosition objects linked to the template
            # For simplicity, we create slots based on required_staff
            # A real implementation would loop through specific ShiftPositionRequirement models
            
            # Placeholder Logic: Create slots for the template's required staff
            
            # For now, we assume a generic position exists (ID 1)
            generic_position = ShiftPosition.objects.first() # REQUIRES initial data to be loaded

            if generic_position:
                for i in range(template.required_staff):
                    ShiftSlot.objects.create(
                        shift_assignment=shift_assignment,
                        position=generic_position
                    )
                
            created_count += 1
            
        current_date += timedelta(days=1)
        
    return created_count

# --- Scheduler Dashboard View (Protected) ---

class SchedulerDashboardView(LoginRequiredMixin, View):
    """
    Protected dashboard for the Scheduler role to manage templates and mass generate shifts.
    """
    template_name = 'scheduling/scheduler_dashboard.html'
    
    def get(self, request):
        if not is_scheduler(request.user):
            messages.error(request, "Access Denied. You must be a Scheduler to view this page.")
            return redirect('dashboard')
            
        template_form = ShiftTemplateForm()
        generation_form = MassScheduleGenerationForm()
        
        shift_templates = ShiftTemplate.objects.all().prefetch_related('shifttemplate_set').order_by('standard_start_time')
        
        context = {
            'template_form': template_form,
            'generation_form': generation_form,
            'shift_templates': shift_templates,
            'upcoming_shifts': ShiftAssignment.objects.filter(date__gte=date.today()).order_by('date')[:10],
        }
        return render(request, self.template_name, context)

    @transaction.atomic
    def post(self, request):
        if not is_scheduler(request.user):
            return redirect('dashboard')
            
        if 'generate_shifts' in request.POST:
            generation_form = MassScheduleGenerationForm(request.POST)
            
            if generation_form.is_valid():
                start_date = generation_form.cleaned_data['start_date']
                end_date = generation_form.cleaned_data['end_date']
                templates = generation_form.cleaned_data['templates_to_generate']
                
                try:
                    count = generate_shift_assignments(start_date, end_date, templates)
                    messages.success(request, f"Successfully created {count} new shift assignments from {start_date} to {end_date}.")
                except Exception as e:
                    messages.error(request, f"Error generating shifts: {e}")
                
            return redirect('scheduler_dashboard')
            
        # Handle ShiftTemplateForm submission here (creating a new template)
        # elif 'create_template' in request.POST:
        #    ...
        
        return redirect('scheduler_dashboard')


# --- Simple View to List Shift Assignments (for members to browse) ---

class ShiftCalendarView(LoginRequiredMixin, View):
    """View showing the entire calendar of available shifts."""
    template_name = 'scheduling/shift_calendar.html'
    
    def get(self, request):
        # Shows shifts and uses AJAX to allow users to sign up for available slots
        upcoming_assignments = ShiftAssignment.objects.filter(
            date__gte=date.today()
        ).prefetch_related('shiftslot_set__member').order_by('date')
        
        context = {'assignments': upcoming_assignments}
        return render(request, self.template_name, context)
