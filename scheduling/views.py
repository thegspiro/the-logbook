from datetime import date, datetime, timedelta
from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse_lazy
from django.views.generic import TemplateView, View, FormView
from django.contrib.auth.mixins import LoginRequiredMixin
from django.db.models import Sum, Count, Q
from django.http import HttpResponse
from django.contrib import messages
from icalendar import Calendar, Event

from fd_intranet.utils import IsSchedulerMixin
from .models import Shift, ShiftSlot, Position, ShiftTemplate, ShiftSlotTemplate
from .forms import ShiftTemplateForm, ShiftSlotTemplateFormSet, ShiftGenerationForm
from .utils import check_qualification, check_shift_overlap
from django.db import transaction

# --- 1. MEMBER-FACING VIEWS ---

class ShiftCalendarView(LoginRequiredMixin, TemplateView):
    """
    Displays the calendar view of all upcoming shifts, showing open slots.
    This is the primary interface for shift sign-up.
    """
    template_name = 'scheduling/shift_calendar.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Determine the date range for the calendar (e.g., next 90 days)
        start_date = date.today()
        end_date = start_date + timedelta(days=90)
        
        # Fetch all upcoming shifts and related slots
        shifts = Shift.objects.filter(date__gte=start_date, date__lte=end_date).order_by('date')
        
        shift_data = []
        for shift in shifts:
            slots = []
            
            for slot in shift.slots.all().select_related('position', 'filled_by__userprofile'):
                
                is_qualified = True
                if slot.position.required_certification:
                    is_qualified = check_qualification(
                        self.request.user, 
                        slot.position.required_certification.name
                    )

                slots.append({
                    'id': slot.pk,
                    'position': slot.position.code,
                    'filled_by': slot.filled_by.get_full_name() if slot.filled_by else None,
                    'is_filled': slot.is_filled,
                    'is_qualified': is_qualified,
                    'is_user_signed_up': slot.filled_by == self.request.user,
                })
            
            shift_data.append({
                'id': shift.pk,
                'date': shift.date,
                'template_name': shift.shift_template.name,
                'start_time': shift.start_datetime.time,
                'slots': slots,
                'is_fully_staffed': shift.is_fully_staffed,
            })

        context['shift_data'] = shift_data
        context['today'] = start_date
        return context

class ShiftSignupView(LoginRequiredMixin, View):
    """
    Handles POST request for a member to sign up for a specific ShiftSlot.
    Performs qualification and overlap checks before signing up.
    """
    def post(self, request, pk):
        slot = get_object_or_404(ShiftSlot, pk=pk)
        user = request.user
        
        # 1. Check if slot is already filled
        if slot.is_filled:
            messages.error(request, "This slot has already been filled by another member.")
            return redirect(reverse_lazy('scheduling:shift_calendar'))

        # 2. Check for qualification
        required_cert = slot.position.required_certification
        if required_cert and not check_qualification(user, required_cert.name):
            messages.error(request, f"You are not qualified for the {slot.position.code} position (requires: {required_cert.name}).")
            return redirect(reverse_lazy('scheduling:shift_calendar'))

        # 3. Check for shift overlap
        if check_shift_overlap(user, slot):
            messages.error(request, f"You are already signed up for a position on the {slot.shift.shift_template.name} shift on {slot.shift.date}.")
            return redirect(reverse_lazy('scheduling:shift_calendar'))
        
        # 4. Sign up
        slot.filled_by = user
        slot.is_filled = True
        slot.save()

        # Update parent shift status
        slot.shift.is_fully_staffed = slot.shift.slots.filter(is_filled=True).count() == slot.shift.slots.count()
        slot.shift.save()
        
        messages.success(request, f"Successfully signed up for {slot.position.code} on {slot.shift.date}!")
        return redirect(reverse_lazy('scheduling:shift_calendar'))

class ShiftDropView(LoginRequiredMixin, View):
    """
    Handles POST request for a member to drop a ShiftSlot they currently hold.
    """
    def post(self, request, pk):
        slot = get_object_or_404(ShiftSlot, pk=pk)
        user = request.user
        
        if slot.filled_by != user:
            messages.error(request, "You cannot drop a slot you are not currently holding.")
            return redirect(reverse_lazy('scheduling:shift_calendar'))

        # Drop the slot
        slot.filled_by = None
        slot.is_filled = False
        slot.save()

        # Update parent shift status
        slot.shift.is_fully_staffed = False # Must be False now
        slot.shift.save()

        messages.info(request, f"Successfully dropped {slot.position.code} on {slot.shift.date}. It is now open.")
        return redirect(reverse_lazy('scheduling:shift_calendar'))

