# compliance/management/commands/monitor_membership.py

import os
from datetime import date, timedelta
from django.core.management.base import BaseCommand
from django.db.models import Count
from django.core.mail import send_mail
from django.conf import settings
from django.contrib.auth.models import Group

# Import models
from compliance.models import GroupProfile
from accounts.models import FireDeptUser

# --- Configuration ---
# You would configure the actual email addresses in the GroupProfile model instance
SUBJECT_PREFIX = "[CRITICAL INTRANET ALERT]"

# --- Main Command Class ---

class Command(BaseCommand):
    help = 'Runs daily checks for time-bound membership groups and orphaned members.'

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE('--- Running Membership Monitoring Checks ---'))

        # Check 1: Time-Bound Membership Monitoring
        self.monitor_temporary_groups()

        # Check 2: Orphaned Member Check (Zero Groups)
        self.check_for_orphaned_members()

        self.stdout.write(self.style.SUCCESS('Monitoring checks completed.'))

    # --- Check 1: Maximum Duration Exceeded ---

    def monitor_temporary_groups(self):
        """
        Identifies members who have exceeded the max_duration_days in a temporary role.
        """
        
        temporary_profiles = GroupProfile.objects.filter(is_temporary=True, max_duration_days__gt=0)
        
        if not temporary_profiles.exists():
            self.stdout.write("No temporary groups configured. Skipping duration check.")
            return

        for profile in temporary_profiles:
            max_days = profile.max_duration_days
            warning_list = profile.warning_email_list.split(',')
            group_name = profile.group.name
            
            # --- Logic Caveat ---
            # To correctly track the start date, we would need a MemberGroupHistory model 
            # recording the date a user entered a group. Since we don't have that model, 
            # we must use a simplified check based on user creation date as a fallback.
            # A developer MUST implement a Group-to-User join with a 'start_date' field for accuracy.
            
            self.stdout.write(f"Checking group: {group_name} (Max: {max_days} days)")
            
            # Simplified (FALLBACK) Check: Find all users in this group
            members_in_group = FireDeptUser.objects.filter(groups=profile.group)
            
            for member in members_in_group:
                # Using date joined as a simplified proxy for 'group start date'
                days_in_system = (date.today() - member.date_joined.date()).days 
                
                if days_in_system > max_days:
                    
                    self.send_alert(
                        recipients=warning_list,
                        subject=f"{SUBJECT_PREFIX} ACTION REQUIRED: {group_name} Max Duration Exceeded",
                        message=(
                            f"Member: {member.get_full_name()} (ID: {member.id}) has exceeded the maximum "
                            f"duration of {max_days} days in the '{group_name}' role. "
                            f"They joined the system on {member.date_joined.date()} and require reassignment."
                        )
                    )
                    self.stdout.write(self.style.WARNING(f" -> Alert sent for {member.username}."))


    # --- Check 2: Orphaned Member Check ---

    def check_for_orphaned_members(self):
        """
        Identifies active members who are not assigned to any Django Group (role).
        This usually happens after an administrative error (e.g., group deletion).
        """
        
        # Find active members who belong to ZERO groups
        orphaned_members = FireDeptUser.objects.annotate(
            group_count=Count('groups')
        ).filter(
            group_count=0,
            is_active=True,
            is_superuser=False # Exclude the superuser from the check
        )
        
        if orphaned_members.exists():
            # Standard leadership list (Chief, President, Compliance Officer emails)
            # This should ideally be pulled from a configuration model, but we use a hardcoded fallback:
            leadership_emails = os.getenv('DEFAULT_FROM_EMAIL', 'admin@example.com') 
            
            orphaned_names = "\n".join([f"- {m.get_full_name()} ({m.email})" for m in orphaned_members])

            self.send_alert(
                recipients=[leadership_emails],
                subject=f"{SUBJECT_PREFIX} CRITICAL: {orphaned_members.count()} Members Are Unassigned to Any Role",
                message=(
                    f"The following active members are not currently assigned to any operational role (Django Group). "
                    f"This may be due to administrative oversight and requires IMMEDIATE assignment to ensure compliance:\n\n"
                    f"{orphaned_names}\n\n"
                    f"Action Required: Navigate to the Admin Role Assignment page and reassign these members."
                )
            )
            self.stdout.write(self.style.ERROR(f"CRITICAL: Found {orphaned_members.count()} orphaned members. Alert sent."))
        else:
            self.stdout.write("No orphaned members found. System is compliant.")


    # --- Email Utility ---

    def send_alert(self, recipients, subject, message):
        """Helper to send alert emails."""
        try:
            send_mail(
                subject,
                message,
                settings.DEFAULT_FROM_EMAIL,
                recipients,
                fail_silently=False,
            )
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Failed to send email alert: {e}"))
