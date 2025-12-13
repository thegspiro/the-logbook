# scheduling/utils.py

from datetime import date, timedelta
from django.db.models import Sum, F, ExpressionWrapper, fields

# Imports for checking qualifications
from accounts.models import PersonnelRecord, FireDeptUser
from scheduling.models import ShiftSlot, ShiftPosition, ShiftAssignment
from compliance.models import ComplianceStandard

# --- 1. Qualification Check Logic ---

def check_member_eligibility(member: FireDeptUser, slot: ShiftSlot) -> (bool, list):
    """
    Determines if a member is qualified to fill a specific ShiftSlot based on 
    their current roles and verified certifications.
    
    Args:
        member: The FireDeptUser attempting to sign up.
        slot: The ShiftSlot (e.g., Driver position on Shift A).
        
    Returns:
        A tuple: (is_qualified: bool, missing_requirements: list)
    """
    position = slot.position
    missing_requirements = []
    
    # 1. Check Required Roles (Django Groups)
    required_roles = position.required_roles.all()
    member_roles = member.groups.all()
    
    # Check if the member has ANY of the required roles (or a higher qualified role)
    if required_roles.exists():
        has_required_role = False
        for req_role in required_roles:
            if req_role in member_roles:
                has_required_role = True
                break
        
        if not has_required_role:
            # Note: This logic needs to consider role hierarchy (e.g., Chief -> Firefighter)
            # For simplicity, we check direct match here.
            missing_requirements.append(f"Requires role: {', '.join([r.name for r in required_roles])}")
            return False, missing_requirements


    # 2. Check Required Certifications
    required_certs = position.required_certifications.all()
    
    if required_certs.exists():
        # Get all VEFIRIED, non-expired certifications for the member
        today = date.today()
        verified_certs = PersonnelRecord.objects.filter(
            member=member,
            is_verified=True,
            document_expiration__gte=today
        ).values_list('certification__name', flat=True)

        for req_cert in required_certs:
            if req_cert.name not in verified_certs:
                missing_requirements.append(f"Missing active and verified certification: {req_cert.name}")

    if missing_requirements:
        return False, missing_requirements
    
    return True, []


# --- 2. Activity Hour Calculation Logic ---

def calculate_activity_hours(member: FireDeptUser, start_date: date, end_date: date) -> dict:
    """
    Calculates the total shift, training, and admin hours for a member 
    within a specified date range.
    """
    
    # A. Shift Hours (Based on ShiftAssignment)
    # We use ExpressionWrapper to ensure the calculation is done in the database
    duration_expression = ExpressionWrapper(
        F('end_datetime') - F('start_datetime'), 
        output_field=fields.DurationField()
    )
    
    shift_hours_queryset = ShiftAssignment.objects.filter(
        shift_slot__member=member,
        date__range=[start_date, end_date]
    ).annotate(
        duration=duration_expression
    ).aggregate(
        total_duration=Sum('duration')
    )
    
    total_shift_seconds = shift_hours_queryset.get('total_duration', timedelta(0)).total_seconds()
    shift_hours = total_shift_seconds / 3600.0 if total_shift_seconds else 0.0

    
    # B. Training/Admin/Other Hours (Based on Events/Meetings - Assuming Event model)
    # NOTE: This requires integrating with a presumed 'events' or 'meetings' app model.
    # We will assume an 'Event' model with an 'Attendance' join table.
    
    # Placeholder for Training/Admin hours (Requires the 'events' app models to be present)
    # The actual logic would sum the duration_minutes of attended events grouped by type.
    
    # total_training_hours = Event.objects.filter(...).aggregate(...)
    total_training_hours = 0.0
    total_admin_hours = 0.0
    total_maintenance_hours = 0.0 # Example of another category
    

    return {
        'shift_hours': round(shift_hours, 2),
        'training_hours': round(total_training_hours, 2),
        'admin_hours': round(total_admin_hours, 2),
        'maintenance_hours': round(total_maintenance_hours, 2),
        'start_date': start_date,
        'end_date': end_date,
    }

# --- 3. Compliance Status Logic ---

def get_member_compliance_status(member: FireDeptUser, period='ANNUAL') -> list:
    """
    Retrieves compliance standards applicable to the member's roles and checks their status.
    """
    
    today = date.today()
    
    # Calculate the reporting period dates
    if period == 'ANNUAL':
        start_date = date(today.year, 1, 1)
        end_date = date(today.year, 12, 31)
    elif period == 'MONTHLY':
        # Simpler date logic for monthly calculation
        start_date = date(today.year, today.month, 1)
        end_date = start_date.replace(day=28) + timedelta(days=4)
        end_date = end_date - timedelta(days=end_date.day)
    else:
        return []

    # 1. Get Member's Recorded Hours for the period
    recorded_hours = calculate_activity_hours(member, start_date, end_date)
    
    # 2. Get Applicable Compliance Standards
    member_roles = member.groups.all()
    standards = ComplianceStandard.objects.filter(role__in=member_roles, time_period=period)
    
    compliance_report = []

    for standard in standards:
        activity = standard.activity_type.lower().replace('_', '') + 's' # shift_hours
        required = float(standard.required_quantity)
        actual = recorded_hours.get(activity, 0.0)
        
        compliance_percentage = (actual / required) * 100 if required > 0 else 100
        
        status = 'PASS'
        if compliance_percentage < 80:
            status = 'FAIL'
        elif compliance_percentage < 100:
            status = 'WARNING'
            
        compliance_report.append({
            'standard_role': standard.role.name,
            'activity': standard.get_activity_type_display(),
            'required': required,
            'actual': actual,
            'percentage': round(compliance_percentage, 1),
            'status': status,
            'time_period': period,
        })
        
    return compliance_report