class ICalExportView(LoginRequiredMixin, View):
    """
    Generates an iCalendar (.ics) file containing the user's scheduled shifts.
    """
    def get(self, request):
        user_shifts = ShiftSlot.objects.filter(filled_by=request.user).order_by('shift__start_datetime')
        
        cal = Calendar()
        cal.add('prodid', '-//FD Intranet Scheduled Shifts//EN')
        cal.add('version', '2.0')
        
        for slot in user_shifts:
            event = Event()
            event.add('summary', f"FD Shift: {slot.position.name} ({slot.position.code})")
            event.add('dtstart', slot.shift.start_datetime)
            event.add('dtend', slot.shift.end_datetime)
            event.add('dtstamp', datetime.now())
            event.add('uid', f'shift-{slot.pk}@fd-intranet.com')
            event.add('location', 'Fire Department Station 1')
            cal.add_component(event)
            
        response = HttpResponse(cal.to_ical(), content_type='text/calendar')
        response['Content-Disposition'] = 'attachment; filename="my_shifts.ics"'
        return response


# --- 2. SCHEDULER-FACING VIEWS (Access restricted by IsSchedulerMixin) ---

class SchedulerDashboardView(IsSchedulerMixin, TemplateView):
    """
    Dashboard for the Scheduler role. Provides tools for generating shifts 
    and managing shift templates.
    """
    template_name = 'scheduling/scheduler_dashboard.html'
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        
        # Tools for Shift Generation (Form and Templates List)
        context['generation_form'] = ShiftGenerationForm()
        context['templates'] = ShiftTemplate.objects.all().order_by('name')
        
        # Simple overview of upcoming shifts
        context['upcoming_shifts'] = Shift.objects.filter(date__gte=date.today()).order_by('date')[:10]
        
        return context


class ShiftTemplateCreateView(IsSchedulerMixin, FormView):
    """
    Allows the Scheduler to define a new ShiftTemplate and its required slots.
    Uses a formset to handle the dynamic creation of ShiftSlotTemplates.
    """
    template_name = 'scheduling/shift_template_form.html'
    form_class = ShiftTemplateForm
    success_url = reverse_lazy('scheduling:scheduler_dashboard')

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        if self.request.POST:
            # Use POST data to repopulate the formset after submission error
            context['slot_formset'] = ShiftSlotTemplateFormSet(self.request.POST, instance=self.object if hasattr(self, 'object') else None)
        else:
            # Use an empty formset for a new template
            context['slot_formset'] = ShiftSlotTemplateFormSet(instance=self.object if hasattr(self, 'object') else None)
        return context

    def post(self, request, *args, **kwargs):
        form = self.get_form()
        context = self.get_context_data()
        slot_formset = context['slot_formset']

        if form.is_valid() and slot_formset.is_valid():
            return self.form_valid(form, slot_formset)
        else:
            return self.form_invalid(form, slot_formset)

    @transaction.atomic
    def form_valid(self, form, slot_formset):
        # 1. Save the ShiftTemplate instance
        template = form.save()
        
        # 2. Link the formset to the template and save slots
        slot_formset.instance = template
        slot_formset.save()
        
        messages.success(self.request, f"Shift Template '{template.name}' and its positions saved successfully!")
        return redirect(self.success_url)

    def form_invalid(self, form, slot_formset):
        messages.error(self.request, "Error creating shift template. Please check the fields below.")
        return self.render_to_response(self.get_context_data(form=form, slot_formset=slot_formset))

class ShiftGeneratorView(IsSchedulerMixin, FormView):
    """
    Handles the bulk generation of Shift instances based on a template and date range.
    """
    form_class = ShiftGenerationForm
    success_url = reverse_lazy('scheduling:scheduler_dashboard')
    
    @transaction.atomic
    def form_valid(self, form):
        template = form.cleaned_data['template']
        start_date = form.cleaned_data['start_date']
        end_date = form.cleaned_data['end_date']
        
        # Use Python's built-in date objects
        current_date = start_date
        shifts_created = 0

        while current_date <= end_date:
            # 1. Check if a shift already exists for this template on this date
            if not Shift.objects.filter(date=current_date, shift_template=template).exists():
                
                # Calculate start/end datetimes
                start_datetime = datetime.combine(current_date, template.start_time)
                end_datetime = start_datetime + timedelta(hours=template.duration_hours)
                
                # 2. Create the Shift instance
                shift = Shift.objects.create(
                    date=current_date,
                    shift_template=template,
                    start_datetime=start_datetime,
                    end_datetime=end_datetime,
                )
                
                # 3. Create the required ShiftSlots from the ShiftSlotTemplates
                for slot_template in template.slots.all():
                    for _ in range(slot_template.count):
                        ShiftSlot.objects.create(
                            shift=shift,
                            position=slot_template.position,
                            is_filled=False # Starts unfilled
                        )
                
                shifts_created += 1

            # Move to the next day
            current_date += timedelta(days=1)
            
        messages.success(self.request, f"Successfully generated {shifts_created} shifts using the '{template.name}' template between {start_date} and {end_date}.")
        return super().form_valid(form)

    def form_invalid(self, form):
        messages.error(self.request, "Error generating shifts. Please correct the fields.")
        return redirect(self.success_url)
